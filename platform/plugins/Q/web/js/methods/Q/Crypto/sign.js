Q.exports(function (Q) {

	// ---------------------------------------------
	// Helper: BigInt → 32-byte Uint8Array (big-endian)
	// ---------------------------------------------
	function bigIntTo32Bytes(n) {
		const hex = n.toString(16).padStart(64, '0');
		const out = new Uint8Array(32);
		for (let i = 0; i < 32; i++) {
			out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
		}
		return out;
	}

	function toHex(bytes) {
		if (!(bytes instanceof Uint8Array)) {
			bytes = new Uint8Array(bytes);
		}
		return Array.prototype.slice.call(bytes).toHex();
	}

	return function Q_Crypto_sign(options) {

		return new Q.Promise(async function (resolve) {

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
			const format = options.format || "qcrypto";

			// -------------------------------------------------
			// Derive keypair ONCE
			// -------------------------------------------------
			const kp = await Q.Crypto.internalKeypair({
				secret: options.secret,
				format: format
			});

			/* =================================================
			 * Ethereum / EIP-712
			 * ================================================= */
			if (format === "eip712") {

				const [{ hashTypedData }, secp] = await Promise.all([
					import(Q.url("{{Q}}/src/js/crypto/eip712.js")),
					import(Q.url("{{Q}}/src/js/crypto/secp256k1.js"))
				]);

				// ---------- Digest (single source of truth) ----------
				const digestBytes = hashTypedData(
					domain,
					options.primaryType,
					options.message,
					options.types
				);

				// ---------- Sign ----------
				const sig = secp.secp256k1.sign(digestBytes, kp.privateKey, {
					recovered: true,
					der: false
				});

				let compact, recovery;

				if (Array.isArray(sig)) {
					compact = sig[0];
					recovery = sig[1];
				} else {
					compact = sig.signature;
					recovery = sig.recovery;
				}

				// Ensure Uint8Array
				if (!(compact instanceof Uint8Array)) {
					compact = new Uint8Array(compact);
				}

				// ---------- Build Ethereum signature (r || s || v) ----------
				const signature = new Uint8Array(65);
				signature.set(compact, 0);
				signature[64] = 27 + recovery;

				resolve({
					format: "eip712",
					curve: "secp256k1",
					hashAlg: "keccak256",
					domain: domain,
					primaryType: options.primaryType,
					digest: toHex(digestBytes),
					signature: signature,
					signatureHex: toHex(signature),
					publicKey: kp.publicKey,
					address: kp.address
				});

				return;
			}
			/* =================================================
			 * qcrypto (P-256 + SHA-256)
			 * ================================================= */

			const payload = {
				domain: domain,
				primaryType: options.primaryType,
				types: options.types,
				message: options.message
			};

			const canonical = Q.serialize(payload);
			const msgBytes = new TextEncoder().encode(canonical);

			const digestHex = await Q.Data.digest("SHA-256", msgBytes);
			const digestBytes = Q.Data.fromHex(digestHex);

			const noble = await import(
				Q.url("{{Q}}/src/js/crypto/nist.js")
			);
			const { encodeEcdsaDer } = await import(
				Q.url("{{Q}}/src/js/crypto/encoder.js")
			);

			const sig = noble.p256
				.sign(digestBytes, kp.privateKey)
				.normalizeS();

			// noble BigInt → bytes
			const signatureDer = encodeEcdsaDer(
				bigIntTo32Bytes(sig.r),
				bigIntTo32Bytes(sig.s)
			);

			resolve({
				format: "qcrypto",
				curve: "p256",
				hashAlg: "sha256",
				domain: domain,
				primaryType: options.primaryType,
				digest: digestHex,
				signature: signatureDer,
				publicKey: kp.publicKey
			});
		});
	};
});