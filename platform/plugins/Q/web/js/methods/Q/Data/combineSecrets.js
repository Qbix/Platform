Q.exports(function (Q) {

	/**
	 * Combines server material (M) and side-channel secret (N)
	 * into deterministic key material.
	 *
	 * @module Q
	 * @class Q.Data
	 */

	/**
	 * @static
	 * @method combineSecrets
	 * @param {String} mBase64 Server-provided entropy (base64)
	 * @param {String} nAlpha Lowercase alphabetic side-channel secret
	 * @param {String} [context="khcd-v1"]
	 * @return {Q.Promise} Resolves Uint8Array (32 bytes)
	 */
	return function Q_Data_combineSecrets(mBase64, nAlpha, context) {
		context = context || "khcd-v1";

		var m = Q.Data.fromBase64(mBase64);
		var n = new TextEncoder().encode(nAlpha);

		return Q.Data.digest("SHA-256", nAlpha).then(function (nHashHex) {
			var salt = new Uint8Array(
				nHashHex.match(/.{2}/g).map(function (h) {
					return parseInt(h, 16);
				})
			);
			return Q.Data.hkdf(m, salt, context, 32);
		});
	};
});
