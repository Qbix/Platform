Q.exports(function (Q) {
	/**
	 * Produces a canonical JSON string per RFC 8785 / JCS
	 * (JSON Canonicalization Scheme).
	 *
	 * Inlines the full algorithm from RFC 8785 Appendix A — no external
	 * dependency. JSON.stringify already implements the ECMAScript
	 * number-to-string algorithm (Section 7.1.12.1 of ECMA-262) that
	 * RFC 8785 requires, so numbers are handled correctly:
	 *   1e30 → "1e+30",  4.5 → "4.5",  2e-3 → "0.002"
	 *
	 * Rules (RFC 8785):
	 *   - Object properties sorted recursively in UTF-16 code unit order.
	 *   - Array element order preserved; arrays scanned recursively for objects.
	 *   - Primitives (string, number, bool, null) serialized via JSON.stringify.
	 *   - undefined and symbol values/elements omitted (per JSON.stringify).
	 *   - NaN and Infinity throw — not valid in I-JSON (RFC 8259 / RFC 7493).
	 *   - Objects with a toJSON method are serialized via JSON.stringify.
	 *
	 * Used by Q.Crypto.OpenClaim.canonicalize, which additionally strips
	 * the sig field before calling this method.
	 *
	 * Byte-identical to PHP Q_Data::canonicalize().
	 *
	 * @module Q
	 * @class Q.Data
	 */

	/**
	 * @static
	 * @method canonicalize
	 * @param {Object|Array} object  The value to canonicalize.
	 * @return {String}  Canonical UTF-8 JSON string.
	 * @throws {Error} If the object contains NaN or Infinity.
	 */
	return function Q_Data_canonicalize(object) {
		var buffer = '';
		serialize(object);
		return buffer;

		function serialize(object) {
			if (object === null || typeof object !== 'object' ||
				object.toJSON instanceof Function) {
				// Primitive, null, or toJSON — delegate to JSON.stringify.
				// JSON.stringify implements the ECMAScript number serialization
				// algorithm (ECMA-262 §7.1.12.1) that RFC 8785 §3.2.2.3 requires.
				if (typeof object === 'number') {
					if (isNaN(object)) {
						throw new Error('Q.Data.canonicalize: NaN is not valid in RFC 8785 / I-JSON');
					}
					if (!isFinite(object)) {
						throw new Error('Q.Data.canonicalize: Infinity is not valid in RFC 8785 / I-JSON');
					}
				}
				buffer += JSON.stringify(object);

			} else if (Array.isArray(object)) {
				// Array — preserve element order; recurse into each element.
				// undefined and symbol become null (per JSON.stringify / RFC 8259).
				buffer += '[';
				var firstArr = true;
				object.forEach(function (element) {
					if (!firstArr) { buffer += ','; }
					firstArr = false;
					serialize(element === undefined || typeof element === 'symbol'
						? null : element);
				});
				buffer += ']';

			} else {
				// Object — sort properties in UTF-16 code unit order, then recurse.
				// undefined and symbol values are omitted (per JSON.stringify).
				buffer += '{';
				var firstObj = true;
				Object.keys(object).sort().forEach(function (key) {
					var value = object[key];
					if (value === undefined || typeof value === 'symbol') {
						return;
					}
					if (!firstObj) { buffer += ','; }
					firstObj = false;
					buffer += JSON.stringify(key);
					buffer += ':';
					serialize(value);
				});
				buffer += '}';
			}
		}
	};

});