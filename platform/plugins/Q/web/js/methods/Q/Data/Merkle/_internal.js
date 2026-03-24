/**
 * Shared structural helpers for Q.Data.Merkle method files.
 * Loaded once via options.require and passed as _ to each method file.
 * Crypto (SHA-256) is done via Q.Data.digest, available in closure as Q.
 *
 * Exports a plain object (sync) — no async setup needed here.
 */
Q.exports(function (Q) {

    var _ = {

        /**
         * SHA-256 arbitrary bytes. Returns Promise<Uint8Array(32)>.
         * payload may be Uint8Array or ArrayBuffer.
         */
        sha256: function (payload) {
            return Q.Data.digest('SHA-256', payload);
        },

        /**
         * Concatenate two Uint8Arrays.
         */
        concat: function (a, b) {
            var out = new Uint8Array(a.length + b.length);
            out.set(a, 0);
            out.set(b, a.length);
            return out;
        },

        /**
         * Encode Uint8Array to lowercase hex string.
         */
        toHex: function (bytes) {
            return Q.Data.toHex(bytes);
        },

        /**
         * Hash one level of the tree: pair up nodes, hash each pair.
         * Odd node at end is promoted (paired with itself).
         * nodes: Array<Uint8Array>
         * Returns Promise<Array<Uint8Array>>.
         */
        hashLevel: function (nodes) {
            var pairs = [];
            for (var i = 0; i < nodes.length; i += 2) {
                var left  = nodes[i];
                var right = (i + 1 < nodes.length) ? nodes[i + 1] : left;
                pairs.push(_.sha256(_.concat(left, right)));
            }
            return Promise.all(pairs);
        },

        /**
         * Reduce an array of hash nodes to a single root hash.
         * Returns Promise<Uint8Array(32)>.
         */
        reduce: function (nodes) {
            if (nodes.length === 1) {
                return Promise.resolve(nodes[0]);
            }
            return _.hashLevel(nodes).then(_.reduce);
        }

    };

    return _;

});
