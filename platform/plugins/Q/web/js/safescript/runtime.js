/**
 * SafeScript runtime — __at, __set, __check, sanitize, scope builder, hooks.
 *
 * These are injected into compiled SafeScript code and provide
 * the last line of defense: runtime property access guards,
 * scope sanitization (null-prototype deep copy), execution guards
 * (__check for timeout + ops limit), and hooks for resource throttling.
 */
'use strict';

var defs = require('./defs');

// Hardcoded ceilings — even if host passes higher, these cap it
var MAX_TIMEOUT = 60000;   // 1 minute
var MAX_OPS     = 100000000; // 100M ops

// ── Type registry ────────────────────────────────────────────────
// Maps constructor → { allowMethods: string[] }
// Hosts register via SafeScript.lib(Constructor, { allowMethods: [...] })
var _typeRegistry = new Map();

// Built-in constructors whose methods are always safe to call
var SAFE_CTORS = [Error, TypeError, RangeError, SyntaxError, ReferenceError];

function registerType(ctor, config) {
  if (typeof ctor !== 'function') {
    throw new Error('SafeScript: registerType expects a constructor function');
  }
  if (!config || !Array.isArray(config.allowMethods)) {
    throw new Error('SafeScript: registerType config must have allowMethods array');
  }
  _typeRegistry.set(ctor, config);
}

function unregisterType(ctor) {
  _typeRegistry.delete(ctor);
}

function clearTypeRegistry() {
  _typeRegistry.clear();
}

/**
 * Safe bracket read: obj[key] → __at(obj, key)
 * Returns undefined for blocked property names.
 * Throws on null/undefined receiver.
 */
function __at(obj, key) {
  if (obj == null) {
    throw new TypeError('Cannot read property "' + key + '" of ' + String(obj));
  }
  var k = String(key);
  if (defs.BLOCKED_PROPS[k]) return undefined;
  return obj[k];
}

/**
 * Safe bracket write: obj[key] = val → __set(obj, key, val)
 * Throws for blocked property names.
 * Throws on null/undefined receiver.
 */
function __set(obj, key, val) {
  if (obj == null) {
    throw new TypeError('Cannot set property "' + key + '" of ' + String(obj));
  }
  var k = String(key);
  if (defs.BLOCKED_PROPS[k]) {
    throw new TypeError('SafeScript: cannot set blocked property "' + k + '"');
  }
  obj[k] = val;
  return val;
}

/**
 * Safe method call: obj.method(args) → __call(obj, 'method', arg1, arg2, ...)
 *
 * Dispatch rules:
 *   1. Primitives (string, number, boolean): allow all native methods
 *   2. Arrays: allow all native methods
 *   3. Functions: allow .call, .apply, .bind
 *   4. Plain objects (null proto or Object.prototype): allow callable properties
 *   5. Built-in error types: allow all methods
 *   6. Registered class instances: allow only whitelisted methods
 *   7. Unregistered class instances: block (sandbox violation)
 */
function __call(obj, method) {
  if (obj == null) {
    throw new TypeError('Cannot read property "' + method + '" of ' + String(obj));
  }

  // Collect variadic args after (obj, method)
  var args = [];
  for (var i = 2; i < arguments.length; i++) {
    args.push(arguments[i]);
  }

  var t = typeof obj;

  // 1. Primitives: string, number, boolean — allow all native methods
  if (t === 'string' || t === 'number' || t === 'boolean') {
    var fn = obj[method];
    if (typeof fn !== 'function') return undefined;
    return fn.apply(obj, args);
  }

  // 3. Functions — allow .call, .apply, .bind
  if (t === 'function') {
    var fn = obj[method];
    if (typeof fn !== 'function') return undefined;
    return fn.apply(obj, args);
  }

  if (t !== 'object') return undefined;

  // 2. Arrays — allow all native methods
  if (Array.isArray(obj)) {
    var fn = obj[method];
    if (typeof fn !== 'function') return undefined;
    return fn.apply(obj, args);
  }

  var proto = Object.getPrototypeOf(obj);

  // 4. Plain objects (null proto or Object.prototype): allow callable properties
  if (proto === null || proto === Object.prototype) {
    var fn = obj[method];
    if (typeof fn === 'function') return fn.apply(obj, args);
    return undefined;
  }

  // 5. Built-in error constructors: allow all methods
  var ctor = obj.constructor;
  for (var j = 0; j < SAFE_CTORS.length; j++) {
    if (ctor === SAFE_CTORS[j]) {
      var fn = obj[method];
      if (typeof fn === 'function') return fn.apply(obj, args);
      return undefined;
    }
  }

  // 6. Registered class instances: check allowMethods whitelist
  // Walk the prototype chain to find a registered constructor (supports subclasses)
  var regConfig = null;
  var regName = ctor && ctor.name || 'object';
  if (ctor && _typeRegistry.has(ctor)) {
    regConfig = _typeRegistry.get(ctor);
  } else {
    // Check parent constructors
    var p = proto;
    while (p && p !== Object.prototype) {
      var pc = p.constructor;
      if (pc && _typeRegistry.has(pc)) {
        regConfig = _typeRegistry.get(pc);
        break;
      }
      p = Object.getPrototypeOf(p);
    }
  }
  if (regConfig) {
    var allowed = regConfig.allowMethods || [];
    if (allowed.indexOf(method) === -1) {
      throw new Error('SafeScript: method "' + method + '" not allowed on ' +
        regName + ' — register with SafeScript.lib()');
    }
    return obj[method].apply(obj, args);
  }

  // 7. Unregistered class instance — block
  throw new Error('SafeScript: cannot call methods on unregistered type' +
    (ctor && ctor.name ? ' ' + ctor.name : '') +
    ' — register with SafeScript.lib()');
}

/**
 * Optional-chaining variant: obj?.method(args)
 * Returns undefined for null/undefined instead of throwing.
 */
function __call_opt(obj, method) {
  if (obj == null) return undefined;
  return __call.apply(undefined, arguments);
}

/**
 * Deep-copy an object to null-prototype objects.
 * Functions pass through (they're trusted API).
 * Handles cycles via a seen-set.
 */
function sanitize(obj, _seen) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'function') return obj;
  if (typeof obj !== 'object') return obj;

  if (!_seen) _seen = new Map();
  if (_seen.has(obj)) return _seen.get(obj);

  if (Array.isArray(obj)) {
    var arr = [];
    _seen.set(obj, arr);
    for (var i = 0; i < obj.length; i++) {
      arr[i] = sanitize(obj[i], _seen);
    }
    return arr;
  }

  // Non-plain objects (built-ins like JSON, Math, class instances)
  // pass through — they're trusted API with non-enumerable methods.
  // Only plain objects ({} literals) get null-prototype treatment.
  var proto = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) {
    return obj;
  }

  var out = Object.create(null);
  _seen.set(obj, out);
  var keys = Object.getOwnPropertyNames(obj);
  for (var j = 0; j < keys.length; j++) {
    out[keys[j]] = sanitize(obj[keys[j]], _seen);
  }
  return out;
}

/**
 * Build the global shadow list — all globals set to undefined
 * so compiled code can't reach them.
 */
function buildShadowList() {
  var all = Object.create(null);
  defs.SHADOW_STATIC.forEach(function(k) { all[k] = 1; });
  // eval and arguments are illegal in strict mode var declarations
  delete all['eval'];
  delete all['arguments'];
  return Object.keys(all);
}

/**
 * Strip __proto__ keys from JSON.parse output and convert
 * plain objects to null-prototype objects.
 */
function sanitizeJsonParsed(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    for (var i = 0; i < obj.length; i++) {
      obj[i] = sanitizeJsonParsed(obj[i]);
    }
    return obj;
  }
  var out = Object.create(null);
  var keys = Object.keys(obj);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i] === '__proto__') continue;
    out[keys[i]] = sanitizeJsonParsed(obj[keys[i]]);
  }
  return out;
}

/**
 * Build the safe globals object — frozen facade objects exposing
 * only safe static methods. Never raw JS constructors.
 * These override the shadowed globals in compiled code.
 */
function buildSafeGlobals() {
  var sg = Object.create(null);

  // Object — safe static methods only; create restricted to null prototype
  sg.Object = Object.freeze({
    create: function(proto) {
      if (proto !== null) {
        throw new TypeError('SafeScript: Object.create only allows null prototype');
      }
      return Object.create(null);
    },
    keys: Object.keys,
    values: Object.values,
    entries: Object.entries,
    assign: Object.assign,
    freeze: Object.freeze,
    isFrozen: Object.isFrozen,
    getOwnPropertyNames: Object.getOwnPropertyNames,
  });

  // Array — safe static methods
  sg.Array = Object.freeze({
    isArray: Array.isArray,
    from: Array.from,
    of: Array.of,
  });

  // String — safe static methods
  sg.String = Object.freeze({
    fromCharCode: String.fromCharCode,
    fromCodePoint: String.fromCodePoint,
  });

  // Number — safe static methods and constants
  sg.Number = Object.freeze({
    isInteger: Number.isInteger,
    isFinite: Number.isFinite,
    isNaN: Number.isNaN,
    parseInt: Number.parseInt,
    parseFloat: Number.parseFloat,
    MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER,
    MIN_SAFE_INTEGER: Number.MIN_SAFE_INTEGER,
    EPSILON: Number.EPSILON,
    MAX_VALUE: Number.MAX_VALUE,
    MIN_VALUE: Number.MIN_VALUE,
    POSITIVE_INFINITY: Number.POSITIVE_INFINITY,
    NEGATIVE_INFINITY: Number.NEGATIVE_INFINITY,
    NaN: Number.NaN,
  });

  // Math — all standard methods except random (handled by deterministic RNG)
  sg.Math = Object.freeze({
    abs: Math.abs, ceil: Math.ceil, floor: Math.floor, round: Math.round,
    trunc: Math.trunc, sign: Math.sign,
    max: Math.max, min: Math.min,
    pow: Math.pow, sqrt: Math.sqrt, cbrt: Math.cbrt,
    log: Math.log, log2: Math.log2, log10: Math.log10, log1p: Math.log1p,
    exp: Math.exp, expm1: Math.expm1,
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh,
    hypot: Math.hypot, clz32: Math.clz32, imul: Math.imul, fround: Math.fround,
    PI: Math.PI, E: Math.E, LN2: Math.LN2, LN10: Math.LN10,
    LOG2E: Math.LOG2E, LOG10E: Math.LOG10E, SQRT2: Math.SQRT2, SQRT1_2: Math.SQRT1_2,
  });

  // JSON — parse sanitizes output, stringify as-is
  sg.JSON = Object.freeze({
    parse: function(text, reviver) {
      return sanitizeJsonParsed(JSON.parse(text, reviver));
    },
    stringify: JSON.stringify,
  });

  // Error constructors (all work without new in JS)
  sg.Error = Error;
  sg.TypeError = TypeError;
  sg.RangeError = RangeError;
  sg.SyntaxError = SyntaxError;
  sg.ReferenceError = ReferenceError;

  // Standalone functions
  sg.parseInt = parseInt;
  sg.parseFloat = parseFloat;
  sg.isNaN = isNaN;
  sg.isFinite = isFinite;
  sg.encodeURI = encodeURI;
  sg.decodeURI = decodeURI;
  sg.encodeURIComponent = encodeURIComponent;
  sg.decodeURIComponent = decodeURIComponent;

  // Constants
  sg.NaN = NaN;
  sg.Infinity = Infinity;

  return sg;
}

// Singleton — safe globals are the same for every execution (no Math.random)
var SAFE_GLOBALS = buildSafeGlobals();

// Names of safe globals that should be assigned in the compiled body
var SAFE_GLOBAL_NAMES = Object.keys(SAFE_GLOBALS);

/**
 * Mulberry32 — fast 32-bit PRNG with excellent distribution.
 * Returns a function that produces [0, 1) on each call.
 */
function mulberry32(seed) {
  var state = seed | 0;
  return function() {
    state = (state + 0x6D2B79F5) | 0;
    var t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build per-invocation safe globals with Math.random added.
 * Clones the singleton's Math facade and adds random from the PRNG.
 */
function buildSafeGlobalsWithRandom(randomFn) {
  var sg = Object.create(null);
  var keys = SAFE_GLOBAL_NAMES;
  for (var i = 0; i < keys.length; i++) {
    sg[keys[i]] = SAFE_GLOBALS[keys[i]];
  }
  // Build new Math facade with random
  var mathProps = Object.getOwnPropertyNames(SAFE_GLOBALS.Math);
  var newMath = Object.create(null);
  for (var j = 0; j < mathProps.length; j++) {
    newMath[mathProps[j]] = SAFE_GLOBALS.Math[mathProps[j]];
  }
  newMath.random = randomFn;
  sg.Math = Object.freeze(newMath);
  return sg;
}

/**
 * Wrap a single function with beforeCall/afterCall hooks.
 * @param {Function} fn - The original function
 * @param {string} name - Dotted path name (e.g. "db.query")
 * @param {Object} hooks - { beforeCall, afterCall }
 * @param {Object} state - Shared mutable state { callCount, startTime }
 * @returns {Function} Wrapped async function
 */
function wrapFnWithHooks(fn, name, hooks, state) {
  return async function() {
    var args = Array.prototype.slice.call(arguments);
    state.callCount++;
    var elapsed = Date.now() - state.startTime;
    var info = { name: name, args: args, callCount: state.callCount, elapsed: elapsed };

    // beforeCall hook
    if (hooks.beforeCall) {
      var decision = hooks.beforeCall(info);
      if (decision === false) return undefined;  // suppress
      if (decision && typeof decision === 'object') {
        if ('value' in decision) return decision.value;  // short-circuit
        if (decision.args) args = decision.args;         // transform args
      }
      // undefined → proceed normally
    }

    var result = await fn.apply(undefined, args);

    // afterCall hook
    if (hooks.afterCall) {
      info.result = result;
      info.elapsed = Date.now() - state.startTime;
      var afterDecision = hooks.afterCall(info);
      if (afterDecision === false) return undefined;  // suppress result
      if (afterDecision && typeof afterDecision === 'object') {
        if ('value' in afterDecision) return afterDecision.value;  // transform result
      }
    }

    return result;
  };
}

/**
 * Walk a sanitized scope object and wrap every function with hooks.
 * Nested objects are walked recursively, building dotted name paths.
 * @param {Object} scopeObj - The sanitized scope (null-prototype)
 * @param {Object} hooks - { beforeCall, afterCall }
 * @param {Object} state - Shared mutable state
 * @param {string} [prefix] - Dotted path prefix
 * @returns {Object} The scope with functions wrapped
 */
function wrapScopeWithHooks(scopeObj, hooks, state, prefix) {
  if (!scopeObj || typeof scopeObj !== 'object') return scopeObj;
  var keys = Object.keys(scopeObj);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var val = scopeObj[key];
    var path = prefix ? prefix + '.' + key : key;
    if (typeof val === 'function') {
      scopeObj[key] = wrapFnWithHooks(val, path, hooks, state);
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      wrapScopeWithHooks(val, hooks, state, path);
    }
  }
  return scopeObj;
}

/**
 * Build a compiled function from emitted source with scope injection.
 *
 * @param {string} source - The emitted JS source
 * @param {Object} scope  - The scope object (capabilities)
 * @param {Object} opts   - Options { timeout, maxOps, hooks: { beforeCall, afterCall } }
 * @returns {Function} A function that executes the SafeScript code (always returns a Promise)
 */
/**
 * Wrap a callback function so it sets __thisCell.value to the facade
 * before the callback executes. The callback's emitted preamble then
 * captures __safeThis = __thisCell.value and resets the cell.
 */
function wrapCallbackWithFacade(fn, facade, thisCell) {
  return function() {
    thisCell.value = facade;
    return fn.apply(undefined, arguments);
  };
}

/**
 * Create a facade-aware wrapper for a scope function.
 * When the SafeScript code calls this function, the wrapper:
 *   1. Calls config.create(...args) to build the facade object
 *   2. Wraps callback arguments (config.args indices) with facade binding
 *   3. Wraps method-object arguments (config.methods indices) similarly
 *   4. Forwards to the original function
 */
function makeFacadeWrapper(origFn, config, thisCell) {
  var argIndices = config.args || [];
  var methodIndices = config.methods || [];
  var createFacade = config.create;

  return function() {
    var args = Array.prototype.slice.call(arguments);

    // Create the facade for this call
    var facade = createFacade ? createFacade.apply(undefined, args) : undefined;

    // Wrap callback arguments
    for (var i = 0; i < argIndices.length; i++) {
      var idx = argIndices[i];
      if (typeof args[idx] === 'function') {
        args[idx] = wrapCallbackWithFacade(args[idx], facade, thisCell);
      }
    }

    // Wrap method-object arguments (objects whose values are callbacks)
    for (var i = 0; i < methodIndices.length; i++) {
      var idx = methodIndices[i];
      if (args[idx] && typeof args[idx] === 'object') {
        var methodObj = args[idx];
        var keys = Object.keys(methodObj);
        for (var j = 0; j < keys.length; j++) {
          if (typeof methodObj[keys[j]] === 'function') {
            methodObj[keys[j]] = wrapCallbackWithFacade(methodObj[keys[j]], facade, thisCell);
          }
        }
      }
    }

    return origFn.apply(undefined, args);
  };
}

/**
 * Walk a dotted path in a scope object and wrap the leaf function
 * with a facade wrapper.
 */
function applyFacades(scopeObj, facades, thisCell) {
  var paths = Object.keys(facades);
  for (var p = 0; p < paths.length; p++) {
    var path = paths[p];
    var config = facades[path];
    var parts = path.split('.');

    // Walk to the parent object
    var obj = scopeObj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (!obj || typeof obj !== 'object') { obj = null; break; }
      obj = obj[parts[i]];
    }
    if (!obj || typeof obj !== 'object') continue;

    var fnName = parts[parts.length - 1];
    var origFn = obj[fnName];
    if (typeof origFn !== 'function') continue;

    obj[fnName] = makeFacadeWrapper(origFn, config, thisCell);
  }
}

function buildFunction(source, scope, opts) {
  opts = opts || {};
  var scopeObj = scope ? sanitize(scope) : Object.create(null);
  var scopeKeys = scope ? Object.keys(scope) : [];

  // DOM Membrane: create context and inject scope additions
  var domContext = null;
  if (opts.dom && opts.dom.root) {
    var createDOMContext = require('./dom/index').createDOMContext;
    domContext = createDOMContext(opts.dom.root, opts.dom.policy);
    // Inject DOM globals into scope
    var domScope = domContext.scope;
    var domKeys = Object.keys(domScope);
    for (var d = 0; d < domKeys.length; d++) {
      var dk = domKeys[d];
      scopeObj[dk] = domScope[dk];
      if (scopeKeys.indexOf(dk) === -1) {
        scopeKeys.push(dk);
      }
    }
  }

  // Hooks: wrap scope functions before building
  var hooks = opts.hooks || null;
  var hookState = { callCount: 0, startTime: 0 };
  if (hooks && (hooks.beforeCall || hooks.afterCall)) {
    wrapScopeWithHooks(scopeObj, hooks, hookState);
  }

  // Mutable cell for __safeThis binding — shared between facade
  // wrappers and compiled code. Reset per invocation.
  var thisCell = { value: undefined };

  // Facades: wrap scope functions with facade-aware wrappers
  if (opts.facades) {
    applyFacades(scopeObj, opts.facades, thisCell);
  }

  // Compute effective timeout and maxOps (capped by ceilings)
  var timeout = opts.timeout || 0;
  if (timeout > MAX_TIMEOUT) timeout = MAX_TIMEOUT;
  if (timeout <= 0 && MAX_TIMEOUT > 0) timeout = MAX_TIMEOUT; // always enforce ceiling

  var maxOps = opts.maxOps || MAX_OPS;
  if (maxOps > MAX_OPS) maxOps = MAX_OPS;

  // Shadow all globals
  var shadowList = buildShadowList();
  var shadowDecl = shadowList.length > 0 ?
    'var ' + shadowList.join(', ') + ';\n' : '';

  // Build function body: shadow globals, restore safe globals, capture __safeThis, then user code
  var safeAssign = SAFE_GLOBAL_NAMES.map(function(n) { return n + ' = __safeGlobals.' + n; }).join('; ') + ';\n';
  var thisPreamble = 'var __safeThis = __thisCell.value; __thisCell.value = undefined;\n';
  var body = '"use strict";\n' + shadowDecl + safeAssign + thisPreamble + source;

  // Function params: __scope, __at, __set, __call, __call_opt, __check, __thisCell, __safeGlobals, then scope keys
  var paramNames = ['__scope', '__at', '__set', '__call', '__call_opt', '__check', '__thisCell', '__safeGlobals'].concat(scopeKeys);

  // Always use AsyncFunction constructor (auto-async model)
  var AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  var fn = new AsyncFunction(paramNames.join(', '), body);

  // Seed for deterministic RNG
  var seed = opts.seed !== undefined ? opts.seed : 0; // default: deterministic seed 0

  // Environment authorization: seed: null requires env: { Random: true }
  if (seed === null) {
    var env = opts.env || {};
    if (!env.Random) {
      throw new Error('SafeScript: seed: null requires env: { Random: true } (nondeterministic RNG needs host approval)');
    }
  }

  return function() {
    // Reset guards for each invocation
    var deadline = Date.now() + timeout;
    var opsRemaining = maxOps;
    hookState.callCount = 0;
    hookState.startTime = Date.now();
    thisCell.value = undefined; // reset for each invocation

    // __check: called at top of every function and every loop iteration
    function __check() {
      if (--opsRemaining <= 0) {
        throw new Error('SafeScript: max operations exceeded (' + maxOps + ')');
      }
      if (Date.now() > deadline) {
        throw new Error('SafeScript: execution timed out after ' + timeout + 'ms');
      }
    }

    // Build per-invocation safe globals (with fresh RNG state if seed is set)
    var invocationGlobals;
    if (seed === null) {
      // seed: null — use true Math.random (requires env: { Random: true }, checked at compile)
      invocationGlobals = buildSafeGlobalsWithRandom(Math.random);
    } else {
      // Deterministic RNG — fresh mulberry32 state per invocation
      invocationGlobals = buildSafeGlobalsWithRandom(mulberry32(seed));
    }

    // Bind the arguments
    var args = [scopeObj, __at, __set, __call, __call_opt, __check, thisCell, invocationGlobals];
    for (var i = 0; i < scopeKeys.length; i++) {
      args.push(scopeObj[scopeKeys[i]]);
    }

    var promise = fn.apply(undefined, args);

    // DOM cleanup on completion
    function cleanupDOM() {
      if (domContext && domContext.cleanup) {
        domContext.cleanup();
      }
    }

    // Promise.race as secondary defense (catches slow async injected methods)
    if (timeout > 0) {
      var timer;
      return Promise.race([
        promise.then(function(v) { clearTimeout(timer); cleanupDOM(); return v; },
                     function(e) { clearTimeout(timer); cleanupDOM(); throw e; }),
        new Promise(function(_, reject) {
          timer = setTimeout(function() {
            cleanupDOM();
            reject(new Error('SafeScript: execution timed out after ' + timeout + 'ms'));
          }, timeout);
        })
      ]);
    }
    return promise.then(function(v) { cleanupDOM(); return v; },
                        function(e) { cleanupDOM(); throw e; });
  };
}

exports.__at = __at;
exports.__set = __set;
exports.__call = __call;
exports.__call_opt = __call_opt;
exports.sanitize = sanitize;
exports.buildShadowList = buildShadowList;
exports.buildFunction = buildFunction;
exports.wrapScopeWithHooks = wrapScopeWithHooks;
exports.wrapFnWithHooks = wrapFnWithHooks;
exports.registerType = registerType;
exports.unregisterType = unregisterType;
exports.clearTypeRegistry = clearTypeRegistry;
exports.getTypeConfig = function(ctor) {
  return _typeRegistry.get(ctor) || null;
};
exports.getRegisteredTypes = function() {
  var result = [];
  _typeRegistry.forEach(function(config, ctor) {
    result.push({ ctor: ctor, name: ctor.name || null, config: config });
  });
  return result;
};
exports.MAX_TIMEOUT = MAX_TIMEOUT;
exports.MAX_OPS = MAX_OPS;
