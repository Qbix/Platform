Q.exports(function (Q) {
	/**
	 * Compiles and runs SafeScript source with the given scope.
	 *
	 * Because SafeScript emits every function as async and wraps every
	 * call with await, the scope functions can return Promises transparently.
	 * This is what enables the "transparent cross-context proxying" pattern:
	 * scope objects that proxy calls to a WebWorker via postMessage work
	 * identically to local scope objects — the SafeScript source doesn't change.
	 *
	 * @method run
	 * @static
	 * @param {String} source SafeScript source code
	 * @param {Object} [scope] Capabilities to inject (e.g. { createElement, setText })
	 * @param {Object} [opts] Options { timeout, allow, hooks, facades, dom, env }
	 * @return {Promise} Resolves to the return value of the SafeScript code
	 */
	return function Q_SafeScript_run(source, scope, opts) {
		if (typeof SafeScript === 'undefined') {
			throw new Error('Q.SafeScript: SafeScript compiler not loaded. ' +
				'Include safescript.js before using Q.SafeScript.run()');
		}
		return SafeScript.run(source, scope, opts);
	};
});
