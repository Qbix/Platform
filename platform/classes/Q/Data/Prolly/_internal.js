"use strict";
/**
 * Shared helpers for Q.Data.Prolly (Node.js).
 * Counterpart of browser methods/Q/Data/Prolly/_internal.js.
 * isBoundary is sync in Node — no subtle crypto needed.
 */
var nodeCrypto = require('crypto');

var BOUNDARY_BYTE = 16; // SHA-256(key)[0] < 16  → ~1/16 boundary probability

var _mem = {};
var defaultStore = {
    get: function (hash) { return Promise.resolve(_mem[hash] || null); },
    put: function (hash, node) { _mem[hash] = node; return Promise.resolve(); }
};

var _ = module.exports = {

    BOUNDARY_BYTE: BOUNDARY_BYTE,
    defaultStore:  defaultStore,

    isBoundary: function (key) {
        var d = nodeCrypto.createHash('sha256').update(Buffer.from(key, 'utf8')).digest();
        return d[0] < BOUNDARY_BYTE;
    },

    nodeHash: function (node) {
        return nodeCrypto.createHash('sha256')
            .update(Buffer.from(JSON.stringify(node), 'utf8'))
            .digest('hex');
    },

    storeNode: function (store, node) {
        var hash = _.nodeHash(node);
        return store.put(hash, node).then(function () { return { hash: hash, node: node }; });
    },

    sortEntries: function (entries) {
        return entries.slice().sort(function (a, b) {
            return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0);
        });
    },

    buildLeaves: function (entries, store) {
        var nodes   = [];
        var current = { keys: [], values: [], isLeaf: true };
        for (var i = 0; i < entries.length; i++) {
            current.keys.push(entries[i].key);
            current.values.push(entries[i].value);
            var isLast  = (i === entries.length - 1);
            var isBound = _.isBoundary(entries[i].key);
            if ((isBound && current.keys.length > 1) || isLast) {
                nodes.push(JSON.parse(JSON.stringify(current)));
                current = { keys: [], values: [], isLeaf: true };
            }
        }
        return Promise.all(nodes.map(function (n) { return _.storeNode(store, n); }));
    },

    buildInternal: function (children, store) {
        var nodes   = [];
        var current = { keys: [], children: [], isLeaf: false };
        for (var i = 0; i < children.length; i++) {
            var lastKey = children[i].node.keys[children[i].node.keys.length - 1];
            current.keys.push(lastKey);
            current.children.push(children[i].hash);
            var isLast  = (i === children.length - 1);
            var isBound = _.isBoundary(lastKey);
            if ((isBound && current.keys.length > 1) || isLast) {
                nodes.push(JSON.parse(JSON.stringify(current)));
                current = { keys: [], children: [], isLeaf: false };
            }
        }
        return Promise.all(nodes.map(function (n) { return _.storeNode(store, n); }));
    },

    reduceLevel: function (nodes, store) {
        if (nodes.length === 1) { return Promise.resolve(nodes[0].hash); }
        return _.buildInternal(nodes, store).then(function (level) {
            return _.reduceLevel(level, store);
        });
    },

    collectAll: function (hash, store) {
        if (!hash) { return Promise.resolve([]); }
        return store.get(hash).then(function (node) {
            if (!node) { return []; }
            if (node.isLeaf) {
                return node.keys.map(function (k, i) { return { key: k, value: node.values[i] }; });
            }
            return Promise.all(node.children.map(function (ch) {
                return _.collectAll(ch, store);
            })).then(function (sets) { return [].concat.apply([], sets); });
        });
    }
};
