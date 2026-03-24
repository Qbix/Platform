"use strict";
/**
 * Q.Data.Prolly — probabilistic B-tree for set reconciliation (Node.js).
 * Counterpart of browser methods/Q/Data/Prolly/{build,get,set,delete,diff}.js.
 *
 * Boundaries: SHA-256(key)[0] < 16  (~1/16 probability).
 * Structural sharing: diff() skips equal-hash subtrees in O(diff × log n).
 * Pluggable store: { get(hash) → Promise<node|null>, put(hash, node) → Promise }.
 *
 * @class Q.Data.Prolly
 * @static
 */
var nodeCrypto = require('crypto');
var Data       = require('../Data');

var Prolly = module.exports;
Data.Prolly = Prolly; // self-attach

// ─── Default in-memory store ─────────────────────────────────────────────────

var _mem = {};
Prolly.defaultStore = {
    get: function (hash) { return Promise.resolve(_mem[hash] || null); },
    put: function (hash, node) { _mem[hash] = node; return Promise.resolve(); }
};

// ─── Private helpers ──────────────────────────────────────────────────────────

var BOUNDARY_BYTE = 16; // SHA-256(key)[0] < 16 → chunk boundary

function _isBoundary(key) {
    return nodeCrypto.createHash('sha256')
        .update(Buffer.from(key, 'utf8')).digest()[0] < BOUNDARY_BYTE;
}

function _nodeHash(node) {
    return nodeCrypto.createHash('sha256')
        .update(Buffer.from(JSON.stringify(node), 'utf8')).digest('hex');
}

function _storeNode(store, node) {
    var hash = _nodeHash(node);
    return store.put(hash, node).then(function () { return { hash: hash, node: node }; });
}

function _sortEntries(entries) {
    return entries.slice().sort(function (a, b) {
        return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0);
    });
}

function _buildLeaves(entries, store) {
    var nodes   = [];
    var current = { keys: [], values: [], isLeaf: true };
    for (var i = 0; i < entries.length; i++) {
        current.keys.push(entries[i].key);
        current.values.push(entries[i].value);
        var isLast  = (i === entries.length - 1);
        var isBound = _isBoundary(entries[i].key);
        if ((isBound && current.keys.length > 1) || isLast) {
            nodes.push(JSON.parse(JSON.stringify(current)));
            current = { keys: [], values: [], isLeaf: true };
        }
    }
    return Promise.all(nodes.map(function (n) { return _storeNode(store, n); }));
}

function _buildInternal(children, store) {
    var nodes   = [];
    var current = { keys: [], children: [], isLeaf: false };
    for (var i = 0; i < children.length; i++) {
        var lastKey = children[i].node.keys[children[i].node.keys.length - 1];
        current.keys.push(lastKey);
        current.children.push(children[i].hash);
        var isLast  = (i === children.length - 1);
        var isBound = _isBoundary(lastKey);
        if ((isBound && current.keys.length > 1) || isLast) {
            nodes.push(JSON.parse(JSON.stringify(current)));
            current = { keys: [], children: [], isLeaf: false };
        }
    }
    return Promise.all(nodes.map(function (n) { return _storeNode(store, n); }));
}

function _reduceLevel(nodes, store) {
    if (nodes.length === 1) { return Promise.resolve(nodes[0].hash); }
    return _buildInternal(nodes, store).then(function (level) {
        return _reduceLevel(level, store);
    });
}

function _collectAll(hash, store) {
    if (!hash) { return Promise.resolve([]); }
    return store.get(hash).then(function (node) {
        if (!node) { return []; }
        if (node.isLeaf) {
            return node.keys.map(function (k, i) { return { key: k, value: node.values[i] }; });
        }
        return Promise.all(node.children.map(function (ch) {
            return _collectAll(ch, store);
        })).then(function (sets) { return [].concat.apply([], sets); });
    });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build from { key, value } entries. Returns root hash hex.
 * @param {Array}    entries   [{ key: String, value: String }]
 * @param {Object}   [store]
 * @param {Function} [callback]
 * @return {Promise<String>}
 */
Prolly.build = function (entries, store, callback) {
    if (typeof store === 'function') { callback = store; store = null; }
    store = store || Prolly.defaultStore;
    if (!entries || !entries.length) {
        var e = new Error('Q.Data.Prolly.build: no entries');
        if (callback) { callback(e); }
        return Promise.reject(e);
    }
    return _buildLeaves(_sortEntries(entries), store)
        .then(function (level) { return _reduceLevel(level, store); })
        .then(function (root) { if (callback) { callback(null, root); } return root; })
        .catch(function (e)   { if (callback) { callback(e); } return Promise.reject(e); });
};

/**
 * Look up a key. Returns value string or null if not found.
 * @param {String}   rootHash
 * @param {String}   key
 * @param {Object}   [store]
 * @param {Function} [callback]
 * @return {Promise<String|null>}
 */
Prolly.get = function (rootHash, key, store, callback) {
    if (typeof store === 'function') { callback = store; store = null; }
    store = store || Prolly.defaultStore;
    function _search(hash) {
        return store.get(hash).then(function (node) {
            if (!node) { return null; }
            if (node.isLeaf) {
                var idx = node.keys.indexOf(key);
                return idx >= 0 ? node.values[idx] : null;
            }
            var ci = node.keys.length - 1;
            for (var i = 0; i < node.keys.length; i++) {
                if (key <= node.keys[i]) { ci = i; break; }
            }
            return _search(node.children[ci]);
        });
    }
    return _search(rootHash)
        .then(function (v) { if (callback) { callback(null, v); } return v; })
        .catch(function (e) { if (callback) { callback(e); } return Promise.reject(e); });
};

/**
 * Insert or update a key-value pair. Returns new root hash.
 * @param {String}   rootHash
 * @param {String}   key
 * @param {String}   value
 * @param {Object}   [store]
 * @param {Function} [callback]
 * @return {Promise<String>}
 */
Prolly.set = function (rootHash, key, value, store, callback) {
    if (typeof store === 'function') { callback = store; store = null; }
    store = store || Prolly.defaultStore;
    return _collectAll(rootHash, store)
        .then(function (entries) {
            var found   = false;
            var updated = entries.map(function (e) {
                if (e.key === key) { found = true; return { key: key, value: value }; }
                return e;
            });
            if (!found) { updated.push({ key: key, value: value }); }
            return Prolly.build(updated, store);
        })
        .then(function (r) { if (callback) { callback(null, r); } return r; })
        .catch(function (e) { if (callback) { callback(e); } return Promise.reject(e); });
};

/**
 * Remove a key. Returns new root hash or null for an empty tree.
 * @param {String}   rootHash
 * @param {String}   key
 * @param {Object}   [store]
 * @param {Function} [callback]
 * @return {Promise<String|null>}
 */
Prolly.delete = function (rootHash, key, store, callback) {
    if (typeof store === 'function') { callback = store; store = null; }
    store = store || Prolly.defaultStore;
    return _collectAll(rootHash, store)
        .then(function (entries) {
            var filtered = entries.filter(function (e) { return e.key !== key; });
            if (!filtered.length) { return null; }
            return Prolly.build(filtered, store);
        })
        .then(function (r) { if (callback) { callback(null, r); } return r; })
        .catch(function (e) { if (callback) { callback(e); } return Promise.reject(e); });
};

/**
 * Compute the diff between two trees.
 * Subtrees with equal hashes are skipped (structural sharing).
 * Returns [{ key, before, after }] sorted by key.
 * @param {String}   rootHashA  "Before" tree
 * @param {String}   rootHashB  "After"  tree
 * @param {Object}   [store]
 * @param {Function} [callback]
 * @return {Promise<Array>}
 */
Prolly.diff = function (rootHashA, rootHashB, store, callback) {
    if (typeof store === 'function') { callback = store; store = null; }
    store = store || Prolly.defaultStore;
    var changes = [];

    function _diffMaps(mapA, mapB) {
        var all = Object.assign({}, mapA, mapB);
        Object.keys(all).forEach(function (k) {
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
        ]).then(function (pair) {
            var nodeA = pair[0], nodeB = pair[1];
            if ((!nodeA || nodeA.isLeaf) && (!nodeB || nodeB.isLeaf)) {
                var mapA = {}, mapB = {};
                if (nodeA) { nodeA.keys.forEach(function (k, i) { mapA[k] = nodeA.values[i]; }); }
                if (nodeB) { nodeB.keys.forEach(function (k, i) { mapB[k] = nodeB.values[i]; }); }
                _diffMaps(mapA, mapB);
                return;
            }
            return Promise.all([
                _collectAll(hashA, store),
                _collectAll(hashB, store)
            ]).then(function (sets) {
                var mapA = {}, mapB = {};
                sets[0].forEach(function (e) { mapA[e.key] = e.value; });
                sets[1].forEach(function (e) { mapB[e.key] = e.value; });
                _diffMaps(mapA, mapB);
            });
        });
    }

    return _compare(rootHashA, rootHashB)
        .then(function () {
            changes.sort(function (a, b) { return a.key < b.key ? -1 : 1; });
            if (callback) { callback(null, changes); }
            return changes;
        })
        .catch(function (e) { if (callback) { callback(e); } return Promise.reject(e); });
};
