"use strict";
/*jshint node:true */
/**
 * Q.Crypto.OpenClaim.EVM — EIP-712 Payment and Authorization extensions (Node.js).
 *
 * Parity counterpart of:
 *   Browser: Q.Crypto.OpenClaim.EVM (Q/js/methods/Q/Crypto/OpenClaim/EVM/)
 *   PHP:     Q_Crypto_OpenClaim_EVM
 *
 * Delegates all crypto to Q.Crypto.sign / Q.Crypto.verify (EIP712 format)
 * since the EIP-712 digest is identical to what Q.Crypto already computes.
 * Zero duplication of secp256k1/keccak logic.
 *
 * Supported extensions:
 *   Payment       — payer, token, recipients, max, line, nbf, exp, chainId, contract
 *   Authorization — authority, subject, actors, roles, actions, constraints, contexts, nbf, exp
 *
 * Both use the same EIP-712 typed-data approach: sub-arrays are hashed to bytes32
 * via ABI-encoding, exactly byte-identical to the on-chain ecrecover verification.
 *
 * Dependencies:
 *   Q.Crypto        — sign, verify (EIP712 format) — already has keccak + secp256k1
 *   Q.Data          — toBase64, fromBase64
 *   crypto-js       — already in package.json (keccak256 sub-hashes)
 *
 * @class Q.Crypto.OpenClaim.EVM
 * @static
 */

var Q    = require('Q');
var Data = require('../Data');    // Q.Data — same as Q.Crypto.Data

// ── keccak256 via crypto-js (already in package.json) ────────────────────────
// CryptoJS.SHA3 outputLength:256 IS keccak-256 (not SHA3-256).
// Byte-identical to PHP \Crypto\Keccak::hash and noble keccak_256.

function _keccak256(buf) {
    var CryptoJS = require('crypto-js');
    var b  = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    var wa = CryptoJS.lib.WordArray.create(b);
    return Buffer.from(CryptoJS.SHA3(wa, { outputLength: 256 }).toString(), 'hex');
}

// ── Type definitions ──────────────────────────────────────────────────────────
// Byte-identical to JS PAYMENT_TYPES / AUTHORIZATION_TYPES and PHP counterparts.

var PAYMENT_TYPES = {
    EIP712Domain: [
        { name: 'name',              type: 'string'  },
        { name: 'version',           type: 'string'  },
        { name: 'chainId',           type: 'uint256' },
        { name: 'verifyingContract', type: 'address' }
    ],
    Payment: [
        { name: 'payer',          type: 'address' },
        { name: 'token',          type: 'address' },
        { name: 'recipientsHash', type: 'bytes32' },
        { name: 'max',            type: 'uint256' },
        { name: 'line',           type: 'uint256' },
        { name: 'nbf',            type: 'uint256' },
        { name: 'exp',            type: 'uint256' }
    ]
};

var AUTHORIZATION_TYPES = {
    EIP712Domain: [
        { name: 'name',              type: 'string'  },
        { name: 'version',           type: 'string'  },
        { name: 'chainId',           type: 'uint256' },
        { name: 'verifyingContract', type: 'address' }
    ],
    Authorization: [
        { name: 'authority',       type: 'address' },
        { name: 'subject',         type: 'address' },
        { name: 'actorsHash',      type: 'bytes32' },
        { name: 'rolesHash',       type: 'bytes32' },
        { name: 'actionsHash',     type: 'bytes32' },
        { name: 'constraintsHash', type: 'bytes32' },
        { name: 'contextsHash',    type: 'bytes32' },
        { name: 'nbf',             type: 'uint256' },
        { name: 'exp',             type: 'uint256' }
    ]
};

// ── ABI sub-hash helpers ──────────────────────────────────────────────────────
// Byte-identical to Q_Crypto_OpenClaim_EVM PHP and browser hashTypedData.js

function _padLeft32(bytes) {
    var out = Buffer.alloc(32, 0);
    var buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    buf.copy(out, 32 - buf.length);
    return out;
}

function _encodeAddress(addr) {
    var hex = String(addr).replace(/^0x/i, '').toLowerCase().padStart(40, '0');
    return _padLeft32(Buffer.from(hex, 'hex'));
}

function _hashAddresses(addrs) {
    if (!addrs.length) { return _keccak256(Buffer.alloc(0)); }
    return _keccak256(Buffer.concat(addrs.map(_encodeAddress)));
}

function _hashStrings(strings) {
    if (!strings.length) { return _keccak256(Buffer.alloc(0)); }
    var hashes = strings.map(function (s) { return _keccak256(Buffer.from(String(s), 'utf8')); });
    return _keccak256(Buffer.concat(hashes));
}

function _hashConstraints(constraints) {
    if (!constraints.length) { return _keccak256(Buffer.alloc(0)); }
    var th = _keccak256(Buffer.from('Constraint(string key,string op,string value)', 'utf8'));
    var hashes = constraints.map(function (c) {
        return _keccak256(Buffer.concat([
            th,
            _keccak256(Buffer.from(c.key   || '', 'utf8')),
            _keccak256(Buffer.from(c.op    || '', 'utf8')),
            _keccak256(Buffer.from(c.value || '', 'utf8'))
        ]));
    });
    return _keccak256(Buffer.concat(hashes));
}

function _hashContexts(contexts) {
    if (!contexts.length) { return _keccak256(Buffer.alloc(0)); }
    var th = _keccak256(Buffer.from('Context(string type,string value)', 'utf8'));
    var hashes = contexts.map(function (ctx) {
        return _keccak256(Buffer.concat([
            th,
            _keccak256(Buffer.from(ctx.type  || ctx.fmt || '', 'utf8')),
            _keccak256(Buffer.from(ctx.value || '',           'utf8'))
        ]));
    });
    return _keccak256(Buffer.concat(hashes));
}

// ── Utility ───────────────────────────────────────────────────────────────────

function _arr(v)    { return v == null ? [] : Array.isArray(v) ? v : [v]; }
function _lower(v)  { return String(v).toLowerCase(); }

function _read(claim, key, fallback) {
    if (claim[key]                    != null) { return claim[key]; }
    if (claim.stm && claim.stm[key]   != null) { return claim.stm[key]; }
    return fallback !== undefined ? fallback : null;
}

function _toArray(v) { return v == null ? [] : Array.isArray(v) ? v : [v]; }

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

function _normalizeSigToBuffer(sig) {
    if (Buffer.isBuffer(sig))    { return sig; }
    if (sig instanceof Uint8Array) { return Buffer.from(sig); }
    if (typeof sig === 'string') {
        // hex (with or without 0x)
        var hex = sig.replace(/^0x/i, '');
        if (/^[0-9a-fA-F]{130}$/.test(hex)) { return Buffer.from(hex, 'hex'); }
        // base64
        var bin = Buffer.from(sig, 'base64');
        if (bin.length === 65) { return bin; }
    }
    return null;
}

// ── Payload builder ───────────────────────────────────────────────────────────

function _buildPayload(claim) {
    var payer     = _read(claim, 'payer');
    var token     = _read(claim, 'token');
    var line      = _read(claim, 'line');
    var authority = _read(claim, 'authority');
    var subject   = _read(claim, 'subject');

    if (payer != null && token != null && line != null) {
        return _paymentPayload(claim);
    }
    if (authority && subject) {
        return _authorizationPayload(claim);
    }
    throw new Error('Q.Crypto.OpenClaim.EVM: cannot detect claim extension (Payment or Authorization)');
}

function _paymentPayload(claim) {
    var recipients = _arr(_read(claim, 'recipients', []));
    return {
        primaryType: 'Payment',
        domain: {
            name:              'OpenClaiming.payments',
            version:           '1',
            chainId:           claim.chainId,
            verifyingContract: claim.contract
        },
        types: PAYMENT_TYPES,
        value: {
            payer:          _lower(_read(claim, 'payer', '')),
            token:          _lower(_read(claim, 'token', '')),
            recipientsHash: _hashAddresses(recipients),
            // uint256: keep as BigInt for Q.Crypto EIP-712 encoder
            max:  BigInt(_read(claim, 'max',  0) || 0),
            line: BigInt(_read(claim, 'line', 0) || 0),
            nbf:  BigInt(_read(claim, 'nbf',  0) || 0),
            exp:  BigInt(_read(claim, 'exp',  0) || 0)
        }
    };
}

function _authorizationPayload(claim) {
    var actors      = _arr(_read(claim, 'actors',      []));
    var roles       = _arr(_read(claim, 'roles',       []));
    var actions     = _arr(_read(claim, 'actions',     []));
    var constraints = _arr(_read(claim, 'constraints', []));
    var contexts    = _arr(_read(claim, 'contexts',    []));
    return {
        primaryType: 'Authorization',
        domain: {
            name:              'OpenClaiming.authorizations',
            version:           '1',
            chainId:           claim.chainId,
            verifyingContract: claim.contract
        },
        types: AUTHORIZATION_TYPES,
        value: {
            authority:       _lower(_read(claim, 'authority', '')),
            subject:         _lower(_read(claim, 'subject',   '')),
            actorsHash:      _hashAddresses(actors),
            rolesHash:       _hashStrings(roles),
            actionsHash:     _hashStrings(actions),
            constraintsHash: _hashConstraints(constraints),
            contextsHash:    _hashContexts(contexts),
            nbf: BigInt(_read(claim, 'nbf', 0) || 0),
            exp: BigInt(_read(claim, 'exp', 0) || 0)
        }
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// EVM namespace — attached to Q.Crypto.OpenClaim
// ─────────────────────────────────────────────────────────────────────────────

var EVM = Q.Crypto.OpenClaim.EVM = {};

/**
 * Compute the EIP-712 typed-data digest for an OpenClaim EVM claim.
 * Returns the full payload so callers can pass it directly to Q.Crypto.sign/verify.
 *
 * Byte-identical to:
 *   Browser: Q.Crypto.OpenClaim.EVM.hashTypedData(claim)
 *   PHP:     Q_Crypto_OpenClaim_EVM::hashTypedData($claim)
 *
 * @method hashTypedData
 * @param  {Object}   claim
 * @param  {Function} [callback]
 * @return {Promise<{ digest: Buffer, payload: Object }>}
 */
EVM.hashTypedData = function (claim, callback) {
    var p = new Promise(function (resolve, reject) {
        try {
            var payload = _buildPayload(claim);
            // Q.Crypto has an inline _hashTypedData that is byte-identical to PHP.
            // We invoke it via Q.Crypto.sign with a dummy secret and read back the digest,
            // OR we can replicate the same inline computation here using crypto-js.
            // Better: use Q.Crypto's internal EIP712 digest directly.
            // Q.Crypto exposes this via sign() which returns { digest }.
            // For hashTypedData we just need the digest — derive a temp keypair-free hash
            // by calling the same inline _hashTypedData that Q.Crypto.js uses internally.
            // Since Q.Crypto.js does not expose _hashTypedData publicly, we replicate
            // the same 20-line inline function here (same keccak + ABI encoding).
            var digest = _hashTypedData(
                payload.domain,
                payload.primaryType,
                payload.value,
                payload.types
            );
            resolve({ digest: digest, payload: payload });
        } catch (e) {
            reject(e);
        }
    });
    if (callback) { p.then(function (r) { callback(null, r); }).catch(callback); }
    return p;
};

/**
 * Sign an OpenClaim EVM claim from a secret.
 * Delegates entirely to Q.Crypto.sign (EIP712 format).
 *
 * The derived Ethereum address is stored as data:key/eip712,<address> in key[].
 * The 65-byte r||s||v signature is base64-encoded and stored in sig[].
 *
 * @method sign
 * @param  {Object}            claim
 * @param  {Buffer|Uint8Array} secret      Raw binary secret (32 bytes)
 * @param  {Object}            [existing]  { keys, signatures } for multisig
 * @param  {Function}          [callback]
 * @return {Promise<Object>}   Claim with key[] and sig[] populated
 */
EVM.sign = function (claim, secret, existing, callback) {
    if (typeof existing === 'function') { callback = existing; existing = {}; }
    existing = existing || {};

    var p = EVM.hashTypedData(claim).then(function (result) {
        var payload = result.payload;

        return Q.Crypto.sign({
            secret:      secret,
            format:      'EIP712',
            domain:      payload.domain,
            primaryType: payload.primaryType,
            types:       payload.types,
            message:     payload.value
        }).then(function (proof) {
            var signerKey = 'data:key/eip712,' + proof.address;

            var keys = _toArray(existing.keys != null ? existing.keys : claim.key).slice();
            var sigs = _normalizeSigs(existing.signatures != null ? existing.signatures : claim.sig);

            if (keys.indexOf(signerKey) < 0) { keys.push(signerKey); }

            var state = _buildSortedState(keys, sigs);
            var idx   = state.keys.indexOf(signerKey);

            // Store as base64 for OCP wire format
            state.signatures[idx] = Buffer.from(proof.signature).toString('base64');

            return Object.assign({}, claim, {
                key: state.keys,
                sig: state.signatures
            });
        });
    });

    if (callback) { p.then(function (r) { callback(null, r); }).catch(callback); }
    return p;
};

/**
 * Verify an OpenClaim EVM signature against an expected Ethereum address.
 * Delegates entirely to Q.Crypto.verify (EIP712 format).
 *
 * @method verify
 * @param  {Object}            claim
 * @param  {String|Buffer}     signature        65-byte r||s||v (base64, hex, or Buffer)
 * @param  {String}            [expectedAddress] "0x..." Ethereum address
 * @param  {Object}            [recovered]       If object, .address is written here
 * @param  {Function}          [callback]
 * @return {Promise<Boolean>}
 */
EVM.verify = function (claim, signature, expectedAddress, recovered, callback) {
    if (typeof expectedAddress === 'function') { callback = expectedAddress; expectedAddress = null; recovered = null; }
    if (typeof recovered === 'function')       { callback = recovered; recovered = null; }

    var p = EVM.hashTypedData(claim).then(function (result) {
        var payload = result.payload;

        var sigBuf = _normalizeSigToBuffer(signature);
        if (!sigBuf) { return false; }

        var recoveredOut = (recovered && typeof recovered === 'object') ? recovered : {};

        return Q.Crypto.verify({
            format:      'EIP712',
            domain:      payload.domain,
            primaryType: payload.primaryType,
            types:       payload.types,
            message:     payload.value,
            signature:   sigBuf,
            address:     expectedAddress || undefined,
            recovered:   recoveredOut
        }).then(function (ok) {
            if (recovered && typeof recovered === 'object') {
                recovered.address = recoveredOut.address;
            }
            return !!ok;
        });
    }).catch(function () { return false; });

    if (callback) { p.then(function (r) { callback(null, r); }).catch(function (e) { callback(e); }); }
    return p;
};

// ── Inline EIP-712 digest — same algorithm as Q.Crypto.js _hashTypedData ─────
// Replicated here so hashTypedData() works without needing a dummy sign() call.
// Byte-identical to PHP Q_Crypto_EIP712::hashTypedData and Q.Crypto.js inline.

function _hashTypedData(domain, primaryType, message, types) {
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

    // typeHash is computed per-struct inside _hashStruct (not fixed to primaryType)
    // so that nested struct types are hashed correctly.
    function _encodeValue(type, value) {
        if (type === 'string') { return _keccak256(Buffer.from(value, 'utf8')); }
        if (type === 'bytes') {
            var bv = typeof value === 'string'
                ? Buffer.from(value.replace(/^0x/i, ''), 'hex')
                : Buffer.from(value);
            return _keccak256(bv);
        }
        if (type === 'address') {
            return Buffer.from(
                '000000000000000000000000' +
                String(value).replace(/^0x/i, '').toLowerCase().padStart(40, '0'),
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
            var bHex = Buffer.isBuffer(value)
                ? value.toString('hex')
                : (typeof value === 'string' && value.indexOf('0x') === 0
                    ? value.slice(2)
                    : (typeof value === 'string' ? value : Buffer.from(value).toString('hex')));
            return Buffer.from(bHex.padEnd(64, '0').slice(0, 64), 'hex');
        }
        if (types[type]) { return _hashStruct(type, value); }
        throw new Error('EIP-712: unsupported type: ' + type);
    }

    function _hashStruct(type, value) {
        // Per-type hash — correct for nested struct types
        var th    = _keccak256(Buffer.from(_typeString(type), 'utf8'));
        var parts = [th];
        (types[type] || []).forEach(function (f) { parts.push(_encodeValue(f.type, value[f.name])); });
        return _keccak256(Buffer.concat(parts));
    }

    var domainHash = _keccak256(Buffer.concat(
        [_keccak256(Buffer.from(_typeString('EIP712Domain'), 'utf8'))].concat(
            (types['EIP712Domain'] || []).map(function (f) { return _encodeValue(f.type, domain[f.name]); })
        )
    ));
    var structHash = _hashStruct(primaryType, message);
    return _keccak256(Buffer.concat([Buffer.from([0x19, 0x01]), domainHash, structHash]));
}

module.exports = EVM;
