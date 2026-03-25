Q.exports(function (Q) {

	/**
	 * Produce the canonical JSON string for an OpenClaim.
	 *
	 * Strips the sig field, then delegates to Q.Data.canonicalize,
	 * which implements RFC 8785 / JCS inline — no external dependency.
	 *
	 * Rules (RFC 8785):
	 *   - sig field always stripped before canonicalizing.
	 *   - Object keys sorted recursively in UTF-16 code unit order.
	 *   - Numbers serialized per ECMAScript (JSON.stringify algorithm).
	 *   - Array element order preserved.
	 *   - NaN and Infinity throw.
	 *
	 * Byte-identical to PHP Q_Data::canonicalize() (after sig is stripped).
	 *
	 * @static
	 * @method canonicalize
	 * @param  {Object} claim  OCP claim object (sig field is stripped)
	 * @return {Q.Promise<String>}  Canonical JSON string
	 */
	return function Q_Crypto_OpenClaim_canonicalize(claim) {
		var obj = Object.assign({}, claim);
		delete obj.sig;
		return Q.Promise.resolve(Q.Data.canonicalize(obj));
	};

});
