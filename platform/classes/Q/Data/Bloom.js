"use strict";
/**
 * Q.Data.Bloom — Bloom filter (Node.js).
 * Counterpart of browser methods/Q/Data/Bloom/{create,fromBytes,fromBase64,fromElements}.js.
 *
 * Kirsch-Mitzenmacher double hashing: h_i(x) = (h1(x) + i * h2(x)) mod m
 * Wire format ([m:4BE][k:1][count:4BE][bits]) is byte-identical to the browser version.
 * All hash operations are synchronous in Node.
 *
 * @class Q.Data.Bloom
 * @static
 */
var nodeCrypto = require('crypto');
var Data       = require('../Data');

var Bloom = module.exports;
Data.Bloom = Bloom; // self-attach

// ─── Private helpers ──────────────────────────────────────────────────────────

var _LN2  = Math.LN2;
var _LN2S = _LN2 * _LN2;

function _optimalParams(n, p) {
    var m = Math.ceil(-n * Math.log(p) / _LN2S);
    var k = Math.max(1, Math.round((m / n) * _LN2));
    return { m: m, k: k };
}

function _setBit(bits, pos)  { bits[pos >>> 3] |= (1 << (pos & 7)); }
function _testBit(bits, pos) { return (bits[pos >>> 3] & (1 << (pos & 7))) !== 0; }

function _positions(element, k, m) {
    var h1 = nodeCrypto.createHash('sha256').update(Buffer.from('\x00' + element, 'utf8')).digest();
    var h2 = nodeCrypto.createHash('sha256').update(Buffer.from('\x01' + element, 'utf8')).digest();
    var v1 = ((h1[0] << 24) | (h1[1] << 16) | (h1[2] << 8) | h1[3]) >>> 0;
    var v2 = ((h2[0] << 24) | (h2[1] << 16) | (h2[2] << 8) | h2[3]) >>> 0;
    var positions = [];
    for (var i = 0; i < k; i++) {
        positions.push( (((v1 >>> 0) + Math.imul(i, v2 >>> 0)) >>> 0) % m );
    }
    return positions;
}

function _deserialize(bytes, callback) {
    var buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    if (buf.length < 9) {
        var e = new Error('Q.Data.Bloom: buffer too short');
        if (callback) { callback(e); }
        return e;
    }
    var read32 = function (b, o) {
        return ((b[o] << 24) | (b[o+1] << 16) | (b[o+2] << 8) | b[o+3]) >>> 0;
    };
    var m          = read32(buf, 0);
    var k          = buf[4];
    var count      = read32(buf, 5);
    var bitsNeeded = Math.ceil(m / 8);
    if (buf.length - 9 < bitsNeeded) {
        var e2 = new Error('Q.Data.Bloom: truncated bit array');
        if (callback) { callback(e2); }
        return e2;
    }
    var bits   = new Uint8Array(buf.buffer, buf.byteOffset + 9, bitsNeeded);
    var filter = new _BloomFilter(new Uint8Array(bits), k, m, count);
    if (callback) { callback(null, filter); }
    return filter;
}

// ─── BloomFilter class ────────────────────────────────────────────────────────

function _BloomFilter(bits, k, m, count) {
    this._bits  = bits;
    this._k     = k;
    this._m     = m;
    this._count = count || 0;
}

_BloomFilter.prototype.add = function (element, callback) {
    var self = this;
    _positions(element, this._k, this._m).forEach(function (pos) { _setBit(self._bits, pos); });
    this._count++;
    if (callback) { callback(null); }
    return Promise.resolve();
};

_BloomFilter.prototype.has = function (element, callback) {
    var self   = this;
    var result = _positions(element, this._k, this._m)
        .every(function (pos) { return _testBit(self._bits, pos); });
    if (callback) { callback(null, result); }
    return Promise.resolve(result);
};

_BloomFilter.prototype.hasMany = function (elements, callback) {
    var self    = this;
    var results = elements.map(function (el) {
        return _positions(el, self._k, self._m)
            .every(function (pos) { return _testBit(self._bits, pos); });
    });
    if (callback) { callback(null, results); }
    return Promise.resolve(results);
};

_BloomFilter.prototype.merge = function (other, callback) {
    if (other._m !== this._m || other._k !== this._k) {
        var e = new Error('Q.Data.Bloom.merge: incompatible filters');
        if (callback) { callback(e); }
        return Promise.reject(e);
    }
    for (var i = 0; i < this._bits.length; i++) { this._bits[i] |= other._bits[i]; }
    this._count += other._count;
    if (callback) { callback(null); }
    return Promise.resolve();
};

_BloomFilter.prototype.falsePositiveRate = function () {
    return Math.pow(1 - Math.exp(-this._k * this._count / this._m), this._k);
};

_BloomFilter.prototype.elementCount = function () { return this._count; };

/** Serialise to wire format: [m:4BE][k:1][count:4BE][bits] */
_BloomFilter.prototype.toBytes = function () {
    var out = new Uint8Array(9 + this._bits.length);
    out[0] = (this._m >>> 24) & 0xff; out[1] = (this._m >>> 16) & 0xff;
    out[2] = (this._m >>> 8)  & 0xff; out[3] =  this._m         & 0xff;
    out[4] =  this._k         & 0xff;
    out[5] = (this._count >>> 24) & 0xff; out[6] = (this._count >>> 16) & 0xff;
    out[7] = (this._count >>> 8)  & 0xff; out[8] =  this._count         & 0xff;
    out.set(this._bits, 9);
    return out;
};

_BloomFilter.prototype.toBase64 = function () { return Data.toBase64(this.toBytes()); };

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create an empty Bloom filter sized for n elements at false positive rate p.
 * @param {Number}   n
 * @param {Number}   [p=0.01]
 * @param {Function} [callback]
 * @return {Promise<BloomFilter>}
 */
Bloom.create = function (n, p, callback) {
    if (typeof p === 'function') { callback = p; p = 0.01; }
    p = p || 0.01;
    if (n <= 0) {
        var e1 = new Error('Q.Data.Bloom.create: n must be > 0');
        if (callback) { callback(e1); } return Promise.reject(e1);
    }
    if (p <= 0 || p >= 1) {
        var e2 = new Error('Q.Data.Bloom.create: p must be in (0,1)');
        if (callback) { callback(e2); } return Promise.reject(e2);
    }
    var params = _optimalParams(n, p);
    var filter = new _BloomFilter(new Uint8Array(Math.ceil(params.m / 8)), params.k, params.m, 0);
    if (callback) { callback(null, filter); }
    return Promise.resolve(filter);
};

/**
 * Deserialise from a Uint8Array produced by filter.toBytes().
 * @param {Uint8Array} bytes
 * @param {Function}   [callback]
 * @return {Promise<BloomFilter>}
 */
Bloom.fromBytes = function (bytes, callback) {
    var result = _deserialize(bytes, callback);
    if (result instanceof Error) { return Promise.reject(result); }
    return Promise.resolve(result);
};

/**
 * Deserialise from a base64 string produced by filter.toBase64().
 * @param {String}   base64
 * @param {Function} [callback]
 * @return {Promise<BloomFilter>}
 */
Bloom.fromBase64 = function (base64, callback) {
    try {
        var result = _deserialize(Data.fromBase64(base64), callback);
        if (result instanceof Error) { return Promise.reject(result); }
        return Promise.resolve(result);
    } catch (e) {
        if (callback) { callback(e); }
        return Promise.reject(e);
    }
};

/**
 * Build a Bloom filter from an existing array of elements.
 * @param {Array<String>} elements
 * @param {Number}        [p=0.01]
 * @param {Function}      [callback]
 * @return {Promise<BloomFilter>}
 */
Bloom.fromElements = function (elements, p, callback) {
    if (typeof p === 'function') { callback = p; p = 0.01; }
    p = p || 0.01;
    if (!elements || !elements.length) {
        var e = new Error('Q.Data.Bloom.fromElements: no elements');
        if (callback) { callback(e); } return Promise.reject(e);
    }
    try {
        var params = _optimalParams(elements.length, p);
        var bits   = new Uint8Array(Math.ceil(params.m / 8));
        elements.forEach(function (el) {
            _positions(el, params.k, params.m).forEach(function (pos) { _setBit(bits, pos); });
        });
        var filter = new _BloomFilter(bits, params.k, params.m, elements.length);
        if (callback) { callback(null, filter); }
        return Promise.resolve(filter);
    } catch (e) {
        if (callback) { callback(e); }
        return Promise.reject(e);
    }
};
