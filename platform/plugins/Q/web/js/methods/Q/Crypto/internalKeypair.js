Q.exports(function (Q) {

	/**
	 * Deterministically derive a signing keypair from a secret.
	 *
	 * SECURITY INVARIANTS:
	 * - This is the ONLY place secrets become private keys
	 * - No randomness
	 * - No storage
	 * - Deterministic & reproducible
	 *
	 * Supported formats:
	 * - "eip712"   → secp256k1 (ethers.js)
	 * - "qcrypto"  → P-256 (noble-curves)
	 *
	 * @static
	 * @method internalKeypair
	 *
	 * @param {Object} options
	 * @param {Uint8Array} options.secret
	 * @param {String} [options.format="qcrypto"]
	 *
	 * @return {Q.Promise<Object>}
	 */
	return function Q_Crypto_internalKeypair(options) {

		return new Q.Promise(async function (resolve) {

			if (!options || !(options.secret instanceof Uint8Array)) {
				throw new Error("secret must be Uint8Array");
			}

			var secret = options.secret;
			var format = options.format || "qcrypto";

			// -------------------------------------------------
			// Ethereum / EIP-712 (secp256k1)
			// -------------------------------------------------
			if (format === "eip712") {

				if (!globalThis.ethers) {
					throw new Error("ethers.js required for eip712 key derivation");
				}

				// Domain-separated deterministic seed
				const info = new TextEncoder().encode(
					"q.crypto.eip712.private-key"
				);

				const material = new Uint8Array(info.length + secret.length);
				material.set(info, 0);
				material.set(secret, info.length);

				const digestHex = await Q.Data.digest(
					"KECCAK-256",
					material
				);

				// Proper scalar derivation: mod curve order
				const secp = await import(
					Q.url("{{Q}}/src/js/crypto/secp256k1.js")
				);

				const n = secp.secp256k1.CURVE.n;
				let k = BigInt("0x" + digestHex) % n;

				if (k === 0n) {
					throw new Error("Derived invalid secp256k1 scalar");
				}

				const skHex = "0x" + k.toString(16).padStart(64, "0");
				const wallet = new ethers.Wallet(skHex);

				resolve({
					format: "eip712",
					curve: "secp256k1",
					hashAlg: "keccak256",
					privateKey: skHex,
					publicKey: wallet.publicKey,
					address: wallet.address,
					_wallet: wallet
				});
				return;
			}

			// -------------------------------------------------
			// Q-native crypto (P-256 via noble-curves)
			// -------------------------------------------------

			// Deterministically derive scalar (noble handles reduction)
			var sk = await Q.Data.derive(
				secret,
				"q.crypto.p256.private-key",
				{ size: 32 }
			);

			const noble = await import(
				Q.url("{{Q}}/src/js/crypto/noble/nist.js")
			);

			const p256 = noble.p256;

			// Uncompressed public key (65 bytes)
			const publicKey = p256.getPublicKey(sk, false);

			resolve({
				format: "qcrypto",
				curve: "p256",
				hashAlg: "sha256",
				privateKey: sk,     // Uint8Array(32)
				publicKey: publicKey // Uint8Array(65)
			});
		});
	};

});