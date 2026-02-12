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
						const { code, context, methodNames } = msg;

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
							'const indexedDB = ' + (${allowDB} ? 'indexedDB' : 'undefined') + ';\\n' +
							'const IDBFactory = undefined;\\n' +
							'const IDBDatabase = undefined;\\n' +
							'const IDBObjectStore = undefined;\\n' +
							'return (async () => { ' + code + ' })();'
						);

						const result = await fn(...values);
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
			const worker = this.worker || this.createWorker();
			const timeoutMs = (opts && opts.timeout) || this.defaults.timeout;

			let safeCtx;
			try {
				safeCtx = JSON.parse(JSON.stringify(ctx));
			} catch {
				safeCtx = {};
			}

			const methodNames = Object.keys(methods);

			return new Q.Promise(function (resolve, reject) {
				let timer;

				const cleanup = () => {
					clearTimeout(timer);
					if (!opts.name) {
						try {
							URL.revokeObjectURL(this.url);
							worker.terminate();
						} catch {}
					}
				};

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
								worker.postMessage({
									type: "rpcResult",
									id: msg.id,
									ok: true,
									result
								});
							})
							.catch(err => {
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
						cleanup();
						msg.ok ? resolve(msg.result) : reject(msg.error);
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
					methodNames
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
