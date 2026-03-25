Q.exports(function (Q) {

	/**
	 * Sign an OpenClaim with a P-256 keypair derived from a secret.
	 *
	 * Derives a deterministic keypair from the secret via Q.Crypto.internalKeypair
	 * (ES256 format: HKDF-SHA256 scalar, same derivation as Q.Crypto.sign).
	 *
	 * Signing model:
	 *   canon = RFC8785(claim without sig)
	 *   digest = SHA-256(canon)              — noble p256 hashes internally
	 *   sig = p256.sign(digest, privateKey)  — raw 64-byte r||s, low-S normalized
	 *   sig[i] = base64(sig)                 — stored in sig[] at matching key index
	 *
	 * The public key URI (data:key/es256;base64,<SPKI-DER>) is derived from
	 * the raw uncompressed public key and appended to key[] if not already present.
	 *
	 * NOTE: signatures are raw r||s (64 bytes), NOT DER — this matches the OCP
	 * reference implementation and SubtleCrypto's native signature format.
	 * Q.Crypto.sign by contrast produces DER for typed-message signing.
	 *
	 * Pass existing = { keys, signatures } to add a signature alongside existing
	 * ones in a multisig claim without disturbing them.
	 *
	 * @static
	 * @method sign
	 *
	 * @param  {Object}     claim             OCP claim object
	 * @param  {Uint8Array} secret            Raw binary secret (32 bytes recommended)
	 * @param  {Object}     [existing={}]     { keys, signatures } for multisig
	 *
	 * @return {Q.Promise<Object>}  Claim with key[] and sig[] populated
	 */
	return function Q_Crypto_OpenClaim_sign(claim, secret, existing) {

		existing = existing || {};

		_validateNumbers(claim);

		// Load noble p256, derive keypair, build SPKI key URI — all chained Promises
		return Q.Promise.resolve(
			import(Q.url("{{Q}}/src/js/crypto/nist.js"))
		).then(function (noble) {

			return Q.Crypto.internalKeypair({
				secret: secret,
				format: "ES256"
			}).then(function (kp) {

				// Build the SPKI-based key URI from the raw uncompressed public key
				return _rawPublicKeyToKeyString(kp.publicKey).then(function (signerKey) {

					// Merge into sorted key+sig state
					var keys = _toArray(existing.keys != null ? existing.keys : claim.key);
					var sigs = _normalizeSigs(existing.signatures != null ? existing.signatures : claim.sig);

					_ensureStringKeys(keys);
					_ensureUniqueKeys(keys);
					if (keys.indexOf(signerKey) < 0) { keys.push(signerKey); }

					var state = _buildSortedState(keys, sigs);

					// Canonicalize (RFC 8785, sig stripped)
					var tmp = Object.assign({}, claim, { key: state.keys, sig: state.signatures });

					return Q.Crypto.OpenClaim.canonicalize(tmp).then(function (canon) {

						var data = new TextEncoder().encode(canon);

						// SHA-256 of canonical bytes — noble.p256.sign takes pre-hashed digest
						return crypto.subtle.digest("SHA-256", data).then(function (digestBuffer) {

							var digest = new Uint8Array(digestBuffer);

							// Sign with noble p256 — produces Signature object
							// .normalizeS() enforces low-S (required for OpenClaim interop)
							var sig     = noble.p256.sign(digest, kp.privateKey).normalizeS();
							var sigBytes = new Uint8Array(64);

							// r and s as 32-byte big-endian — raw r||s format (not DER)
							var rHex = sig.r.toString(16).padStart(64, "0");
							var sHex = sig.s.toString(16).padStart(64, "0");
							for (var i = 0; i < 32; i++) {
								sigBytes[i]      = parseInt(rHex.slice(i * 2, i * 2 + 2), 16);
								sigBytes[i + 32] = parseInt(sHex.slice(i * 2, i * 2 + 2), 16);
							}

							var idx = state.keys.indexOf(signerKey);
							state.signatures[idx] = Q.Data.toBase64(sigBytes);

							return Object.assign({}, claim, {
								key: state.keys,
								sig: state.signatures
							});
						});
					});
				});
			});
		});
	};

	// ── Helpers ───────────────────────────────────────────────────────────────

	function _toArray(v) {
		return v == null ? [] : Array.isArray(v) ? v : [v];
	}

	function _normalizeSigs(v) {
		return _toArray(v).map(function (x) { return x == null ? null : String(x); });
	}

	function _ensureStringKeys(keys) {
		keys.forEach(function (k) {
			if (typeof k !== "string") {
				throw new Error("Q.Crypto.OpenClaim.sign: all keys must be strings");
			}
		});
	}

	function _ensureUniqueKeys(keys) {
		var seen = {};
		keys.forEach(function (k) {
			if (seen[k]) { throw new Error("Q.Crypto.OpenClaim.sign: duplicate key: " + k); }
			seen[k] = true;
		});
	}

	function _buildSortedState(keys, sigs) {
		if (sigs.length > keys.length) {
			throw new Error("Q.Crypto.OpenClaim.sign: more signatures than keys");
		}
		var pairs = keys.map(function (k, i) {
			return { key: k, sig: i < sigs.length ? sigs[i] : null };
		});
		pairs.sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });
		return {
			keys:       pairs.map(function (p) { return p.key; }),
			signatures: pairs.map(function (p) { return p.sig; })
		};
	}

	function _validateNumbers(v, path) {
		path = path || "claim";
		if (Array.isArray(v)) {
			v.forEach(function (item, i) { _validateNumbers(item, path + "[" + i + "]"); });
			return;
		}
		if (v && typeof v === "object") {
			Object.keys(v).forEach(function (k) { _validateNumbers(v[k], path + "." + k); });
			return;
		}
		if (typeof v === "number" && Number.isInteger(v) && !Number.isSafeInteger(v)) {
			throw new Error(
				"Q.Crypto.OpenClaim.sign: integer at " + path +
				" exceeds safe range — use a string"
			);
		}
	}

	// Export the raw uncompressed P-256 point as a data:key/es256;base64,<SPKI> URI.
	// Uses SubtleCrypto importKey("raw") → exportKey("spki") — the canonical path.
	function _rawPublicKeyToKeyString(rawPublicKey) {
		return crypto.subtle.importKey(
			"raw",
			rawPublicKey,
			{ name: "ECDSA", namedCurve: "P-256" },
			true,       // extractable = true so we can export as SPKI
			["verify"]
		).then(function (cryptoKey) {
			return crypto.subtle.exportKey("spki", cryptoKey);
		}).then(function (spkiBuffer) {
			return "data:key/es256;base64," + Q.Data.toBase64(new Uint8Array(spkiBuffer));
		});
	}

});
