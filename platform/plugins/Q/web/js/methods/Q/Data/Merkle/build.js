/**
 * Q.Data.Merkle.build
 * Build a Merkle tree from an ordered array of leaf values.
 * Each leaf is hashed with SHA-256 first.
 * Returns the root as a hex string.
 *
 * @param {Array<Uint8Array|String>} leaves
 *   If strings are passed they are UTF-8 encoded before hashing.
 * @param {Function} [callback] (err, rootHex)
 * @return {Q.Promise<String>}
 */
Q.exports(function (Q, _) {

    return Q.promisify(function (leaves, callback) {
        if (!leaves || !leaves.length) {
            return callback(new Error('Q.Data.Merkle.build: no leaves provided'));
        }

        var enc = new TextEncoder();

        Promise.all(leaves.map(function (leaf) {
            var bytes = (typeof leaf === 'string') ? enc.encode(leaf) : leaf;
            return _.sha256(bytes);
        })).then(_.reduce).then(function (rootBytes) {
            callback(null, _.toHex(rootBytes));
        }).catch(callback);
    }, false, 1);

});
