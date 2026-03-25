Q.exports(function (Q) {

	/**
	 * Verify signatures on an OpenClaim.
	 *
	 * Verifies ES256 signatures using SubtleCrypto directly against the
	 * RFC 8785 canonical form of the claim. Does NOT use Q.Crypto.verify
	 * because OpenClaim's canonical input is the whole claim (sig stripped),
	 * not the Q.Crypto typed-data wrapper {domain, primaryType, types, message}.
	 *
	 * For EIP712 key entries (data:key/eip712,<address>), delegates to
	 * Q.Crypto.OpenClaim.EVM.verify so all EVM recovery logic stays in one place.
	 *
	 * Policy:
	 *   null / omitted   → at least 1 valid signature required
	 *   integer N        → at least N valid signatures required
	 *   { mode: "all" }  → every key must have a valid signature
	 *   { minValid: N }  → at least N valid signatures required
	 *
	 * @static
	 * @method verify
	 *
	 * @param  {Object}        claim   OCP claim with key[] and sig[]
	 * @param  {Number|Object} [policy]
	 *
	 * @return {Q.Promise<Boolean>}
	 */
	return function Q_Crypto_OpenClaim_verify(claim, policy) {

		var keys = _toArray(claim.key);
		var sigs = _normalizeSigs(claim.sig);

		if (!keys.length) {
			return Q.Promise.resolve(false);
		}

		var state = _buildSortedState(keys, sigs);
		var tmp   = Object.assign({}, claim, { key: state.keys, sig: state.signatures });

		return Q.Crypto.OpenClaim.canonicalize(tmp).then(function (canon) {

			var data  = new TextEncoder().encode(canon);
			var valid = 0;

			// Verify each key sequentially — reduces complexity vs Promise.all
			// with mutable valid counter, and avoids async/await.
			var pending = state.keys.slice(); // queue

			function verifyNext() {
				if (!pending.length) {
					return Q.Promise.resolve(valid >= _parsePolicy(policy, state.keys.length));
				}

				var k   = pending.shift();
				var idx = state.keys.indexOf(k);
				var sig = state.signatures[idx];

				if (!sig) {
					return verifyNext();
				}

				return Q.Crypto.OpenClaim.resolve(k).then(function (keyObj) {
					if (!keyObj) { return verifyNext(); }

					var keyObjs = Array.isArray(keyObj) ? keyObj : [keyObj];

					// Try each key object in sequence — returns Promise
					return _tryKeyObjs(keyObjs, 0, sig, data, claim).then(function (matched) {
						if (matched) { valid++; }
						return verifyNext();
					});
				}).catch(function () {
					return verifyNext();
				});
			}

			return verifyNext();

		}).catch(function () {
			return false;
		});
	};

	// Try each key object in keyObjs[idx..] — returns Promise<Boolean>
	function _tryKeyObjs(keyObjs, idx, sig, data, claim) {
		if (idx >= keyObjs.length) {
			return Q.Promise.resolve(false);
		}

		var ko  = keyObjs[idx];
		if (!ko) { return _tryKeyObjs(keyObjs, idx + 1, sig, data, claim); }

		var fmt = String(ko.fmt || "").toUpperCase();

		// ── ES256 ─────────────────────────────────────────────────────────────
		if (fmt === "ES256") {
			var spki = ko.value instanceof Uint8Array
				? ko.value
				: Q.Data.fromBase64(String(ko.value));

			return crypto.subtle.importKey(
				"spki",
				spki,
				{ name: "ECDSA", namedCurve: "P-256" },
				false,
				["verify"]
			).then(function (cryptoKey) {
				// sig[] stores base64 raw r||s (64 bytes)
				// SubtleCrypto verify with {hash:"SHA-256"} accepts
				// raw r||s for ECDSA P-256 (IEEE P1363 format)
				var sigBytes = Q.Data.fromBase64(sig);
				return crypto.subtle.verify(
					{ name: "ECDSA", hash: "SHA-256" },
					cryptoKey,
					sigBytes,  // raw r||s
					data       // raw canonical bytes — subtle hashes once
				);
			}).then(function (ok) {
				if (ok) { return true; }
				return _tryKeyObjs(keyObjs, idx + 1, sig, data, claim);
			}).catch(function () {
				return _tryKeyObjs(keyObjs, idx + 1, sig, data, claim);
			});
		}

		// ── EIP712 ────────────────────────────────────────────────────────────
		if (fmt === "EIP712") {
			// Delegate to Q.Crypto.OpenClaim.EVM.verify
			// which uses Q.Crypto.verify({format:"EIP712",...})
			return Q.Crypto.OpenClaim.EVM.verify(
				claim,
				sig,
				String(ko.value) // expected address
			).then(function (evmOk) {
				if (evmOk) { return true; }
				return _tryKeyObjs(keyObjs, idx + 1, sig, data, claim);
			}).catch(function () {
				return _tryKeyObjs(keyObjs, idx + 1, sig, data, claim);
			});
		}

		// Unknown format — skip
		return _tryKeyObjs(keyObjs, idx + 1, sig, data, claim);
	}

	// ── Helpers ───────────────────────────────────────────────────────────────

	function _toArray(v) {
		return v == null ? [] : Array.isArray(v) ? v : [v];
	}

	function _normalizeSigs(v) {
		return _toArray(v).map(function (x) { return x == null ? null : String(x); });
	}

	function _buildSortedState(keys, sigs) {
		var pairs = keys.map(function (k, i) {
			return { key: k, sig: i < sigs.length ? sigs[i] : null };
		});
		pairs.sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });
		return {
			keys:       pairs.map(function (p) { return p.key; }),
			signatures: pairs.map(function (p) { return p.sig; })
		};
	}

	function _parsePolicy(policy, totalKeys) {
		if (policy == null)                            return 1;
		if (typeof policy === "number")                return policy;
		if (policy.mode === "all")                     return totalKeys;
		if (typeof policy.minValid === "number")       return policy.minValid;
		return 1;
	}

});
