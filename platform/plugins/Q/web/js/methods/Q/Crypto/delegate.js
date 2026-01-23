Q.exports(function (Q) {

	/**
	 * Perform a cryptographic delegation ceremony.
	 *
	 * Delegation is capability-based:
	 * - A child secret is deterministically derived from a parent secret
	 * - The parent signs a typed delegation statement
	 * - The result can be verified and chained
	 *
	 * Security model:
	 * - `rootSecret` is never returned
	 * - `secret` is the sole bearer of delegated capability
	 * - Authority is proven by the parent’s signature
	 * - `context` is treated as an opaque, signed string
	 *
	 * @static
	 * @method delegate
	 *
	 * @param {Object} options
	 * @param {Uint8Array} options.rootSecret Parent secret material.
	 * @param {String} options.label Delegation label (domain-separated).
	 * @param {String} [options.context] Opaque, signed context string.
	 * @param {String} [options.format='qcrypto'] Signature format:
	 *   - `qcrypto` → P-256 + SHA-256
	 *   - `eip712`  → secp256k1 + keccak256
	 *
	 * @return {Q.Promise<Object>} Delegation result.
	 * @return {String} return.label Delegation label.
	 * @return {String|undefined} return.context Signed context string.
	 * @return {Uint8Array} return.secret Delegated capability secret.
	 * @return {Object} return.proof Signed delegation proof.
	 */
	return function Q_Crypto_delegate(options) {

		return new Q.Promise(async function (resolve) {

			if (!options) {
				throw new Error("options required");
			}

			const rootSecret = options.rootSecret;
			const label = options.label;
			const context = options.context;
			const format = options.format || "qcrypto";

			if (!(rootSecret instanceof Uint8Array)) {
				throw new Error("rootSecret must be Uint8Array");
			}
			if (typeof label !== "string" || !label.length) {
				throw new Error("label required");
			}
			if (context !== undefined && typeof context !== "string") {
				throw new Error("context must be a string if provided");
			}

			// -------------------------------------------------
			// Derive delegated capability secret
			// -------------------------------------------------
			const derivedSecret = await Q.Data.derive(
				rootSecret,
				"q.crypto.delegate." + label,
				{ size: 32 }
			);

			// -------------------------------------------------
			// Derive parent identity
			// -------------------------------------------------
			const parentKp = await Q.Crypto.internalKeypair({
				secret: rootSecret,
				format: format
			});

			let parentIdentity;
			let parentType;

			if (format === "eip712") {
				parentIdentity = parentKp.address;
				parentType = "address";
			} else {
				parentIdentity = Q.Data.toHex(
					await Q.Data.digest("SHA-256", parentKp.publicKey)
				);
				parentType = "bytes32";
			}

			// -------------------------------------------------
			// Construct delegation statement (protocol-fixed)
			// -------------------------------------------------
			const statement = {
				parent: parentIdentity,
				label: label,
				issuedTime: Math.floor(Date.now() / 1000),
				context: context || "",
				secretHash: Q.Data.toHex(
					await Q.Data.digest("SHA-256", derivedSecret)
				)
			};

			// -------------------------------------------------
			// Parent signs the delegation
			// -------------------------------------------------
			const proof = await Q.Crypto.sign({
				secret: rootSecret,
				message: statement,
				types: {
					Delegation: [
						{ name: "parent", type: parentType },
						{ name: "label", type: "string" },
						{ name: "issuedTime", type: "uint64" },
						{ name: "context", type: "string" },
						{ name: "secretHash", type: "bytes32" }
					]
				},
				primaryType: "Delegation",
				format: format
			});

			resolve({
				label: label,
				context: context,
				secret: derivedSecret,
				proof: proof
			});
		});
	};

});