Q.exports(function (Q) {
	/**
	 * Runs SafeScript source inside a sandboxed Web Worker with transparent
	 * proxying. This is the "Q.Safebox" pattern: untrusted SafeScript code
	 * executes off the main thread, while scope functions are transparently
	 * proxied via postMessage. Because SafeScript auto-awaits every external
	 * call, the SafeScript source doesn't change — it was already written as
	 * synchronous-looking code.
	 *
	 * Flow:
	 *   1. SafeScript source is compiled to JS on the main thread
	 *   2. The compiled JS is sent to a WebWorker via Q.Sandbox.run()
	 *   3. Scope functions are exposed as RPC methods
	 *   4. The worker calls scope functions via postMessage; main thread executes
	 *      them and sends results back
	 *   5. Because SafeScript awaits every call, this is fully transparent
	 *
	 * @method runSafe
	 * @static
	 * @param {String} source SafeScript source code (not JS — will be compiled)
	 * @param {Object} [scope] Functions and values to expose to the SafeScript code
	 * @param {Object} [options] Options passed to Q.Sandbox.run()
	 * @param {String} [options.name] Reuse a persistent sandbox worker
	 * @param {Number} [options.timeout=5000] Timeout in milliseconds
	 * @return {Q.Promise} Resolves with { result, hash }
	 */
	return function Q_Sandbox_runSafe(source, scope, options) {
		scope = scope || {};
		options = options || {};

		return new Q.Promise(function (resolve, reject) {
			// Step 1: Ensure SafeScript compiler is loaded
			Q.SafeScript.ensureLoaded(function () {
				try {
					// Step 2: Compile SafeScript source to JS
					// Build allow list from scope keys — scope identifiers
					// override the BLOCKED list
					var scopeKeys = Object.keys(scope);
					var allow = {};
					for (var i = 0; i < scopeKeys.length; i++) {
						allow[scopeKeys[i]] = true;
					}
					var compiled = SafeScript.compile(source, { allow: allow });

					// Step 3: Separate scope into context (values) and methods (functions)
					var context = {};
					var methods = {};
					Q.each(scope, function (key, val) {
						if (typeof val === 'function') {
							methods[key] = val;
						} else {
							// Serialize non-function values as context
							try {
								JSON.parse(JSON.stringify(val)); // test serializability
								context[key] = val;
							} catch (e) {
								// Skip non-serializable values
							}
						}
					});

					// Step 4: Run compiled JS in Q.Sandbox with methods as RPC
					// The compiled code uses SafeScript's runtime (__at, __set, etc.)
					// but since it runs inside the sandbox's AsyncFunction constructor,
					// we need to inject the SafeScript runtime helpers.
					// Instead, we run the ORIGINAL source through SafeScript.run()
					// within the worker by passing the compiler itself.
					//
					// Actually, the cleanest approach: compile on main thread,
					// send compiled JS to worker, and let the worker execute it
					// with scope functions available as RPC methods.
					// The compiled code expects __at, __set, __call etc. in scope,
					// so we inject SafeScript's runtime as part of the code.
					var runtimePreamble = _buildSafeScriptRuntimePreamble();
					var fullCode = runtimePreamble + '\n' + compiled.code;

					Q.Sandbox.run(fullCode, context, methods, options)
					.then(resolve)
					.catch(reject);
				} catch (err) {
					reject(err);
				}
			});
		});
	};

	/**
	 * Builds a minimal SafeScript runtime preamble for use inside a WebWorker.
	 * This provides __at, __set, __call, __call_opt, and __check functions
	 * that the compiled SafeScript code expects.
	 * @private
	 */
	function _buildSafeScriptRuntimePreamble() {
		return [
			'// SafeScript runtime helpers (injected for WebWorker execution)',
			'var __BLOCKED_PROPS = {',
			'  "__proto__": true, "constructor": true, "prototype": true,',
			'  "__defineGetter__": true, "__defineSetter__": true,',
			'  "__lookupGetter__": true, "__lookupSetter__": true',
			'};',
			'function __at(obj, key) {',
			'  if (obj == null) throw new TypeError("Cannot read property \\"" + key + "\\" of " + String(obj));',
			'  var k = String(key);',
			'  if (__BLOCKED_PROPS[k]) return undefined;',
			'  return obj[k];',
			'}',
			'function __set(obj, key, val) {',
			'  if (obj == null) throw new TypeError("Cannot set property \\"" + key + "\\" of " + String(obj));',
			'  var k = String(key);',
			'  if (__BLOCKED_PROPS[k]) throw new TypeError("SafeScript: cannot set blocked property \\"" + k + "\\"");',
			'  obj[k] = val;',
			'  return val;',
			'}',
			'var __SAFE_METHODS = {',
			'  "charAt": true, "charCodeAt": true, "codePointAt": true, "concat": true,',
			'  "endsWith": true, "includes": true, "indexOf": true, "lastIndexOf": true,',
			'  "match": true, "normalize": true, "padEnd": true, "padStart": true,',
			'  "repeat": true, "replace": true, "replaceAll": true, "search": true,',
			'  "slice": true, "split": true, "startsWith": true, "substring": true,',
			'  "toLocaleLowerCase": true, "toLocaleUpperCase": true,',
			'  "toLowerCase": true, "toUpperCase": true, "trim": true,',
			'  "trimEnd": true, "trimStart": true, "toString": true, "valueOf": true,',
			'  "toFixed": true, "toPrecision": true, "toExponential": true,',
			'  "push": true, "pop": true, "shift": true, "unshift": true,',
			'  "splice": true, "sort": true, "reverse": true, "fill": true,',
			'  "copyWithin": true, "flat": true, "flatMap": true,',
			'  "filter": true, "find": true, "findIndex": true, "forEach": true,',
			'  "map": true, "reduce": true, "reduceRight": true, "some": true,',
			'  "every": true, "join": true, "keys": true, "values": true,',
			'  "entries": true, "at": true,',
			'  "call": true, "apply": true, "bind": true,',
			'  "has": true, "get": true, "set": true, "delete": true, "clear": true,',
			'  "add": true, "size": true,',
			'  "getTime": true, "getFullYear": true, "getMonth": true, "getDate": true,',
			'  "getHours": true, "getMinutes": true, "getSeconds": true,',
			'  "toISOString": true, "toJSON": true, "toDateString": true,',
			'  "toTimeString": true, "toLocaleDateString": true, "toLocaleTimeString": true',
			'};',
			'function __call(obj, method) {',
			'  if (obj == null) throw new TypeError("Cannot call method \\"" + method + "\\" of " + String(obj));',
			'  var fn = obj[method];',
			'  if (typeof fn !== "function") throw new TypeError(method + " is not a function");',
			'  var args = Array.prototype.slice.call(arguments, 2);',
			'  // Allow methods on scope-provided objects (they came from the host)',
			'  // Allow all safe built-in methods',
			'  if (__SAFE_METHODS[method] || typeof obj === "string" || typeof obj === "number"',
			'      || typeof obj === "boolean" || Array.isArray(obj)) {',
			'    return fn.apply(obj, args);',
			'  }',
			'  // For scope objects, allow their own methods',
			'  if (obj.hasOwnProperty && obj.hasOwnProperty(method)) {',
			'    return fn.apply(obj, args);',
			'  }',
			'  return fn.apply(obj, args);',
			'}',
			'function __call_opt(obj, method) {',
			'  if (obj == null) return undefined;',
			'  return __call.apply(null, arguments);',
			'}',
			'var __checkOps = 100000000, __checkDeadline = Date.now() + 60000;',
			'function __check() {',
			'  if (--__checkOps <= 0) throw new Error("SafeScript: operation limit exceeded");',
			'  if (Date.now() > __checkDeadline) throw new Error("SafeScript: timeout exceeded");',
			'}',
			'var __safeThis = undefined;',
			''
		].join('\n');
	}
});
