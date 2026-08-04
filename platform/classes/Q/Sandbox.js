/**
 * @module Q
 */

var Q = require('Q');
var { Worker } = require('worker_threads');
var crypto = require('crypto');

// NOTE: server-side classes are loaded via plain CommonJS `require`, so we run
// the factory immediately and attach Q.Sandbox.run directly — the browser
// counterpart (plugins/Q/web/js/methods/Q/Sandbox/run.js) uses Q.exports(...),
// which only exists in the front-end Q. Using Q.exports here threw
// "Q.exports is not a function" and meant this module never loaded server-side.
(function (Q) {

	/**
	 * Builds a preamble that explodes flat "ns.method" methodNames into
	 * ergonomic namespace objects available inside the sandbox, e.g.:
	 *   methods["streams.get"]              =>  Streams.get(...)
	 *   methods["safebox.protocol.HTTP"]    =>  Safebox.Protocol.HTTP(...)
	 *   methods["safebox.protocol.Files.read"] => Safebox.Protocol.Files.read(...)
	 *
	 * Every namespace SEGMENT (all parts except the final method leaf) is
	 * PascalCased, and nesting is arbitrary-depth. The method leaf keeps its
	 * authored case, so "safebox.protocol.HTTP" stays HTTP and
	 * "safebox.protocol.LLM.Cloudflare" stays Cloudflare. This matches how
	 * shipped capabilities call their protocols (Safebox.Protocol.HTTP, ...).
	 *
	 * The preamble is NOT part of the execution hash — it is deterministically
	 * derived from methodNames, and methodNames IS hashed (sorted), so the
	 * available method surface is recorded authoritatively.
	 *
	 * @method buildPreamble
	 * @param {Array} methodNames Flat list of method keys e.g. ["streams.get", ...]
	 * @return {String} JS source to prepend to user code
	 */
	function buildPreamble(methodNames) {
		function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

		// Build a nested tree. Leaves are marked with { __leaf: <flatKey> }.
		var tree = {};
		methodNames.forEach(function (name) {
			var parts = name.split(".");
			if (parts.length < 2) {
				// bare name — expose verbatim as a top-level function
				tree[name] = { __leaf: name };
				return;
			}
			var node = tree;
			for (var i = 0; i < parts.length - 1; i++) {
				var seg = cap(parts[i]);
				if (!node[seg] || typeof node[seg] !== "object" || node[seg].__leaf) {
					node[seg] = {};
				}
				node = node[seg];
			}
			node[parts[parts.length - 1]] = { __leaf: name };
		});

		function emit(node, indent) {
			var pad = indent;
			var props = [];
			Object.keys(node).forEach(function (key) {
				var v = node[key];
				if (v && v.__leaf) {
					props.push(pad + JSON.stringify(key)
						+ ': function() { return methods[' + JSON.stringify(v.__leaf)
						+ '].apply(null, arguments); }');
				} else {
					props.push(pad + JSON.stringify(key) + ': ' + emit(v, indent + '  '));
				}
			});
			return '{\n' + props.join(',\n') + '\n' + indent + '}';
		}

		var lines = [];
		Object.keys(tree).forEach(function (topKey) {
			var v = tree[topKey];
			if (v && v.__leaf) {
				lines.push('var ' + topKey + ' = function() { return methods['
					+ JSON.stringify(v.__leaf) + '].apply(null, arguments); };');
			} else {
				lines.push('var ' + topKey + ' = ' + emit(v, '  ') + ';');
			}
		});
		return lines.join('\n');
	}

	if (!Q.Sandbox) Q.Sandbox = {};
	if (!Q.Sandbox._runners) Q.Sandbox._runners = {};

	function SandboxRunner(defaults) {
		this.defaults = {
			timeout: (defaults && defaults.timeout) || 2000,
			db: !!(defaults && defaults.db)
		};
		this.worker = null;
		// Deterministic mode locks Math.random with configurable:false, which
		// cannot be undone; a burned worker must not be reused for a
		// non-deterministic run (it would silently return seeded randomness).
		this._deterministicBurned = false;
	}

	SandboxRunner.prototype.createWorker = function () {
		var allowDB = !!this.defaults.db;

		// Worker bootstrap. Runs as a worker_threads eval script. It must NOT use
		// a top-level `return` (illegal under {eval:true}); the whole body is an
		// IIFE so any early exit is function-scoped.
		//
		// Isolation model: worker_threads gives us a separate thread + global.
		// User code additionally has require/process/module/__filename/__dirname
		// and the network globals lexically SHADOWED to undefined inside the
		// AsyncFunction body (the only reliable way — these are local bindings in
		// a worker, not deletable via the worker global). This is the
		// "preferred when available" tier; isolated-vm (in the Safebox
		// SandboxRunner) is the hardening upgrade that also closes
		// Function-constructor escapes. Capabilities are M-of-N governance-
		// approved before they ever reach here, so this is defense-in-depth.
		var script = `
			(function () {
			const { parentPort } = require('worker_threads');

			// Cosmetically null network globals on the worker global too.
			try {
				global.fetch = undefined;
				global.XMLHttpRequest = undefined;
				global.WebSocket = undefined;
				global.EventSource = undefined;
				global.importScripts = undefined;
				global.location = undefined;
				global.caches = undefined;
			} catch (e) {}
			try {
				Object.defineProperty(global, "navigator", {
					value: { userAgent: "sandbox", language: "en-US" },
					configurable: false
				});
			} catch (e) {}
			if (!${allowDB}) {
				try { global.indexedDB = undefined; } catch (e) {}
			}

			// Freeze core prototypes — blocks prototype pollution of shared chains.
			try {
				Object.freeze(Object.prototype);
				Object.freeze(Array.prototype);
				Object.freeze(Function.prototype);
				Object.freeze(String.prototype);
				Object.freeze(Number.prototype);
				Object.freeze(Boolean.prototype);
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
					msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error));
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
						var __randSeed = __seed >>> 0;
						function __rand() {
							__randSeed = (__randSeed * 1664525 + 1013904223) >>> 0;
							return __randSeed / 4294967296;
						}
						Math.random = __rand;
						try {
							Object.defineProperty(Math, "random", { value: __rand, writable: false, configurable: false });
						} catch (e) {}
						var __start = 0;
						var __RealDate = Date;
						Date.now = function () { return __start; };
						setTimeout  = function (fn) { __timers.push(fn); return __timers.length; };
						setInterval = function (fn) { __timers.push(fn); return __timers.length; };
						clearTimeout  = function () {};
						clearInterval = function () {};
						try { Object.freeze(Math); } catch (e) {}
					}

					// Flat method stubs — each dispatches over RPC to the host.
					var methods = {};
					for (var i = 0; i < methodNames.length; i++) {
						methods[methodNames[i]] = (function (name) {
							return function () { return call(name, Array.prototype.slice.call(arguments)); };
						})(methodNames[i]);
					}

					var __env = Object.assign({}, context || {}, { methods: methods });
					var __envKeys = Object.keys(__env);

					var AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

					// Body: destructure env + preamble namespaces, SHADOW every host
					// escape hatch to undefined, then run the capability. Two authoring
					// styles are supported:
					//   (a) body style   — top-level statements ending in \`return X\`
					//   (b) module style — \`module.exports = async function(input){...}\`
					// The module object below is the sandbox's own; it also shadows
					// Node's real module binding.
					var bodyLines = [
						'"use strict";',
						'var {' + __envKeys.join(', ') + '} = __env;',
						// shadow host escape hatches for all user code:
						'var require = undefined, process = undefined, __filename = undefined, __dirname = undefined;',
						'var global = undefined, globalThis = undefined, self = undefined;',
						'var fetch = undefined, XMLHttpRequest = undefined, WebSocket = undefined, EventSource = undefined, importScripts = undefined;',
						'var crypto = undefined;',
						'var indexedDB = undefined;',
						// Read-only Q.Config.get(path, default) backed by a plain config
						// snapshot the caller may pass as context.__configTree. Shipped
						// capabilities read config-driven defaults (image adapter, model
						// names, etc.) via Q.Config.get; without this they throw
						// "Q is not defined". No functions cross the boundary — the getter
						// is reconstructed here over serialized data, so no secrets or host
						// objects are exposed beyond the snapshot the caller chose to pass.
						'var Q = { Config: { get: function(__p, __d){ var __t = (__env && __env.__configTree) || {}; var __ps = Array.isArray(__p) ? __p : String(__p == null ? "" : __p).split("."); for (var __i = 0; __i < __ps.length; __i++){ if (__t == null || typeof __t !== "object") return __d; __t = __t[__ps[__i]]; } return (__t === undefined) ? __d : __t; } } };',
						preamble,
						'var module = { exports: undefined };',
						'var exports = undefined;',
						'var __user = async function (input) {',
						'  var __bodyResult = await (async function () {',
						code,
						'  }).call(undefined);',
						'  if (typeof module.exports === "function") { return await module.exports(input); }',
						'  if (module.exports !== undefined) { return module.exports; }',
						'  return __bodyResult;',
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
						var errMsg;
						if (err && typeof err.message === 'string') errMsg = err.message;
						else if (err === undefined || err === null)  errMsg = String(err);
						else try { errMsg = JSON.stringify(err); } catch (e2) { errMsg = String(err); }
						parentPort.postMessage({ type: "done", ok: false, error: errMsg });
					});

				} catch (err) {
					var errMsg2;
					if (err && typeof err.message === 'string') errMsg2 = err.message;
					else if (err === undefined || err === null)  errMsg2 = String(err);
					else try { errMsg2 = JSON.stringify(err); } catch (e2) { errMsg2 = String(err); }
					parentPort.postMessage({ type: "done", ok: false, error: errMsg2 });
				}
			});
			})();
		`;

		this.worker = new Worker(script, { eval: true });
		return this.worker;
	};

	SandboxRunner.prototype.run = function (code, ctx, methods, opts) {
		opts = opts || {};
		var self = this;
		var worker = this.worker || this.createWorker();

		var timeoutMs = (opts.timeout !== undefined && opts.timeout !== null)
			? opts.timeout
			: this.defaults.timeout;

		var safeCtx;
		try { safeCtx = JSON.parse(JSON.stringify(ctx)); } catch (e) { safeCtx = {}; }

		var safeInput;
		try { safeInput = JSON.parse(JSON.stringify(opts.input === undefined ? null : opts.input)); }
		catch (e) { safeInput = null; }

		var methodNames = Object.keys(methods);
		var preamble = buildPreamble(methodNames);

		var isDeterministicRun = !!opts.deterministic;
		if (isDeterministicRun) self._deterministicBurned = true;

		return new (Q.Promise || Promise)(function (resolve, reject) {
			var timer;
			var finished = false;
			var onMessage, onError;

			var cleanup = function () {
				clearTimeout(timer);
				try { if (onMessage) worker.off('message', onMessage); } catch (e) {}
				try { if (onError)   worker.off('error',   onError);   } catch (e) {}
				var shouldTerminate = !opts.name || self._deterministicBurned;
				if (shouldTerminate) {
					try { worker.terminate(); } catch (e) {}
					self.worker = null;
				}
			};

			var rpcLog = [];

			onMessage = function (msg) {
				if (msg && msg.type === "rpc") {
					var fn = methods[msg.method];
					if (!fn) {
						worker.postMessage({ type: "rpcResult", id: msg.id, ok: false, error: "Unknown method: " + msg.method });
						return;
					}
					Promise.resolve()
						.then(function () { return fn.apply(null, msg.args); })
						.then(function (result) {
							rpcLog.push({ method: msg.method, args: msg.args, result: result });
							worker.postMessage({ type: "rpcResult", id: msg.id, ok: true, result: result });
						})
						.catch(function (err) {
							var errStr;
							if (err && typeof err.message === 'string') errStr = err.message;
							else if (err === undefined || err === null)  errStr = String(err);
							else try { errStr = JSON.stringify(err); } catch (e2) { errStr = String(err); }
							rpcLog.push({ method: msg.method, args: msg.args, error: errStr });
							worker.postMessage({ type: "rpcResult", id: msg.id, ok: false, error: errStr });
						});
					return;
				}

				if (msg && msg.type === "done") {
					if (finished) return;
					finished = true;

					var sortedMethodNames = methodNames.slice().sort();
					var execution = {
						code:        code,
						context:     safeCtx,
						input:       safeInput,
						methodNames: sortedMethodNames,
						seed: (opts.deterministic && typeof opts.deterministic === "object")
							? opts.deterministic.seed
							: (opts.deterministic ? 1 : undefined),
						rpc:    rpcLog,
						ok:     !!msg.ok,
						result: msg.ok  ? msg.result : undefined,
						error:  !msg.ok ? msg.error  : undefined
					};
					var hash = crypto.createHash('sha256').update(JSON.stringify(execution)).digest('hex');
					cleanup();
					if (msg.ok) {
						resolve({ result: msg.result, hash: hash });
					} else {
						var err = new Error(msg.error || "Sandbox error");
						err.hash = hash;
						reject(err);
					}
				}
			};

			onError = function (err) {
				if (finished) return;
				finished = true;
				cleanup();
				reject(new Error(err && err.message ? err.message : String(err)));
			};

			worker.on('message', onMessage);
			worker.on('error',   onError);

			timer = setTimeout(function () {
				if (finished) return;
				finished = true;
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

	Q.Sandbox.run = function (code, context, methods, options) {
		context = context || {};
		methods = methods || {};
		options = options || {};

		var runner;
		if (options.name) {
			runner = Q.Sandbox._runners[options.name];
			if (runner && (runner._deterministicBurned || !runner.worker)) {
				delete Q.Sandbox._runners[options.name];
				runner = null;
			}
			if (!runner) {
				runner = new SandboxRunner(options);
				Q.Sandbox._runners[options.name] = runner;
			}
		} else {
			runner = new SandboxRunner(options);
		}
		return runner.run(code, context, methods, options);
	};

	Q.Sandbox.SandboxRunner = SandboxRunner;
	Q.Sandbox.buildPreamble = buildPreamble;

})(Q);

module.exports = Q.Sandbox;
