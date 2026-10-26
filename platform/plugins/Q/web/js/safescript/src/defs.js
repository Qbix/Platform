/**
 * SafeScript — shared definitions.
 * Blocked/allowed identifiers, keywords, properties.
 */
'use strict';

// Blocked identifiers — rejected as identifier tokens in source.
var BLOCKED = Object.create(null);
[
  // Prototype chain
  'constructor', '__proto__', 'prototype',
  '__defineGetter__', '__defineSetter__',
  '__lookupGetter__', '__lookupSetter__',
  // Self-reference, stack walking
  'arguments', 'callee', 'caller',
  // Internal runtime identifiers (must not be shadowed by user code)
  '__safeThis', '__thisCell', '__safeGlobals',
  // Code generation
  'eval', 'Function',
  // Browser globals
  'globalThis', 'window', 'document', 'navigator',
  'self', 'top', 'parent', 'frames',
  'location', 'history',
  // Metaprogramming
  'Proxy', 'Reflect', 'Symbol',
  // Network
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource',
  // Timers
  'setTimeout', 'setInterval', 'requestAnimationFrame',
  // Node.js
  'require', 'module', 'exports', 'process',
  'global', 'Buffer', '__filename', '__dirname',
].forEach(function(k) { BLOCKED[k] = 1; });

// Blocked keywords
var BLOCKED_KW = Object.create(null);
[
  'new', 'delete', 'class', 'extends', 'super',
  'with', 'import', 'export', 'debugger', 'yield',
  'async', 'await',
].forEach(function(k) { BLOCKED_KW[k] = 1; });

// Allowed keywords
var ALLOWED_KW = Object.create(null);
[
  'var', 'let', 'const',
  'if', 'else', 'for', 'while', 'do',
  'break', 'continue', 'return', 'function',
  'try', 'catch', 'finally', 'throw',
  'switch', 'case', 'default',
  'typeof', 'void', 'in', 'of',
  'true', 'false', 'null', 'undefined',
  'instanceof',
  'this',
].forEach(function(k) { ALLOWED_KW[k] = 1; });

// Blocked property names for __at / __set runtime checks
var BLOCKED_PROPS = Object.create(null);
[
  'constructor', '__proto__', 'prototype',
  '__defineGetter__', '__defineSetter__',
  '__lookupGetter__', '__lookupSetter__',
  'caller', 'callee', 'arguments',
].forEach(function(k) { BLOCKED_PROPS[k] = 1; });

// Globals to shadow in the wrapper function
var SHADOW_STATIC = [
  'Object', 'Array', 'String', 'Number', 'Boolean', 'BigInt',
  'Function', 'Symbol', 'Error', 'TypeError', 'RangeError',
  'SyntaxError', 'ReferenceError', 'EvalError', 'URIError',
  'AggregateError',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'FinalizationRegistry',
  'Date', 'RegExp', 'Promise', 'JSON', 'Math', 'Intl',
  'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Atomics',
  'Int8Array', 'Uint8Array', 'Uint8ClampedArray',
  'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array',
  'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array',
  'Proxy', 'Reflect',
  'eval', 'Function',
  'globalThis', 'window', 'self', 'top', 'parent', 'frames', 'global',
  'document', 'navigator', 'location', 'history', 'screen',
  'localStorage', 'sessionStorage', 'indexedDB',
  'alert', 'confirm', 'prompt', 'print', 'open', 'close',
  'focus', 'blur',
  'postMessage', 'addEventListener', 'removeEventListener',
  'dispatchEvent', 'CustomEvent', 'Event',
  'MutationObserver', 'ResizeObserver', 'IntersectionObserver',
  'Element', 'HTMLElement', 'Node', 'NodeList', 'DocumentFragment',
  'DOMParser', 'XMLSerializer', 'getComputedStyle', 'matchMedia',
  'requestAnimationFrame', 'cancelAnimationFrame',
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource',
  'Request', 'Response', 'Headers', 'URL', 'URLSearchParams',
  'setTimeout', 'setInterval', 'setImmediate',
  'clearTimeout', 'clearInterval', 'clearImmediate',
  'queueMicrotask', 'structuredClone',
  'Worker', 'SharedWorker',
  'Blob', 'File', 'FileReader', 'FileList', 'FormData',
  'TextEncoder', 'TextDecoder', 'atob', 'btoa',
  'encodeURI', 'decodeURI', 'encodeURIComponent', 'decodeURIComponent',
  'escape', 'unescape',
  'crypto', 'performance', 'Notification',
  'BroadcastChannel', 'MessageChannel', 'MessagePort',
  'AbortController', 'AbortSignal',
  'isNaN', 'isFinite', 'parseInt', 'parseFloat',
  'NaN', 'Infinity',
  'require', 'module', 'exports', '__filename', '__dirname',
  'process', 'Buffer',
  'console', 'constructor', '__proto__', 'prototype',
];

exports.BLOCKED = BLOCKED;
exports.BLOCKED_KW = BLOCKED_KW;
exports.ALLOWED_KW = ALLOWED_KW;
exports.BLOCKED_PROPS = BLOCKED_PROPS;
exports.SHADOW_STATIC = SHADOW_STATIC;
