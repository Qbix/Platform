Q.exports(function (Q) {

	/**
	 * Decrypts AES-256-GCM ciphertext.
	 *
	 * @module Q
	 * @class Q.Data
	 */

	/**
	 * @static
	 * @method decrypt
	 * @param {CryptoKey} key AES-GCM key
	 * @param {String} ivBase64
	 * @param {String} ciphertextBase64
	 * @param {Uint8Array} [aad]
	 * @return {Q.Promise} Resolves Uint8Array plaintext
	 */
	return function Q_Data_decrypt(key, ivBase64, ciphertextBase64, aad) {
		return crypto.subtle.decrypt(
			{
				name: "AES-GCM",
				iv: Q.Data.fromBase64(ivBase64),
				additionalData: aad
			},
			key,
			Q.Data.fromBase64(ciphertextBase64)
		).then(function (plaintext) {
			return new Uint8Array(plaintext);
		});
	};
});
