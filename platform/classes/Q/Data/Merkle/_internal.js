"use strict";
/**
 * Shared helpers for Q.Data.Merkle (Node.js).
 * Counterpart of browser methods/Q/Data/Merkle/_internal.js.
 * All operations are synchronous — no subtle crypto needed.
 */
var nodeCrypto = require('crypto');
var Data       = require('../../Data');

var _ = module.exports = {

    sha256: function (payload) {
        var buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
        return new Uint8Array(nodeCrypto.createHash('sha256').update(buf).digest());
    },

    concat: function (a, b) {
        var out = new Uint8Array(a.length + b.length);
        out.set(a, 0);
        out.set(b, a.length);
        return out;
    },

    toHex: function (bytes) { return Data.toHex(bytes); },

    // Hash one level: SHA-256(left || right). Odd node promoted (paired with itself).
    hashLevel: function (nodes) {
        var out = [];
        for (var i = 0; i < nodes.length; i += 2) {
            var left  = nodes[i];
            var right = (i + 1 < nodes.length) ? nodes[i + 1] : left;
            out.push(_.sha256(_.concat(left, right)));
        }
        return out;
    },

    reduce: function (nodes) {
        while (nodes.length > 1) { nodes = _.hashLevel(nodes); }
        return nodes[0];
    }
};
