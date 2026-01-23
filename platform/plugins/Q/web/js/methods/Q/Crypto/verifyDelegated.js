Q.exports(function (Q) {

	/**
	 * Verify a single delegation step.
	 *
	 * Verifies exactly ONE level of delegation. Intended to be called
	 * repeatedly to validate a delegation chain.
	 *
	 * Guarantees:
	 * - The derived secret matches `statement.secretHash`
	 * - The delegation statement was correctly signed
	 * - The signer matches the parent identity declared in the statement
	 *
	 * Does NOT verify:
	 * - Parent legitimacy beyond this step
	 * - Expiration or revocation policy
	 *
	 * @static
	 * @method verifyDelegated
	 *
	 * @param {Object} options
	 * @param {String} [options.format='qcrypto']
	 * @param {Object} options.statement Delegation statement.
	 * @param {String|Uint8Array} options.signature Signature bytes.
	 * @param {Uint8Array} options.derivedSecret Derived child secret.
	 * @param {Uint8Array} [options.parentPublicKey] Expected parent key (qcrypto).
	 * @param {String} [options.parentAddress] Expected parent address (eip712).
	 * @param {Object} [options.recovered] Optional recovered signer output.
	 *
	 * @return {Q.Promise<Boolean>}
	 */
	return function Q_Crypto_verifyDelegated(options) {

		return new Q.Promise(async function (resolve) {

			if (!options) {
				throw new Error("options required");
			}

			const format = options.format || "qcrypto";
			const statement = options.statement;
			const derivedSecret = options.derivedSecret;

			// -------------------------------------------------
			// Validate inputs
			// -------------------------------------------------
			if (!statement || typeof statement !== "object") {
				throw new Error("statement required");
			}
			if (!(derivedSecret instanceof Uint8Array)) {
				throw new Error("derivedSecret must be Uint8Array");
			}
			if (typeof statement.parent !== "string") {
				throw new Error("statement.parent required");
			}
			if (typeof statement.label !== "string") {
				throw new Error("statement.label required");
			}
			if (typeof statement.issuedTime !== "number") {
				throw new Error("statement.issuedTime required");
			}
			if (typeof statement.secretHash !== "string") {
				throw new Error("statement.secretHash required");
			}
			if (
				"context" in statement &&
				typeof statement.context !== "string"
			) {
				throw new Error("statement.context must be string when present");
			}

			// Normalize optional context
			const context = statement.context || "";

			// -------------------------------------------------
			// Verify secret binding
			// -------------------------------------------------
			const actualSecretHash = Q.Data.toHex(
				await Q.Data.digest("SHA-256", derivedSecret)
			);

			if (actualSecretHash !== statement.secretHash) {
				resolve(false);
				return;
			}

			// -------------------------------------------------
			// Protocol-fixed delegation schema
			// -------------------------------------------------
			const types = {
				Delegation: [
					{
						name: "parent",
						type: format === "eip712" ? "address" : "bytes32"
					},
					{ name: "label", type: "string" },
					{ name: "issuedTime", type: "uint64" },
					{ name: "context", type: "string" },
					{ name: "secretHash", type: "bytes32" }
				]
			};

			// -------------------------------------------------
			// Verify signature and parent identity
			// -------------------------------------------------
			let verified;

			if (format === "eip712") {

				verified = await Q.Crypto.verify({
					format: "eip712",
					domain: options.domain || {},
					types,
					primaryType: "Delegation",
					message: {
						...statement,
						context
					},
					signature: options.signature,
					recovered: options.recovered
				});

				if (verified !== true) {
					resolve(false);
					return;
				}

				const recoveredAddress = options.recovered?.address;
				if (
					!recoveredAddress ||
					recoveredAddress.toLowerCase() !== statement.parent.toLowerCase()
				) {
					resolve(false);
					return;
				}

			} else {

				if (!(options.parentPublicKey instanceof Uint8Array)) {
					throw new Error("parentPublicKey required for qcrypto");
				}

				const expectedParent = Q.Data.toHex(
					await Q.Data.digest("SHA-256", options.parentPublicKey)
				);

				if (expectedParent !== statement.parent) {
					resolve(false);
					return;
				}

				verified = await Q.Crypto.verify({
					format: "qcrypto",
					domain: options.domain || {},
					types,
					primaryType: "Delegation",
					message: {
						...statement,
						context
					},
					signature: options.signature,
					publicKey: options.parentPublicKey
				});

				if (verified !== true) {
					resolve(false);
					return;
				}

				if (options.recovered && typeof options.recovered === "object") {
					options.recovered.publicKey = options.parentPublicKey;
				}
			}

			resolve(true);
		});
	};

});