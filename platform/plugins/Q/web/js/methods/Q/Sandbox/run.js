Q.exports(function (Q) {
	/**
	 * Q plugin's front-end code
	 * @module Q
	 * @class Q.Sandbox
	 */

	/**
	 * Runs code safely inside a sandboxed Web Worker.
	 * If `options.name` is provided, a persistent worker is reused.
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
	 * @param {Boolean|Object} [options.deterministic=false] Set to true or object to make the code run deterministically
	 * @param {Number} [options.deterministic.seed=1] Seed for deterministic RNG
	 * @return {Q.Promise} Resolves with result or rejects on error
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
			const allowDB = !!this.defaults.db;
			const indexedDBExpr = allowDB ? 'indexedDB' : 'undefined';

			const script = `
				// --- Hard-disable network & import capabilities ---
				self.fetch = undefined;
				self.XMLHttpRequest = undefined;
				self.WebSocket = undefined;
				self.EventSource = undefined;
				self.importScripts = undefined;

				// --- Safe stubs instead of deleting env ---
				try {
					Object.defineProperty(self, "navigator", {
						value: { userAgent: "sandbox", language: "en-US" },
						configurable: false
					});
				} catch {}

				self.location = undefined;
				self.caches = undefined;

				// Optional DB
				if (!${allowDB}) {
					self.indexedDB = undefined;
				}

				// --- Block prototype mutation entry points (Safari-safe) ---
				try {
					Object.defineProperty(Object.prototype, "__defineSetter__", { value: undefined });
					Object.defineProperty(Object.prototype, "__defineGetter__", { value: undefined });
					Object.defineProperty(Object.prototype, "__lookupGetter__", { value: undefined });
					Object.defineProperty(Object.prototype, "__lookupSetter__", { value: undefined });
				} catch {}

				let rpcCounter = 0;
				const pending = {};

				function call(method, args) {
					return new Promise((resolve, reject) => {
						const id = ++rpcCounter;
						pending[id] = { resolve, reject };
						self.postMessage({ type: "rpc", id, method, args });
					});
				}

				self.onmessage = async function (e) {
					const msg = e.data;

					if (msg && msg.type === "rpcResult") {
						const p = pending[msg.id];
						if (!p) return;
						delete pending[msg.id];
						msg.ok ? p.resolve(msg.result) : p.reject(msg.error);
						return;
					}

					try {
						const { code, context, methodNames, deterministic } = msg;

						let __seed = 1;
						if (deterministic && typeof deterministic === "object" && deterministic.seed !== undefined) {
							__seed = deterministic.seed >>> 0;
						}

						const __timers = [];
						let __timerGuard = 1000;

						// --- Deterministic runtime injected only if requested ---
						if (deterministic) {
							let __randSeed = (__seed >>> 0) || 1;

							function __rand(){
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

							const __start = 0;

							Date.now = function(){ return __start };

							if (typeof performance !== "undefined") {
								performance.now = function(){ return 0 };
							}

							const __RealDate = Date;

							function DeterministicDate(...args) {
								if (!(this instanceof DeterministicDate)) {
									return new __RealDate(__start).toString();
								}
								if (args.length === 0) {
									return new __RealDate(__start);
								}
								return new __RealDate(...args);
							}

							DeterministicDate.UTC = __RealDate.UTC;
							DeterministicDate.parse = __RealDate.parse;
							DeterministicDate.prototype = __RealDate.prototype;
							DeterministicDate.prototype.constructor = DeterministicDate;

							Date = DeterministicDate;

							setTimeout = function(fn){ __timers.push(fn); return __timers.length };
							setInterval = function(fn){ __timers.push(fn); return __timers.length };

							clearTimeout = function(){};
							clearInterval = function(){};

							if (typeof crypto !== "undefined") {
								crypto.getRandomValues = function(arr){
									for (let i=0;i<arr.length;i++){
										arr[i] = Math.floor(__rand()*256);
									}
									return arr;
								};

								crypto.randomUUID = function(){
									return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){
										const r = Math.floor(__rand()*16);
										return (c==='x'?r:(r&0x3|0x8)).toString(16);
									});
								};
							}

							self.fetch = undefined;
							self.XMLHttpRequest = undefined;
							self.WebSocket = undefined;
							self.EventSource = undefined;
							self.navigator = undefined;

							try {
								Object.freeze(Math);
								Object.freeze(Date);
							} catch {}
						}

						const methods = {};
						for (const name of methodNames) {
							methods[name] = (...args) => call(name, args);
						}

						const keys = Object.keys(context || {}).concat("methods");
						const values = Object.values(context || {}).concat(methods);

						const AsyncFunction =
							Object.getPrototypeOf(async function () {}).constructor;

						const fn = new AsyncFunction(
							...keys,
							'"use strict";\\n' +
							'const fetch = undefined;\\n' +
							'const XMLHttpRequest = undefined;\\n' +
							'const WebSocket = undefined;\\n' +
							'const EventSource = undefined;\\n' +
							'const importScripts = undefined;\\n' +
							'const indexedDB = ${allowDB ? 'self.indexedDB' : 'undefined'};\\n' +
							'const IDBFactory = undefined;\\n' +
							'const IDBDatabase = undefined;\\n' +
							'const IDBObjectStore = undefined;\\n' +
							'const __user = async function(){\\n' +
							code + '\\n' +
							'};\\n' +
							'return __user();'
						);

						const result = await fn(...values);

						// run deterministic timers
						while (__timers.length && __timerGuard--) {
							try { __timers.shift()(); } catch {}
						}
						__timers.length = 0;

						self.postMessage({ type: "done", ok: true, result });

					} catch (err) {
						self.postMessage({
							type: "done",
							ok: false,
							error: String(err && err.message || err)
						});
					}
				};
			`;

			const blob = new Blob([script], { type: "application/javascript" });
			this.url = URL.createObjectURL(blob);
			this.worker = new Worker(this.url);
			return this.worker;
		};

		SandboxRunner.prototype.run = function (code, ctx, methods, opts) {
			opts = opts || {};
			const worker = this.worker || this.createWorker();
			const timeoutMs = opts.timeout || this.defaults.timeout;

			let safeCtx;
			try {
				safeCtx = JSON.parse(JSON.stringify(ctx));
			} catch {
				safeCtx = {};
			}

			const methodNames = Object.keys(methods);

			return new Q.Promise(function (resolve, reject) {
				let timer;

				const runner = this;
				const cleanup = () => {
					clearTimeout(timer);
					if (!opts.name) {
						try {
							URL.revokeObjectURL(runner.url);
							worker.terminate();
						} catch {}
					}
				};

				const rpcLog = [];
				let finished = false;

				worker.onmessage = function (e) {
					const msg = e.data;

					if (msg && msg.type === "rpc") {
						const fn = methods[msg.method];
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
							.then(() => fn(...msg.args))
							.then(result => {
								rpcLog.push({
									method: msg.method,
									args: msg.args,
									result
								});
								worker.postMessage({
									type: "rpcResult",
									id: msg.id,
									ok: true,
									result
								});
							})
							.catch(err => {
								rpcLog.push({
									method: msg.method,
									args: msg.args,
									error: String(err && err.message || err)
								});

								worker.postMessage({
									type: "rpcResult",
									id: msg.id,
									ok: false,
									error: String(err && err.message || err)
								});
							});
						return;
					}

					if (msg && msg.type === "done") {
						if (finished) return;
						finished = true;
						
						const execution = {
							code,
							context: safeCtx,
							seed: (opts.deterministic && typeof opts.deterministic === "object")
								? opts.deterministic.seed
								: (opts.deterministic ? 1 : undefined),
							rpc: rpcLog,
							ok: !!msg.ok,
							result: msg.ok ? msg.result : undefined,
							error: msg.ok ? undefined : msg.error
						};

						Q.Data.digest("SHA-256", JSON.stringify(execution))
						.then(function (bytes) {
							var hash = Q.Data.toHex(bytes);
							cleanup();
							if (msg.ok) {
								resolve({
									result: msg.result,
									hash
								});
							} else {
								const err = new Error(msg.error || "Sandbox error");
								err.hash = hash;
								reject(err);
							}
						});
					}
				};

				worker.onerror = function (err) {
					cleanup();
					reject(err.message || String(err));
				};

				timer = setTimeout(function () {
					cleanup();
					reject(new Error("Worker timeout / infinite loop"));
				}, timeoutMs);

				worker.postMessage({
					code,
					context: safeCtx,
					methodNames,
					deterministic: opts.deterministic || false
				});
			}.bind(this));
		};

		let runner;
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
