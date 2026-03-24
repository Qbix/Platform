/**
 * Q.Data.Prolly.build
 * Build a Prolly tree from an array of { key, value } entries.
 * Entries are sorted by key before insertion.
 * Returns the root hash as a hex string.
 *
 * @param {Array}    entries    [{ key: String, value: String }]
 * @param {Object}   [store]    { get(hash), put(hash, node) } -> Promise
 * @param {Function} [callback] (err, rootHex)
 * @return {Q.Promise<String>}
 */
Q.exports(function (Q, _) {

    return Q.promisify(function (entries, store, callback) {
        if (typeof store === 'function') { callback = store; store = null; }
        store = store || _.defaultStore;

        if (!entries || !entries.length) {
            return callback(new Error('Q.Data.Prolly.build: no entries provided'));
        }

        _.buildLeaves(_.sortEntries(entries), store)
            .then(function (level) { return _.reduceLevel(level, store); })
            .then(function (rootHash) { callback(null, rootHash); })
            .catch(callback);
    }, false, 2);

});
