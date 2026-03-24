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
	 * Seed must be binary — pass Uint8Array, ArrayBuffer, or a raw
	 * binary-compatible type handled by Q.Data.toUint8Array().
	 * If you have a hex or base64 string, decode it first with
	 * Q.Data.fromHex() or Q.Data.fromBase64() before calling derive().
	 *
	 * @module Q
	 * @class Q.Data
	 */

	/**
	 * @static
	 * @method derive
	 *
	 * @param {Uint8Array|ArrayBuffer} seed
	 *   Raw binary seed material. Must be a typed binary type —
	 *   not a string. Decode hex/base64 strings before calling.
	 * @param {String} label
	 *   Domain separation label (used as HKDF info). Must be non-empty UTF-8.
	 * @param {Object} [options]
	 * @param {Number} [options.size=32]  Output length in bytes.
	 * @param {String} [options.context=""] Context string used to derive salt
	 *   via SHA-256(context). Empty string is valid and produces a fixed salt.
	 *
	 * @return {Q.Promise<Uint8Array>} Resolves derived key material.
	 */
	return function Q_Data_derive(seed, label, options) {

		options = options || {};
		var size    = options.size    || 32;
		var context = options.context || "";

		// ---------------------------------------------
		// Normalize seed — strict binary types only
		// ---------------------------------------------
		var seedBytes;
		try {
			seedBytes = Q.Data.toUint8Array(seed);
		} catch (e) {
			return Q.reject(new Error(
				"derive: seed must be a binary type (Uint8Array, ArrayBuffer). " +
				"Decode hex or base64 strings before calling derive(). " +
				"Original error: " + e.message
			));
		}

		if (!label || typeof label !== "string") {
			return Q.reject(new Error("derive: label must be a non-empty string"));
		}

		// ---------------------------------------------
		// salt = SHA-256(context)
		// ---------------------------------------------
		var contextBytes = new TextEncoder().encode(context);

		return Q.Data.digest("SHA-256", contextBytes)
		.then(function (salt) {
			return Q.Data.hkdf(
				seedBytes,  // IKM
				salt,       // salt = SHA-256(context)
				label,      // info = label
				size
			);
		});
	};
});