Q.exports(function (Q) {

	/**
	 * Sign a typed message using a deterministically derived keypair.
	 *
	 * This is the JS counterpart of Q_Crypto::sign() in PHP.
	 * It performs protocol-level typed signing (not raw message signing).
	 *
	 * Supported formats:
	 * - "ES256"  → NIST P-256 + SHA-256 (Q-native)
	 * - "EIP712" → secp256k1 + keccak256 (Ethereum-style, full EIP-712 encoding)
	 *
	 * SECURITY PROPERTIES:
	 * - Secret is never stored
	 * - Keypair derivation is deterministic
	 * - Exactly one hash + one signature
	 * - Output is a verifiable proof object
	 *
	 * @static
	 * @method sign
	 *
	 * @param {Object}     options
	 * @param {Uint8Array} options.secret      Raw binary secret material.
	 * @param {Object}     options.message     Typed message payload.
	 * @param {Object}     options.types       Type definitions (EIP-712 style).
	 * @param {String}     options.primaryType Root type name.
	 * @param {Object}     [options.domain={}] Domain separator fields.
	 * @param {String}     [options.format="ES256"] "ES256" or "EIP712".
	 *
	 * @return {Q.Promise<Object>} Resolves to an object with the following properties:
	 *
	 *   format       {String}     Resolved format: "eip712" or "es256".
	 *   curve        {String}     Elliptic curve: "secp256k1" or "p256".
	 *   hashAlg      {String}     Hash algorithm: "keccak256" or "sha256".
	 *   domain       {Object}     Domain separator used.
	 *   primaryType  {String}     Root type name.
	 *   digest       {String}     Hex-encoded message digest.
	 *   signature    {Uint8Array} Raw signature bytes.
	 *                             EIP712: 65 bytes r||s||v (v = 27 + recovery).
	 *                             ES256:  DER-encoded ECDSA signature.
	 *   signatureHex {String}     Hex-encoded signature (no 0x prefix).
	 *   publicKey    {Uint8Array} Raw uncompressed public key (65 bytes).
	 *
	 *   EIP712 only:
	 *   address      {String}     Ethereum address of signer ("0x...").
	 */
	return function Q_Crypto_sign(options) {

		return new Q.Promise(async function (resolve, reject) {

			try {

				if (!options || !(options.secret instanceof Uint8Array)) {
					throw new Error("secret must be Uint8Array");
				}
				if (!options.message || typeof options.message !== "object") {
					throw new Error("message required");
				}
				if (!options.types || typeof options.types !== "object") {
					throw new Error("types required");
				}
				if (typeof options.primaryType !== "string") {
					throw new Error("primaryType required");
				}

				const domain = options.domain || {};
				const format = options.format || "ES256";

				// -------------------------------------------------
				// Derive keypair ONCE
				// -------------------------------------------------
				const kp = await Q.Crypto.internalKeypair({
					secret: options.secret,
					format: format
				});

				/* =================================================
				 * EIP712 (secp256k1 + keccak256)
				 * ================================================= */
				if (format === "EIP712") {

					const [{ hashTypedData }, secp] = await Promise.all([
						import(Q.url("{{Q}}/src/js/crypto/eip712.js")),
						import(Q.url("{{Q}}/src/js/crypto/secp256k1.js"))
					]);

					// Single source of truth for EIP-712 digest —
					// byte-identical to Q_Crypto_EIP712::hashTypedData() in PHP
					const digestBytes = hashTypedData(
						domain,
						options.primaryType,
						options.message,
						options.types
					);

					const sig = secp.secp256k1.sign(digestBytes, kp.privateKey, {
						recovered: true,
						der: false
					});

					let compact, recovery;

					if (Array.isArray(sig)) {
						compact  = sig[0];
						recovery = sig[1];
					} else {
						compact  = sig.signature;
						recovery = sig.recovery;
					}

					if (!(compact instanceof Uint8Array)) {
						compact = new Uint8Array(compact);
					}

					// Ethereum-style: r||s||v  (v = 27 + recovery)
					const signature = new Uint8Array(65);
					signature.set(compact, 0);
					signature[64] = 27 + recovery;

					resolve({
						format:       "eip712",
						curve:        "secp256k1",
						hashAlg:      "keccak256",
						domain:       domain,
						primaryType:  options.primaryType,
						digest:       Q.Data.toHex(digestBytes),
						signature:    signature,
						signatureHex: Q.Data.toHex(signature),
						publicKey:    kp.publicKey,
						address:      kp.address
					});

					return;
				}

				/* =================================================
				 * ES256 (P-256 + SHA-256)
				 * ================================================= */

				// Canonical JSON payload — must match Q_Crypto::sign() in PHP exactly
				const payload = {
					domain:      domain,
					primaryType: options.primaryType,
					types:       options.types,
					message:     options.message
				};

				const canonical   = Q.serialize(payload);
				const msgBytes    = new TextEncoder().encode(canonical);
				const digestBytes = await Q.Data.digest("SHA-256", msgBytes);

				const noble = await import(
					Q.url("{{Q}}/src/js/crypto/nist.js")
				);
				const { encodeEcdsaDer } = await import(
					Q.url("{{Q}}/src/js/crypto/encoder.js")
				);

				const sig = noble.p256
					.sign(digestBytes, kp.privateKey)
					.normalizeS();

				const signatureDer = encodeEcdsaDer(
					bigIntTo32Bytes(sig.r),
					bigIntTo32Bytes(sig.s)
				);

				resolve({
					format:       "es256",
					curve:        "p256",
					hashAlg:      "sha256",
					domain:       domain,
					primaryType:  options.primaryType,
					digest:       Q.Data.toHex(digestBytes),
					signature:    signatureDer,
					signatureHex: Q.Data.toHex(signatureDer),
					publicKey:    kp.publicKey
				});

			} catch (e) {
				reject(e);
			}
		});
	};

	// -------------------------------------------------
	// Module-private helper
	// -------------------------------------------------

	// BigInt → 32-byte Uint8Array (big-endian)
	function bigIntTo32Bytes(n) {
		const hex = n.toString(16).padStart(64, "0");
		const out = new Uint8Array(32);
		for (let i = 0; i < 32; i++) {
			out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
		}
		return out;
	}

});