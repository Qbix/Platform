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
	 * - "eip712" → secp256k1 (noble-curves). Public key and Ethereum
	 *              address derived entirely from noble, no ethers dependency.
	 * - "es256"  → NIST P-256 (noble-curves).
	 *
	 * Derivation method:
	 * - eip712: seed = keccak256("q.crypto.k256.private-key" || secret),
	 *           scalar = seed mod curveOrder.
	 * - es256:  scalar = HKDF-SHA256(secret, "q.crypto.p256.private-key")
	 *           via Q.Data.derive().
	 *
	 * @static
	 * @method internalKeypair
	 *
	 * @param {Object}     options
	 * @param {Uint8Array} options.secret          Raw secret material (32 bytes recommended).
	 * @param {String}     [options.format="es256"] Signing format: "eip712" or "es256".
	 *
	 * @return {Q.Promise<Object>} Resolves to an object with the following properties:
	 *
	 *   format     {String}     Normalized format: "eip712" or "es256".
	 *   curve      {String}     Curve name: "secp256k1" or "p256".
	 *   hashAlg    {String}     Hash algorithm: "keccak256" or "sha256".
	 *   privateKey {Uint8Array} Raw private key scalar (32 bytes).
	 *                           Never log, store, or transmit this value.
	 *   publicKey  {Uint8Array} Raw uncompressed public key (65 bytes): 0x04 || X || Y.
	 *
	 *   The following property is only present for "eip712":
	 *   address    {String}     Ethereum address: lowercase "0x" + last 20 bytes of
	 *                           keccak256(publicKey[1..64]). Suitable for use
	 *                           as an EVM signer identity.
	 *
	 * @throws {Error} If secret is missing or not a Uint8Array.
	 * @throws {Error} If format is unsupported.
	 * @throws {Error} If derived private key scalar is zero (astronomically unlikely).
	 */
	return function Q_Crypto_internalKeypair(options) {

		return new Q.Promise(async function (resolve, reject) {

			try {

				if (!options || !(options.secret instanceof Uint8Array)) {
					throw new Error("secret must be Uint8Array");
				}

				const secret = options.secret;
				const format = options.format || "ES256";

				// -------------------------------------------------
				// EIP-712 / secp256k1 (noble-curves, no ethers)
				// -------------------------------------------------
				if (format === "EIP712") {

					const [{ keccak_256 }, secp] = await Promise.all([
						import(Q.url("{{Q}}/src/js/crypto/sha3.js")),
						import(Q.url("{{Q}}/src/js/crypto/secp256k1.js"))
					]);

					// Domain-separated deterministic seed:
					// keccak256("q.crypto.k256.private-key" || secret)
					const info     = new TextEncoder().encode("q.crypto.k256.private-key");
					const material = new Uint8Array(info.length + secret.length);
					material.set(info, 0);
					material.set(secret, info.length);

					const digest = keccak_256(material); // Uint8Array(32)

					// Reduce mod curve order — matches PHP implementation
					const n = secp.secp256k1.CURVE.n;
					const k = bytesToBigInt(digest) % n;

					if (k === 0n) {
						throw new Error("Derived invalid secp256k1 scalar");
					}

					// Private key as Uint8Array(32)
					const privateKey = bigIntToBytes32(k);

					// Uncompressed public key: 0x04 || X(32) || Y(32)
					const publicKey = secp.secp256k1.getPublicKey(privateKey, false);

					// Ethereum address: "0x" + last 20 bytes of keccak256(pubkey[1..])
					const pubKeyBody  = publicKey.slice(1); // drop 0x04 prefix
					const addrHash    = keccak_256(pubKeyBody); // Uint8Array(32)
					const address     = "0x" + Q.Data.toHex(addrHash.slice(12)); // last 20 bytes

					resolve({
						format:     "eip712",
						curve:      "secp256k1",
						hashAlg:    "keccak256",
						privateKey: privateKey, // Uint8Array(32)
						publicKey:  publicKey,  // Uint8Array(65)
						address:    address     // "0x..." lowercase
					});

					return;
				}

				// -------------------------------------------------
				// es256 / P-256 (noble-curves)
				// -------------------------------------------------
				if (format === "ES256") {

					const noble = await import(
						Q.url("{{Q}}/src/js/crypto/nist.js")
					);

					// Deterministic scalar via HKDF-SHA256
					const privateKey = await Q.Data.derive(
						secret,
						"q.crypto.p256.private-key",
						{ size: 32 }
					); // Uint8Array(32)

					// Uncompressed public key: 0x04 || X(32) || Y(32)
					const publicKey = noble.p256.getPublicKey(privateKey, false);

					resolve({
						format:     "es256",
						curve:      "p256",
						hashAlg:    "sha256",
						privateKey: privateKey, // Uint8Array(32)
						publicKey:  publicKey   // Uint8Array(65)
					});

					return;
				}

				throw new Error("Unsupported format: " + format);

			} catch (e) {
				reject(e);
			}
		});
	};

	// -------------------------------------------------
	// Module-private helpers
	// -------------------------------------------------

	function bytesToBigInt(bytes) {
		let result = 0n;
		for (let i = 0; i < bytes.length; i++) {
			result = (result << 8n) | BigInt(bytes[i]);
		}
		return result;
	}

	function bigIntToBytes32(n) {
		const hex = n.toString(16).padStart(64, "0");
		const out = new Uint8Array(32);
		for (let i = 0; i < 32; i++) {
			out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
		}
		return out;
	}

});