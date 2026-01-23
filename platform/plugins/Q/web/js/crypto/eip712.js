// eip712.js
// Canonical EIP-712 encoder + hasher (spec-correct, hardened)
// Depends ONLY on keccak_256 from sha3.js

import { keccak_256 } from './sha3.js';

const te = new TextEncoder();

/* ---------------- helpers ---------------- */

const hexToBytes = (hex) => {
	hex = String(hex).replace(/^0x/, '');
	if (hex.length === 0) return new Uint8Array();
	if (hex.length % 2) throw new Error('invalid hex');
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) {
		out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return out;
};

const toBytes = (v) => {
	if (v instanceof Uint8Array) return v;
	if (typeof v === 'string') return hexToBytes(v);
	throw new Error('Expected bytes');
};

const concat = (...arrays) => {
	let len = 0;
	for (const a of arrays) len += a.length;
	const out = new Uint8Array(len);
	let pos = 0;
	for (const a of arrays) {
		out.set(a, pos);
		pos += a.length;
	}
	return out;
};

const padLeft32 = (b) => {
	if (b.length > 32) throw new Error('value exceeds 32 bytes');
	const out = new Uint8Array(32);
	out.set(b, 32 - b.length);
	return out;
};

const padRight32 = (b) => {
	if (b.length > 32) throw new Error('value exceeds 32 bytes');
	const out = new Uint8Array(32);
	out.set(b);
	return out;
};

// Accept bigint | number | decimal string | hex string | ethers BigNumber
function toBigInt(v) {
	if (typeof v === 'bigint') return v;
	if (typeof v === 'number') return BigInt(v);
	if (typeof v === 'string') return BigInt(v);
	if (v && typeof v === 'object') {
		if (typeof v.toBigInt === 'function') return v.toBigInt();
		if (typeof v.toString === 'function') return BigInt(v.toString());
	}
	throw new Error('Invalid numeric value');
}

/* ---------------- dependency resolution ---------------- */

function findDeps(type, types, out = new Set()) {
	if (out.has(type)) return;
	out.add(type);
	for (const f of types[type] || []) {
		const t = f.type.replace(/\[.*\]$/, '');
		if (types[t]) findDeps(t, types, out);
	}
}

function encodeType(primary, types) {
	if (!types[primary]) throw new Error(`Unknown type ${primary}`);

	const deps = new Set();
	findDeps(primary, types, deps);
	deps.delete(primary);

	return [primary, ...[...deps].sort()]
		.map(t => `${t}(${types[t].map(f => `${f.type} ${f.name}`).join(',')})`)
		.join('');
}

function typeHash(primary, types) {
	return keccak_256(te.encode(encodeType(primary, types)));
}

/* ---------------- value encoding ---------------- */

function encodeValue(type, value, types) {
	if (value === undefined || value === null) value = 0;

	// Arrays
	if (type.endsWith('[]')) {
		if (!Array.isArray(value)) throw new Error(`${type} expects array`);
		const base = type.slice(0, -2);
		const items = value.map(v => encodeValue(base, v, types));
		return keccak_256(items.length ? concat(...items) : new Uint8Array());
	}

	// Struct
	if (types[type]) {
		if (typeof value !== 'object') throw new Error(`${type} expects object`);
		return keccak_256(encodeData(type, value, types));
	}

	// string
	if (type === 'string') {
		return keccak_256(te.encode(String(value)));
	}

	// bytes (dynamic)
	if (type === 'bytes') {
		const b = toBytes(value);
		return keccak_256(b);
	}

	// bool
	if (type === 'bool') {
		return padLeft32(Uint8Array.of(value ? 1 : 0));
	}

	// address (20 bytes)
	if (type === 'address') {
		const b = toBytes(value);
		if (b.length !== 20) throw new Error('Invalid address length');
		return padLeft32(b);
	}

	// bytes<N>
	const bytesMatch = type.match(/^bytes([1-9]|[12][0-9]|3[01])$/);
	if (bytesMatch) {
		const n = parseInt(bytesMatch[1], 10);
		const b = toBytes(value);
		if (b.length !== n) throw new Error(`Invalid ${type} length`);
		return padRight32(b);
	}

	// uint<N>
	const uintMatch = type.match(/^uint(\d{0,3})$/);
	if (uintMatch) {
		const bits = uintMatch[1] ? parseInt(uintMatch[1], 10) : 256;
		if (bits === 0 || bits > 256 || bits % 8 !== 0) {
			throw new Error(`Invalid ${type}`);
		}
		const v = toBigInt(value);
		const max = 1n << BigInt(bits);
		if (v < 0n || v >= max) throw new Error(`${type} overflow`);
		return padLeft32(hexToBytes(v.toString(16)));
	}

	// int<N>
	const intMatch = type.match(/^int(\d{0,3})$/);
	if (intMatch) {
		const bits = intMatch[1] ? parseInt(intMatch[1], 10) : 256;
		if (bits === 0 || bits > 256 || bits % 8 !== 0) {
			throw new Error(`Invalid ${type}`);
		}
		const v = toBigInt(value);
		const min = -(1n << BigInt(bits - 1));
		const max = (1n << BigInt(bits - 1)) - 1n;
		if (v < min || v > max) throw new Error(`${type} overflow`);
		const enc = v < 0n ? (1n << 256n) + v : v;
		return padLeft32(hexToBytes(enc.toString(16)));
	}

	throw new Error(`Unsupported type ${type}`);
}

function encodeData(primary, data, types) {
	let enc = typeHash(primary, types);
	for (const f of types[primary]) {
		enc = concat(enc, encodeValue(f.type, data[f.name], types));
	}
	return enc;
}

/* ---------------- public API ---------------- */

export function hashTypedData(domain, primaryType, message, types) {
	if (!types || typeof types !== 'object') {
		throw new Error('types required');
	}
	if (!types.EIP712Domain) {
		throw new Error('EIP712Domain type missing');
	}
	if (!primaryType || primaryType === 'EIP712Domain') {
		throw new Error('Invalid primaryType');
	}
	if (!types[primaryType]) {
		throw new Error(`Unknown primaryType ${primaryType}`);
	}

	const domainHash = keccak_256(
		encodeData('EIP712Domain', domain || {}, types)
	);
	const messageHash = keccak_256(
		encodeData(primaryType, message || {}, types)
	);

	return keccak_256(
		concat(
			Uint8Array.of(0x19, 0x01),
			domainHash,
			messageHash
		)
	);
}
