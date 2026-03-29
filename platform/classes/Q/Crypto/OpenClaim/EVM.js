"use strict";
/*jshint node:true */
/**
 * Q.Crypto.OpenClaim.EVM — EIP-712 Payment and Authorization extensions (Node.js).
 *
 * Parity counterpart of:
 *   Browser: Q.Crypto.OpenClaim.EVM (Q/js/methods/Q/Crypto/OpenClaim/EVM/)
 *   PHP:     Q_Crypto_OpenClaim_EVM
 *
 * Delegates all crypto to Q.Crypto.sign / Q.Crypto.verify (EIP712 format).
 *
 * recipientsHash encoding:
 *   Matches Solidity paymentsHashRecipients() = keccak256(abi.encode(address[])).
 *   abi.encode of a dynamic array = 32-byte offset + 32-byte length + 32-byte elements.
 *   This is NOT abi.encodePacked (no offset/length) — the contract uses abi.encode.
 *
 * chainId:
 *   CAIP-2 strings like 'eip155:56' are stripped to integer 56 for the EIP-712 domain.
 *   The Solidity contract uses block.chainid (uint256 integer).
 *
 * @class Q.Crypto.OpenClaim.EVM
 * @static
 */

var Q = require('Q');

// ── keccak256 via crypto-js ────────────────────────────────────────────────────
function _keccak256(buf) {
    var CryptoJS = require('crypto-js');
    var b  = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    var wa = CryptoJS.lib.WordArray.create(b);
    return Buffer.from(CryptoJS.SHA3(wa, { outputLength: 256 }).toString(), 'hex');
}

// ── Type definitions ───────────────────────────────────────────────────────────

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


var ACTIONS_TYPES = {
    EIP712Domain: [
        { name: 'name',              type: 'string'  },
        { name: 'version',           type: 'string'  },
        { name: 'chainId',           type: 'uint256' },
        { name: 'verifyingContract', type: 'address' }
    ],
    Action: [
        { name: 'authority',       type: 'address' },
        { name: 'subject',         type: 'address' },
        { name: 'contractAddress', type: 'address' },
        { name: 'method',          type: 'bytes4'  },
        { name: 'paramsHash',      type: 'bytes32' },
        { name: 'minimum',         type: 'uint256' },
        { name: 'fraction',        type: 'uint256' },
        { name: 'delay',           type: 'uint256' },
        { name: 'nbf',             type: 'uint256' },
        { name: 'exp',             type: 'uint256' }
    ]
};
var MESSAGES_TYPES = {
    EIP712Domain: [
        { name: 'name',              type: 'string'  },
        { name: 'version',           type: 'string'  },
        { name: 'chainId',           type: 'uint256' },
        { name: 'verifyingContract', type: 'address' }
    ],
    MessageAssociation: [
        { name: 'account',      type: 'address' },
        { name: 'endpointType', type: 'bytes32' },
        { name: 'commitment',   type: 'bytes32' }
    ]
};

// ── ABI sub-hash helpers ───────────────────────────────────────────────────────

function _padLeft32(bytes) {
    var out = Buffer.alloc(32, 0);
    var buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    buf.copy(out, 32 - buf.length);
    return out;
}

function _encodeAddress(addr) {
    // Strip OCP URI prefix if present: "evm:56:address:0xABC" → "0xABC"
    var s = String(addr).replace(/^evm:\d+:address:/i, '');
    var hex = s.replace(/^0x/i, '').toLowerCase().padStart(40, '0');
    return _padLeft32(Buffer.from(hex, 'hex'));
}

/**
 * Hash an address array matching Solidity paymentsHashRecipients():
 *   keccak256(abi.encode(address[]))
 *
 * abi.encode of a dynamic array prepends:
 *   - 32-byte offset (= 0x20, always, for a single top-level dynamic param)
 *   - 32-byte element count
 * followed by 32-byte-padded elements.
 *
 * This is NOT abi.encodePacked. The contract's paymentsHashRecipients()
 * uses abi.encode, so we must match it exactly.
 */
function _hashAddresses(addrs) {
    var offset = Buffer.alloc(32, 0);
    offset[31] = 0x20; // pointer to array data = 32 bytes ahead

    var length = Buffer.alloc(32, 0);
    var n = addrs.length;
    for (var i = 0; i < 32; i++) { length[31 - i] = n & 0xff; n >>= 8; }

    var elements = addrs.length
        ? Buffer.concat(addrs.map(_encodeAddress))
        : Buffer.alloc(0);

    return _keccak256(Buffer.concat([offset, length, elements]));
}




// ── Utility ────────────────────────────────────────────────────────────────────

function _arr(v)    { return v == null ? [] : Array.isArray(v) ? v : [v]; }
function _lower(v)  { return String(v).toLowerCase(); }

function _read(claim, key, fallback) {
    if (claim[key]                    != null) { return claim[key]; }
    if (claim.stm && claim.stm[key]   != null) { return claim.stm[key]; }
    return fallback !== undefined ? fallback : null;
}

/**
 * Convert a CAIP-2 chain ID ('eip155:56') or plain string ('56') to integer.
 * The EIP-712 domain requires chainId as uint256 (integer), matching block.chainid.
 */
function _caip2ToChainId(v) {
    if (typeof v === 'number') { return v; }
    if (typeof v === 'string') {
        if (v.indexOf('eip155:') === 0) { return parseInt(v.slice(7), 10); }
        var m = v.match(/^evm:(\d+):/);
        if (m) { return parseInt(m[1], 10); }
        return parseInt(v, 10);
    }
    return v; // BigInt or other — pass through to EIP-712 encoder
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
    if (Buffer.isBuffer(sig))      { return sig; }
    if (sig instanceof Uint8Array) { return Buffer.from(sig); }
    if (typeof sig === 'string') {
        var hex = sig.replace(/^0x/i, '');
        if (/^[0-9a-fA-F]{130}$/.test(hex)) { return Buffer.from(hex, 'hex'); }
        var bin = Buffer.from(sig, 'base64');
        if (bin.length === 65) { return bin; }
    }
    return null;
}

// ── Payload builder ────────────────────────────────────────────────────────────

function _buildPayload(claim) {
    var payer           = _read(claim, 'payer');
    var token           = _read(claim, 'token');
    var line            = _read(claim, 'line');
    var authority       = _read(claim, 'authority');
    var subject         = _read(claim, 'subject');
    var contractAddress = _read(claim, 'contractAddress') || _read(claim, 'contract');
    var account         = _read(claim, 'account');
    var endpointType    = _read(claim, 'endpointType');

    if (payer != null && token != null && line != null) {
        return _paymentPayload(claim);
    }
    if (authority != null && subject != null && contractAddress != null) {
        return _actionsPayload(claim);
    }
    if (account != null && endpointType != null) {
        return _messagesPayload(claim);
    }
    throw new Error('Q.Crypto.OpenClaim.EVM: cannot detect extension (payments, actions, or messages)');
}

function _paymentPayload(claim) {
    var recipients = _arr(_read(claim, 'recipients', []));
    return {
        primaryType: 'Payment',
        domain: {
            name:              'OpenClaiming.payments',
            version:           '1',
            chainId:           _caip2ToChainId(_read(claim, 'chainId')),
            verifyingContract: _read(claim, 'contract')
        },
        types: PAYMENT_TYPES,
        value: {
            payer:          _lower(_read(claim, 'payer', '')),
            token:          _lower(_read(claim, 'token', '')),
            recipientsHash: _hashAddresses(recipients),
            max:  BigInt(_read(claim, 'max',  0) || 0),
            line: BigInt(_read(claim, 'line', 0) || 0),
            nbf:  BigInt(_read(claim, 'nbf',  0) || 0),
            exp:  BigInt(_read(claim, 'exp',  0) || 0)
        }
    };
}

function _actionsPayload(claim) {
    var contractAddress = _read(claim, 'contractAddress') || _read(claim, 'contract');
    var methodHex = String(_read(claim, 'method') || '').replace(/^0x/i, '').padEnd(8, '0').slice(0, 8);
    var methodBuf = Buffer.from(methodHex, 'hex'); // 4 bytes

    var paramsHash = _read(claim, 'paramsHash');
    if (!paramsHash) {
        var params = _read(claim, 'params') || '';
        var paramBuf = typeof params === 'string'
            ? Buffer.from(params.replace(/^0x/i, ''), 'hex')
            : Buffer.from(params);
        paramsHash = _keccak256(paramBuf);
    }

    return {
        primaryType: 'Action',
        domain: {
            name:              'OpenClaiming.actions',
            version:           '1',
            chainId:           _caip2ToChainId(_read(claim, 'chainId')),
            verifyingContract: _read(claim, 'contract')
        },
        types: ACTIONS_TYPES,
        value: {
            authority:       _lower(_read(claim, 'authority', '')),
            subject:         _lower(_read(claim, 'subject',   '')),
            contractAddress: _lower(String(contractAddress || '').replace(/^evm:\d+:address:/i, '')),
            method:          methodBuf,
            paramsHash:      paramsHash,
            minimum:         BigInt(_read(claim, 'minimum', 0) || 0),
            fraction:        BigInt(_read(claim, 'fraction', 0) || 0),
            delay:           BigInt(_read(claim, 'delay',   0) || 0),
            nbf:             BigInt(_read(claim, 'nbf',     0) || 0),
            exp:             BigInt(_read(claim, 'exp',     0) || 0)
        }
    };
}

function _messagesPayload(claim) {
    return {
        primaryType: 'MessageAssociation',
        domain: {
            name:              'OpenClaiming.messages',
            version:           '1',
            chainId:           _caip2ToChainId(_read(claim, 'chainId')),
            verifyingContract: _read(claim, 'contract')
        },
        types: MESSAGES_TYPES,
        value: {
            account:      _lower(_read(claim, 'account', '')),
            endpointType: _read(claim, 'endpointType'),
            commitment:   _read(claim, 'commitment')
        }
    };
}

// ── EVM namespace ──────────────────────────────────────────────────────────────

var EVM = Q.Crypto.OpenClaim.EVM = {};

EVM.hashTypedData = function (claim, callback) {
    var p = new Promise(function (resolve, reject) {
        try {
            var payload = _buildPayload(claim);
            var digest  = _hashTypedData(
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

// ── Inline EIP-712 digest ──────────────────────────────────────────────────────
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
