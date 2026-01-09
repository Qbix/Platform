/**
 * @module Db
 */

/**
 * The class representing a range of database values.
 * Semantics: a Range represents an OR-union of one or more ranges.
 *
 * @class Range
 * @constructor
 * @param {*} min
 * @param {boolean} includeMin
 * @param {boolean} includeMax
 * @param {*} max
 */
function Range(min, includeMin, includeMax, max) {
	this.min = min;
	this.includeMin = includeMin;
	this.includeMax = includeMax;

	if (max === true) {
		if (typeof min !== 'string') {
			throw new Error("Db.Range: min must be a string when max === true");
		}
		var lastChar = min.length ? min.charCodeAt(min.length - 1) : 32;
		max = min.substring(0, min.length - 1) + String.fromCharCode(lastChar + 1);
	}

	this.max = max;
	this.additionalRanges = [];
	this.typename = "Db.Range";
}

/**
 * Render a single range as SQL-ish text (debug / logging only)
 */
Range.prototype._renderOne = function () {
	var parts = [];

	if (this.min !== null && this.min !== undefined) {
		parts.push(
			(this.includeMin ? ">=" : ">") + " " + this.min
		);
	}
	if (this.max !== null && this.max !== undefined) {
		parts.push(
			(this.includeMax ? "<=" : "<") + " " + this.max
		);
	}

	return parts.length ? parts.join(" AND ") : "";
};

/**
 * Convert range (including unions) to string
 */
Range.prototype.toString = function () {
	var results = [];
	var base = this._renderOne();
	if (base) results.push(base);

	for (var i = 0; i < this.additionalRanges.length; ++i) {
		var r = this.additionalRanges[i]._renderOne();
		if (r) results.push(r);
	}

	return results.join(" OR ");
};

/**
 * Union multiple Range objects into one OR-composed range
 *
 * @static
 */
Range.union = function () {
	var ranges = Array.prototype.slice.call(arguments);
	if (!ranges.length) {
		throw new Error("Range.union requires at least one Range");
	}

	var base = null;

	for (var i = 0; i < ranges.length; ++i) {
		var r = ranges[i];
		if (!(r instanceof Range)) {
			throw new Error("Range.union arguments must be Range instances");
		}
		if (!base) {
			base = r;
		} else {
			base.additionalRanges.push(r);
		}
	}

	return base;
};

/**
 * Create a Range matching values starting with min..max (prefix semantics)
 *
 * @static
 */
Range.startingWith = function (min, max) {
	if (typeof min === 'number' && typeof max === 'number') {
		return new Range(
			Math.floor(min),
			true,
			false,
			Math.ceil(max)
		);
	}

	if (typeof min === 'string' && typeof max === 'string') {
		var len = max.length;
		var nextChar = String.fromCharCode(max.charCodeAt(len - 1) + 1);
		var maxNext = max.substring(0, len - 1) + nextChar;
		return new Range(min, true, false, maxNext);
	}

	throw new Error("Range.startingWith: min and max must both be numbers or strings");
};

/**
 * Unicode letter ranges (OR-union), equivalent to PHP unicode()
 *
 * NOTE: English-only by default.
 *
 * @static
 */
Range.unicode = function (lang) {
	lang = lang || 'en';
	if (lang !== 'en') {
		throw new Error("Range.unicode for non-English languages not implemented");
	}

	var upper = new Range('A', true, false, 'Z'.charCodeAt(0) + 1);
	upper.max = String.fromCharCode(upper.max);

	var lower = new Range('a', true, false, 'z'.charCodeAt(0) + 1);
	lower.max = String.fromCharCode(lower.max);

	return Range.union(upper, lower);
};

module.exports = Range;
