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

	function SandboxRunner(defaults) {
		this.defaults = {
			timeout: (defaults && defaults.timeout) || 2000,
			db: !!(defaults && defaults.db)
		};
		this.worker = null;
	}

	SandboxRunner.prototype.createWorker = function () {

		const allowDB = !!this.defaults.db;

		const script = `
			const { parentPort } = require('worker_threads');
			// --- Block Node escape hatches ---
			try {
				Object.defineProperty(global, "require", { value: undefined, writable: false, configurable: false });
				Object.defineProperty(global, "module", { value: undefined, writable: false, configurable: false });
				Object.defineProperty(global, "exports", { value: undefined, writable: false, configurable: false });
				Object.defineProperty(global, "process", { value: undefined, writable: false, configurable: false });
				Object.defineProperty(global, "__filename", { value: undefined, writable: false, configurable: false });
				Object.defineProperty(global, "__dirname", { value: undefined, writable: false, configurable: false });
			} catch {}

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
			} catch {}

			global.location = undefined;
			global.caches = undefined;

			if (!${allowDB}) {
				global.indexedDB = undefined;
			}

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
					parentPort.postMessage({ type: "rpc", id, method, args });
				});
			}

			parentPort.on('message', async function (msg) {

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

					if (deterministic) {

						let __randSeed = (__seed >>> 0) || 1;

						function __rand(){
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

							if (crypto.subtle) {
								crypto.subtle = undefined;
							}

						}

						global.fetch = undefined;
						global.XMLHttpRequest = undefined;
						global.WebSocket = undefined;
						global.EventSource = undefined;
						global.navigator = undefined;

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
						'const crypto = ' + (deterministic ? 'undefined' : '(global.crypto || undefined)') + ';\\n' +
						'const indexedDB = ${allowDB ? 'global.indexedDB' : 'undefined'};\\n' +
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

					parentPort.postMessage({
						type: "done",
						ok: true,
						result
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

		const worker = this.worker || (this.worker = this.createWorker());

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

			const cleanup = () => {
				clearTimeout(timer);
				if (!opts.name) {
					try {
						worker.terminate();
					} catch {}
				}
			};

			const rpcLog = [];
			let finished = false;

			worker.removeAllListeners('message');
			worker.removeAllListeners('error');
			worker.on('message', function (msg) {

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

					const hash = crypto
						.createHash("sha256")
						.update(JSON.stringify(execution))
						.digest("hex");

					// example: emit or store
					Q.emit && Q.emit('Sandbox/executed', { hash, execution });

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
				}

			});

			worker.on('error', function (err) {
				cleanup();
				reject(err.message || String(err));
			});

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

		});
	};

	if (!Q.Sandbox) Q.Sandbox = {};
	if (!Q.Sandbox._runners) Q.Sandbox._runners = {};

	Q.Sandbox.run = function (code, context, methods, options) {

		context = context || {};
		methods = methods || {};
		options = options || {};

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

	return Q.Sandbox.run;

});