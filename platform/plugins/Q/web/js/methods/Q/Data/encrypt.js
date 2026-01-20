Q.exports(function (Q) {

	/**
	 * Encrypts plaintext using AES-256-GCM.
	 *
	 * @module Q
	 * @class Q.Data
	 */

	/**
	 * @static
	 * @method encrypt
	 * @param {CryptoKey} key AES-GCM key
	 * @param {Uint8Array} plaintext
	 * @param {Uint8Array} [aad]
	 * @return {Q.Promise} Resolves { iv, ciphertext }
	 */
	return function Q_Data_encrypt(key, plaintext, aad) {
		var iv = crypto.getRandomValues(new Uint8Array(12));

		return crypto.subtle.encrypt(
			{
				name: "AES-GCM",
				iv: iv,
				additionalData: aad
			},
			key,
			plaintext
		).then(function (ciphertext) {
			return {
				iv: Q.Data.toBase64(iv),
				ciphertext: Q.Data.toBase64(ciphertext)
			};
		});
	};
});
