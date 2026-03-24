/**
 * Q.Data.Merkle.verify
 * Verify a Merkle proof for a leaf against a known root.
 *
 * @param {Uint8Array|String} leaf     The leaf being verified
 * @param {Array}  proof  Array<{ hex: String, side: 'left'|'right' }>
 * @param {String} rootHex  Expected root as hex string
 * @param {Function} [callback]  (err, Boolean)
 * @return {Q.Promise<Boolean>}
 */
Q.exports(function (Q, _) {

    return Q.promisify(function (leaf, proof, rootHex, callback) {
        var enc   = new TextEncoder();
        var bytes = (typeof leaf === 'string') ? enc.encode(leaf) : leaf;

        _.sha256(bytes).then(function (current) {
            return proof.reduce(function (chain, step) {
                return chain.then(function (cur) {
                    var sibling = Q.Data.fromHex(step.hex);
                    var pair    = (step.side === 'left')
                        ? _.concat(sibling, cur)
                        : _.concat(cur, sibling);
                    return _.sha256(pair);
                });
            }, Promise.resolve(current));
        }).then(function (computedRoot) {
            callback(null, _.toHex(computedRoot) === rootHex);
        }).catch(callback);
    }, false, 3);

});
