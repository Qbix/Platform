/**
 * @module Q
 */

var Q = require('../Q');
var { Worker } = require('worker_threads');
var crypto = require('crypto');

Q.exports(function (Q) {

	/**
	 * @class Sandbox
	 * @namespace Q
	 */

	/**
	 * Builds a preamble that explodes flat "ns.method" methodNames into
	 * ergonomic namespace objects available inside the sandbox, e.g.:
	 *   methods["streams.get"]        =>  Streams.get(...)
	 *   methods["crypto.openClaim.sign"]  =>  Crypto.openClaim.sign(...)
	 *
	 * Three-level names are nested one level deep on the top-level namespace
	 * object so tool authors can write Crypto.openClaim.sign(...) naturally.
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
		var top = {};

		methodNames.forEach(function (name) {
			var parts = name.split(".");
			if (parts.length < 2) return;

			var ns = parts[0];
			if (!top[ns]) top[ns] = {};

			if (parts.length === 2) {
				top[ns][parts[1]] = name;
			} else {
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
			var varName = ns.charAt(0).toUpperCase() + ns.slice(1);
			var nsObj = top[ns];
			var topProps = [];

			Object.keys(nsObj).forEach(function (key) {
				var val = nsObj[key];

				if (typeof val === "string") {
					topProps.push(
						'  ' + JSON.stringify(key) + ': function() { return methods[' + JSON.stringify(val) + '].apply(null, arguments); }'
					);
				} else {
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

	function SandboxRunner(defaults) {
		this.defaults = {
			timeout: (defaults && defaults.timeout) || 2000,
			db: !!(defaults && defaults.db)
		};
		this.worker = null;
	}

	SandboxRunner.prototype.createWorker = function () {

		var allowDB = !!this.defaults.db;

		var script = `
			const { parentPort } = require('worker_threads');

			// --- Block Node escape hatches ---
			try {
				Object.defineProperty(global, "require",    { value: undefined, writable: false, configurable: false });
				Object.defineProperty(global, "module",     { value: undefined, writable: false, configurable: false });
				Object.defineProperty(global, "exports",    { value: undefined, writable: false, configurable: false });
				Object.defineProperty(global, "process",    { value: undefined, writable: false, configurable: false });
				Object.defineProperty(global, "__filename", { value: undefined, writable: false, configurable: false });
				Object.defineProperty(global, "__dirname",  { value: undefined, writable: false, configurable: false });
			} catch (e) {}

			global.fetch = undefined;
			global.XMLHttpRequest = undefined;
			global.WebSocket = undefined;
			global.EventSource = undefined;
			global.importScripts = undefined;

			try {
				Object.defineProperty(global, "navigator", {
					value: { userAgent: "sandbox", language: "en-US" },
					configurable: false
				});
			} catch (e) {}

			global.location = undefined;
			global.caches = undefined;

			if (!${allowDB}) {
				global.indexedDB = undefined;
			}

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
					parentPort.postMessage({ type: "rpc", id: id, method: method, args: args });
				});
			}

			parentPort.on('message', async function (msg) {

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

						Object.defineProperty(global, "__deterministicSeed", {
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
							var a = Array.prototype.slice.call(arguments);
							return new (Function.prototype.bind.apply(__RealDate, [null].concat(a)));
						}

						DeterministicDate.UTC      = __RealDate.UTC;
						DeterministicDate.parse     = __RealDate.parse;
						DeterministicDate.prototype = __RealDate.prototype;
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

						global.fetch = undefined;
						global.XMLHttpRequest = undefined;
						global.WebSocket = undefined;
						global.EventSource = undefined;
						global.navigator = undefined;

						try { Object.freeze(Math); } catch (e) {}
						try { Object.freeze(Date); } catch (e) {}
					}

					// Build flat method stubs
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
					// injected AFTER env destructuring, BEFORE user code.
					// NOT part of the execution hash.
					var bodyLines = [
						'"use strict";',
						'var {' + __envKeys.join(', ') + '} = __env;',
						'var fetch = undefined;',
						'var XMLHttpRequest = undefined;',
						'var WebSocket = undefined;',
						'var EventSource = undefined;',
						'var importScripts = undefined;',
						'var crypto = ' + (deterministic ? 'undefined' : '(global.crypto || undefined)') + ';',
						'var indexedDB = ' + (${allowDB} ? 'global.indexedDB' : 'undefined') + ';',
						'var IDBFactory = undefined;',
						'var IDBDatabase = undefined;',
						'var IDBObjectStore = undefined;',
						preamble,
						'var __user = async function (input) {',
						code,
						'};',
						'return __user(__input);'
					];

					var fn = new AsyncFunction('__env', '__input', bodyLines.join("\\n"));

					fn(__env, input === undefined ? null : input)
					.then(function (result) {
						while (__timers.length && __timerGuard--) {
							try { __timers.shift()(); } catch (e) {}
						}
						__timers.length = 0;

						parentPort.postMessage({ type: "done", ok: true, result: result });
					})
					.catch(function (err) {
						parentPort.postMessage({
							type: "done",
							ok: false,
							error: String(err && err.message || err)
						});
					});

				} catch (err) {
					parentPort.postMessage({
						type: "done",
						ok: false,
						error: String(err && err.message || err)
					});
				}

			});
		`;

		this.worker = new Worker(script, { eval: true });

		return this.worker;
	};

	SandboxRunner.prototype.run = function (code, ctx, methods, opts) {

		opts = opts || {};

		var worker = this.worker || (this.worker = this.createWorker());
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

		// Build preamble on host side from methodNames.
		// Sent to worker alongside code but excluded from execution hash
		// (fully derived from methodNames already present in the hash).
		var preamble = buildPreamble(methodNames);

		return new Q.Promise(function (resolve, reject) {

			var timer;

			var cleanup = function () {
				clearTimeout(timer);
				if (!opts.name) {
					try { worker.terminate(); } catch (e) {}
				}
			};

			var rpcLog = [];
			var finished = false;

			worker.removeAllListeners('message');
			worker.removeAllListeners('error');

			worker.on('message', function (msg) {

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
					// Preamble intentionally excluded — derived from methodNames already present here.
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

					var hash = crypto
						.createHash("sha256")
						.update(JSON.stringify(execution))
						.digest("hex");

					Q.emit && Q.emit('Sandbox/executed', { hash: hash, execution: execution });

					cleanup();

					if (msg.ok) {
						resolve({ result: msg.result, hash: hash });
					} else {
						var err = new Error(msg.error || "Sandbox error");
						err.hash = hash;
						reject(err);
					}
				}

			});

			worker.on('error', function (err) {
				cleanup();
				reject(new Error(err.message || String(err)));
			});

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

		});
	};

	if (!Q.Sandbox) Q.Sandbox = {};
	if (!Q.Sandbox._runners) Q.Sandbox._runners = {};

	Q.Sandbox.run = function (code, context, methods, options) {

		context = context || {};
		methods = methods || {};
		options = options || {};

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

	return Q.Sandbox.run;

});