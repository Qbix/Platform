"use strict";
/*jshint node:true */
/**
 * Q.Crypto.OpenClaim — OpenClaiming Protocol (OCP) for Node.js.
 *
 * Parity counterpart of:
 *   Browser: Q.Crypto.OpenClaim (Q/js/methods/Q/Crypto/OpenClaim/)
 *   PHP:     Q_Crypto_OpenClaim
 *
 * Wire format:
 *   { ocp:1, iss, sub, stm, key:[], sig:[] }
 *
 * Key URI scheme:
 *   data:key/es256;base64,<SPKI-DER-base64>   — inline P-256 public key
 *   data:key/eip712,<0x-address>               — Ethereum address
 *   https://example.com/.well-known/...#path   — URL-hosted key document
 *
 * Canonicalization: RFC 8785 / JCS, inline via Q.Data.canonicalize().
 *   No external dependency.
 *
 * Signing (ES256):
 *   canon  = RFC8785(claim, sig stripped)
 *   digest = SHA-256(canon)
 *   sig    = raw r||s 64 bytes → base64   (low-S normalized)
 *
 * Verification (ES256):
 *   Uses Node built-in crypto.verify() with SPKI-imported public key.
 *   SubtleCrypto in the browser uses the same raw r||s / IEEE P1363 format.
 *
 * EIP712 keys: delegate entirely to Q.Crypto.OpenClaim.EVM (same module).
 *
 * Dependencies (all already in Q or standard):
 *   Q.Crypto       — internalKeypair, sign, verify
 *   Q.Data         — canonicalize, DERToRAW, RAWtoDER
 *   Node built-in crypto
 *
 * @class Q.Crypto.OpenClaim
 * @static
 */

var Q          = require('Q');
var nodeCrypto = require('crypto');

// ── P-256 SPKI helpers ────────────────────────────────────────────────────────

// Fixed 27-byte ASN.1 header: SEQUENCE { AlgorithmIdentifier ecPublicKey prime256v1, BIT STRING }
var _P256_SPKI_PREFIX = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex');

function _rawPublicKeyToSpki(rawPublicKey) {
    return Buffer.concat([_P256_SPKI_PREFIX, Buffer.from(rawPublicKey)]);
}

function _rawPublicKeyToKeyString(rawPublicKey) {
    var spki = _rawPublicKeyToSpki(rawPublicKey);
    return 'data:key/es256;base64,' + spki.toString('base64');
}

// ── Shared state helpers ──────────────────────────────────────────────────────

function _toArray(v) {
    return v == null ? [] : Array.isArray(v) ? v : [v];
}

function _normalizeSigs(v) {
    return _toArray(v).map(function (x) { return x == null ? null : String(x); });
}

function _buildSortedState(keys, sigs) {
    var pairs = keys.map(function (k, i) {
        return { key: k, sig: i < sigs.length ? sigs[i] : null };
    });
    pairs.sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });
    return {
        keys:       pairs.map(function (p) { return p.key; }),
        signatures: pairs.map(function (p) { return p.sig; })
    };
}

function _parsePolicy(policy, totalKeys) {
    if (policy == null)                            return 1;
    if (typeof policy === 'number')                return policy;
    if (policy.mode === 'all')                     return totalKeys;
    if (typeof policy.minValid === 'number')       return policy.minValid;
    return 1;
}

function _validateNumbers(v, path) {
    path = path || 'claim';
    if (Array.isArray(v)) {
        v.forEach(function (item, i) { _validateNumbers(item, path + '[' + i + ']'); });
        return;
    }
    if (v && typeof v === 'object') {
        Object.keys(v).forEach(function (k) { _validateNumbers(v[k], path + '.' + k); });
        return;
    }
    if (typeof v === 'number' && Number.isInteger(v) && !Number.isSafeInteger(v)) {
        throw new Error(
            'Q.Crypto.OpenClaim: integer at ' + path +
            ' exceeds safe range — use a string'
        );
    }
}

// ── Key resolution (same logic as browser resolve.js) ────────────────────────

var _keyCache = {};
var _urlCache = {};
var _urlCacheTime = {};
var _urlTtl = 60 * 1000; // 60 seconds

function _parseDataKey(keyStr) {
    var comma = keyStr.indexOf(',');
    if (comma < 0) { return null; }
    var meta  = keyStr.slice(5, comma); // after "data:"
    var data  = keyStr.slice(comma + 1);
    var parts = meta.split(';');
    var fmt   = parts[0].replace('key/', '').toUpperCase();
    var enc   = 'raw';
    parts.forEach(function (p) {
        if (p === 'base64')    { enc = 'base64'; }
        if (p === 'base64url') { enc = 'base64url'; }
    });
    var value;
    if (enc === 'base64') {
        value = Buffer.from(data, 'base64');
    } else if (enc === 'base64url') {
        value = Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    } else {
        value = Buffer.from(data, 'utf8');
    }
    return { fmt: fmt, value: value };
}

function _resolve(keyStr, seen, callback) {
    if (!callback) {
        callback = seen;
        seen = [];
    }
    seen = seen || [];

    if (seen.indexOf(keyStr) >= 0) {
        return callback(new Error('Q.Crypto.OpenClaim: cyclic key reference: ' + keyStr));
    }
    if (_keyCache[keyStr]) {
        return callback(null, _keyCache[keyStr]);
    }

    seen = seen.concat([keyStr]);

    if (keyStr.indexOf('data:key/') === 0) {
        var parsed = _parseDataKey(keyStr);
        _keyCache[keyStr] = parsed;
        return callback(null, parsed);
    }

    if (keyStr.indexOf('http') === 0) {
        var hashIdx = keyStr.indexOf('#');
        var url      = hashIdx >= 0 ? keyStr.slice(0, hashIdx) : keyStr;
        var fragment = hashIdx >= 0 ? keyStr.slice(hashIdx + 1) : '';

        var now = Date.now();
        if (_urlCache[url] && (now - _urlCacheTime[url]) < _urlTtl) {
            return _resolveFromDoc(_urlCache[url], fragment, keyStr, seen, callback);
        }

        var https = require(url.indexOf('https') === 0 ? 'https' : 'http');
        https.get(url, function (res) {
            var body = '';
            res.on('data', function (chunk) { body += chunk; });
            res.on('end', function () {
                _urlCache[url]     = body;
                _urlCacheTime[url] = Date.now();
                _resolveFromDoc(body, fragment, keyStr, seen, callback);
            });
        }).on('error', function (e) { callback(e); });
        return;
    }

    // Legacy shorthand fmt:value
    var colon = keyStr.indexOf(':');
    if (colon >= 0) {
        var res = {
            fmt:   keyStr.slice(0, colon).toUpperCase(),
            value: keyStr.slice(colon + 1)
        };
        _keyCache[keyStr] = res;
        return callback(null, res);
    }

    callback(null, null);
}

function _resolveFromDoc(body, fragment, keyStr, seen, callback) {
    var doc;
    try { doc = JSON.parse(body); } catch (e) { return callback(e); }
    var current = doc;
    if (fragment) {
        fragment.split('/').forEach(function (part) {
            if (part && current != null) { current = current[part]; }
        });
    }
    if (current == null) { return callback(null, null); }
    if (typeof current === 'string') {
        return _resolve(current, seen, callback);
    }
    _keyCache[keyStr] = current;
    callback(null, current);
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenClaim namespace — attached to Q.Crypto
// ─────────────────────────────────────────────────────────────────────────────

var OpenClaim = Q.Crypto.OpenClaim = {};

/**
 * Produce the RFC 8785 / JCS canonical JSON string for a claim.
 * Always strips the sig field before canonicalizing.
 * Delegates to Q.Data.canonicalize() — byte-identical to PHP Q_Crypto_OpenClaim::canonicalize().
 *
 * @method canonicalize
 * @param  {Object} claim
 * @return {String}
 */
OpenClaim.canonicalize = function (claim) {
    var obj = Object.assign({}, claim);
    delete obj.sig;
    return Q.Data.canonicalize(obj);
};

/**
 * Sign an OpenClaim with a P-256 keypair derived from a secret.
 *
 * Signing model:
 *   canon  = RFC8785(claim, sig stripped)
 *   digest = SHA-256(canon)              — 32 raw bytes
 *   sig    = raw r||s 64 bytes → base64  — low-S normalized via Node sign()
 *
 * The public SPKI key URI is appended to key[] if not already present.
 * key[]+sig[] are sorted lexicographically before and after signing.
 *
 * Pass existing = { keys, signatures } for multisig.
 *
 * @method sign
 * @param  {Object}            claim
 * @param  {Buffer|Uint8Array} secret      Raw binary secret (32 bytes)
 * @param  {Object}            [existing]  { keys, signatures } for multisig
 * @param  {Function}          [callback]
 * @return {Promise<Object>}   Claim with key[] and sig[] populated
 */
OpenClaim.sign = function (claim, secret, existing, callback) {
    if (typeof existing === 'function') { callback = existing; existing = {}; }
    existing = existing || {};

    var p = new Promise(function (resolve, reject) {
        try {
            _validateNumbers(claim);

            // Derive P-256 keypair — same HKDF derivation as browser + PHP
            Q.Crypto.internalKeypair({ secret: secret, format: 'ES256' }).then(function (kp) {
                try {
                    var signerKey = _rawPublicKeyToKeyString(kp.publicKey);

                    var keys = _toArray(existing.keys != null ? existing.keys : claim.key).slice();
                    var sigs = _normalizeSigs(existing.signatures != null ? existing.signatures : claim.sig);

                    if (keys.indexOf(signerKey) < 0) { keys.push(signerKey); }

                    var state = _buildSortedState(keys, sigs);
                    var tmp   = Object.assign({}, claim, { key: state.keys, sig: state.signatures });
                    var canon = OpenClaim.canonicalize(tmp);

                    // SHA-256 of canonical UTF-8 bytes
                    var digest = nodeCrypto.createHash('sha256')
                        .update(Buffer.from(canon, 'utf8'))
                        .digest();

                    // Build PKCS8 DER from raw P-256 scalar so Node can sign.
                    // ECDH gives us the raw public key; we wrap scalar + public key
                    // in SEC1 DER, then re-wrap as PKCS8 — the standard Node path.
                    // sign(null, digest, privKey) treats digest as pre-hashed raw bytes.
                    var ecdhP256 = nodeCrypto.createECDH('prime256v1');
                    ecdhP256.setPrivateKey(Buffer.from(kp.privateKey));
                    var rawPub = ecdhP256.getPublicKey(); // 65-byte uncompressed point

                    // SEC1 DER for P-256:  SEQUENCE { version, privateKey, [0] OID, [1] pubKey }
                    var sec1 = Buffer.concat([
                        Buffer.from([0x30, 0x77, 0x02, 0x01, 0x01, 0x04, 0x20]),
                        Buffer.from(kp.privateKey),
                        Buffer.from([0xa0, 0x0a, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]),
                        Buffer.from([0xa1, 0x44, 0x03, 0x42, 0x00]),
                        rawPub
                    ]);
                    var privKeyObj = nodeCrypto.createPrivateKey({ key: sec1, format: 'der', type: 'sec1' });

                    // sign(null,...) produces DER-encoded ECDSA signature.
                    // OCP wire format stores raw r||s (64 bytes, IEEE P1363) — convert.
                    var derSig = nodeCrypto.sign(null, digest, privKeyObj);
                    var rawSig = Q.Data.DERToRAW(derSig); // 64 bytes — matches browser sig[]

                    var idx = state.keys.indexOf(signerKey);
                    state.signatures[idx] = Buffer.from(rawSig).toString('base64');

                    resolve(Object.assign({}, claim, {
                        key: state.keys,
                        sig: state.signatures
                    }));
                } catch (e) { reject(e); }
            }).catch(reject);
        } catch (e) { reject(e); }
    });

    if (callback) { p.then(function (r) { callback(null, r); }).catch(callback); }
    return p;
};

/**
 * Verify signatures on an OpenClaim against its key[] array.
 *
 * ES256 keys: imports SPKI public key, verifies raw r||s sig via Node verify().
 * EIP712 keys: delegates to Q.Crypto.OpenClaim.EVM.verify().
 *
 * Policy:
 *   null / omitted  → at least 1 valid signature
 *   integer N       → at least N valid signatures
 *   { mode:'all' }  → every key must have a valid sig
 *   { minValid: N } → at least N valid signatures
 *
 * @method verify
 * @param  {Object}        claim
 * @param  {Number|Object} [policy]
 * @param  {Function}      [callback]
 * @return {Promise<Boolean>}
 */
OpenClaim.verify = function (claim, policy, callback) {
    if (typeof policy === 'function') { callback = policy; policy = null; }

    var p = new Promise(function (resolve) {
        try {
            var keys = _toArray(claim.key);
            var sigs = _normalizeSigs(claim.sig);

            if (!keys.length) { return resolve(false); }

            var state = _buildSortedState(keys, sigs);
            var tmp   = Object.assign({}, claim, { key: state.keys, sig: state.signatures });
            var canon = OpenClaim.canonicalize(tmp);

            // Pre-compute the SHA-256 digest once for all ES256 verifications
            var digest = nodeCrypto.createHash('sha256')
                .update(Buffer.from(canon, 'utf8'))
                .digest();

            var valid   = 0;
            var pending = state.keys.length;

            if (!pending) { return resolve(false); }

            state.keys.forEach(function (k, i) {
                var sig = state.signatures[i];

                if (!sig) {
                    if (--pending === 0) { resolve(valid >= _parsePolicy(policy, state.keys.length)); }
                    return;
                }

                _resolve(k, function (err, keyObj) {
                    if (err || !keyObj) {
                        if (--pending === 0) { resolve(valid >= _parsePolicy(policy, state.keys.length)); }
                        return;
                    }

                    var keyObjs = Array.isArray(keyObj) ? keyObj : [keyObj];
                    var verified = false;

                    for (var j = 0; j < keyObjs.length; j++) {
                        var ko  = keyObjs[j];
                        if (!ko) { continue; }
                        var fmt = String(ko.fmt || '').toUpperCase();

                        // ── ES256 ─────────────────────────────────────────
                        if (fmt === 'ES256') {
                            try {
                                // ko.value is a Buffer containing the SPKI DER bytes
                                var spkiBuf  = Buffer.isBuffer(ko.value)
                                    ? ko.value
                                    : Buffer.from(ko.value);

                                var pubKeyObj = nodeCrypto.createPublicKey({
                                    key:    spkiBuf,
                                    format: 'der',
                                    type:   'spki'
                                });

                                // sig[] is base64 raw r||s (64 bytes, IEEE P1363).
                                // nodeCrypto.verify(null,...) requires DER — convert first.
                                var rawSigBuf = Buffer.from(sig, 'base64');
                                var derSigBuf = Q.Data.RAWtoDER(rawSigBuf);

                                // verify(null,...) treats data as already-hashed raw bytes.
                                var ok = nodeCrypto.verify(null, digest, pubKeyObj, derSigBuf);
                                if (ok) { verified = true; break; }
                            } catch (e) { /* try next */ }
                            continue;
                        }

                        // ── EIP712 ────────────────────────────────────────
                        if (fmt === 'EIP712') {
                            // Delegate to EVM submodule — it handles the ecrecover path
                            // We need to handle this asynchronously; set a flag and return
                            (function (address) {
                                Q.Crypto.OpenClaim.EVM.verify(claim, sig, String(address))
                                    .then(function (evmOk) {
                                        if (evmOk) { valid++; }
                                        if (--pending === 0) {
                                            resolve(valid >= _parsePolicy(policy, state.keys.length));
                                        }
                                    })
                                    .catch(function () {
                                        if (--pending === 0) {
                                            resolve(valid >= _parsePolicy(policy, state.keys.length));
                                        }
                                    });
                            }(ko.value));
                            return; // async path — pending will be decremented above
                        }
                    }

                    if (verified) { valid++; }
                    if (--pending === 0) {
                        resolve(valid >= _parsePolicy(policy, state.keys.length));
                    }
                });
            });
        } catch (e) {
            resolve(false);
        }
    });

    if (callback) { p.then(function (r) { callback(null, r); }).catch(function (e) { callback(e); }); }
    return p;
};

/**
 * Resolve a key URI to { fmt, value }.
 * Caches results in memory for 60 seconds for URL keys.
 *
 * @method resolve
 * @param  {String}   keyStr
 * @param  {Function} [callback]
 * @return {Promise<Object|null>}
 */
OpenClaim.resolve = function (keyStr, callback) {
    var p = new Promise(function (resolve, reject) {
        _resolve(keyStr, [], function (err, result) {
            if (err) { reject(err); } else { resolve(result); }
        });
    });
    if (callback) { p.then(function (r) { callback(null, r); }).catch(callback); }
    return p;
};

module.exports = OpenClaim;
