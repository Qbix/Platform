Q.exports(function (Q) {

	/**
	 * Perform a cryptographic delegation ceremony.
	 *
	 * Delegation is capability-based:
	 * - A child secret is deterministically derived from a parent secret
	 * - The parent signs a typed delegation statement
	 * - The result can be verified and chained
	 *
	 * SECURITY MODEL:
	 * - rootSecret is never returned
	 * - secret is the sole bearer of delegated capability
	 * - Authority is proven by the parent's signature
	 * - context is treated as an opaque, signed string
	 *
	 * SIGNING FORMATS:
	 * - "ES256"  → P-256 + SHA-256. Digest = SHA-256(canonical JSON payload).
	 * - "EIP712" → secp256k1 + keccak256 + full EIP-712 struct encoding.
	 *   Domain: { name: "Q.Crypto", version: "1", salt: keccak256(label) }
	 *   The label is in the domain salt, making cross-label signature
	 *   replay structurally impossible at the cryptographic level.
	 *
	 * @static
	 * @method delegate
	 *
	 * @param {Object}     options
	 * @param {Uint8Array} options.rootSecret  Parent secret material.
	 * @param {String}     options.label       Delegation label (domain-separated).
	 * @param {String}     [options.context]   Opaque, signed context string.
	 * @param {String}     [options.format='es256'] "ES256" or "EIP712".
	 *
	 * @return {Q.Promise<Object>}
	 * @return {String}     return.label     Delegation label.
	 * @return {String}     return.context   Signed context string.
	 * @return {Uint8Array} return.secret    Delegated capability secret.
	 * @return {Object}     return.statement The signed statement.
	 * @return {Object}     return.proof     Signed delegation proof.
	 */
	return function Q_Crypto_delegate(options) {

		return new Q.Promise(async function (resolve, reject) {

			try {

				if (!options) {
					throw new Error("options required");
				}

				const rootSecret = options.rootSecret;
				const label      = options.label;
				const context    = options.context;
				const format     = options.format || "ES256";

				if (!(rootSecret instanceof Uint8Array)) {
					throw new Error("rootSecret must be Uint8Array");
				}
				if (typeof label !== "string" || !label.length) {
					throw new Error("label required");
				}
				if (context !== undefined && typeof context !== "string") {
					throw new Error("context must be a string if provided");
				}

				const normalizedContext = context || "";

				// -------------------------------------------------
				// Derive delegated capability secret
				// -------------------------------------------------
				const derivedSecret = await Q.Data.derive(
					rootSecret,
					"q.crypto.delegate." + label,
					{ size: 32 }
				);

				// -------------------------------------------------
				// Derive parent keypair + identity
				// -------------------------------------------------
				const parentKp = await Q.Crypto.internalKeypair({
					secret: rootSecret,
					format: format
				});

				let parentIdentity;
				let parentType;

				if (format === "EIP712") {
					// eip712: parent identity is the Ethereum address
					parentIdentity = parentKp.address;
					parentType     = "address";
				} else {
					// es256: parent identity is SHA-256 of the public key
					const pubBytes  = Q.Data.toUint8Array(parentKp.publicKey);
					const pubDigest = await Q.Data.digest("SHA-256", pubBytes);
					parentIdentity  = Q.Data.toHex(pubDigest);
					parentType      = "bytes32";
				}

				// -------------------------------------------------
				// Compute secret hash
				// eip712: keccak256(derivedSecret)
				// es256:  SHA-256(derivedSecret)
				// -------------------------------------------------
				const { keccak_256 } = await import(
					Q.url("{{Q}}/src/js/crypto/sha3.js")
				);

				let secretHashHex;

				if (format === "EIP712") {
					secretHashHex = Q.Data.toHex(keccak_256(derivedSecret));
				} else {
					secretHashHex = Q.Data.toHex(
						await Q.Data.digest("SHA-256", derivedSecret)
					);
				}

				// -------------------------------------------------
				// Construct delegation statement (protocol-fixed)
				// -------------------------------------------------
				const statement = {
					parent:     parentIdentity,
					label:      label,
					issuedTime: Math.floor(Date.now() / 1000),
					context:    normalizedContext,
					secretHash: secretHashHex
				};

				// -------------------------------------------------
				// Build domain
				// eip712: { name, version, salt } where
				//   salt = keccak256(utf8(label)) as bytes32.
				//   Placing the label in the domain salt makes
				//   cross-label replay impossible at the digest level.
				// es256: domain is unused (empty object).
				// -------------------------------------------------
				const domain = format === "EIP712"
					? {
						name:    "Q.Crypto",
						version: "1",
						salt:    Q.Data.toHex(keccak_256(new TextEncoder().encode(label)))
					}
					: {};

				// -------------------------------------------------
				// Sign via Q.Crypto.sign()
				// eip712 path uses hashTypedData() from eip712.js.
				// es256  path uses SHA-256(canonical JSON).
				// -------------------------------------------------
				const proof = await Q.Crypto.sign({
					secret:      rootSecret,
					domain:      domain,
					message:     statement,
					types: {
						EIP712Domain: [
							{ name: "name",    type: "string"  },
							{ name: "version", type: "string"  },
							{ name: "salt",    type: "bytes32" }
						],
						Delegation: [
							{ name: "parent",     type: parentType },
							{ name: "label",      type: "string"   },
							{ name: "issuedTime", type: "uint64"   },
							{ name: "context",    type: "string"   },
							{ name: "secretHash", type: "bytes32"  }
						]
					},
					primaryType: "Delegation",
					format:      format
				});

				resolve({
					label:     label,
					context:   normalizedContext,
					secret:    derivedSecret,
					statement: statement,
					proof:     proof
				});

			} catch (e) {
				reject(e);
			}
		});
	};

});