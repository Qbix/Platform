"use strict";
/**
 * Q.Data.Merkle — binary Merkle tree (Node.js).
 * Counterpart of browser methods/Q/Data/Merkle/{build,proof,verify}.js.
 *
 * Leaves = SHA-256(leaf). Parents = SHA-256(left || right).
 * Odd node promoted (paired with itself).
 * All internal ops are sync; public API returns Promises for browser parity.
 *
 * @class Q.Data.Merkle
 * @static
 */
var nodeCrypto = require('crypto');
var Data       = require('../Data');

var Merkle = module.exports;
Data.Merkle = Merkle; // self-attach

// ─── Private helpers ──────────────────────────────────────────────────────────

function _sha256(payload) {
    var buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    return new Uint8Array(nodeCrypto.createHash('sha256').update(buf).digest());
}

function _concat(a, b) {
    var out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
}

function _hashLevel(nodes) {
    var out = [];
    for (var i = 0; i < nodes.length; i += 2) {
        var left  = nodes[i];
        var right = (i + 1 < nodes.length) ? nodes[i + 1] : left;
        out.push(_sha256(_concat(left, right)));
    }
    return out;
}

function _reduce(nodes) {
    while (nodes.length > 1) { nodes = _hashLevel(nodes); }
    return nodes[0];
}

function _leafBytes(leaf) {
    return typeof leaf === 'string' ? Buffer.from(leaf, 'utf8') : Buffer.from(leaf);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build a Merkle tree from ordered leaves. Returns root as hex string.
 * @param {Array<Uint8Array|String>} leaves
 * @param {Function} [callback]
 * @return {Promise<String>}
 */
Merkle.build = function (leaves, callback) {
    try {
        if (!leaves || !leaves.length) { throw new Error('Q.Data.Merkle.build: no leaves'); }
        var hashes = leaves.map(function (leaf) { return _sha256(_leafBytes(leaf)); });
        var hex    = Data.toHex(_reduce(hashes));
        if (callback) { callback(null, hex); }
        return Promise.resolve(hex);
    } catch (e) {
        if (callback) { callback(e); }
        return Promise.reject(e);
    }
};

/**
 * Generate a Merkle inclusion proof for the leaf at index.
 * @param {Array<Uint8Array|String>} leaves
 * @param {Number}   index
 * @param {Function} [callback]  (err, { proof, rootHex })
 * @return {Promise<{ proof: Array, rootHex: String }>}
 */
Merkle.proof = function (leaves, index, callback) {
    try {
        if (index < 0 || index >= leaves.length) {
            throw new Error('Q.Data.Merkle.proof: index out of range');
        }
        var hashes = leaves.map(function (leaf) { return _sha256(_leafBytes(leaf)); });
        var steps  = [];
        var idx    = index;
        var nodes  = hashes.slice();
        while (nodes.length > 1) {
            var sibling, side;
            if (idx % 2 === 0) {
                sibling = (idx + 1 < nodes.length) ? nodes[idx + 1] : nodes[idx];
                side    = 'right';
            } else {
                sibling = nodes[idx - 1];
                side    = 'left';
            }
            steps.push({ hex: Data.toHex(sibling), side: side });
            idx   = Math.floor(idx / 2);
            nodes = _hashLevel(nodes);
        }
        var result = { proof: steps, rootHex: Data.toHex(nodes[0]) };
        if (callback) { callback(null, result); }
        return Promise.resolve(result);
    } catch (e) {
        if (callback) { callback(e); }
        return Promise.reject(e);
    }
};

/**
 * Verify a Merkle proof for a leaf against a known root.
 * @param {Uint8Array|String} leaf
 * @param {Array}  proof    [{ hex: String, side: 'left'|'right' }]
 * @param {String} rootHex
 * @param {Function} [callback]
 * @return {Promise<Boolean>}
 */
Merkle.verify = function (leaf, proof, rootHex, callback) {
    try {
        var current = _sha256(_leafBytes(leaf));
        for (var i = 0; i < proof.length; i++) {
            var step    = proof[i];
            var sibling = Data.fromHex(step.hex);
            var pair    = step.side === 'left'
                ? _concat(sibling, current)
                : _concat(current, sibling);
            current = _sha256(pair);
        }
        var ok = Data.toHex(current) === rootHex;
        if (callback) { callback(null, ok); }
        return Promise.resolve(ok);
    } catch (e) {
        if (callback) { callback(e); }
        return Promise.reject(e);
    }
};
