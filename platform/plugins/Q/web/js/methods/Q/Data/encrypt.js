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
	 * @param {Object} [options]
	 * @param {Uint8Array|String} [options.iv] Optional IV (12 bytes).
	 *   If omitted, a random IV is generated via crypto.getRandomValues.
	 *   Pass a derived IV (e.g. from Q.Data.derive) for deterministic /
	 *   convergent encryption, such as Safecloud chunk encryption where
	 *   the same content should always produce the same ciphertext and CID.
	 *   WARNING: never reuse the same (key, iv) pair for different plaintexts.
	 * @param {Uint8Array} [options.additional] Additional authenticated data (AAD).
	 *   Authenticated but not encrypted. Pass e.g. a chunk index or stream ID
	 *   to bind the ciphertext to its position and prevent reordering attacks.
	 * @return {Q.Promise} Resolves { iv: String, ciphertext: String, tag: String }
	 *   All values are base64-encoded.
	 */
	return function Q_Data_encrypt(key, plaintext, options) {
		options = options || {};

		var iv;
		if (options.iv) {
			iv = (typeof options.iv === 'string')
				? Q.Data.fromBase64(options.iv)
				: Q.Data.toUint8Array(options.iv);
		} else {
			iv = crypto.getRandomValues(new Uint8Array(12));
		}

		var params = {
			name: 'AES-GCM',
			iv:   iv
		};
		if (options.additional) {
			params.additionalData = options.additional;
		}

		return crypto.subtle.encrypt(params, key, plaintext)
			.then(function (ciphertext) {
				var ct  = new Uint8Array(ciphertext);
				var tag = ct.slice(ct.length - 16);
				var data = ct.slice(0, ct.length - 16);
				return {
					iv:         Q.Data.toBase64(iv),
					ciphertext: Q.Data.toBase64(data),
					tag:        Q.Data.toBase64(tag)
				};
			});
	};

});
