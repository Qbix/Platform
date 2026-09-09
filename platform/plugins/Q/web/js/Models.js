/**
 * Q.Models — local inference runtime for the Qbix platform.
 *
 * Loads small specialized models (face detection, PII redaction, language
 * detection, toxicity) and runs them in-browser or Node. Any plugin can call:
 *
 *   Q.Models.load('blazeface', function (model) {
 *       model.run(videoFrame, function (faces) { ... });
 *   });
 *
 * @module Q.Models
 */
(function (Q, undefined) {

"use strict";

var Models = Q.Models = {};

// ─────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────

Models.registry = {};

// ─────────────────────────────────────────────────────────────────────────
// Events
// ─────────────────────────────────────────────────────────────────────────

/** Fires after a model finishes loading. (name, model) */
Models.onLoad = new Q.Event();

/** Fires on each progress tick during binary download. (name, loadedBytes, totalBytes) */
Models.onProgress = new Q.Event();

/** Fires after inference completes. (name, input, output, elapsedMs) */
Models.onInfer = new Q.Event();

/** Fires if a model fails to load or run. (name, error) */
Models.onError = new Q.Event();

/** Fires when a model is registered. (name, entry) */
Models.onRegister = new Q.Event();

/** Fires when a model is unloaded. (name) */
Models.onUnload = new Q.Event();

/** Fires once when the best backend is detected. (backendName) */
Models.onBackendReady = new Q.Event();

// ─────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────

Models.options = {
	timeoutMs:     30000,
	retries:       1,
	retryDelayMs:  2000,
	cacheInIDB:    true,
	idbName:       'Q_Models_Cache',
	idbStore:      'binaries'
};

/**
 * Runtime script URLs. Override these if you self-host.
 * @property {Object} runtimes
 */
Models.runtimes = {
	litert:       'https://cdn.jsdelivr.net/npm/anthropic-litert-web@latest/dist/litert.min.js',
	transformers: 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2/dist/transformers.min.js'
};

// ─────────────────────────────────────────────────────────────────────────
// Private state
// ─────────────────────────────────────────────────────────────────────────

var _loaded  = {};    // name → model wrapper
var _pending = {};    // name → [{ resolve, reject }]  (dedup concurrent loads)
var _runtimes = {};   // runtimeName → true once loaded
var _detectedBackend = null;

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Register a model in the registry.
 *
 * @method register
 * @param {String} name  Unique model name
 * @param {Object} entry Descriptor:
 * @param {String} entry.format    'tflite', 'onnx', 'tfjs', or 'custom'
 * @param {String|Array} entry.src URL(s) to model file(s)
 * @param {String} [entry.sha256]  Hex hash for integrity verification
 * @param {String} [entry.runtime] Force a runtime: 'litert', 'transformers', 'tfjs'
 * @param {String} [entry.task]    For onnx/transformers: pipeline task name
 * @param {Number} [entry.sizeBytes]     Approximate size for progress UI
 * @param {Function} [entry.factory]     For tfjs: async function returning the raw model
 * @param {Function} [entry.loader]      For custom: function(entry, done)
 * @param {Function} [entry.preprocess]  (input) → modelInput
 * @param {Function} [entry.postprocess] (rawOutput) → processedOutput
 * @param {Object} [entry.options]       Runtime-specific options
 */
Models.register = function (name, entry) {
	if (!name || !entry) return;
	entry.name = name;
	if (!entry.format) {
		var src = typeof entry.src === 'string' ? entry.src : (entry.src && entry.src[0]) || '';
		if (src.indexOf('.tflite') !== -1) entry.format = 'tflite';
		else if (src.indexOf('.onnx') !== -1) entry.format = 'onnx';
		else entry.format = 'tfjs';
	}
	Models.registry[name] = entry;
	Models.onRegister.handle(name, entry);
};

/**
 * Load a model by name. Deduplicates concurrent calls.
 *
 * @method load
 * @param {String} name
 * @param {Function} [callback]  (model, error)
 * @return {Promise}
 */
Models.load = function (name, callback) {
	if (_loaded[name]) {
		Q.handle(callback, null, [_loaded[name]]);
		return _resolve(_loaded[name]);
	}

	var entry = Models.registry[name];
	if (!entry) {
		var err = new Error('Q.Models: unknown model "' + name + '". Call Q.Models.register() first.');
		Models.onError.handle(name, err);
		if (callback) callback(null, err);
		return _reject(err);
	}

	// Dedup: if already loading, queue this caller
	if (_pending[name]) {
		var p = _deferred();
		_pending[name].push(p);
		if (callback) p.promise.then(function (m) { callback(m); }, function (e) { callback(null, e); });
		return p.promise;
	}

	_pending[name] = [];
	var mainDeferred = _deferred();
	_pending[name].push(mainDeferred);
	if (callback) mainDeferred.promise.then(function (m) { callback(m); }, function (e) { callback(null, e); });

	_loadWithRetry(entry, Models.options.retries, function (model, error) {
		var waiters = _pending[name] || [];
		delete _pending[name];

		if (error) {
			Models.onError.handle(name, error);
			for (var i = 0; i < waiters.length; i++) waiters[i].reject(error);
			return;
		}

		_loaded[name] = model;
		Models.onLoad.handle(name, model);
		for (var i = 0; i < waiters.length; i++) waiters[i].resolve(model);
	});

	return mainDeferred.promise;
};

/**
 * Load + run in one call.
 *
 * @method run
 * @param {String} name
 * @param {Mixed} input
 * @param {Function} [callback]  (output, error)
 * @return {Promise}
 */
Models.run = function (name, input, callback) {
	var d = _deferred();
	Models.load(name, function (model, loadErr) {
		if (loadErr) {
			if (callback) callback(null, loadErr);
			d.reject(loadErr);
			return;
		}
		var p = model.run(input, callback);
		if (p && typeof p.then === 'function') {
			p.then(d.resolve, d.reject);
		}
	});
	return d.promise;
};

/**
 * Detect the best available backend.
 * @method backend
 * @return {String}  'webgpu', 'wasm', 'webgl', or 'cpu'
 */
Models.backend = function () {
	if (_detectedBackend) return _detectedBackend;
	if (typeof navigator !== 'undefined' && navigator.gpu) _detectedBackend = 'webgpu';
	else if (typeof WebAssembly !== 'undefined') _detectedBackend = 'wasm';
	else if (typeof WebGLRenderingContext !== 'undefined') _detectedBackend = 'webgl';
	else _detectedBackend = 'cpu';
	Models.onBackendReady.handle(_detectedBackend);
	return _detectedBackend;
};

/**
 * Unload a model, freeing memory.
 * @method unload
 * @param {String} name
 */
Models.unload = function (name) {
	var m = _loaded[name];
	if (m && m.dispose) {
		try { m.dispose(); } catch (e) {}
	}
	delete _loaded[name];
	Models.onUnload.handle(name);
};

/**
 * Clear the IndexedDB cache for all models.
 * @method clearCache
 * @param {Function} [callback]
 */
Models.clearCache = function (callback) {
	_idbOpen(function (db, err) {
		if (err || !db) { Q.handle(callback); return; }
		try {
			var tx = db.transaction(Models.options.idbStore, 'readwrite');
			tx.objectStore(Models.options.idbStore).clear();
			tx.oncomplete = function () { Q.handle(callback); };
			tx.onerror = function () { Q.handle(callback); };
		} catch (e) { Q.handle(callback); }
	});
};

/**
 * Register legacy tfjs models that the Users plugin ships.
 * @method registerDefaults
 * @param {String} pluginUrl  e.g. '{{Users}}'
 */
Models.registerDefaults = function (pluginUrl) {
	Models.register('blazeface', {
		format: 'tfjs',
		src: [pluginUrl + '/js/models/tfjs.js', pluginUrl + '/js/models/blazeface.js'],
		factory: function (opts) { return blazeface.load(opts); }
	});

	Models.register('face-landmarks', {
		format: 'tfjs',
		src: [
			pluginUrl + '/js/models/tf-core.js',
			pluginUrl + '/js/models/tf-converter.js',
			pluginUrl + '/js/models/tf-backend-webgl.js',
			pluginUrl + '/js/models/face-landmarks-detection.js'
		],
		factory: function (opts) {
			return faceLandmarksDetection.load(
				faceLandmarksDetection.SupportedPackages.mediapipeFacemesh,
				Q.extend({ maxFaces: 1 }, opts)
			);
		},
		options: { maxFaces: 1 }
	});

	Models.register('webgazer', {
		format: 'tfjs',
		src: [pluginUrl + '/js/models/webgazer.js'],
		factory: function () {
			return { infer: function () {}, webgazer: window.webgazer, dispose: function () { if (window.webgazer) window.webgazer.end(); } };
		}
	});
};

// ─────────────────────────────────────────────────────────────────────────
// Format-specific loaders (private)
// ─────────────────────────────────────────────────────────────────────────

function _loadWithRetry(entry, retriesLeft, done) {
	_loadByFormat(entry, function (model, error) {
		if (!error) return done(model);
		if (retriesLeft > 0) {
			setTimeout(function () {
				_loadWithRetry(entry, retriesLeft - 1, done);
			}, Models.options.retryDelayMs);
		} else {
			done(null, error);
		}
	});
}

function _loadByFormat(entry, done) {
	switch (entry.format) {
		case 'tfjs':   return _loadTfjs(entry, done);
		case 'tflite': return _loadBinary(entry, 'litert', done);
		case 'onnx':   return _loadBinary(entry, 'transformers', done);
		case 'custom': return _loadCustom(entry, done);
		default:       return done(null, new Error('Q.Models: unknown format "' + entry.format + '"'));
	}
}

function _loadTfjs(entry, done) {
	var scripts = typeof entry.src === 'string' ? [entry.src] : entry.src;
	Q.addScript(scripts, function () {
		try {
			if (typeof entry.factory !== 'function') {
				return done(null, new Error('Q.Models: tfjs model "' + entry.name + '" needs a factory function'));
			}
			var result = entry.factory(entry.options || {});
			if (result && typeof result.then === 'function') {
				result.then(function (raw) { done(_wrapModel(entry, raw)); })
					.catch(function (e) { done(null, e); });
			} else {
				done(_wrapModel(entry, result));
			}
		} catch (e) { done(null, e); }
	});
}

function _loadBinary(entry, runtimeName, done) {
	_ensureRuntime(runtimeName, function (err) {
		if (err) return done(null, err);

		// Try IDB cache first
		_idbGet(entry.name, function (cached) {
			if (cached && (!entry.sha256 || cached.sha256 === entry.sha256)) {
				return _initBinaryModel(entry, runtimeName, cached.data, done);
			}
			// Fetch with progress, timeout, and sha256 verification
			_fetchBinary(entry, function (buf, fetchErr) {
				if (fetchErr) return done(null, fetchErr);
				// sha256 verify
				if (entry.sha256) {
					_sha256(buf, function (hash) {
						if (hash !== entry.sha256) {
							return done(null, new Error('Q.Models: sha256 mismatch for "' + entry.name +
								'". Expected ' + entry.sha256 + ', got ' + hash));
						}
						_idbPut(entry.name, buf, entry.sha256);
						_initBinaryModel(entry, runtimeName, buf, done);
					});
				} else {
					_idbPut(entry.name, buf, null);
					_initBinaryModel(entry, runtimeName, buf, done);
				}
			});
		});
	});
}

function _initBinaryModel(entry, runtimeName, buf, done) {
	try {
		if (runtimeName === 'litert') {
			var LiteRT = _global('LiteRT') || _global('litert');
			if (!LiteRT) return done(null, new Error('Q.Models: LiteRT runtime not available'));
			var p = LiteRT.loadModel ? LiteRT.loadModel(buf) :
				(LiteRT.TFLiteModel ? LiteRT.TFLiteModel.create(buf) : null);
			if (!p) return done(null, new Error('Q.Models: LiteRT has no loadModel method'));
			if (typeof p.then === 'function') {
				p.then(function (raw) { done(_wrapModel(entry, raw)); })
					.catch(function (e) { done(null, e); });
			} else {
				done(_wrapModel(entry, p));
			}
		} else if (runtimeName === 'transformers') {
			var T = _global('transformers') || _global('HuggingFaceTransformers');
			if (!T) return done(null, new Error('Q.Models: Transformers.js runtime not available'));
			if (!entry.task) return done(null, new Error('Q.Models: onnx model needs entry.task'));
			T.pipeline(entry.task, entry.src, entry.options || {})
				.then(function (pipe) { done(_wrapModel(entry, pipe)); })
				.catch(function (e) { done(null, e); });
		}
	} catch (e) { done(null, e); }
}

function _loadCustom(entry, done) {
	if (typeof entry.loader !== 'function') {
		return done(null, new Error('Q.Models: custom model needs entry.loader function'));
	}
	entry.loader(entry, function (raw, err) {
		if (err) return done(null, err);
		done(_wrapModel(entry, raw));
	});
}

// ─────────────────────────────────────────────────────────────────────────
// Binary fetch with progress + timeout
// ─────────────────────────────────────────────────────────────────────────

function _fetchBinary(entry, done) {
	var src = typeof entry.src === 'string' ? entry.src : entry.src[0];
	var name = entry.name;
	var timedOut = false;
	var timer = setTimeout(function () {
		timedOut = true;
		done(null, new Error('Q.Models: timeout loading "' + name + '" after ' + Models.options.timeoutMs + 'ms'));
	}, Models.options.timeoutMs);

	fetch(src).then(function (resp) {
		if (timedOut) return;
		if (!resp.ok) throw new Error('HTTP ' + resp.status);
		var reader = resp.body && resp.body.getReader ? resp.body.getReader() : null;
		var total = parseInt(resp.headers.get('Content-Length') || entry.sizeBytes || 0, 10);
		if (!reader) {
			// Fallback: no streaming
			return resp.arrayBuffer();
		}
		var chunks = [], loaded = 0;
		function _read() {
			return reader.read().then(function (result) {
				if (timedOut) return;
				if (result.done) {
					var buf = _concat(chunks, loaded);
					return buf;
				}
				chunks.push(result.value);
				loaded += result.value.length;
				Models.onProgress.handle(name, loaded, total);
				return _read();
			});
		}
		return _read();
	}).then(function (buf) {
		if (timedOut) return;
		clearTimeout(timer);
		if (buf instanceof ArrayBuffer) buf = new Uint8Array(buf);
		done(buf);
	}).catch(function (e) {
		if (timedOut) return;
		clearTimeout(timer);
		done(null, e);
	});
}

function _concat(chunks, totalLen) {
	var buf = new Uint8Array(totalLen);
	var offset = 0;
	for (var i = 0; i < chunks.length; i++) {
		buf.set(chunks[i], offset);
		offset += chunks[i].length;
	}
	return buf;
}

// ─────────────────────────────────────────────────────────────────────────
// SHA-256 verification
// ─────────────────────────────────────────────────────────────────────────

function _sha256(buf, callback) {
	if (typeof crypto !== 'undefined' && crypto.subtle) {
		crypto.subtle.digest('SHA-256', buf).then(function (hash) {
			callback(Array.from(new Uint8Array(hash)).map(function (b) {
				return b.toString(16).padStart(2, '0');
			}).join(''));
		}).catch(function () { callback(null); });
	} else if (typeof require !== 'undefined') {
		try {
			var h = require('crypto').createHash('sha256').update(Buffer.from(buf)).digest('hex');
			callback(h);
		} catch (e) { callback(null); }
	} else {
		callback(null); // can't verify, skip
	}
}

// ─────────────────────────────────────────────────────────────────────────
// IndexedDB binary cache
// ─────────────────────────────────────────────────────────────────────────

var _idb = null;
var _idbOpening = false;
var _idbQueue = [];

function _idbOpen(callback) {
	if (!Models.options.cacheInIDB || typeof indexedDB === 'undefined') {
		return callback(null);
	}
	if (_idb) return callback(_idb);
	_idbQueue.push(callback);
	if (_idbOpening) return;
	_idbOpening = true;
	try {
		var req = indexedDB.open(Models.options.idbName, 1);
		req.onupgradeneeded = function (e) {
			var db = e.target.result;
			if (!db.objectStoreNames.contains(Models.options.idbStore)) {
				db.createObjectStore(Models.options.idbStore, { keyPath: 'name' });
			}
		};
		req.onsuccess = function (e) {
			_idb = e.target.result;
			_idbOpening = false;
			var q = _idbQueue.splice(0);
			for (var i = 0; i < q.length; i++) q[i](_idb);
		};
		req.onerror = function () {
			_idbOpening = false;
			var q = _idbQueue.splice(0);
			for (var i = 0; i < q.length; i++) q[i](null);
		};
	} catch (e) {
		_idbOpening = false;
		var q = _idbQueue.splice(0);
		for (var i = 0; i < q.length; i++) q[i](null);
	}
}

function _idbGet(name, callback) {
	_idbOpen(function (db) {
		if (!db) return callback(null);
		try {
			var tx = db.transaction(Models.options.idbStore, 'readonly');
			var req = tx.objectStore(Models.options.idbStore).get(name);
			req.onsuccess = function () { callback(req.result || null); };
			req.onerror = function () { callback(null); };
		} catch (e) { callback(null); }
	});
}

function _idbPut(name, data, sha256) {
	_idbOpen(function (db) {
		if (!db) return;
		try {
			var tx = db.transaction(Models.options.idbStore, 'readwrite');
			tx.objectStore(Models.options.idbStore).put({ name: name, data: data, sha256: sha256, cachedAt: Date.now() });
		} catch (e) {}
	});
}

// ─────────────────────────────────────────────────────────────────────────
// Runtime loaders (lazy, one-time)
// ─────────────────────────────────────────────────────────────────────────

function _ensureRuntime(name, callback) {
	if (_runtimes[name]) return Q.handle(callback);
	var urls = Models.runtimes[name];
	if (!urls) return callback(new Error('Q.Models: no runtime URL for "' + name + '"'));
	var scripts = typeof urls === 'string' ? [urls] : urls;
	Q.addScript(scripts, function () {
		_runtimes[name] = true;
		Q.handle(callback);
	});
}

// ─────────────────────────────────────────────────────────────────────────
// Model wrapper — normalizes every model to { run, dispose, name, ... }
// ─────────────────────────────────────────────────────────────────────────

function _wrapModel(entry, raw) {
	return {
		name:    entry.name,
		raw:     raw,
		format:  entry.format,
		backend: Models.backend(),

		/**
		 * @method run
		 * @param {Mixed} input
		 * @param {Function} [callback]  (output, error)
		 * @return {Promise}
		 */
		run: function (input, callback) {
			var t0 = Date.now();
			var processed = entry.preprocess ? entry.preprocess(input) : input;
			var d = _deferred();
			if (callback) d.promise.then(function (o) { callback(o); }, function (e) { callback(null, e); });

			function _finish(output, error) {
				if (error) { d.reject(error); return; }
				var final = entry.postprocess ? entry.postprocess(output) : output;
				Models.onInfer.handle(entry.name, input, final, Date.now() - t0);
				d.resolve(final);
			}

			try {
				var result;
				if (typeof raw === 'function') {
					result = raw(processed);
				} else if (typeof raw.infer === 'function') {
					result = raw.infer(processed);
				} else if (typeof raw.estimateFaces === 'function') {
					result = raw.estimateFaces(processed);
				} else if (typeof raw.detect === 'function') {
					result = raw.detect(processed);
				} else if (typeof raw.predict === 'function') {
					result = raw.predict(processed);
				} else if (typeof raw.classify === 'function') {
					result = raw.classify(processed);
				} else if (typeof raw.run === 'function') {
					result = raw.run(processed);
				} else {
					return _finish(null, new Error('Q.Models: "' + entry.name + '" has no inference method'));
				}

				if (result && typeof result.then === 'function') {
					result.then(function (r) { _finish(r); }, function (e) { _finish(null, e); });
				} else {
					_finish(result);
				}
			} catch (e) { _finish(null, e); }

			return d.promise;
		},

		dispose: function () {
			if (raw && typeof raw.dispose === 'function') {
				try { raw.dispose(); } catch (e) {}
			}
			raw = null;
		}
	};
}

// ─────────────────────────────────────────────────────────────────────────
// Promise helpers (works even if Q.Promise is undefined)
// ─────────────────────────────────────────────────────────────────────────

function _deferred() {
	var resolve, reject;
	var P = Q.Promise || (typeof Promise !== 'undefined' ? Promise : null);
	var promise = P ? new P(function (res, rej) { resolve = res; reject = rej; }) : null;
	if (!promise) {
		// Minimal sync fallback when no Promise exists
		var _val, _err, _cbs = [];
		resolve = function (v) { _val = v; for (var i = 0; i < _cbs.length; i++) _cbs[i][0](v); };
		reject = function (e) { _err = e; for (var i = 0; i < _cbs.length; i++) _cbs[i][1](e); };
		promise = { then: function (onR, onJ) { if (_val !== undefined) onR(_val); else if (_err !== undefined) onJ && onJ(_err); else _cbs.push([onR, onJ || function(){}]); return promise; } };
	}
	return { promise: promise, resolve: resolve, reject: reject };
}

function _resolve(v) { var d = _deferred(); d.resolve(v); return d.promise; }
function _reject(e)  { var d = _deferred(); d.reject(e);  return d.promise; }
function _global(name) { return (typeof window !== 'undefined' ? window[name] : undefined) || (typeof globalThis !== 'undefined' ? globalThis[name] : undefined); }

// ─────────────────────────────────────────────────────────────────────────
// Shims for standalone use (without full Q.js)
// ─────────────────────────────────────────────────────────────────────────

if (!Q.handle) {
	Q.handle = function (cb, ctx, args) {
		if (typeof cb === 'function') return cb.apply(ctx || null, args || []);
		return 0;
	};
}

if (!Q.extend) {
	Q.extend = function (target) {
		for (var i = 1; i < arguments.length; i++) {
			var src = arguments[i];
			if (src && typeof src === 'object') { for (var k in src) { if (src.hasOwnProperty(k)) target[k] = src[k]; } }
		}
		return target;
	};
}

if (!Q.addScript) {
	Q.addScript = function (srcs, callback) {
		if (typeof srcs === 'string') srcs = [srcs];
		var remaining = srcs.length;
		if (!remaining) { Q.handle(callback); return; }
		srcs.forEach(function (src) {
			var s = document.createElement('script');
			s.src = src;
			s.onload = s.onerror = function () { if (--remaining === 0) Q.handle(callback); };
			document.head.appendChild(s);
		});
	};
}

})(typeof Q !== 'undefined' ? Q : (typeof window !== 'undefined' ? (window.Q = window.Q || { plugins: {}, Event: function(){ this.handle = function(){}; this.set = function(){}; } }) : {}));