/**
 * Q.Data.Prolly.get
 * Look up a key in the tree. Returns value string or null if not found.
 *
 * @param {String}   rootHash
 * @param {String}   key
 * @param {Object}   [store]
 * @param {Function} [callback]  (err, String|null)
 * @return {Q.Promise<String|null>}
 */
Q.exports(function (Q, _) {

    return Q.promisify(function (rootHash, key, store, callback) {
        if (typeof store === 'function') { callback = store; store = null; }
        store = store || _.defaultStore;

        function _search(hash) {
            return store.get(hash).then(function (node) {
                if (!node) { return null; }
                if (node.isLeaf) {
                    var idx = node.keys.indexOf(key);
                    return idx >= 0 ? node.values[idx] : null;
                }
                // First separator key >= search key -> descend into that child
                var childIdx = node.keys.length - 1;
                for (var i = 0; i < node.keys.length; i++) {
                    if (key <= node.keys[i]) { childIdx = i; break; }
                }
                return _search(node.children[childIdx]);
            });
        }

        _search(rootHash)
            .then(function (value) { callback(null, value); })
            .catch(callback);
    }, false, 3);

});
