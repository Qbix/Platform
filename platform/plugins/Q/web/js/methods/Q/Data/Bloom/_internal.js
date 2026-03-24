/**
 * Shared helpers for Q.Data.Bloom method files.
 * Loaded once via options.require and passed as _ to each method file.
 *
 * Exports a plain object containing:
 *   - BloomFilter constructor (used by all four method files)
 *   - _positions, _optimalParams, _setBit, _testBit, _fromUint8Array
 */
Q.exports(function (Q) {

    var LN2  = Math.LN2;
    var LN2S = LN2 * LN2;

    // -------------------------------------------------------------------------
    // Sizing
    // -------------------------------------------------------------------------

    function _optimalParams(n, p) {
        var m = Math.ceil(-n * Math.log(p) / LN2S);
        var k = Math.max(1, Math.round((m / n) * LN2));
        return { m: m, k: k };
    }

    // -------------------------------------------------------------------------
    // Bit array ops
    // -------------------------------------------------------------------------

    function _setBit(bits, pos)  { bits[pos >>> 3] |= (1 << (pos & 7)); }
    function _testBit(bits, pos) { return (bits[pos >>> 3] & (1 << (pos & 7))) !== 0; }

    // -------------------------------------------------------------------------
    // Kirsch-Mitzenmacher double hashing
    // Two SHA-256 calls -> k positions, as effective as k independent hashes.
    // h_i(x) = (h1(x) + i * h2(x)) mod m
    // -------------------------------------------------------------------------

    function _positions(element, k, m) {
        var enc = new TextEncoder();
        return Promise.all([
            Q.Data.digest('SHA-256', enc.encode('\x00' + element)),
            Q.Data.digest('SHA-256', enc.encode('\x01' + element))
        ]).then(function (digests) {
            var view = function (d) {
                return ((d[0] << 24) | (d[1] << 16) | (d[2] << 8) | d[3]) >>> 0;
            };
            var h1 = view(digests[0]);
            var h2 = view(digests[1]);
            var positions = [];
            for (var i = 0; i < k; i++) {
                var combined = ((h1 >>> 0) + Math.imul(i, h2 >>> 0)) >>> 0;
                positions.push(combined % m);
            }
            return positions;
        });
    }

    // -------------------------------------------------------------------------
    // BloomFilter class
    // -------------------------------------------------------------------------

    function BloomFilter(bits, k, m, count) {
        this._bits  = bits;
        this._k     = k;
        this._m     = m;
        this._count = count || 0;
    }

    BloomFilter.prototype.add = Q.promisify(function (element, callback) {
        var self = this;
        _positions(element, self._k, self._m).then(function (positions) {
            positions.forEach(function (pos) { _setBit(self._bits, pos); });
            self._count++;
            callback(null);
        }).catch(callback);
    }, false, 1);

    BloomFilter.prototype.has = Q.promisify(function (element, callback) {
        var self = this;
        _positions(element, self._k, self._m).then(function (positions) {
            callback(null, positions.every(function (pos) { return _testBit(self._bits, pos); }));
        }).catch(callback);
    }, false, 1);

    BloomFilter.prototype.hasMany = Q.promisify(function (elements, callback) {
        var self = this;
        Promise.all(elements.map(function (el) {
            return _positions(el, self._k, self._m).then(function (positions) {
                return positions.every(function (pos) { return _testBit(self._bits, pos); });
            });
        })).then(function (results) {
            callback(null, results);
        }).catch(callback);
    }, false, 1);

    BloomFilter.prototype.merge = Q.promisify(function (other, callback) {
        if (other._m !== this._m || other._k !== this._k) {
            return callback(new Error('Q.Data.Bloom.merge: incompatible filters'));
        }
        for (var i = 0; i < this._bits.length; i++) {
            this._bits[i] |= other._bits[i];
        }
        this._count += other._count;
        callback(null);
    }, false, 1);

    BloomFilter.prototype.falsePositiveRate = function () {
        return Math.pow(1 - Math.exp(-this._k * this._count / this._m), this._k);
    };

    BloomFilter.prototype.elementCount = function () { return this._count; };

    BloomFilter.prototype.toBytes = function () {
        var out = new Uint8Array(9 + this._bits.length);
        out[0] = (this._m >>> 24) & 0xff;
        out[1] = (this._m >>> 16) & 0xff;
        out[2] = (this._m >>> 8)  & 0xff;
        out[3] =  this._m         & 0xff;
        out[4] =  this._k         & 0xff;
        out[5] = (this._count >>> 24) & 0xff;
        out[6] = (this._count >>> 16) & 0xff;
        out[7] = (this._count >>> 8)  & 0xff;
        out[8] =  this._count         & 0xff;
        out.set(this._bits, 9);
        return out;
    };

    BloomFilter.prototype.toBase64 = function () {
        return Q.Data.toBase64(this.toBytes());
    };

    // -------------------------------------------------------------------------
    // Deserialise helper shared by fromBytes + fromBase64
    // -------------------------------------------------------------------------

    function _fromUint8Array(bytes, callback) {
        if (bytes.length < 9) {
            return callback(new Error('Q.Data.Bloom: buffer too short'));
        }
        var view  = function (d, o) { return ((d[o] << 24) | (d[o+1] << 16) | (d[o+2] << 8) | d[o+3]) >>> 0; };
        var m     = view(bytes, 0);
        var k     = bytes[4];
        var count = view(bytes, 5);
        var bits  = new Uint8Array(bytes.buffer, bytes.byteOffset + 9);
        if (bits.length < Math.ceil(m / 8)) {
            return callback(new Error('Q.Data.Bloom: truncated bit array'));
        }
        callback(null, new BloomFilter(new Uint8Array(bits), k, m, count));
    }

    // -------------------------------------------------------------------------
    // Exported helpers object
    // -------------------------------------------------------------------------

    return {
        BloomFilter:    BloomFilter,
        optimalParams:  _optimalParams,
        positions:      _positions,
        setBit:         _setBit,
        testBit:        _testBit,
        fromUint8Array: _fromUint8Array
    };

});
