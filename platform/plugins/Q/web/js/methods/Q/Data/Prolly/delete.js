/**
 * Q.Data.Prolly.delete
 * Remove a key. Returns new root hash, or null for an empty tree.
 *
 * @param {String}   rootHash
 * @param {String}   key
 * @param {Object}   [store]
 * @param {Function} [callback]  (err, newRootHash|null)
 * @return {Q.Promise<String|null>}
 */
Q.exports(function (Q, _) {

    return Q.promisify(function (rootHash, key, store, callback) {
        if (typeof store === 'function') { callback = store; store = null; }
        store = store || _.defaultStore;

        _.collectAll(rootHash, store).then(function (entries) {
            var filtered = entries.filter(function (e) { return e.key !== key; });
            if (!filtered.length) {
                return Promise.resolve(null);
            }
            return Q.Data.Prolly.build(filtered, store);
        }).then(function (newRootHash) {
            callback(null, newRootHash);
        }).catch(callback);
    }, false, 3);

});
