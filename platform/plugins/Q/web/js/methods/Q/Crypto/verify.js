Q.exports(function (Q) {

	/**
	 * Verify typed signatures (Q-native or EIP-712).
	 *
	 * Always returns a boolean.
	 *
	 * Optional recovery:
	 * - If options.recovered is an object, recovered signer info
	 *   will be written into it (when supported by the format).
	 *
	 * @static
	 * @method verify
	 * @param {Object} options
	 * @param {String} [options.format='ES256']
	 * @param {Object} options.domain
	 * @param {Object} options.types
	 * @param {Object} options.message
	 * @param {String|Uint8Array} options.signature
	 * @param {String} [options.address] Expected signer address (EIP712)
	 * @param {Uint8Array} [options.publicKey] Expected signer public key (ES256)
	 * @param {Object} [options.recovered] If provided, signer info is written here
	 * @return {Q.Promise} resolves to true or false
	 */
	return function Q_Crypto_verify(options) {

		return new Q.Promise(async function (resolve) {

			if (!options) {
				throw new Error("options required");
			}

			const format = options.format || "ES256";

			/* =================================================
			 * Ethereum / EIP-712
			 * ================================================= */
			if (format === "EIP712") {

				if (typeof options.primaryType !== "string") {
					throw new Error("primaryType required for eip712 verification");
				}

				try {
					// Always use our encoder for the digest —
					// single source of truth, byte-identical to PHP Q_Crypto_EIP712
					const [{ hashTypedData }, { keccak_256 }] = await Promise.all([
						import(Q.url("{{Q}}/src/js/crypto/eip712.js")),
						import(Q.url("{{Q}}/src/js/crypto/sha3.js"))
					]);

					const digest = hashTypedData(
						options.domain || {},
						options.primaryType,
						options.message,
						options.types
					);

					const secp = await import(
						Q.url("{{Q}}/src/js/crypto/secp256k1.js")
					);

					let sigBytes = options.signature;

					if (typeof sigBytes === "string") {
						sigBytes = Q.Data.fromHex(sigBytes);
					}

					if (!(sigBytes instanceof Uint8Array)) {
						resolve(false);
						return;
					}

					// Accept 65-byte r||s||v → extract recovery id, drop v
					let recovery;
					if (sigBytes.length === 65) {
						const v = sigBytes[64];
						recovery = (v === 27 || v === 28) ? v - 27 : v;
						sigBytes = sigBytes.slice(0, 64);
					}

					if (sigBytes.length !== 64) {
						resolve(false);
						return;
					}

					const sig = secp.secp256k1.Signature.fromCompact(sigBytes);

					// Enforce low-s (EIP-2)
					if (sig.s > secp.secp256k1.CURVE.n / 2n) {
						resolve(false);
						return;
					}

					// Use stored recovery id if available, otherwise try both
					const recoveries = (recovery === 0 || recovery === 1)
						? [recovery]
						: [0, 1];

					let pub = null;
					for (const r of recoveries) {
						try {
							pub = sig.addRecoveryBit(r)
								.recoverPublicKey(digest)
								.toRawBytes(false); // uncompressed
							break;
						} catch (e) {
							// try next
						}
					}

					if (!pub) {
						resolve(false);
						return;
					}

					if (!secp.secp256k1.verify(sig, digest, pub)) {
						resolve(false);
						return;
					}

					// Address = last 20 bytes of keccak256(pub[1:])
					const addrBytes = keccak_256(pub.slice(1)).slice(-20);
					const recoveredAddress = "0x" + [...addrBytes]
						.map(b => b.toString(16).padStart(2, "0"))
						.join("");

					if (options.recovered && typeof options.recovered === "object") {
						options.recovered.address = recoveredAddress;
					}

					if (options.address) {
						resolve(
							recoveredAddress.toLowerCase() ===
							options.address.toLowerCase()
						);
						return;
					}

					resolve(true);

				} catch (e) {
					resolve(false);
				}

				return;
			}

			/* =================================================
			 * ES256 (P-256 + SHA-256)
			 * =================================================
			 *
			 * Signatures are DER-encoded ECDSA (WebCrypto compatible).
			 * subtle.verify hashes internally, so pass raw canonical bytes.
			 */
			if (format === "ES256") {

				if (!(options.publicKey instanceof Uint8Array)) {
					throw new Error("ES256 verify requires publicKey (Uint8Array)");
				}
				if (!(options.signature instanceof Uint8Array)) {
					throw new Error("ES256 verify requires signature (Uint8Array)");
				}

				const payload = {
					domain:      options.domain || {},
					primaryType: options.primaryType,
					types:       options.types,
					message:     options.message
				};

				// Canonical JSON — must match sign.js and PHP Q_Crypto::sign() exactly
				const canonical = Q.serialize(payload);
				const data = new TextEncoder().encode(canonical);

				try {
					const key = await crypto.subtle.importKey(
						"raw",
						options.publicKey,
						{ name: "ECDSA", namedCurve: "P-256" },
						false,
						["verify"]
					);

					try {
						const ok = await crypto.subtle.verify(
							{ name: "ECDSA", hash: "SHA-256" },
							key,
							options.signature,
							data  // raw canonical bytes — subtle hashes once internally
						);
						resolve(ok);
					} catch (e) {
						resolve(false);
					}

					return;

				} catch (e) {
					resolve(false);
					return;
				}
			}

			throw new Error("Unknown signature format: " + format);
		});
	};

});