/**
 * Q.Data.Prolly.diff
 * Compute the diff between two trees.
 * Subtrees with equal hashes are skipped entirely (structural sharing).
 * Returns [{ key, before: value|null, after: value|null }] sorted by key.
 *
 * @param {String}   rootHashA  "Before" tree
 * @param {String}   rootHashB  "After"  tree
 * @param {Object}   [store]
 * @param {Function} [callback]  (err, Array)
 * @return {Q.Promise}
 */
Q.exports(function (Q, _) {

    return Q.promisify(function (rootHashA, rootHashB, store, callback) {
        if (typeof store === 'function') { callback = store; store = null; }
        store = store || _.defaultStore;

        var changes = [];

        function _diffMaps(mapA, mapB) {
            Object.keys(Q.extend({}, mapA, mapB)).forEach(function (k) {
                if (mapA[k] !== mapB[k]) {
                    changes.push({
                        key:    k,
                        before: mapA[k] !== undefined ? mapA[k] : null,
                        after:  mapB[k] !== undefined ? mapB[k] : null
                    });
                }
            });
        }

        function _compare(hashA, hashB) {
            if (hashA === hashB) { return Promise.resolve(); }

            return Promise.all([
                hashA ? store.get(hashA) : Promise.resolve(null),
                hashB ? store.get(hashB) : Promise.resolve(null)
            ]).then(function (nodes) {
                var nodeA = nodes[0];
                var nodeB = nodes[1];

                if ((!nodeA || nodeA.isLeaf) && (!nodeB || nodeB.isLeaf)) {
                    var mapA = {}, mapB = {};
                    if (nodeA) { nodeA.keys.forEach(function (k, i) { mapA[k] = nodeA.values[i]; }); }
                    if (nodeB) { nodeB.keys.forEach(function (k, i) { mapB[k] = nodeB.values[i]; }); }
                    _diffMaps(mapA, mapB);
                    return;
                }

                // Mixed levels or both internal — fall back to full leaf collection
                return Promise.all([
                    _.collectAll(hashA, store),
                    _.collectAll(hashB, store)
                ]).then(function (sets) {
                    var mapA = {}, mapB = {};
                    sets[0].forEach(function (e) { mapA[e.key] = e.value; });
                    sets[1].forEach(function (e) { mapB[e.key] = e.value; });
                    _diffMaps(mapA, mapB);
                });
            });
        }

        _compare(rootHashA, rootHashB).then(function () {
            changes.sort(function (a, b) { return a.key < b.key ? -1 : 1; });
            callback(null, changes);
        }).catch(callback);
    }, false, 3);

});
