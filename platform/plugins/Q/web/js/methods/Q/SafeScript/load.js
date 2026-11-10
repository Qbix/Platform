Q.exports(function (Q) {
	/**
	 * Loads a .safe file from a URL, compiles it, and returns a factory
	 * function that accepts a scope and runs the compiled code.
	 *
	 * This is the integration point for Q.Tool.define({ safe: url }) and
	 * Q.Method.define() — when a tool or method points to a .safe file,
	 * the loading system calls Q.SafeScript.load() to compile it and
	 * produce a constructor or method implementation.
	 *
	 * @method load
	 * @static
	 * @param {String} url URL of the .safe file to load
	 * @param {Function} callback Called with (err, factory) where factory(scope, opts) → Promise
	 */
	return function Q_SafeScript_load(url, callback) {
		// Ensure SafeScript compiler is loaded first
		Q.SafeScript.ensureLoaded(function () {
			Q.request(url, function (err, response) {
				if (err) {
					return callback(err);
				}
				try {
					var source = (typeof response === 'string')
						? response
						: response.responseText || response;
					// Pre-compile (catches syntax errors early)
					var compiled = SafeScript.compile(source);
					// Return a factory that builds and runs with any scope
					var factory = function Q_SafeScript_factory(scope, opts) {
						return SafeScript.run(source, scope, opts);
					};
					factory.source = source;
					factory.compiled = compiled;
					callback(null, factory);
				} catch (e) {
					callback(e);
				}
			}, { extend: false, parse: false });
		});
	};
});
