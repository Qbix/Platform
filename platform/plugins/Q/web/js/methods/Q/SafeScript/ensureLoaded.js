Q.exports(function (Q) {
    var _promise = null;

    /**
     * Returns a Promise that resolves when the SafeScript compiler is available.
     * Concurrent callers all share the same in-flight Promise.
     *
     * @method ensureLoaded
     * @static
     * @return {Promise}
     */
    return function Q_SafeScript_ensureLoaded() {
        if (_promise) return _promise;

        if (typeof SafeScript !== 'undefined') {
            return (_promise = Promise.resolve());
        }

        var src = Q.SafeScript.src
            || Q.getObject('Q.plugins.Q.SafeScript.src', Q)
            || Q.url('{{Q}}/js/safescript/index.js');

        _promise = new Promise(function (resolve) {
            Q.addScript(src, resolve);
        });

        return _promise;
    };
});