Q.exports(function (Q) {

	/**
	 * Verify an OpenClaim EVM signature against an expected Ethereum address.
	 *
	 * Builds the EIP-712 payload via Q.Crypto.OpenClaim.EVM.hashTypedData,
	 * then delegates entirely to Q.Crypto.verify (EIP712 format) which:
	 *   - computes the EIP-712 digest via eip712.js (byte-identical to PHP)
	 *   - recovers the signer address via secp256k1 ecrecover
	 *   - compares against expectedAddress (if provided)
	 *
	 * This is the correct and complete path — Q.Crypto.verify EIP712 is the
	 * single source of truth for secp256k1 recovery in the Q framework.
	 *
	 * @static
	 * @method verify  (Q.Crypto.OpenClaim.EVM.verify)
	 *
	 * @param  {Object}            claim            OCP EVM claim
	 * @param  {String|Uint8Array} signature        65-byte r||s||v (hex, base64, or Uint8Array)
	 * @param  {String}            [expectedAddress]  "0x..." Ethereum address to verify against
	 * @param  {Object}            [recovered=null]   If object, recovered.address is written here
	 *
	 * @return {Q.Promise<Boolean>}
	 *   true  — signature is valid (and matches expectedAddress if given)
	 *   false — invalid or address mismatch
	 */
	return function Q_Crypto_OpenClaim_EVM_verify(claim, signature, expectedAddress, recovered) {

		// Build typed payload
		return Q.Crypto.OpenClaim.EVM.hashTypedData(claim).then(function (result) {

			var payload = result.payload;

			// Normalize signature to Uint8Array
			var sigBytes = _normalizeSig(signature);
			if (!sigBytes) { return false; }

			// recovered object for address extraction
			var recoveredOut = recovered || {};

			return Q.Crypto.verify({
				format:      "EIP712",
				domain:      payload.domain,
				primaryType: payload.primaryType,
				types:       payload.types,
				message:     payload.value,
				signature:   sigBytes,
				address:     expectedAddress || undefined,
				recovered:   recoveredOut
			}).then(function (ok) {

				// Write back recovered address if caller passed an object
				if (recovered && typeof recovered === "object") {
					recovered.address = recoveredOut.address;
				}

				return !!ok;
			});

		}).catch(function () {
			return false;
		});
	};

	// ── Helpers ───────────────────────────────────────────────────────────────

	function _normalizeSig(sig) {
		if (sig instanceof Uint8Array) { return sig; }
		if (typeof sig === "string") {
			// hex (with or without 0x)
			var hex = sig.replace(/^0x/i, "");
			if (/^[0-9a-fA-F]{130}$/.test(hex)) {
				return Q.Data.fromHex(hex);
			}
			// base64
			try { return Q.Data.fromBase64(sig); } catch (e) {}
		}
		return null;
	}

});
