Q.exports(function (Q) {
	/**
	 * Q plugin's front-end code
	 * @module Q
	 * @class Q.Sandbox
	 */

	/**
	 * Builds a preamble that explodes flat "ns.method" methodNames into
	 * ergonomic namespace objects available inside the sandbox, e.g.:
	 *   methods["streams.get"]  =>  Streams.get(...)
	 *   methods["crypto.openClaim.sign"]  =>  Crypto.openClaim.sign(...)
	 *
	 * Three-level names (e.g. "crypto.openClaim.sign") are nested one level
	 * deep on the top-level namespace object so tool authors can write
	 * Crypto.openClaim.sign(...) naturally.
	 *
	 * The preamble is injected into the sandbox but NOT included in the
	 * execution hash — it is deterministically derived from methodNames
	 * which is already part of the hashed execution record.
	 *
	 * @method buildPreamble
	 * @param {Array} methodNames Flat list of method keys e.g. ["streams.get", ...]
	 * @return {String} JS source to prepend to user code
	 */
	function buildPreamble(methodNames) {
		// top  : { "streams": { "get": "streams.get", "create": "streams.create" } }
		// three: { "crypto":  { "openClaim": { "sign": "crypto.openClaim.sign" } } }
		var top = {};

		methodNames.forEach(function (name) {
			var parts = name.split(".");
			if (parts.length < 2) return; // bare name — no namespace sugar needed

			var ns = parts[0];
			if (!top[ns]) top[ns] = {};

			if (parts.length === 2) {
				// e.g. "streams.get"  ->  top.streams.get = "streams.get"
				top[ns][parts[1]] = name;
			} else {
				// e.g. "crypto.openClaim.sign"
				// ->  top.crypto.openClaim = top.crypto.openClaim || {}
				// ->  top.crypto.openClaim.sign = "crypto.openClaim.sign"
				var sub = parts[1];
				var leaf = parts.slice(2).join(".");
				if (typeof top[ns][sub] !== "object" || top[ns][sub] === null) {
					top[ns][sub] = {};
				}
				top[ns][sub][leaf] = name;
			}
		});

		var lines = [];

		Object.keys(top).forEach(function (ns) {
			// Capitalise first letter: "streams" -> "Streams"
			var varName = ns.charAt(0).toUpperCase() + ns.slice(1);
			var nsObj = top[ns];
			var topProps = [];

			Object.keys(nsObj).forEach(function (key) {
				var val = nsObj[key];

				if (typeof val === "string") {
					// Simple two-level: Streams.get = function(){ return methods["streams.get"](...) }
					topProps.push(
						'  ' + JSON.stringify(key) + ': function() { return methods[' + JSON.stringify(val) + '].apply(null, arguments); }'
					);
				} else {
					// Three-level: Crypto.openClaim = { sign: function(){ ... }, verify: function(){ ... } }
					var subProps = [];
					Object.keys(val).forEach(function (leaf) {
						var fullName = val[leaf];
						subProps.push(
							'    ' + JSON.stringify(leaf) + ': function() { return methods[' + JSON.stringify(fullName) + '].apply(null, arguments); }'
						);
					});
					topProps.push(
						'  ' + JSON.stringify(key) + ': {\n' + subProps.join(',\n') + '\n  }'
					);
				}
			});

			lines.push('var ' + varName + ' = {');
			lines.push(topProps.join(',\n'));
			lines.push('};');
		});

		return lines.join('\n');
	}

	/**
	 * Runs code safely inside a sandboxed Web Worker.
	 * If `options.name` is provided, a persistent worker is reused.
	 *
	 * Inside the sandbox, flat method names like "streams.get" and
	 * "crypto.openClaim.sign" are automatically available as ergonomic
	 * namespace objects: Streams.get(...), Crypto.openClaim.sign(...) etc.
	 * The raw `methods` object is also available for dynamic dispatch.
	 *
	 * @static
	 * @method run
	 * @param {String} code JavaScript source to execute
	 * @param {Object} [context] Variables accessible inside the sandbox
	 * @param {Object} [methods] Async RPC methods exposed as stubs
	 * @param {Object} [options] Additional sandbox configuration
	 * @param {String} [options.name] Reuse a persistent sandbox worker under this name
	 * @param {Number} [options.timeout=2000] Timeout in milliseconds before aborting execution
	 * @param {Boolean} [options.db=false] Whether to expose indexedDB inside sandbox
	 * @param {Boolean|Object} [options.deterministic=false] Deterministic execution mode
	 * @param {Number} [options.deterministic.seed=1] Seed for deterministic RNG
	 * @param {Object} [options.input=null] Input passed as first argument to the sandboxed function
	 * @return {Q.Promise} Resolves with { result, hash } or rejects on error
	 */
	return function Q_Sandbox_run(code, context, methods, options) {
		context = context || {};
		methods = methods || {};
		options = options || {};

		if (!Q.Sandbox._runners) Q.Sandbox._runners = {};

		function SandboxRunner(defaults) {
			this.defaults = {
				timeout: (defaults && defaults.timeout) || 2000,
				db: !!(defaults && defaults.db)
			};
			this.worker = null;
			this.url = null;
		}

		SandboxRunner.prototype.createWorker = function () {
			var allowDB = !!this.defaults.db;

			var script = `
				// --- Hard-disable network & import capabilities ---
				self.fetch = undefined;
				self.XMLHttpRequest = undefined;
				self.WebSocket = undefined;
				self.EventSource = undefined;
				self.importScripts = undefined;

				try {
					Object.defineProperty(self, "navigator", {
						value: { userAgent: "sandbox", language: "en-US" },
						configurable: false
					});
				} catch (e) {}

				self.location = undefined;
				self.caches = undefined;

				if (!${allowDB}) {
					self.indexedDB = undefined;
				}

				// --- Block prototype mutation entry points (Safari-safe) ---
				try {
					Object.defineProperty(Object.prototype, "__defineSetter__",  { value: undefined });
					Object.defineProperty(Object.prototype, "__defineGetter__",  { value: undefined });
					Object.defineProperty(Object.prototype, "__lookupGetter__",  { value: undefined });
					Object.defineProperty(Object.prototype, "__lookupSetter__",  { value: undefined });
				} catch (e) {}

				var rpcCounter = 0;
				var pending = {};

				function call(method, args) {
					return new Promise(function (resolve, reject) {
						var id = ++rpcCounter;
						pending[id] = { resolve: resolve, reject: reject };
						self.postMessage({ type: "rpc", id: id, method: method, args: args });
					});
				}

				self.onmessage = async function (e) {
					var msg = e.data;

					if (msg && msg.type === "rpcResult") {
						var p = pending[msg.id];
						if (!p) return;
						delete pending[msg.id];
						msg.ok ? p.resolve(msg.result) : p.reject(msg.error);
						return;
					}

					try {
						var code          = msg.code;
						var context       = msg.context;
						var methodNames   = msg.methodNames;
						var deterministic = msg.deterministic;
						var input         = msg.input;
						var preamble      = msg.preamble;

						var __seed = 1;
						if (deterministic && typeof deterministic === "object" && deterministic.seed !== undefined) {
							__seed = deterministic.seed >>> 0;
						}

						var __timers = [];
						var __timerGuard = 1000;

						if (deterministic) {
							var __randSeed = (__seed >>> 0) || 1;

							function __rand() {
								__randSeed = (__randSeed * 1664525 + 1013904223) >>> 0;
								return __randSeed / 4294967296;
							}

							Object.defineProperty(self, "__deterministicSeed", {
								value: __randSeed,
								writable: false,
								configurable: false
							});

							Math.random = __rand;
							Object.defineProperty(Math, "random", {
								value: __rand,
								writable: false,
								configurable: false
							});

							var __start = 0;

							Date.now = function () { return __start; };

							if (typeof performance !== "undefined") {
								performance.now = function () { return 0; };
							}

							var __RealDate = Date;

							function DeterministicDate() {
								if (!(this instanceof DeterministicDate)) {
									return new __RealDate(__start).toString();
								}
								if (arguments.length === 0) {
									return new __RealDate(__start);
								}
								var args = Array.prototype.slice.call(arguments);
								return new (Function.prototype.bind.apply(__RealDate, [null].concat(args)));
							}

							DeterministicDate.UTC       = __RealDate.UTC;
							DeterministicDate.parse      = __RealDate.parse;
							DeterministicDate.prototype  = __RealDate.prototype;
							DeterministicDate.prototype.constructor = DeterministicDate;

							Date = DeterministicDate;

							setTimeout  = function (fn) { __timers.push(fn); return __timers.length; };
							setInterval = function (fn) { __timers.push(fn); return __timers.length; };
							clearTimeout  = function () {};
							clearInterval = function () {};

							if (typeof crypto !== "undefined") {
								crypto.getRandomValues = function (arr) {
									for (var i = 0; i < arr.length; i++) {
										arr[i] = Math.floor(__rand() * 256);
									}
									return arr;
								};
								crypto.randomUUID = function () {
									return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
										var r = Math.floor(__rand() * 16);
										return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
									});
								};
								if (crypto.subtle) {
									crypto.subtle = undefined;
								}
							}

							self.fetch = undefined;
							self.XMLHttpRequest = undefined;
							self.WebSocket = undefined;
							self.EventSource = undefined;
							self.navigator = undefined;

							try { Object.freeze(Math); } catch (e) {}
							try { Object.freeze(Date); } catch (e) {}
						}

						// Build flat methods stubs
						var methods = {};
						for (var i = 0; i < methodNames.length; i++) {
							methods[methodNames[i]] = (function (name) {
								return function () { return call(name, Array.prototype.slice.call(arguments)); };
							})(methodNames[i]);
						}

						var __env = Object.assign({}, context || {}, { methods: methods });
						var __envKeys = Object.keys(__env);

						var AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

						// preamble declares ergonomic namespace vars (Streams, Crypto, etc.)
						// and is prepended BEFORE user code but AFTER env destructuring.
						// It is NOT part of the execution hash.
						var userSource = [
							'"use strict";',
							'var {' + __envKeys.join(', ') + '} = __env;',
							'var fetch = undefined;',
							'var XMLHttpRequest = undefined;',
							'var WebSocket = undefined;',
							'var EventSource = undefined;',
							'var importScripts = undefined;',
							'var indexedDB = ' + (${allowDB} ? 'self.indexedDB' : 'undefined') + ';',
							'var IDBFactory = undefined;',
							'var IDBDatabase = undefined;',
							'var IDBObjectStore = undefined;',
							preamble,
							'var __user = async function (input) {',
							code,
							'};',
							'return __user(__input);'
						].join('\n');

						var fn = new AsyncFunction('__env', '__input', userSource);

						fn(__env, input === undefined ? null : input)
						.then(function (result) {
							while (__timers.length && __timerGuard--) {
								try { __timers.shift()(); } catch (e) {}
							}
							__timers.length = 0;
							self.postMessage({ type: "done", ok: true, result: result });
						})
						.catch(function (err) {
							self.postMessage({
								type: "done",
								ok: false,
								error: String(err && err.message || err)
							});
						});

					} catch (err) {
						self.postMessage({
							type: "done",
							ok: false,
							error: String(err && err.message || err)
						});
					}
				};
			`;

			var blob = new Blob([script], { type: "application/javascript" });
			this.url = URL.createObjectURL(blob);
			this.worker = new Worker(this.url);
			return this.worker;
		};

		SandboxRunner.prototype.run = function (code, ctx, methods, opts) {
			opts = opts || {};
			var worker = this.worker || this.createWorker();
			var timeoutMs = opts.timeout || this.defaults.timeout;

			var safeCtx;
			try {
				safeCtx = JSON.parse(JSON.stringify(ctx));
			} catch (e) {
				safeCtx = {};
			}

			var safeInput;
			try {
				safeInput = JSON.parse(JSON.stringify(
					opts.input === undefined ? null : opts.input
				));
			} catch (e) {
				safeInput = null;
			}

			var methodNames = Object.keys(methods);

			// Build the preamble on the host side from methodNames.
			// Sent to the worker alongside the code but kept out of the
			// execution hash (it is fully derived from methodNames).
			var preamble = buildPreamble(methodNames);

			return new Q.Promise(function (resolve, reject) {
				var timer;
				var runner = this;

				var cleanup = function () {
					clearTimeout(timer);
					if (!opts.name) {
						try { URL.revokeObjectURL(runner.url); } catch (e) {}
						try { worker.terminate(); } catch (e) {}
					}
				};

				var rpcLog = [];
				var finished = false;

				worker.onmessage = function (e) {
					var msg = e.data;

					if (msg && msg.type === "rpc") {
						var fn = methods[msg.method];
						if (!fn) {
							worker.postMessage({
								type: "rpcResult",
								id: msg.id,
								ok: false,
								error: "Unknown method: " + msg.method
							});
							return;
						}

						Promise.resolve()
							.then(function () { return fn.apply(null, msg.args); })
							.then(function (result) {
								rpcLog.push({ method: msg.method, args: msg.args, result: result });
								worker.postMessage({ type: "rpcResult", id: msg.id, ok: true, result: result });
							})
							.catch(function (err) {
								var errStr = String(err && err.message || err);
								rpcLog.push({ method: msg.method, args: msg.args, error: errStr });
								worker.postMessage({ type: "rpcResult", id: msg.id, ok: false, error: errStr });
							});
						return;
					}

					if (msg && msg.type === "done") {
						if (finished) return;
						finished = true;

						// Execution hash covers original code + context + input + seed + rpc log + outcome.
						// Preamble is intentionally excluded — it is derived from methodNames already present here.
						var execution = {
							code:    code,
							context: safeCtx,
							input:   safeInput,
							seed: (opts.deterministic && typeof opts.deterministic === "object")
								? opts.deterministic.seed
								: (opts.deterministic ? 1 : undefined),
							rpc:    rpcLog,
							ok:     !!msg.ok,
							result: msg.ok  ? msg.result : undefined,
							error:  !msg.ok ? msg.error  : undefined
						};

						Q.Data.digest("SHA-256", JSON.stringify(execution))
						.then(function (bytes) {
							var hash = Q.Data.toHex(bytes);
							cleanup();
							if (msg.ok) {
								resolve({ result: msg.result, hash: hash });
							} else {
								var err = new Error(msg.error || "Sandbox error");
								err.hash = hash;
								reject(err);
							}
						});
					}
				};

				worker.onerror = function (err) {
					cleanup();
					reject(new Error(err.message || String(err)));
				};

				timer = setTimeout(function () {
					cleanup();
					reject(new Error("Worker timeout / infinite loop"));
				}, timeoutMs);

				worker.postMessage({
					code:          code,
					context:       safeCtx,
					methodNames:   methodNames,
					preamble:      preamble,
					deterministic: opts.deterministic || false,
					input:         safeInput
				});
			}.bind(this));
		};

		var runner;
		if (options.name) {
			runner = Q.Sandbox._runners[options.name];
			if (!runner) {
				runner = new SandboxRunner(options);
				Q.Sandbox._runners[options.name] = runner;
			}
		} else {
			runner = new SandboxRunner(options);
		}

		return runner.run(code, context, methods, options);
	};
});