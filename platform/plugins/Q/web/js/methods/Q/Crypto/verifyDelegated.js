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
	 * Secret hash algorithm matches the signing format:
	 * - EIP712 → keccak256(derivedSecret)
	 * - ES256  → SHA-256(derivedSecret)
	 * This must match delegate.js exactly.
	 *
	 * @static
	 * @method verifyDelegated
	 *
	 * @param {Object}            options
	 * @param {String}            [options.format="ES256"] "ES256" or "EIP712".
	 * @param {Object}            options.statement        Delegation statement.
	 * @param {String|Uint8Array} options.signature        Signature bytes.
	 * @param {Uint8Array}        options.derivedSecret    Derived child secret.
	 * @param {Uint8Array}        [options.parentPublicKey] Expected parent key (ES256).
	 * @param {Object}            [options.domain]          EIP-712 domain (EIP712 only).
	 * @param {Object}            [options.recovered]       Optional recovered signer output.
	 *
	 * @return {Q.Promise<Boolean>}
	 */
	return function Q_Crypto_verifyDelegated(options) {

		return new Q.Promise(function (resolve, reject) {

			try {

				if (!options) {
					throw new Error("options required");
				}

				const format        = options.format || "ES256";
				const statement     = options.statement;
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
				if ("context" in statement && typeof statement.context !== "string") {
					throw new Error("statement.context must be string when present");
				}

				const context = statement.context || "";

				// -------------------------------------------------
				// Verify secret binding
				// Algorithm matches delegate.js: keccak256 for EIP712, SHA-256 for ES256
				// -------------------------------------------------
				const secretHashPromise = format === "EIP712"
					? import(Q.url("{{Q}}/src/js/crypto/sha3.js"))
						.then(function ({ keccak_256 }) {
							return Q.Data.toHex(keccak_256(derivedSecret));
						})
					: Q.Data.digest("SHA-256", derivedSecret)
						.then(function (h) {
							return Q.Data.toHex(h);
						});

				secretHashPromise.then(function (actualSecretHashHex) {

					if (actualSecretHashHex !== statement.secretHash) {
						resolve(false);
						return;
					}

					// -------------------------------------------------
					// Schema — must match delegate.js types exactly
					// -------------------------------------------------
					const types = {
						EIP712Domain: [
							{ name: "name",    type: "string"  },
							{ name: "version", type: "string"  },
							{ name: "salt",    type: "bytes32" }
						],
						Delegation: [
							{
								name: "parent",
								type: format === "EIP712" ? "address" : "bytes32"
							},
							{ name: "label",      type: "string"  },
							{ name: "issuedTime", type: "uint64"  },
							{ name: "context",    type: "string"  },
							{ name: "secretHash", type: "bytes32" }
						]
					};

					// -------------------------------------------------
					// Normalize signature
					// -------------------------------------------------
					let signature = options.signature;
					if (typeof signature === "string") {
						signature = Q.Data.fromBase64(signature);
					}

					// -------------------------------------------------
					// EIP712 path
					// -------------------------------------------------
					if (format === "EIP712") {

						return Q.Crypto.verify({
							format:      "EIP712",
							domain:      options.domain || {},
							types:       types,
							primaryType: "Delegation",
							message:     Q.extend({}, statement, { context: context }),
							signature:   signature,
							recovered:   options.recovered
						}).then(function (verified) {

							if (!verified) {
								resolve(false);
								return;
							}

							const recoveredAddress =
								options.recovered && options.recovered.address;

							if (
								!recoveredAddress ||
								recoveredAddress.toLowerCase() !==
								statement.parent.toLowerCase()
							) {
								resolve(false);
								return;
							}

							resolve(true);
						});
					}

					// -------------------------------------------------
					// ES256 path
					// -------------------------------------------------
					if (!(options.parentPublicKey instanceof Uint8Array)) {
						throw new Error("parentPublicKey required for ES256");
					}

					const pubBytes = Q.Data.toUint8Array(options.parentPublicKey);

					return Q.Data.digest("SHA-256", pubBytes)
					.then(function (digest) {

						const expectedParent = Q.Data.toHex(digest);

						if (expectedParent !== statement.parent) {
							resolve(false);
							return;
						}

						return Q.Crypto.verify({
							format:      "ES256",
							domain:      options.domain || {},
							types:       types,
							primaryType: "Delegation",
							message:     Q.extend({}, statement, { context: context }),
							signature:   signature,
							publicKey:   pubBytes
						}).then(function (verified) {

							if (!verified) {
								resolve(false);
								return;
							}

							if (options.recovered && typeof options.recovered === "object") {
								options.recovered.publicKey = pubBytes;
							}

							resolve(true);
						});
					});

				}).catch(reject);

			} catch (e) {
				reject(e);
			}
		});
	};

});