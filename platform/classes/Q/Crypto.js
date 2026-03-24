"use strict";
/**
 * Q.Crypto — typed-message signing, delegation, and verification (Node.js).
 *
 * Exact counterpart of the browser Q.Crypto method files and PHP Q_Crypto class.
 * Same signing protocols, same wire formats, same delegation ceremony.
 *
 * Dependencies:
 *   P-256 / ES256  — Node built-in `crypto` only (zero new npm deps)
 *   secp256k1/EIP712 — @noble/secp256k1 v3 (add to package.json, same role as
 *                      mdanter/ecc in PHP composer.json)
 *   keccak256      — crypto-js (already in package.json)
 *   EIP-712 digest — inline, byte-identical to PHP Q_Crypto_EIP712
 *
 * @noble/secp256k1 v3 usage notes (differs from v2):
 *   - Must configure hashes.sha256 and hashes.hmacSha256 before use
 *   - sign(digest, priv, { prehash: false, format: 'recovered' })
 *     → returns Uint8Array[65]: [recovery | r | s]
 *   - recoverPublicKey(sig65, digest, { prehash: false })
 *     → returns compressed Uint8Array[33]; convert to uncompressed via ECDH
 *   - verify(compact64, digest, pubUncompressed, { prehash: false }) → Boolean
 *
 * @class Q.Crypto
 * @static
 */

var nodeCrypto = require('crypto');
var Data       = require('./Data');

// ─── @noble/secp256k1 — lazy, configured on first use ────────────────────────

var _secp = null;

function _getSecp() {
    if (_secp) { return _secp; }
    try {
        _secp = require('@noble/secp256k1');
    } catch (e) {
        throw new Error(
            'Q.Crypto EIP712 path requires @noble/secp256k1. ' +
            'Run: npm install @noble/secp256k1  ' +
            '(same role as mdanter/ecc in PHP composer.json). ' +
            'Original: ' + e.message
        );
    }
    // v3 requires explicit hash configuration
    _secp.hashes.sha256 = function (msg) {
        return nodeCrypto.createHash('sha256').update(Buffer.from(msg)).digest();
    };
    _secp.hashes.hmacSha256 = function (key) {
        var hmac = nodeCrypto.createHmac('sha256', Buffer.from(key));
        for (var i = 1; i < arguments.length; i++) { hmac.update(Buffer.from(arguments[i])); }
        return hmac.digest();
    };
    return _secp;
}

// ─── keccak256 via crypto-js ──────────────────────────────────────────────────
// CryptoJS.SHA3 with outputLength:256 IS keccak-256 (not SHA3-256).
// This is a known crypto-js naming convention — byte-identical to noble and PHP.

function _keccak256(buf) {
    var CryptoJS = require('crypto-js');
    var b  = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    var wa = CryptoJS.lib.WordArray.create(b);
    return Buffer.from(CryptoJS.SHA3(wa, { outputLength: 256 }).toString(), 'hex');
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _toBuffer(data) {
    if (Buffer.isBuffer(data)) { return data; }
    if (data instanceof Uint8Array) {
        return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    }
    if (data instanceof ArrayBuffer) { return Buffer.from(data); }
    throw new Error('Q.Crypto: expected Buffer or Uint8Array, got ' + typeof data);
}

function _normalizeFormat(fmt) {
    switch ((fmt || '').toLowerCase()) {
        case 'eip712': case 'k256': return 'k256';
        case 'es256':  case 'p256': return 'p256';
        default: throw new Error('Q.Crypto: unsupported format: ' + fmt);
    }
}

function _bigIntTo32(n) {
    return Buffer.from(n.toString(16).padStart(64, '0'), 'hex');
}

// ─── P-256 SEC1 DER builder ───────────────────────────────────────────────────
// Lets Node import a raw P-256 scalar for signing without re-deriving from PKCS#8.

function _buildP256Sec1(privScalar, rawPub) {
    return Buffer.concat([
        Buffer.from([0x30, 0x77, 0x02, 0x01, 0x01, 0x04, 0x20]),   // SEQUENCE + version + privkey
        privScalar,
        // [0] OID prime256v1
        Buffer.from([0xa0, 0x0a, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]),
        // [1] public key BIT STRING
        Buffer.from([0xa1, 0x44, 0x03, 0x42, 0x00]),
        rawPub
    ]);
}

function _rawP256ToSpki(rawPoint) {
    var header = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex');
    return Buffer.concat([header, _toBuffer(rawPoint)]);
}

// ─── EIP-712 typed data digest ────────────────────────────────────────────────
// Inline implementation — byte-identical to PHP Q_Crypto_EIP712::hashTypedData.

function _hashTypedData(domain, primaryType, message, types) {
    function _keccak(buf) {
        return _keccak256(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
    }
    function _typeString(type) {
        if (!types[type]) { return type; }
        var fields = types[type].map(function (f) { return f.type + ' ' + f.name; }).join(',');
        var deps   = [];
        types[type].forEach(function (f) {
            var base = f.type.replace(/\[\d*\]$/, '');
            if (types[base] && deps.indexOf(base) < 0 && base !== type) { deps.push(base); }
        });
        deps.sort();
        return type + '(' + fields + ')' + deps.map(_typeString).join('');
    }
    var typeHash = _keccak(Buffer.from(_typeString(primaryType), 'utf8'));
    function _encodeValue(type, value) {
        if (type === 'string') { return _keccak(Buffer.from(value, 'utf8')); }
        if (type === 'bytes') {
            var bv = typeof value === 'string'
                ? Buffer.from(value.replace(/^0x/i, ''), 'hex')
                : Buffer.from(value);
            return _keccak(bv);
        }
        if (type === 'address') {
            return Buffer.from(
                '000000000000000000000000' + value.replace(/^0x/i, '').toLowerCase().padStart(40, '0'),
                'hex'
            );
        }
        if (type === 'bool') {
            return Buffer.from(
                value
                    ? '0000000000000000000000000000000000000000000000000000000000000001'
                    : '0000000000000000000000000000000000000000000000000000000000000000',
                'hex'
            );
        }
        if (/^u?int\d*$/.test(type)) {
            var n = BigInt(value);
            if (n < 0n) { n = n + (1n << 256n); }
            return Buffer.from(n.toString(16).padStart(64, '0'), 'hex');
        }
        if (/^bytes\d+$/.test(type)) {
            var hex = typeof value === 'string' && value.indexOf('0x') === 0
                ? value.slice(2)
                : (typeof value === 'string' ? value : Buffer.from(value).toString('hex'));
            return Buffer.from(hex.padEnd(64, '0').slice(0, 64), 'hex');
        }
        if (types[type]) { return _hashStruct(type, value); }
        throw new Error('EIP-712: unsupported type: ' + type);
    }
    function _hashStruct(type, value) {
        var parts = [typeHash];
        (types[type] || []).forEach(function (f) { parts.push(_encodeValue(f.type, value[f.name])); });
        return _keccak(Buffer.concat(parts));
    }
    var domainHash = _keccak(Buffer.concat(
        [_keccak(Buffer.from(_typeString('EIP712Domain'), 'utf8'))].concat(
            (types['EIP712Domain'] || []).map(function (f) { return _encodeValue(f.type, domain[f.name]); })
        )
    ));
    var structHash = _hashStruct(primaryType, message);
    return _keccak(Buffer.concat([Buffer.from([0x19, 0x01]), domainHash, structHash]));
}

// ─── Canonical JSON ───────────────────────────────────────────────────────────
// Must match PHP Q_Utils::serialize and browser Q.serialize exactly.

function _serialize(obj) {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
        return JSON.stringify(obj);
    }
    var pairs = Object.keys(obj).sort().map(function (k) {
        return JSON.stringify(k) + ':' + _serialize(obj[k]);
    });
    return '{' + pairs.join(',') + '}';
}

// ─── Convert compressed secp256k1 point to uncompressed ──────────────────────
// @noble/secp256k1 v3 recoverPublicKey returns a compressed 33-byte point.
// Node's ECDH can decompress it without any BigInt curve math.

function _decompressSecp256k1(compressed) {
    var ecdh = nodeCrypto.createECDH('secp256k1');
    ecdh.setPublicKey(Buffer.from(compressed));
    return ecdh.getPublicKey(); // 65 bytes uncompressed
}

// ─── Synchronous internal keypair ────────────────────────────────────────────

function _syncInternalKeypair(secret, format) {
    if (format === 'k256') {
        // keccak256("q.crypto.k256.private-key" || secret)
        var info      = Buffer.from('q.crypto.k256.private-key', 'utf8');
        var privBytes = _keccak256(Buffer.concat([info, secret]));

        // Public key via ECDH — no noble needed for key derivation
        var ecdh   = nodeCrypto.createECDH('secp256k1');
        ecdh.setPrivateKey(privBytes);
        var rawPub = ecdh.getPublicKey(); // 65 bytes uncompressed

        var address = '0x' + _keccak256(rawPub.slice(1)).slice(12).toString('hex');
        return {
            format:     'eip712',
            curve:      'secp256k1',
            hashAlg:    'keccak256',
            privateKey: privBytes,
            publicKey:  new Uint8Array(rawPub),
            address:    address
        };
    }

    // p256: HKDF(secret, "q.crypto.p256.private-key")
    // Data.derive is async; use hkdfSync directly (same derivation: salt=SHA-256(""), info=label).
    var _p256Salt = nodeCrypto.createHash('sha256').update(Buffer.from('', 'utf8')).digest();
    var privBuf   = Buffer.from(nodeCrypto.hkdfSync(
        'sha256', secret, _p256Salt, Buffer.from('q.crypto.p256.private-key', 'utf8'), 32
    ));
    var ecdhP256 = nodeCrypto.createECDH('prime256v1');
    ecdhP256.setPrivateKey(privBuf);
    var rawPubP256 = ecdhP256.getPublicKey(); // 65 bytes uncompressed

    return {
        format:     'es256',
        curve:      'p256',
        hashAlg:    'sha256',
        privateKey: privBuf,
        publicKey:  new Uint8Array(rawPubP256)
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Q.Crypto
// ─────────────────────────────────────────────────────────────────────────────

var Crypto = module.exports = {};

/**
 * Deterministically derive a signing keypair from a secret.
 * Byte-identical to browser Q.Crypto.internalKeypair and PHP Q_Crypto::internalKeypair.
 *
 * ES256  (P-256):   privateKey = HKDF-SHA256(secret, "q.crypto.p256.private-key")
 * EIP712 (k256):    privateKey = keccak256("q.crypto.k256.private-key" || secret)
 *
 * @method internalKeypair
 */
Crypto.internalKeypair = function (options, callback) {
    try {
        var result = _syncInternalKeypair(
            _toBuffer(options.secret),
            _normalizeFormat(options.format || 'ES256')
        );
        if (callback) { callback(null, result); }
        return Promise.resolve(result);
    } catch (e) {
        if (callback) { callback(e); }
        return Promise.reject(e);
    }
};

/**
 * Sign a typed message using a deterministically derived keypair.
 * Byte-identical to browser Q.Crypto.sign and PHP Q_Crypto::sign.
 *
 * ES256:
 *   digest = SHA-256(canonical JSON { domain, primaryType, types, message })
 *   signature = DER-encoded P-256 ECDSA (via Node built-in sign(null,...))
 *   Node's sign(null, digest, key) signs the raw bytes without re-hashing.
 *
 * EIP712:
 *   digest = EIP-712 hashTypedData(...)  (raw 32-byte keccak hash)
 *   signature = 65 bytes r||s||v  (v = 27 + recovery bit)
 *   @noble/secp256k1 v3 signs the raw digest with prehash:false.
 *
 * @method sign
 */
Crypto.sign = function (options, callback) {
    try {
        var secret      = _toBuffer(options.secret);
        var format      = _normalizeFormat(options.format || 'ES256');
        var domain      = options.domain      || {};
        var primaryType = options.primaryType;
        var message     = options.message;
        var types       = options.types;
        var kp          = _syncInternalKeypair(secret, format);

        if (format === 'k256') {
            var secp      = _getSecp();
            var digestBuf = _hashTypedData(domain, primaryType, message, types);

            // sign(..., { prehash: false, format: 'recovered' })
            // → Uint8Array[65]: [recovery_bit | r(32) | s(32)]
            var sig65    = secp.sign(digestBuf, kp.privateKey, { prehash: false, format: 'recovered' });
            var recovery = sig65[0];           // 0 or 1
            var compact  = Buffer.from(sig65.slice(1)); // r||s, 64 bytes

            // Ethereum-style: r||s||v  (v = 27 + recovery)
            var sigBuf = Buffer.concat([compact, Buffer.from([27 + recovery])]);

            var result = {
                format:       'eip712',
                curve:        'secp256k1',
                hashAlg:      'keccak256',
                domain:       domain,
                primaryType:  primaryType,
                digest:       digestBuf.toString('hex'),
                signature:    new Uint8Array(sigBuf),
                signatureHex: sigBuf.toString('hex'),
                publicKey:    kp.publicKey,
                address:      kp.address
            };
            if (callback) { callback(null, result); }
            return Promise.resolve(result);
        }

        // p256 / ES256
        var canonical  = _serialize({ domain: domain, primaryType: primaryType, types: types, message: message });
        var digestArr  = nodeCrypto.createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest();

        // Import P-256 scalar via SEC1 DER, then sign(null,...) — no re-hashing
        var ecdhP256   = nodeCrypto.createECDH('prime256v1');
        ecdhP256.setPrivateKey(kp.privateKey);
        var rawPubP256 = ecdhP256.getPublicKey();
        var sec1       = _buildP256Sec1(kp.privateKey, rawPubP256);
        var privKeyObj = nodeCrypto.createPrivateKey({ key: sec1, format: 'der', type: 'sec1' });
        var derSig     = nodeCrypto.sign(null, digestArr, privKeyObj);

        var res = {
            format:       'es256',
            curve:        'p256',
            hashAlg:      'sha256',
            domain:       domain,
            primaryType:  primaryType,
            digest:       digestArr.toString('hex'),
            signature:    new Uint8Array(derSig),
            signatureHex: derSig.toString('hex'),
            publicKey:    kp.publicKey
        };
        if (callback) { callback(null, res); }
        return Promise.resolve(res);
    } catch (e) {
        if (callback) { callback(e); }
        return Promise.reject(e);
    }
};

/**
 * Verify a typed signature.
 * Byte-identical to browser Q.Crypto.verify and PHP Q_Crypto::verify.
 *
 * EIP712: recovers signer address from signature; optionally checks against options.address.
 *         @noble/secp256k1 v3 returns compressed pubkey — converted to uncompressed via ECDH.
 *
 * ES256:  verifies DER signature against known public key via Node built-in verify(null,...).
 *
 * @method verify
 */
Crypto.verify = function (options, callback) {
    try {
        var format = _normalizeFormat(options.format || 'ES256');

        if (format === 'k256') {
            var secp      = _getSecp();
            var digestBuf = _hashTypedData(
                options.domain || {},
                options.primaryType,
                options.message,
                options.types
            );

            var sigRaw = options.signature;
            if (typeof sigRaw === 'string') {
                sigRaw = Buffer.from(sigRaw.replace(/^0x/i, ''), 'hex');
            } else {
                sigRaw = _toBuffer(sigRaw);
            }

            // Accept 65-byte r||s||v (Ethereum) or 64-byte r||s (compact)
            var compact64, recoveryBit;
            if (sigRaw.length === 65) {
                var v   = sigRaw[64];
                recoveryBit = (v === 27 || v === 28) ? v - 27 : v;
                compact64   = sigRaw.slice(0, 64);
            } else if (sigRaw.length === 64) {
                compact64   = sigRaw;
                recoveryBit = undefined; // try both
            } else {
                if (callback) { callback(null, false); }
                return Promise.resolve(false);
            }

            // First verify the signature is valid at all
            var pubK = Buffer.from(options.publicKey || _toBuffer(new Uint8Array(0)));
            // If we have a known pubKey, verify directly (fast path)
            if (options.publicKey && options.publicKey.length === 65) {
                var verOk = secp.verify(compact64, digestBuf, options.publicKey, { prehash: false });
                if (!verOk) {
                    if (callback) { callback(null, false); }
                    return Promise.resolve(false);
                }
            }

            // Recover public key for address matching
            // Build 65-byte [recovery | r | s] for @noble/secp256k1 v3 recoverPublicKey
            var recoveryBits = (recoveryBit !== undefined) ? [recoveryBit] : [0, 1];
            var recoveredAddr = null, recoveredPub = null;

            for (var vi = 0; vi < recoveryBits.length; vi++) {
                try {
                    var sig65ForRecovery = Buffer.concat([
                        Buffer.from([recoveryBits[vi]]),
                        Buffer.from(compact64)
                    ]);
                    // recoverPublicKey(sig_recovered, message, opts)
                    // returns compressed 33-byte pubkey in v3
                    var recCompressed = secp.recoverPublicKey(sig65ForRecovery, digestBuf, { prehash: false });
                    // Convert compressed → uncompressed via Node ECDH
                    var recUncompressed = _decompressSecp256k1(recCompressed);
                    var candidateAddr   = '0x' + _keccak256(recUncompressed.slice(1)).slice(12).toString('hex');
                    recoveredAddr = candidateAddr;
                    recoveredPub  = recUncompressed;
                    break; // take first valid recovery
                } catch (e) { /* try next recovery bit */ }
            }

            if (!recoveredAddr) {
                if (callback) { callback(null, false); }
                return Promise.resolve(false);
            }

            if (options.recovered && typeof options.recovered === 'object') {
                options.recovered.address   = recoveredAddr;
                options.recovered.publicKey = recoveredPub;
            }

            var ok = options.address
                ? recoveredAddr.toLowerCase() === options.address.toLowerCase()
                : true;

            if (callback) { callback(null, ok); }
            return Promise.resolve(ok);
        }

        // p256 / ES256
        if (!options.publicKey) {
            throw new Error('Q.Crypto.verify: ES256 requires publicKey');
        }
        var canonical  = _serialize({
            domain:      options.domain || {},
            primaryType: options.primaryType,
            types:       options.types,
            message:     options.message
        });
        var digestBufP = nodeCrypto.createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest();

        var pubKeyObj  = nodeCrypto.createPublicKey({
            key:    _rawP256ToSpki(_toBuffer(options.publicKey)),
            format: 'der',
            type:   'spki'
        });

        var sigBytes = options.signature;
        if (typeof sigBytes === 'string') {
            sigBytes = Buffer.from(sigBytes.replace(/^0x/i, ''), 'hex');
        } else {
            sigBytes = _toBuffer(sigBytes);
        }

        try {
            // verify(null,...) checks raw bytes without re-hashing — matches sign(null,...)
            var verified = nodeCrypto.verify(null, digestBufP, pubKeyObj, sigBytes);
            if (callback) { callback(null, verified); }
            return Promise.resolve(verified);
        } catch (e) {
            if (callback) { callback(null, false); }
            return Promise.resolve(false);
        }
    } catch (e) {
        if (callback) { callback(e); }
        return Promise.reject(e);
    }
};

/**
 * Cryptographic delegation ceremony.
 * Byte-identical to browser Q.Crypto.delegate and PHP Q_Crypto::delegate.
 *
 * @method delegate
 */
Crypto.delegate = function (options, callback) {
    try {
        var rootSecret = _toBuffer(options.rootSecret);
        var label      = options.label;
        var context    = options.context || '';
        var format     = _normalizeFormat(options.format || 'ES256');

        if (!label) { throw new Error('Q.Crypto.delegate: label required'); }

        // Data.derive is async; use hkdfSync directly here for sync context.
        // Matches Data.derive exactly: salt = SHA-256(""), info = label.
        var _dSalt        = nodeCrypto.createHash('sha256').update(Buffer.from('', 'utf8')).digest();
        var derivedSecret = new Uint8Array(nodeCrypto.hkdfSync(
            'sha256', rootSecret, _dSalt,
            Buffer.from('q.crypto.delegate.' + label, 'utf8'), 32
        ));
        var parentKp      = _syncInternalKeypair(rootSecret, format);

        var parentIdentity, parentType;
        if (format === 'k256') {
            parentIdentity = parentKp.address;
            parentType     = 'address';
        } else {
            parentIdentity = nodeCrypto.createHash('sha256')
                .update(_toBuffer(parentKp.publicKey)).digest('hex');
            parentType = 'bytes32';
        }

        var secretHashHex = format === 'k256'
            ? _keccak256(_toBuffer(derivedSecret)).toString('hex')
            : nodeCrypto.createHash('sha256').update(_toBuffer(derivedSecret)).digest('hex');

        var statement = {
            parent:     parentIdentity,
            label:      label,
            issuedTime: Math.floor(Date.now() / 1000),
            context:    context,
            secretHash: secretHashHex
        };

        var domain = format === 'k256'
            ? { name: 'Q.Crypto', version: '1', salt: _keccak256(Buffer.from(label, 'utf8')).toString('hex') }
            : {};

        var types = {
            EIP712Domain: [
                { name: 'name',    type: 'string'  },
                { name: 'version', type: 'string'  },
                { name: 'salt',    type: 'bytes32' }
            ],
            Delegation: [
                { name: 'parent',     type: parentType },
                { name: 'label',      type: 'string'   },
                { name: 'issuedTime', type: 'uint64'   },
                { name: 'context',    type: 'string'   },
                { name: 'secretHash', type: 'bytes32'  }
            ]
        };

        return Crypto.sign({
            secret:      rootSecret,
            domain:      domain,
            message:     statement,
            types:       types,
            primaryType: 'Delegation',
            format:      format === 'k256' ? 'EIP712' : 'ES256'
        }).then(function (proof) {
            var result = {
                label:     label,
                context:   context,
                secret:    new Uint8Array(_toBuffer(derivedSecret)),
                statement: statement,
                proof:     proof
            };
            if (callback) { callback(null, result); }
            return result;
        });
    } catch (e) {
        if (callback) { callback(e); }
        return Promise.reject(e);
    }
};

/**
 * Verify a single delegation step.
 * Byte-identical to browser Q.Crypto.verifyDelegated and PHP Q_Crypto::verifyDelegated.
 * Checks: secret binding, signature, parent identity. Call repeatedly for chains.
 *
 * @method verifyDelegated
 */
Crypto.verifyDelegated = function (options, callback) {
    try {
        var format        = _normalizeFormat(options.format || 'ES256');
        var statement     = options.statement;
        var derivedSecret = _toBuffer(options.derivedSecret);
        var context       = (statement && statement.context) || '';

        if (!statement) { throw new Error('Q.Crypto.verifyDelegated: statement required'); }
        ['parent', 'label', 'issuedTime', 'secretHash'].forEach(function (f) {
            if (statement[f] === undefined) {
                throw new Error('Q.Crypto.verifyDelegated: statement.' + f + ' required');
            }
        });

        // 1. Verify secret binding
        var actualHash = format === 'k256'
            ? _keccak256(derivedSecret).toString('hex')
            : nodeCrypto.createHash('sha256').update(derivedSecret).digest('hex');

        if (actualHash !== statement.secretHash) {
            if (callback) { callback(null, false); }
            return Promise.resolve(false);
        }

        // 2. Protocol-fixed schema — must match delegate() exactly
        var types = {
            EIP712Domain: [
                { name: 'name',    type: 'string'  },
                { name: 'version', type: 'string'  },
                { name: 'salt',    type: 'bytes32' }
            ],
            Delegation: [
                { name: 'parent',     type: format === 'k256' ? 'address' : 'bytes32' },
                { name: 'label',      type: 'string'  },
                { name: 'issuedTime', type: 'uint64'  },
                { name: 'context',    type: 'string'  },
                { name: 'secretHash', type: 'bytes32' }
            ]
        };

        var msg = Object.assign({}, statement, { context: context });
        var sig = options.signature;
        if (typeof sig === 'string') { sig = Data.fromBase64(sig); }

        if (format === 'k256') {
            // Reconstruct the protocol-fixed domain — must match delegate() exactly.
            // The domain is never caller-supplied for delegations; it is derived from the label.
            var _vdDomain = {
                name:    'Q.Crypto',
                version: '1',
                salt:    _keccak256(Buffer.from(statement.label, 'utf8')).toString('hex')
            };
            var recovered = {};
            return Crypto.verify({
                format:      'EIP712',
                domain:      _vdDomain,
                types:       types,
                primaryType: 'Delegation',
                message:     msg,
                signature:   sig,
                recovered:   recovered
            }).then(function (ok) {
                if (!ok || !recovered.address) {
                    if (callback) { callback(null, false); }
                    return false;
                }
                var pass = recovered.address.toLowerCase() === statement.parent.toLowerCase();
                if (options.recovered && typeof options.recovered === 'object') {
                    Object.assign(options.recovered, recovered);
                }
                if (callback) { callback(null, pass); }
                return pass;
            });
        }

        // ES256
        if (!options.parentPublicKey) {
            throw new Error('Q.Crypto.verifyDelegated: parentPublicKey required for ES256');
        }
        var pubBytes     = _toBuffer(options.parentPublicKey);
        var expectedHash = nodeCrypto.createHash('sha256').update(pubBytes).digest('hex');
        if (expectedHash !== statement.parent) {
            if (callback) { callback(null, false); }
            return Promise.resolve(false);
        }

        return Crypto.verify({
            format:      'ES256',
            domain:      options.domain || {},
            types:       types,
            primaryType: 'Delegation',
            message:     msg,
            signature:   sig,
            publicKey:   pubBytes
        }).then(function (ok) {
            if (ok && options.recovered && typeof options.recovered === 'object') {
                options.recovered.publicKey = pubBytes;
            }
            if (callback) { callback(null, ok); }
            return ok;
        });
    } catch (e) {
        if (callback) { callback(e); }
        return Promise.reject(e);
    }
};
