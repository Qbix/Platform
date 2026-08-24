/**
 * @module Db
 */
var Q = require('Q');

/**
 * Represents a vector (embedding) value in a query.
 * Parallels Db_Vector in PHP, and is shaped like Db.Range: a dumb value
 * type that the adapters know how to render. It deliberately knows nothing
 * about how the embedding was produced -- generating embeddings is the AI
 * plugin's job, storing and searching them is Db's.
 *
 * @class Vector
 * @namespace Db
 * @constructor
 * @param {Array|Float32Array|Buffer} values The vector components
 * @param {String} [metric='cosine'] One of 'cosine', 'euclidean', 'dot'
 * @param {Object} [options]
 * @param {Boolean} [options.normalize=false] Scale to unit length on construction.
 *   Worth doing at write time when searching with cosine, so that cosine and
 *   dot product agree and the metric can be changed later without re-embedding.
 * @param {String} [options.model] Identifier of the model that produced this
 *   vector, e.g. "nomic-embed-text". Purely informational here, but callers
 *   should persist it next to the vector: comparing embeddings from two
 *   different models yields plausible-looking nonsense with no error at all.
 */
function Db_Vector(values, metric, options) {
	options = options || {};
	if (values instanceof Buffer) {
		values = Db_Vector.fromBinary(values).values;
	} else if (typeof Float32Array !== 'undefined' && values instanceof Float32Array) {
		values = Array.prototype.slice.call(values);
	} else if (typeof values === 'string') {
		// Two wire forms arrive here. pgvector hands back bracketed text;
		// MariaDB's VECTOR columns come back through the mysql driver as a
		// binary STRING (not a Buffer), so packed float32 has to be handled
		// too or every retrieved row throws on JSON.parse.
		var trimmed = values.replace(/^\s+/, '');
		if (trimmed.charAt(0) === '[') {
			values = JSON.parse(trimmed);
		} else if (values.length % 4 === 0 && values.length) {
			values = Db_Vector.fromBinary(Buffer.from(values, 'latin1')).values;
		} else {
			throw new Q.Exception(
				"Db.Vector: could not parse a vector from a "
				+ values.length + "-byte string"
			);
		}
	}
	if (!Q.isArrayLike(values)) {
		throw new Q.Exception("Db.Vector: values must be an array of numbers");
	}
	var i, l = values.length;
	if (!l) {
		throw new Q.Exception("Db.Vector: cannot construct an empty vector");
	}
	var floats = new Array(l);
	for (i=0; i<l; ++i) {
		var v = Number(values[i]);
		if (!isFinite(v)) {
			throw new Q.Exception(
				"Db.Vector: component " + i + " is not a finite number"
			);
		}
		floats[i] = v;
	}

	metric = (metric || 'cosine').toLowerCase();
	if (Db_Vector.metrics.indexOf(metric) < 0) {
		throw new Q.Exception(
			"Db.Vector: unsupported metric '" + metric + "', expected one of "
			+ Db_Vector.metrics.join(', ')
		);
	}

	this.typename = 'Db.Vector';
	this.metric = metric;
	this.model = options.model || null;
	this.values = options.normalize ? Db_Vector.normalize(floats) : floats;
}

Db_Vector.metrics = ['cosine', 'euclidean', 'dot'];

/**
 * Number of components in the vector.
 * @method dimensions
 * @return {Number}
 */
Db_Vector.prototype.dimensions = function () {
	return this.values.length;
};

/**
 * Renders as a bracketed list: "[0.1,0.2,0.3]".
 * This is the text form MariaDB's VEC_FromText() and pgvector's ::vector
 * cast both accept, so adapters can build on it.
 * @method toText
 * @return {String}
 */
Db_Vector.prototype.toText = function () {
	return '[' + this.values.join(',') + ']';
};

/**
 * Renders as packed little-endian float32 bytes, which is what
 * sqlite-vec and MariaDB's binary vector form both expect.
 * Named to match Db_Vector::toBinary() in PHP; toBuffer is an alias, since
 * a Buffer is what actually comes back in Node.
 * @method toBinary
 * @return {Buffer}
 */
Db_Vector.prototype.toBinary = function () {
	return Buffer.from(new Float32Array(this.values).buffer);
};

Db_Vector.prototype.toString = function () {
	return this.toText();
};

/**
 * Reconstructs a vector from packed little-endian float32 bytes.
 * @method fromBinary
 * @static
 * @param {Buffer} buffer
 * @param {String} [metric]
 * @return {Db.Vector}
 */
Db_Vector.fromBinary = function (buffer, metric) {
	if (!(buffer instanceof Buffer)) {
		throw new Q.Exception("Db.Vector.fromBinary: expected a Buffer");
	}
	if (buffer.length % 4 !== 0) {
		throw new Q.Exception(
			"Db.Vector.fromBinary: length " + buffer.length + " is not a multiple of 4"
		);
	}
	var floats = new Float32Array(
		buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length)
	);
	return new Db_Vector(Array.prototype.slice.call(floats), metric);
};

/**
 * Scales a plain array of numbers to unit length.
 * A zero vector is returned unchanged rather than producing NaNs.
 * @method normalize
 * @static
 * @param {Array} floats
 * @return {Array}
 */
Db_Vector.normalize = function (floats) {
	var i, l = floats.length, sum = 0;
	for (i=0; i<l; ++i) {
		sum += floats[i] * floats[i];
	}
	var norm = Math.sqrt(sum);
	if (!norm) {
		return floats.slice(0);
	}
	var out = new Array(l);
	for (i=0; i<l; ++i) {
		out[i] = floats[i] / norm;
	}
	return out;
};

// Aliases: PHP names are canonical for cross-language parity, but a Buffer is
// the natural Node vocabulary, so both spellings work.
Db_Vector.prototype.toBuffer = Db_Vector.prototype.toBinary;
Db_Vector.fromBuffer = Db_Vector.fromBinary;

module.exports = Db_Vector;
