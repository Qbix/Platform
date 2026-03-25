Q.exports(function (Q) {

	/**
	 * Sign an OpenClaim EVM claim (Payment or Authorization) from a secret.
	 *
	 * Builds the EIP-712 payload via Q.Crypto.OpenClaim.EVM.hashTypedData,
	 * then passes domain/primaryType/types/value to Q.Crypto.sign (EIP712 format).
	 * Q.Crypto.sign handles keypair derivation, EIP-712 digest, and signing.
	 *
	 * The derived Ethereum address is stored as data:key/eip712,<address> in key[].
	 * The 65-byte r||s||v signature is base64-encoded and stored in sig[].
	 *
	 * Pass existing = { keys, signatures } to add to a multisig claim.
	 *
	 * @static
	 * @method sign  (Q.Crypto.OpenClaim.EVM.sign)
	 *
	 * @param  {Object}     claim            OCP EVM claim
	 * @param  {Uint8Array} secret           Raw binary secret (32 bytes)
	 * @param  {Object}     [existing={}]    { keys, signatures } for multisig
	 *
	 * @return {Q.Promise<Object>}  Claim with key[] and sig[] populated
	 */
	return function Q_Crypto_OpenClaim_EVM_sign(claim, secret, existing) {

		existing = existing || {};

		// Get the typed payload (domain, primaryType, types, value)
		return Q.Crypto.OpenClaim.EVM.hashTypedData(claim).then(function (result) {

			var payload = result.payload;

			// Q.Crypto.sign handles everything:
			//   - derives secp256k1 keypair from secret (keccak derivation)
			//   - computes EIP-712 digest via eip712.js
			//   - produces 65-byte r||s||v signature
			//   - returns { signature, address, publicKey, ... }
			return Q.Crypto.sign({
				secret:      secret,
				format:      "EIP712",
				domain:      payload.domain,
				primaryType: payload.primaryType,
				types:       payload.types,
				message:     payload.value
			}).then(function (proof) {

				// Key URI uses the derived Ethereum address
				var signerKey = "data:key/eip712," + proof.address;

				var keys = _toArray(existing.keys != null ? existing.keys : claim.key);
				var sigs = _normalizeSigs(
					existing.signatures != null ? existing.signatures : claim.sig
				);

				if (keys.indexOf(signerKey) < 0) { keys.push(signerKey); }

				var state = _buildSortedState(keys, sigs);
				var idx   = state.keys.indexOf(signerKey);

				// Store as base64 for OCP wire format
				state.signatures[idx] = Q.Data.toBase64(proof.signature);

				return Object.assign({}, claim, {
					key: state.keys,
					sig: state.signatures
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

});
