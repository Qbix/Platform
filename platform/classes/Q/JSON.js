/**
 * Deterministic JSON utilities
 * This file implements canonical JSON used for things like:
 * - Safebox workflow hashing
 * - warrant signing
 * - action verification
 * - stream message integrity
 *
 * @module Q
 * @class Q.JSON
 * @static
 */

const crypto = require('crypto');

/**
 * JSON encode exception
 * @class Q.Exception.JsonEncode
 * @constructor
 * @param {Object} info
 * @param {Number} code
 */
class JsonEncodeException extends Error {
	constructor(info, _, code) {
		super(info && info.message || "JSON encode error");
		this.info = info;
		this.code = code;
	}
}

/**
 * JSON decode exception
 * @class Q.Exception.JsonDecode
 * @constructor
 * @param {Object} info
 * @param {Number} code
 */
class JsonDecodeException extends Error {
	constructor(info, _, code) {
		super(info && info.message || "JSON decode error");
		this.info = info;
		this.code = code;
	}
}

const Q_JSON = {};

/**
 * Exception namespace compatibility
 */
Q_JSON.Exception = {
	JsonEncode: JsonEncodeException,
	JsonDecode: JsonDecodeException
};

/**
 * Convert sequential arrays to objects during encoding
 *
 * @property JSON_FORCE_OBJECT
 * @type Number
 */
Q_JSON.JSON_FORCE_OBJECT = 1 << 0;

/**
 * Pretty print JSON using tabs instead of spaces
 *
 * @property JSON_PRETTY_TABS
 * @type Number
 */
Q_JSON.JSON_PRETTY_TABS = 1 << 1;

/**
 * Clean problematic characters before decoding
 *
 * @property JSON_DECODE_CLEAN
 * @type Number
 */
Q_JSON.JSON_DECODE_CLEAN = 1 << 2;

/**
 * Normalize UTF-8 strings (keys and values)
 *
 * @method utf8ize
 * @static
 * @param {Mixed} v value to normalize
 * @return {Mixed} normalized value
 */
Q_JSON.utf8ize = function utf8ize(v)
{
	if (v === null || v === undefined) {
		return v;
	}

	if (Array.isArray(v)) {
		return v.map(Q_JSON.utf8ize);
	}

	if (typeof v === 'object') {

		const o = {};

		for (const k in v) {

			const nk = (typeof k === 'string')
				? k.normalize('NFC')
				: k;

			o[nk] = Q_JSON.utf8ize(v[k]);
		}

		return o;
	}

	if (typeof v === 'string') {
		return v.normalize('NFC');
	}

	return v;
};

/**
 * Replace placeholder tokens with actual characters
 *
 * @method decodeProblematicChars
 * @static
 * @param {Mixed} data
 * @return {Mixed} decoded value
 */
Q_JSON.decodeProblematicChars = function decodeProblematicChars(data)
{
	if (typeof data === 'string') {
		return data
			.replace(/@@NEWLINE@@/g, "\n")
			.replace(/@@CARRIAGERETURN@@/g, "\r")
			.replace(/@@NULL@@/g, "\0")
			.replace(/@@CONTROL@@/g, "\x1F");
	}

	if (Array.isArray(data)) {
		return data.map(Q_JSON.decodeProblematicChars);
	}

	if (data && typeof data === 'object') {
		for (const k in data) {
			data[k] = Q_JSON.decodeProblematicChars(data[k]);
		}
	}

	return data;
};

/**
 * Check if last character in a buffer is not escaped
 *
 * @method notEscaped
 * @static
 * @param {String} buffer
 * @return {Boolean} true if not escaped
 */
Q_JSON.notEscaped = function notEscaped(buffer)
{
	let slashes = 0;

	for (let i = buffer.length - 1; i >= 0 && buffer[i] === '\\'; i--) {
		slashes++;
	}

	return slashes % 2 === 0;
};

/**
 * Convert nested objects safely
 *
 * @method toArrays
 * @static
 * @param {Mixed} v
 * @param {Number} depth
 * @param {Number} maxDepth
 * @return {Mixed}
 */
Q_JSON.toArrays = function toArrays(v, depth, maxDepth)
{
	if (depth > maxDepth) {
		throw new Error("Q.JSON depth exceeded");
	}

	if (Array.isArray(v)) {
		return v.map(x => Q_JSON.toArrays(x, depth + 1, maxDepth));
	}

	if (v && typeof v === 'object') {

		const o = {};

		for (const k in v) {
			o[k] = Q_JSON.toArrays(v[k], depth + 1, maxDepth);
		}

		return o;
	}

	return v;
};

/**
 * Produce canonical deterministic JSON structure
 *
 * @method canonical
 * @static
 * @param {Mixed} v
 * @return {Mixed} canonical value
 * @throws Error if undefined encountered
 */
Q_JSON.canonical = function canonical(v)
{
	if (v === undefined) {
		throw new Error("Q.JSON: undefined not allowed in canonical JSON");
	}

	if (v === null) {
		return null;
	}

	if (Array.isArray(v)) {
		return v.map(Q_JSON.canonical);
	}

    if (v && typeof v === 'object' && v.constructor !== Object && !Array.isArray(v)) {
        throw new Error("Q.JSON: unsupported object type in canonical JSON");
    }

	if (typeof v === 'object') {

		const keys = Object.keys(v)
			.map(k => k.normalize('NFC'))
			.sort();

		const o = {};

		for (const k of keys) {
			o[k] = Q_JSON.canonical(v[k]);
		}

		return o;
	}

	if (typeof v === 'string') {
		return v.normalize('NFC');
	}

	return v;
};

/**
 * Deterministic JSON stringify
 *
 * @method stringify
 * @static
 * @param {Object} obj
 * @return {String} JSON string
 */
Q_JSON.stringify = function stringify(obj)
{
	return JSON.stringify(Q_JSON.canonical(obj));
};

/**
 * Deterministic JSON parse
 *
 * @method parse
 * @static
 * @param {String} str JSON string
 * @return {Object} parsed object
 */
Q_JSON.parse = function parse(str)
{
	const obj = JSON.parse(str);
	return Q_JSON.utf8ize(obj);
};

/**
 * Deterministic SHA256 hash of canonical JSON
 *
 * @method hash
 * @static
 * @param {Object} obj
 * @return {String} hex hash
 */
Q_JSON.hash = function hash(obj)
{
	return crypto
		.createHash('sha256')
		.update(Q_JSON.stringify(obj))
		.digest('hex');
};

/**
 * Deterministic CID (Content Identifier) of canonical JSON
 *
 * Uses:
 *   CIDv1
 *   codec: dag-json (0x0129)
 *   hash: sha2-256
 *
 * @method cid
 * @static
 * @param {Object} obj
 * @return {String}
 */
Q_JSON.cid = function cid(obj)
{
	const canonical = Q_JSON.stringify(obj);

	return Q.Utils.cid(
		canonical,
		Buffer.from([0x01, 0x29]) // dag-json
	);
};

/**
 * Encode JSON safely
 *
 * @method encode
 * @static
 * @param {Mixed} value value to encode
 * @param {Number} [options=0] encoding options
 * @param {Number} [depth=512] recursion depth
 * @return {String} encoded JSON
 * @throws Q.Exception.JsonEncode
 */
Q_JSON.encode = function encode(value, options = 0, depth = 512)
{
	let argsValue = value;

	if (options & Q_JSON.JSON_FORCE_OBJECT) {

		if (Array.isArray(value)) {

			const o = {};

			for (let i = 0; i < value.length; i++) {
				o[i] = value[i];
			}

			argsValue = o;
		}

		options &= ~Q_JSON.JSON_FORCE_OBJECT;
	}

	argsValue = Q_JSON.utf8ize(argsValue);
	argsValue = Q_JSON.toArrays(argsValue, 0, depth);

	let result;

	try {

		result = JSON.stringify(
			argsValue,
			null,
			(options & Q_JSON.JSON_PRETTY_TABS) ? 4 : 0
		);

	} catch (e) {

		throw new Q_JSON.Exception.JsonEncode({
			message: e.message,
			value: value
		});
	}

	if (options & Q_JSON.JSON_PRETTY_TABS) {

		result = result.replace(/^(?: {4})+/gm, function(m) {
			return "\t".repeat(m.length / 4);
		});
	}

	return result.replace(/\\\//g, '/');
};

/**
 * Decode JSON safely
 *
 * @method decode
 * @static
 * @param {String} json JSON string
 * @param {Boolean} [assoc=false]
 * @param {Number} [depth=512]
 * @param {Number} [options=0]
 * @return {Mixed} decoded value
 * @throws Q.Exception.JsonDecode
 */
Q_JSON.decode = function decode(json, assoc = false, depth = 512, options = 0)
{
	if (!json) {
		return json;
	}

	if (options & Q_JSON.JSON_DECODE_CLEAN) {

		json = Q_JSON.utf8ize(json);

		json = json
			.replace(/\n/g, "@@NEWLINE@@")
			.replace(/\r/g, "@@CARRIAGERETURN@@")
			.replace(/\0/g, "@@NULL@@")
			.replace(/\x1F/g, "@@CONTROL@@");
	}

	let result;

	try {

		result = JSON.parse(json);

	} catch (e) {

		throw new Q_JSON.Exception.JsonDecode({
			message: e.message,
			json: json
		});
	}

	if (!assoc && result && typeof result === 'object') {
		result = JSON.parse(JSON.stringify(result));
	}

	if (options & Q_JSON.JSON_DECODE_CLEAN) {
		result = Q_JSON.decodeProblematicChars(result);
	}

	return result;
};

function base32Encode(buf)
{
	const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
	let bits = 0;
	let value = 0;
	let output = "";

	for (let i = 0; i < buf.length; i++) {

		value = (value << 8) | buf[i];
		bits += 8;

		while (bits >= 5) {

			output += alphabet[(value >>> (bits - 5)) & 31];
			bits -= 5;

		}
	}

	if (bits > 0) {
		output += alphabet[(value << (5 - bits)) & 31];
	}

	return "b" + output;
}

module.exports = Q_JSON;