/**
 * Shared structural helpers for Q.Data.Prolly method files.
 * Loaded once via options.require and passed as _ to each method file.
 *
 * Also sets Q.Data.Prolly.defaultStore once loaded.
 *
 * Exports a plain object (sync).
 */
Q.exports(function (Q) {

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    // Average ~16 keys per node. Boundary when SHA-256(key)[0] < 256/16 = 16.
    var BRANCHING_FACTOR = 16;
    var BOUNDARY_BYTE    = Math.floor(256 / BRANCHING_FACTOR); // 16

    // -------------------------------------------------------------------------
    // In-memory default store
    // -------------------------------------------------------------------------

    var _mem = {};
    var defaultStore = {
        get: function (hash) { return Promise.resolve(_mem[hash] || null); },
        put: function (hash, node) { _mem[hash] = node; return Promise.resolve(); }
    };

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    var _ = {

        BOUNDARY_BYTE: BOUNDARY_BYTE,
        defaultStore:  defaultStore,

        /**
         * SHA-256 arbitrary bytes. Returns Promise<Uint8Array(32)>.
         */
        sha256: function (payload) {
            return Q.Data.digest('SHA-256', payload);
        },

        /**
         * Hex-encode a Uint8Array.
         */
        toHex: function (bytes) {
            return Q.Data.toHex(bytes);
        },

        /**
         * A key is a chunk boundary when SHA-256(key)[0] < BOUNDARY_BYTE.
         * Returns Promise<Boolean>.
         */
        isBoundary: function (key) {
            return _.sha256(new TextEncoder().encode(key)).then(function (digest) {
                return digest[0] < BOUNDARY_BYTE;
            });
        },

        /**
         * Sort entries by key, lexicographic.
         */
        sortEntries: function (entries) {
            return entries.slice().sort(function (a, b) {
                return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0);
            });
        },

        /**
         * Serialise a node to JSON, SHA-256 it, return hex hash.
         * Returns Promise<String>.
         */
        nodeHash: function (node) {
            var bytes = new TextEncoder().encode(JSON.stringify(node));
            return _.sha256(bytes).then(_.toHex);
        },

        /**
         * Store a node and return { hash, node }.
         */
        storeNode: function (store, node) {
            return _.nodeHash(node).then(function (hash) {
                return store.put(hash, node).then(function () {
                    return { hash: hash, node: node };
                });
            });
        },

        /**
         * Build leaf nodes from sorted entries, splitting at boundary keys.
         * Returns Promise<Array<{ hash, node }>>.
         */
        buildLeaves: function (entries, store) {
            return Promise.all(entries.map(function (e) {
                return _.isBoundary(e.key);
            })).then(function (boundaries) {
                var nodes   = [];
                var current = { keys: [], values: [], isLeaf: true };
                for (var i = 0; i < entries.length; i++) {
                    current.keys.push(entries[i].key);
                    current.values.push(entries[i].value);
                    var isLast = (i === entries.length - 1);
                    if ((boundaries[i] && current.keys.length > 1) || isLast) {
                        nodes.push(Q.copy(current));
                        current = { keys: [], values: [], isLeaf: true };
                    }
                }
                return Promise.all(nodes.map(function (node) {
                    return _.storeNode(store, node);
                }));
            });
        },

        /**
         * Build one internal level from child { hash, node } pairs.
         * Returns Promise<Array<{ hash, node }>>.
         */
        buildInternal: function (children, store) {
            return Promise.all(children.map(function (child) {
                var lastKey = child.node.keys[child.node.keys.length - 1];
                return _.isBoundary(lastKey).then(function (b) {
                    return { child: child, isBoundary: b };
                });
            })).then(function (items) {
                var nodes   = [];
                var current = { keys: [], children: [], isLeaf: false };
                for (var i = 0; i < items.length; i++) {
                    var lastKey = items[i].child.node.keys[items[i].child.node.keys.length - 1];
                    current.keys.push(lastKey);
                    current.children.push(items[i].child.hash);
                    var isLast = (i === items.length - 1);
                    if ((items[i].isBoundary && current.keys.length > 1) || isLast) {
                        nodes.push(Q.copy(current));
                        current = { keys: [], children: [], isLeaf: false };
                    }
                }
                return Promise.all(nodes.map(function (node) {
                    return _.storeNode(store, node);
                }));
            });
        },

        /**
         * Reduce levels to a single root hash.
         * Returns Promise<String>.
         */
        reduceLevel: function (nodes, store) {
            if (nodes.length === 1) {
                return Promise.resolve(nodes[0].hash);
            }
            return _.buildInternal(nodes, store).then(function (level) {
                return _.reduceLevel(level, store);
            });
        },

        /**
         * Collect all { key, value } entries from a subtree.
         * Returns Promise<Array<{ key, value }>>.
         */
        collectAll: function (hash, store) {
            if (!hash) {
                return Promise.resolve([]);
            }
            return store.get(hash).then(function (node) {
                if (!node) {
                    return [];
                }
                if (node.isLeaf) {
                    return node.keys.map(function (k, i) {
                        return { key: k, value: node.values[i] };
                    });
                }
                return Promise.all(node.children.map(function (childHash) {
                    return _.collectAll(childHash, store);
                })).then(function (sets) {
                    return [].concat.apply([], sets);
                });
            });
        }

    };

    // Expose defaultStore on Q.Data.Prolly once this is loaded
    Q.Data.Prolly.defaultStore = defaultStore;

    return _;

});
