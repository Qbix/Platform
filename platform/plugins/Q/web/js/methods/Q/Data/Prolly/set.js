/**
 * Q.Data.Prolly.set
 * Insert or update a key-value pair. Returns new root hash.
 * v1: full rebuild. TODO v2: path-only O(log n).
 *
 * @param {String}   rootHash
 * @param {String}   key
 * @param {String}   value
 * @param {Object}   [store]
 * @param {Function} [callback]  (err, newRootHash)
 * @return {Q.Promise<String>}
 */
Q.exports(function (Q, _) {

    return Q.promisify(function (rootHash, key, value, store, callback) {
        if (typeof store === 'function') { callback = store; store = null; }
        store = store || _.defaultStore;

        _.collectAll(rootHash, store).then(function (entries) {
            var found   = false;
            var updated = entries.map(function (e) {
                if (e.key === key) { found = true; return { key: key, value: value }; }
                return e;
            });
            if (!found) { updated.push({ key: key, value: value }); }
            return Q.Data.Prolly.build(updated, store);
        }).then(function (newRootHash) {
            callback(null, newRootHash);
        }).catch(callback);
    }, false, 4);

});
