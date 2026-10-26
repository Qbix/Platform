Q.exports(function (Q) {
	var _loaded = false;
	var _loading = false;
	var _queue = [];

	/**
	 * Ensures the SafeScript compiler is loaded. If already loaded, calls
	 * the callback immediately. If not, loads it from the configured URL
	 * (Q.SafeScript.src) or the default path, then calls the callback.
	 *
	 * @method ensureLoaded
	 * @static
	 * @param {Function} callback Called when SafeScript compiler is available
	 */
	return function Q_SafeScript_ensureLoaded(callback) {
		// Already loaded
		if (_loaded || typeof SafeScript !== 'undefined') {
			_loaded = true;
			return callback && callback();
		}

		if (callback) {
			_queue.push(callback);
		}

		if (_loading) {
			return; // will be called when load completes
		}
		_loading = true;

		// Determine SafeScript source URL
		var src = Q.SafeScript.src
			|| Q.getObject('Q.plugins.Q.SafeScript.src', Q)
			|| Q.url('{{Q}}/js/safescript/index.js');

		Q.addScript(src, function () {
			_loaded = true;
			_loading = false;
			var q = _queue.slice();
			_queue.length = 0;
			q.forEach(function (fn) { fn(); });
		});
	};
});
