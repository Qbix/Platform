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
	 * @param {String} ivBase64 Base64-encoded IV (12 bytes)
	 * @param {String} ciphertextBase64 Base64-encoded ciphertext + tag
	 * @param {Object} [options]
	 * @param {Uint8Array} [options.additional] Additional authenticated data (AAD).
	 *   Must match exactly what was passed to encrypt(), otherwise decryption fails.
	 * @param {String} [options.tag] Base64-encoded authentication tag (16 bytes).
	 *   If provided, the tag is appended to ciphertext before decryption,
	 *   matching the WebCrypto AES-GCM expectation of ciphertext || tag.
	 *   If omitted, ciphertextBase64 is assumed to already include the tag.
	 * @return {Q.Promise} Resolves Uint8Array plaintext
	 */
	return function Q_Data_decrypt(key, ivBase64, ciphertextBase64, options) {
		options = options || {};

		var iv         = Q.Data.fromBase64(ivBase64);
		var ciphertext = Q.Data.fromBase64(ciphertextBase64);

		// If a separate tag is provided, concatenate ciphertext || tag
		// to match the WebCrypto AES-GCM wire format
		if (options.tag) {
			var tag     = Q.Data.fromBase64(options.tag);
			var combined = new Uint8Array(ciphertext.length + tag.length);
			combined.set(ciphertext, 0);
			combined.set(tag, ciphertext.length);
			ciphertext = combined;
		}

		var params = {
			name: 'AES-GCM',
			iv:   iv
		};
		if (options.additional) {
			params.additionalData = options.additional;
		}

		return crypto.subtle.decrypt(params, key, ciphertext)
			.then(function (plaintext) {
				return new Uint8Array(plaintext);
			});
	};

});
