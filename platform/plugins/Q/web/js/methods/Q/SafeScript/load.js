Q.exports(function (Q) {
    var _cache = {};

    /**
     * Loads a .safe file, compiles it, and resolves to a factory function
     * (scope, opts?) → Promise<returnValue> that runs the compiled code.
     *
     * Caches the factory promise per URL; a failed load is evicted so the
     * next call retries.
     *
     * @method load
     * @static
     * @param {String} url URL of the .safe file to load
     * @return {Promise<Function>} Resolves to factory(scope, opts) → Promise
     */
    return function Q_SafeScript_load(url) {
        if (_cache[url]) return _cache[url];

        var p = Q.SafeScript.ensureLoaded().then(function () {
            return new Promise(function (resolve, reject) {
                Q.request(url, function (err, response) {
                    if (err) return reject(err);
                    try {
                        var source = (typeof response === 'string')
                            ? response
                            : response.responseText || response;
                        // Pre-compile catches syntax errors at load time, not call time
                        var compiled = SafeScript.compile(source);
                        var factory = function Q_SafeScript_factory(scope, opts) {
                            return SafeScript.run(source, scope, opts);
                        };
                        factory.source = source;
                        factory.compiled = compiled;
                        resolve(factory);
                    } catch (e) {
                        reject(e);
                    }
                }, { extend: false, parse: false });
            });
        });

        // Cache the promise immediately so concurrent callers share it.
        // Evict on failure so the next caller retries the fetch.
        p.then(null, function () { delete _cache[url]; });
        _cache[url] = p;
        return p;
    };
});