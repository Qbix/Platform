Q.exports(function (Q) {

	/**
	 * @module Q
	 * @class Q.Data
	 */

	/**
	 * Imports raw key bytes into a CryptoKey for use with SubtleCrypto.
	 * @static
	 * @method importKey
	 * @param {Uint8Array} keyBytes Raw key material
	 * @param {Object} [algo] optional algorithm override
	 * @param {String} [algo.name="AES-GCM"]
	 * @param {Number} [algo.length=256]
	 * @param {Array} [algo.usages=["encrypt", "decrypt"]]
	 * @return {Q.Promise} Resolves CryptoKey
	 */
	return function Q_Data_importKey(keyBytes, algo) {
		algo = Q.extend({
			name: "AES-GCM",
			length: 256,
			usages: ["encrypt", "decrypt"]
		}, algo);

		return crypto.subtle.importKey(
			"raw",
			keyBytes,
			{ name: algo.name, length: algo.length },
			false,
			algo.usages
		);
	};
});