Q.exports(function (Q) {

	/**
	 * HKDF using SHA-256 (RFC 5869).
	 *
	 * @module Q
	 * @class Q.Data
	 */

	/**
	 * @static
	 * @method hkdf
	 * @param {Uint8Array} ikm Input key material
	 * @param {Uint8Array} salt Salt
	 * @param {String} info Context string
	 * @param {Number} [length=32] Output length in bytes
	 * @return {Q.Promise} Resolves Uint8Array
	 */
	return function Q_Data_hkdf(ikm, salt, info, length) {
		length = length || 32;
		info = info || "";

		return crypto.subtle.importKey(
			"raw",
			ikm,
			{ name: "HKDF" },
			false,
			["deriveBits"]
		).then(function (key) {
			return crypto.subtle.deriveBits(
				{
					name: "HKDF",
					hash: "SHA-256",
					salt: salt,
					info: new TextEncoder().encode(info)
				},
				key,
				length * 8
			);
		}).then(function (bits) {
			return new Uint8Array(bits);
		});
	};
});