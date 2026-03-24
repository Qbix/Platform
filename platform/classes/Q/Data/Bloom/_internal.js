"use strict";
/**
 * Shared helpers for Q.Data.Bloom (Node.js).
 * Counterpart of browser methods/Q/Data/Bloom/_internal.js.
 * Wire format (toBytes/fromBytes) is byte-identical to the browser version.
 * Kirsch-Mitzenmacher double hashing: h_i(x) = (h1(x) + i * h2(x)) mod m
 * All hash operations are synchronous in Node.
 */
var nodeCrypto = require('crypto');
var Data       = require('../../Data');

var LN2  = Math.LN2;
var LN2S = LN2 * LN2;

function _optimalParams(n, p) {
    var m = Math.ceil(-n * Math.log(p) / LN2S);
    var k = Math.max(1, Math.round((m / n) * LN2));
    return { m: m, k: k };
}

function _setBit(bits, pos)  { bits[pos >>> 3] |= (1 << (pos & 7)); }
function _testBit(bits, pos) { return (bits[pos >>> 3] & (1 << (pos & 7))) !== 0; }

function _positionsSync(element, k, m) {
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

// ─── BloomFilter class ───────────────────────────────────────────────────────

function BloomFilter(bits, k, m, count) {
    this._bits  = bits;
    this._k     = k;
    this._m     = m;
    this._count = count || 0;
}

BloomFilter.prototype.add = function (element, callback) {
    var positions = _positionsSync(element, this._k, this._m);
    var self = this;
    positions.forEach(function (pos) { _setBit(self._bits, pos); });
    this._count++;
    if (callback) { callback(null); }
    return Promise.resolve();
};

BloomFilter.prototype.has = function (element, callback) {
    var positions = _positionsSync(element, this._k, this._m);
    var self = this;
    var result = positions.every(function (pos) { return _testBit(self._bits, pos); });
    if (callback) { callback(null, result); }
    return Promise.resolve(result);
};

BloomFilter.prototype.hasMany = function (elements, callback) {
    var self = this;
    var results = elements.map(function (el) {
        return _positionsSync(el, self._k, self._m).every(function (pos) {
            return _testBit(self._bits, pos);
        });
    });
    if (callback) { callback(null, results); }
    return Promise.resolve(results);
};

BloomFilter.prototype.merge = function (other, callback) {
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

BloomFilter.prototype.falsePositiveRate = function () {
    return Math.pow(1 - Math.exp(-this._k * this._count / this._m), this._k);
};

BloomFilter.prototype.elementCount = function () { return this._count; };

/** Serialise — wire format: [m:4BE][k:1][count:4BE][bits] */
BloomFilter.prototype.toBytes = function () {
    var out = new Uint8Array(9 + this._bits.length);
    out[0] = (this._m >>> 24) & 0xff; out[1] = (this._m >>> 16) & 0xff;
    out[2] = (this._m >>> 8)  & 0xff; out[3] =  this._m         & 0xff;
    out[4] =  this._k         & 0xff;
    out[5] = (this._count >>> 24) & 0xff; out[6] = (this._count >>> 16) & 0xff;
    out[7] = (this._count >>> 8)  & 0xff; out[8] =  this._count         & 0xff;
    out.set(this._bits, 9);
    return out;
};

BloomFilter.prototype.toBase64 = function () { return Data.toBase64(this.toBytes()); };

// ─── Deserialise ─────────────────────────────────────────────────────────────

function _fromUint8Array(bytes, callback) {
    var buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    if (buf.length < 9) {
        var e = new Error('Q.Data.Bloom: buffer too short');
        if (callback) { callback(e); }
        return e;
    }
    var view  = function (b, o) {
        return ((b[o] << 24) | (b[o+1] << 16) | (b[o+2] << 8) | b[o+3]) >>> 0;
    };
    var m     = view(buf, 0);
    var k     = buf[4];
    var count = view(buf, 5);
    var bitsNeeded = Math.ceil(m / 8);
    if (buf.length - 9 < bitsNeeded) {
        var e2 = new Error('Q.Data.Bloom: truncated bit array');
        if (callback) { callback(e2); }
        return e2;
    }
    var bits   = new Uint8Array(buf.buffer, buf.byteOffset + 9, bitsNeeded);
    var filter = new BloomFilter(new Uint8Array(bits), k, m, count);
    if (callback) { callback(null, filter); }
    return filter;
}

module.exports = {
    BloomFilter:    BloomFilter,
    optimalParams:  _optimalParams,
    positionsSync:  _positionsSync,
    setBit:         _setBit,
    testBit:        _testBit,
    fromUint8Array: _fromUint8Array
};
