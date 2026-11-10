Q.exports(function (Q) {
	/**
	 * Compiles SafeScript source to JavaScript.
	 *
	 * The SafeScript compiler must be loaded first via Q.addScript().
	 * This is typically done automatically by Q.SafeScript.run() or
	 * by the tool/method loading system when it encounters a .safe file.
	 *
	 * @method compile
	 * @static
	 * @param {String} source SafeScript source code
	 * @param {Object} [opts] Compiler options
	 * @param {Object} [opts.allow] Additional identifiers to allow
	 * @return {Object} { code, ast, hash }
	 */
	return function Q_SafeScript_compile(source, opts) {
		if (typeof SafeScript === 'undefined') {
			throw new Error('Q.SafeScript: SafeScript compiler not loaded. ' +
				'Include safescript.js before using Q.SafeScript.compile()');
		}
		return SafeScript.compile(source, opts);
	};
});
