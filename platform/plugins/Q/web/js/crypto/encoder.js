// js/crypto/encoder.js
// Strict ECDSA-P256 DER encoder/decoder (protocol-grade)
// Canonical, minimal, hostile to malformed input

import { p256 } from './nist.js';

const CURVE_N = p256.CURVE.n;

/* ============================================================
 * Helpers
 * ========================================================== */

function assert(cond, msg) {
	if (!cond) throw new Error(msg);
}

function isUint8Array(v) {
	return v instanceof Uint8Array;
}

function bytesToBigInt(bytes) {
	let n = 0n;
	for (const b of bytes) {
		n = (n << 8n) | BigInt(b);
	}
	return n;
}

/**
 * Normalize an unsigned big-endian integer for DER:
 * - strip unnecessary leading zeros
 * - prepend 0x00 if MSB would indicate negative
 */
function normalizeUnsigned(bytes) {
	assert(isUint8Array(bytes), 'INTEGER must be Uint8Array');
	assert(bytes.length > 0, 'INTEGER empty');

	// Strip leading zeros
	let i = 0;
	while (i < bytes.length - 1 && bytes[i] === 0x00) i++;
	let out = bytes.slice(i);

	// If MSB set, prepend 0x00 to keep it unsigned
	if (out[0] & 0x80) {
		out = new Uint8Array([0x00, ...out]);
	}

	assert(out.length < 128, 'INTEGER too long');
	return out;
}

function encodeDerLength(len) {
	assert(len < 128, 'DER long-form lengths not allowed');
	return Uint8Array.of(len);
}

/* ============================================================
 * Integer encoding (canonical)
 * ========================================================== */

function encodeDerInt(bytes) {
	const body = normalizeUnsigned(bytes);

	return new Uint8Array([
		0x02,
		body.length,
		...body
	]);
}

function decodeDerInt(buf, offset) {
	assert(buf[offset] === 0x02, 'Expected INTEGER');
	const len = buf[offset + 1];
	assert(len > 0, 'INTEGER length zero');
	assert(len < 128, 'INTEGER long-form not allowed');

	const start = offset + 2;
	const end = start + len;
	assert(end <= buf.length, 'INTEGER overruns buffer');

	const bytes = buf.slice(start, end);

	// Must be unsigned and minimally encoded
	if (bytes.length > 1) {
		assert(
			!(bytes[0] === 0x00 && (bytes[1] & 0x80) === 0),
			'INTEGER has unnecessary leading zero'
		);
	}
	assert((bytes[0] & 0x80) === 0, 'INTEGER must be unsigned');

	return { bytes, next: end };
}

/* ============================================================
 * Public API
 * ========================================================== */

/**
 * Encode ECDSA signature (r,s) into strict DER.
 *
 * - P-256 only
 * - r,s must be 1 <= value < curve.n
 * - s must already be low-S
 */
export function encodeEcdsaDer(rBytes, sBytes) {
	assert(isUint8Array(rBytes), 'r must be Uint8Array');
	assert(isUint8Array(sBytes), 's must be Uint8Array');

	const r = bytesToBigInt(rBytes);
	const s = bytesToBigInt(sBytes);

	assert(r > 0n && r < CURVE_N, 'r out of range');
	assert(s > 0n && s < CURVE_N, 's out of range');
	assert(s <= CURVE_N / 2n, 'High-S signature not allowed');

	const rEnc = encodeDerInt(rBytes);
	const sEnc = encodeDerInt(sBytes);

	const len = rEnc.length + sEnc.length;
	assert(len < 128, 'SEQUENCE too long');

	return new Uint8Array([
		0x30,
		len,
		...rEnc,
		...sEnc
	]);
}

/**
 * Decode strict DER ECDSA signature into { r, s }.
 *
 * Rejects:
 * - non-minimal integers
 * - signed integers
 * - high-S
 * - invalid lengths
 */
export function decodeEcdsaDer(der) {
	assert(isUint8Array(der), 'DER must be Uint8Array');
	assert(der.length >= 8, 'DER too short');
	assert(der[0] === 0x30, 'Expected SEQUENCE');

	const seqLen = der[1];
	assert(seqLen === der.length - 2, 'Invalid SEQUENCE length');

	let offset = 2;

	const rPart = decodeDerInt(der, offset);
	offset = rPart.next;

	const sPart = decodeDerInt(der, offset);
	offset = sPart.next;

	assert(offset === der.length, 'Trailing bytes not allowed');

	const r = bytesToBigInt(rPart.bytes);
	const s = bytesToBigInt(sPart.bytes);

	assert(r > 0n && r < CURVE_N, 'r out of range');
	assert(s > 0n && s < CURVE_N, 's out of range');
	assert(s <= CURVE_N / 2n, 'High-S signature not allowed');

	return {
		r: rPart.bytes,
		s: sPart.bytes
	};
}
