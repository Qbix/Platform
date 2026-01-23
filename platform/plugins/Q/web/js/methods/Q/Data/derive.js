Q.exports(function (Q) {

	/**
	 * Deterministically derives key material from a seed
	 * using HKDF with explicit domain separation.
	 *
	 * PURE FUNCTION:
	 * - no randomness
	 * - no storage
	 * - no side effects
	 *
	 * @module Q
	 * @class Q.Data
	 */

	/**
	 * @static
	 * @method derive
	 *
	 * @param {String|Uint8Array} seed
	 * @param {String} label
	 * @param {Object} [options]
	 * @param {Number} [options.size=32]
	 * @param {String} [options.context=""]
	 *
	 * @return {Q.Promise} Resolves Uint8Array
	 */
	return function Q_Data_derive(seed, label, options) {

		options = options || {};
		var size = options.size || 32;
		var context = options.context || "";

		var seedBytes;

		// ---------------------------------------------
		// Normalize seed
		// ---------------------------------------------

		if (seed instanceof Uint8Array) {
			seedBytes = seed;

		} else if (typeof seed === "string") {

			// Try hex first (more restrictive)
			if (/^[0-9a-fA-F]+$/.test(seed) && seed.length % 2 === 0) {
				seedBytes = Q.Data.fromHex(seed);
			} else {
				seedBytes = Q.Data.fromBase64(seed);
			}

		} else {
			return Q.reject(new Error("Invalid seed format"));
		}

		if (!label || typeof label !== "string") {
			return Q.reject(new Error("Missing or invalid label"));
		}

		// ---------------------------------------------
		// Derive salt from context (RFC 5869-safe)
		// ---------------------------------------------

		return Q.Data.digest("SHA-256", context).then(function (contextHashHex) {

			var salt = Q.Data.fromHex(contextHashHex);

			// -----------------------------------------
			// HKDF
			// -----------------------------------------

			return Q.Data.hkdf(
				seedBytes,   // IKM
				salt,        // salt = hash(context)
				label,       // info = label
				size
			);
		});
	};
});