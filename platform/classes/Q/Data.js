"use strict";
/**
 * Q.Data — cryptographic primitives and data utilities for Node.js.
 *
 * Counterpart of the browser Q.Data method files and PHP Q_Data class.
 * Same algorithms, same wire formats, same base64/hex conventions.
 *
 * Dependencies:
 *   Node built-in `crypto` and `zlib` — no npm packages needed.
 *   keccak256 falls back to crypto-js (already in package.json) if Node's
 *   OpenSSL doesn't expose it natively.
 *
 * Sub-namespaces live in separate files that self-attach when required:
 *   require('./Data/Merkle')  → sets Q.Data.Merkle
 *   require('./Data/Prolly')  → sets Q.Data.Prolly
 *   require('./Data/Bloom')   → sets Q.Data.Bloom
 *
 * @class Q.Data
 * @static
 */

var nodeCrypto = require('crypto');
var zlib       = require('zlib');

var Data = module.exports = {};

// ─── Internal helpers ────────────────────────────────────────────────────────

function _toBuffer(data) {
    if (Buffer.isBuffer(data)) { return data; }
    if (data instanceof Uint8Array) {
        return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    }
    if (data instanceof ArrayBuffer) { return Buffer.from(data); }
    if (typeof data === 'string')    { return Buffer.from(data, 'utf8'); }
    throw new Error('Q.Data: expected Buffer, Uint8Array, ArrayBuffer, or String');
}

function _resolve(value, cb) { if (cb) { cb(null, value); } return Promise.resolve(value); }
function _reject(err, cb)    { if (cb) { cb(err); }        return Promise.reject(err); }

// ─── Encoding utilities (pure, sync) ─────────────────────────────────────────

Data.toBase64 = function (data) { return _toBuffer(data).toString('base64'); };

Data.fromBase64 = function (str) { return new Uint8Array(Buffer.from(str, 'base64')); };

Data.toHex = function (data) { return _toBuffer(data).toString('hex'); };

Data.fromHex = function (hex) {
    return new Uint8Array(Buffer.from(hex.replace(/^0x/i, ''), 'hex'));
};

Data.toUint8Array = function (data) {
    if (data instanceof Uint8Array) { return data; }
    return new Uint8Array(_toBuffer(data));
};

// ─── digest ──────────────────────────────────────────────────────────────────

/**
 * Compute a cryptographic hash.
 * Accepts PHP-style ("sha256") and SubtleCrypto-style ("SHA-256") names.
 * keccak256 uses crypto-js (already in package.json) as the reliable fallback.
 *
 * @method digest
 * @param {String} algorithm
 * @param {Uint8Array|ArrayBuffer|Buffer|String} payload
 * @param {Function} [callback]
 * @return {Promise<Uint8Array>}
 */
Data.digest = function (algorithm, payload, callback) {
    try {
        var a = algorithm.toLowerCase().replace(/-/g, '');
        if (a === 'keccak256') {
            return Data.digest._keccak(payload, callback);
        }
        var nodeName;
        switch (a) {
            case 'sha256':  nodeName = 'sha256';   break;
            case 'sha384':  nodeName = 'sha384';   break;
            case 'sha512':  nodeName = 'sha512';   break;
            case 'sha3256': nodeName = 'sha3-256'; break;
            case 'sha3384': nodeName = 'sha3-384'; break;
            case 'sha3512': nodeName = 'sha3-512'; break;
            default:        nodeName = algorithm.toLowerCase();
        }
        var result = new Uint8Array(
            nodeCrypto.createHash(nodeName).update(_toBuffer(payload)).digest()
        );
        return _resolve(result, callback);
    } catch (e) {
        return _reject(e, callback);
    }
};

/**
 * keccak256 implementation — swappable.
 * Uses crypto-js (already in package.json): SHA3 with outputLength:256
 * is keccak-256 (NOT SHA3-256 — this is a known crypto-js naming convention).
 * @private
 */
Data.digest._keccak = function (payload, callback) {
    try {
        var CryptoJS = require('crypto-js');
        var wa  = CryptoJS.lib.WordArray.create(_toBuffer(payload));
        var hex = CryptoJS.SHA3(wa, { outputLength: 256 }).toString();
        return _resolve(new Uint8Array(Buffer.from(hex, 'hex')), callback);
    } catch (e) {
        return _reject(new Error(
            'Q.Data.digest: keccak256 requires crypto-js (already in package.json). ' +
            'Error: ' + e.message
        ), callback);
    }
};

// ─── hkdf ────────────────────────────────────────────────────────────────────

/**
 * HKDF using SHA-256 (RFC 5869).
 * Byte-identical to browser Q.Data.hkdf and PHP Q_Data::hkdf.
 *
 * @method hkdf
 * @param {Uint8Array|Buffer} ikm
 * @param {Uint8Array|Buffer} salt
 * @param {String}            info
 * @param {Number}            [length=32]
 * @param {Function}          [callback]
 * @return {Promise<Uint8Array>}
 */
Data.hkdf = function (ikm, salt, info, length, callback) {
    if (typeof length === 'function') { callback = length; length = 32; }
    length = length || 32;
    try {
        var infoBytes = typeof info === 'string'
            ? Buffer.from(info, 'utf8')
            : _toBuffer(info || '');
        var result = new Uint8Array(
            nodeCrypto.hkdfSync('sha256', _toBuffer(ikm), _toBuffer(salt), infoBytes, length)
        );
        return _resolve(result, callback);
    } catch (e) {
        return _reject(e, callback);
    }
};

// ─── derive ──────────────────────────────────────────────────────────────────

/**
 * Deterministically derive key material.
 * salt = SHA-256(context), info = label.
 * Byte-identical to browser Q.Data.derive and PHP Q_Data::derive.
 *
 * @method derive
 * @param {Uint8Array|Buffer} seed
 * @param {String}            label
 * @param {Object}            [options]
 * @param {Number}            [options.size=32]
 * @param {String}            [options.context=""]
 * @param {Function}          [callback]
 * @return {Promise<Uint8Array>}
 */
Data.derive = function (seed, label, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    options = options || {};
    var size    = options.size    || 32;
    var context = options.context || '';
    try {
        if (!label || typeof label !== 'string') {
            return _reject(new Error('Q.Data.derive: label must be a non-empty string'), callback);
        }
        var salt   = nodeCrypto.createHash('sha256').update(Buffer.from(context, 'utf8')).digest();
        var result = new Uint8Array(
            nodeCrypto.hkdfSync('sha256', _toBuffer(seed), salt, Buffer.from(label, 'utf8'), size)
        );
        return _resolve(result, callback);
    } catch (e) {
        return _reject(e, callback);
    }
};

// ─── AES-256-GCM encrypt/decrypt ─────────────────────────────────────────────

/**
 * Encrypt with AES-256-GCM.
 * key is raw bytes (Buffer/Uint8Array) — importKey() returns a Buffer for Node.
 * Output format byte-identical to browser Q.Data.encrypt and PHP Q_Data::encrypt.
 *
 * @method encrypt
 * @param {Buffer|Uint8Array}        key        32-byte AES key
 * @param {Buffer|Uint8Array}        plaintext
 * @param {Object}                   [options]
 * @param {Uint8Array|String}        [options.iv]         12-byte IV (base64 or bytes)
 * @param {Uint8Array|Buffer|String} [options.additional] AAD
 * @param {Function}                 [callback]
 * @return {Promise<{ iv: String, ciphertext: String, tag: String }>}
 */
Data.encrypt = function (key, plaintext, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    options = options || {};
    try {
        var keyBuf = _toBuffer(key);
        if (keyBuf.length !== 32) {
            return _reject(new Error('Q.Data.encrypt: key must be 32 bytes'), callback);
        }
        var iv;
        if (options.iv) {
            iv = _toBuffer(typeof options.iv === 'string' ? Data.fromBase64(options.iv) : options.iv);
        } else {
            iv = nodeCrypto.randomBytes(12);
        }
        if (iv.length !== 12) {
            return _reject(new Error('Q.Data.encrypt: IV must be 12 bytes'), callback);
        }
        var cipher = nodeCrypto.createCipheriv('aes-256-gcm', keyBuf, iv);
        if (options.additional) { cipher.setAAD(_toBuffer(options.additional)); }
        var ct  = Buffer.concat([cipher.update(_toBuffer(plaintext)), cipher.final()]);
        var tag = cipher.getAuthTag();
        return _resolve({
            iv:         Buffer.from(iv).toString('base64'),
            ciphertext: ct.toString('base64'),
            tag:        tag.toString('base64')
        }, callback);
    } catch (e) {
        return _reject(e, callback);
    }
};

/**
 * Decrypt AES-256-GCM ciphertext.
 * Byte-identical to browser Q.Data.decrypt and PHP Q_Data::decrypt.
 *
 * @method decrypt
 * @param {Buffer|Uint8Array} key
 * @param {String}            ivBase64
 * @param {String}            ctBase64     Ciphertext without tag
 * @param {Object}            [options]
 * @param {String}            [options.tag]        Base64 auth tag (if separate)
 * @param {Uint8Array|Buffer} [options.additional] AAD
 * @param {Function}          [callback]
 * @return {Promise<Uint8Array>}
 */
Data.decrypt = function (key, ivBase64, ctBase64, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    options = options || {};
    try {
        var keyBuf = _toBuffer(key);
        var iv     = Buffer.from(ivBase64, 'base64');
        var ct     = Buffer.from(ctBase64, 'base64');
        var tag;
        if (options.tag) {
            tag = Buffer.from(options.tag, 'base64');
        } else {
            // WebCrypto wire format: ciphertext || tag (last 16 bytes)
            tag = ct.slice(ct.length - 16);
            ct  = ct.slice(0, ct.length - 16);
        }
        var decipher = nodeCrypto.createDecipheriv('aes-256-gcm', keyBuf, iv);
        decipher.setAuthTag(tag);
        if (options.additional) { decipher.setAAD(_toBuffer(options.additional)); }
        var plain = Buffer.concat([decipher.update(ct), decipher.final()]);
        return _resolve(new Uint8Array(plain), callback);
    } catch (e) {
        return _reject(e, callback);
    }
};

// ─── importKey ───────────────────────────────────────────────────────────────

/**
 * In Node, no CryptoKey wrapper is needed — returns the raw Buffer.
 * encrypt(importKey(bytes), ...) works transparently.
 *
 * @method importKey
 * @param {Uint8Array|Buffer} keyBytes
 * @param {Object}            [algo]    Ignored (API parity)
 * @param {Function}          [callback]
 * @return {Promise<Buffer>}
 */
Data.importKey = function (keyBytes, algo, callback) {
    if (typeof algo === 'function') { callback = algo; }
    return _resolve(_toBuffer(keyBytes), callback);
};

// ─── generateKey ─────────────────────────────────────────────────────────────

/**
 * Generate an ECDSA P-256 key pair.
 * publicKey: raw uncompressed point (65 bytes), base64-encoded.
 * privateKey: PKCS#8 DER, base64-encoded.
 *
 * @method generateKey
 * @param {Object}   [algo]  { namedCurve: 'P-256' }
 * @param {Function} [callback]
 * @return {Promise<{ publicKey: String, privateKey: String, algorithm: Object }>}
 */
Data.generateKey = function (algo, callback) {
    if (typeof algo === 'function') { callback = algo; algo = {}; }
    algo = Object.assign({ namedCurve: 'P-256' }, algo);
    try {
        var kp = nodeCrypto.generateKeyPairSync('ec', {
            namedCurve:         algo.namedCurve || 'P-256',
            publicKeyEncoding:  { type: 'spki',  format: 'der' },
            privateKeyEncoding: { type: 'pkcs8', format: 'der' }
        });
        // P-256 SPKI DER = 27-byte header + 65-byte uncompressed point
        var spki   = kp.publicKey;
        var rawPub = spki.slice(spki.length - 65);
        return _resolve({
            publicKey:  rawPub.toString('base64'),
            privateKey: kp.privateKey.toString('base64'),
            algorithm:  algo
        }, callback);
    } catch (e) {
        return _reject(e, callback);
    }
};

// ─── sign / verify (Q.Data level — raw ECDSA, not typed signing) ──────────────

/**
 * Sign data with PKCS#8 private key(s). Returns DER-encoded signatures.
 * Matches browser Q.Data.sign and PHP Q_Data::sign.
 *
 * @method sign
 * @param {String|Uint8Array} data
 * @param {Array<String>}     privateKeyPKCS8Strings  Base64-encoded PKCS#8 keys
 * @param {Object}            [algo]
 * @param {Function}          [callback]
 * @return {Promise<Array<Uint8Array>>}
 */
Data.sign = function (data, privateKeyPKCS8Strings, algo, callback) {
    if (typeof algo === 'function') { callback = algo; algo = {}; }
    try {
        var dataBuf  = _toBuffer(data);
        var sigs = privateKeyPKCS8Strings.map(function (pks) {
            var der     = Buffer.from(pks, 'base64');
            var privKey = nodeCrypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
            var signer  = nodeCrypto.createSign('SHA256');
            signer.update(dataBuf);
            return new Uint8Array(signer.sign(privKey));
        });
        return _resolve(sigs, callback);
    } catch (e) {
        return _reject(e, callback);
    }
};

/**
 * Verify ECDSA P-256 signatures against raw public keys.
 * Matches browser Q.Data.verify and PHP Q_Data::verify.
 *
 * @method verify
 * @param {String|Uint8Array}        data
 * @param {Array<String>}            publicKeyRawStrings  Base64 raw 65-byte public keys
 * @param {Array<Uint8Array|String>} signatures           DER or base64
 * @param {Object}                   [algo]
 * @param {Function}                 [callback]
 * @return {Promise<Array<Boolean>>}
 */
Data.verify = function (data, publicKeyRawStrings, signatures, algo, callback) {
    if (typeof algo === 'function') { callback = algo; algo = {}; }
    try {
        var dataBuf = _toBuffer(data);
        var results = publicKeyRawStrings.map(function (pks, i) {
            var rawPoint = Buffer.from(pks, 'base64');
            var pubKey   = nodeCrypto.createPublicKey({
                key:    _rawP256ToSpki(rawPoint),
                format: 'der',
                type:   'spki'
            });
            var sig = signatures[i];
            if (typeof sig === 'string') { sig = Buffer.from(sig, 'base64'); }
            else { sig = _toBuffer(sig); }
            var verifier = nodeCrypto.createVerify('SHA256');
            verifier.update(dataBuf);
            try { return verifier.verify(pubKey, sig); } catch (e) { return false; }
        });
        return _resolve(results, callback);
    } catch (e) {
        return _reject(e, callback);
    }
};

function _rawP256ToSpki(rawPoint) {
    // Fixed 27-byte ASN.1 header for ecPublicKey + prime256v1
    var header = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex');
    return Buffer.concat([header, rawPoint]);
}

// ─── DER / RAW signature conversion ─────────────────────────────────────────

/**
 * DER-encoded ECDSA signature → raw r||s (64 bytes).
 * Matches PHP Q_Data::DERToRAW.
 * @method DERToRAW
 */
Data.DERToRAW = function (der) {
    der = _toBuffer(der);
    var off = 0;
    if (der[off++] !== 0x30) { throw new Error('Q.Data.DERToRAW: invalid DER'); }
    off++; // sequence length
    if (der[off++] !== 0x02) { throw new Error('Q.Data.DERToRAW: invalid DER'); }
    var lenR = der[off++];
    var r    = der.slice(off, off + lenR); off += lenR;
    if (der[off++] !== 0x02) { throw new Error('Q.Data.DERToRAW: invalid DER'); }
    var lenS = der[off++];
    var s    = der.slice(off, off + lenS);

    r = _padTo32(Buffer.from(r[0] === 0 ? r.slice(1) : r));
    s = _padTo32(Buffer.from(s[0] === 0 ? s.slice(1) : s));

    var out = new Uint8Array(64);
    r.copy(Buffer.from(out.buffer), 0);
    s.copy(Buffer.from(out.buffer), 32);
    return out;
};

/**
 * raw r||s (64 bytes) → DER-encoded ECDSA signature.
 * Matches PHP Q_Data::RAWtoDER.
 * @method RAWtoDER
 */
Data.RAWtoDER = function (raw) {
    raw = _toBuffer(raw);
    if (raw.length !== 64) { throw new Error('Q.Data.RAWtoDER: expected 64 bytes'); }
    var r = _stripLeadingZeros(raw.slice(0, 32));
    var s = _stripLeadingZeros(raw.slice(32, 64));
    if (r[0] & 0x80) { r = Buffer.concat([Buffer.from([0x00]), r]); }
    if (s[0] & 0x80) { s = Buffer.concat([Buffer.from([0x00]), s]); }
    var body = Buffer.concat([
        Buffer.from([0x02, r.length]), r,
        Buffer.from([0x02, s.length]), s
    ]);
    return new Uint8Array(Buffer.concat([Buffer.from([0x30, body.length]), body]));
};

function _padTo32(buf) {
    if (buf.length >= 32) { return buf; }
    var out = Buffer.alloc(32, 0);
    buf.copy(out, 32 - buf.length);
    return out;
}

function _stripLeadingZeros(buf) {
    var i = 0;
    while (i < buf.length - 1 && buf[i] === 0) { i++; }
    return buf.slice(i);
}

// ─── compress / decompress ───────────────────────────────────────────────────

Data.compress = function (data, callback, options) {
    if (typeof data !== 'string') { data = JSON.stringify(data); }
    var algo = (options && options.algorithm) || 'gzip';
    var fn   = algo === 'deflate' ? zlib.deflate : zlib.gzip;
    return new Promise(function (resolve, reject) {
        fn(Buffer.from(data, 'utf8'), function (err, result) {
            if (err) { if (callback) { callback(err); } return reject(err); }
            if (callback) { callback(null, result); }
            resolve(result);
        });
    });
};

Data.decompress = function (buffer, callback, options) {
    var algo = (options && options.algorithm) || 'gzip';
    var fn   = algo === 'deflate' ? zlib.inflate : zlib.gunzip;
    return new Promise(function (resolve, reject) {
        fn(_toBuffer(buffer), function (err, result) {
            if (err) { if (callback) { callback(err); } return reject(err); }
            var text = result.toString('utf8');
            if (callback) { callback(null, text); }
            resolve(text);
        });
    });
};

// ─── variant ─────────────────────────────────────────────────────────────────

Data.variant = function (sessionId, index, segments, seed) {
    segments = segments || 2;
    seed     = (seed !== undefined) ? seed : 0xBABE;
    var str  = sessionId.replace(/-/g, '') + ':' + index + ':' + seed;
    var hash = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash  = Math.imul(hash, 0x01000193);
        hash ^= (hash >>> 17);
        hash  = Math.imul(hash, 0x85ebca6b);
        hash ^= (hash >>> 13);
        hash  = Math.imul(hash, 0xc2b2ae35);
        hash ^= (hash >>> 16);
    }
    return ((hash >>> 0) % segments) === 0;
};
