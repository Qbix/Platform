/**
 * Q.Data.Merkle.proof
 * Generate a Merkle proof for the leaf at index.
 *
 * @param {Array<Uint8Array|String>} leaves  Full ordered leaf array
 * @param {Number}   index    Leaf index to prove
 * @param {Function} [callback] (err, { proof: Array, rootHex: String })
 *   proof is Array<{ hex: String, side: 'left'|'right' }>
 * @return {Q.Promise}
 */
Q.exports(function (Q, _) {

    return Q.promisify(function (leaves, index, callback) {
        if (index < 0 || index >= leaves.length) {
            return callback(new Error('Q.Data.Merkle.proof: index out of range'));
        }

        var enc = new TextEncoder();

        Promise.all(leaves.map(function (leaf) {
            var bytes = (typeof leaf === 'string') ? enc.encode(leaf) : leaf;
            return _.sha256(bytes);
        })).then(function (hashes) {
            var steps = [];
            var idx   = index;

            function _step(nodes) {
                if (nodes.length === 1) {
                    return Promise.resolve(_.toHex(nodes[0]));
                }
                var sibling, side;
                if (idx % 2 === 0) {
                    sibling = (idx + 1 < nodes.length) ? nodes[idx + 1] : nodes[idx];
                    side    = 'right';
                } else {
                    sibling = nodes[idx - 1];
                    side    = 'left';
                }
                steps.push({ hex: _.toHex(sibling), side: side });
                idx = Math.floor(idx / 2);
                return _.hashLevel(nodes).then(_step);
            }

            return _step(hashes).then(function (rootHex) {
                callback(null, { proof: steps, rootHex: rootHex });
            });
        }).catch(callback);
    }, false, 2);

});
