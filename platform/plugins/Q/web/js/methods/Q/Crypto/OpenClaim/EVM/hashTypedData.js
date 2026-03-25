Q.exports(function (Q) {

	/**
	 * Compute the EIP-712 typed-data digest for an OpenClaim EVM claim.
	 *
	 * Builds the full Payment or Authorization payload (including all sub-hashes
	 * such as recipientsHash, actorsHash, etc.) then returns the 32-byte EIP-712
	 * digest via Q_Crypto_EIP712 / eip712.js.
	 *
	 * The result is byte-identical to:
	 *   PHP: Q_OpenClaim_EVM::hashTypedData($claim)
	 *   Standalone JS: Q.OpenClaim.EVM.hashTypedData(claim)
	 *
	 * Also exposes the built payload as proof.payload so callers can pass
	 * domain / primaryType / types / value directly to Q.Crypto.sign / Q.Crypto.verify.
	 *
	 * @static
	 * @method hashTypedData  (Q.Crypto.OpenClaim.EVM.hashTypedData)
	 *
	 * @param  {Object} claim  OCP EVM claim (Payment or Authorization fields)
	 * @return {Q.Promise<Object>}  { digest: Uint8Array(32), payload: Object }
	 *   payload = { domain, primaryType, types, value }
	 */
	return function Q_Crypto_OpenClaim_EVM_hashTypedData(claim) {

		// Load sha3 for keccak256 — same module as eip712.js uses
		return Q.Promise.resolve(
			import(Q.url("{{Q}}/src/js/crypto/sha3.js"))
		).then(function (sha3) {

			function keccak(bytes) {
				return new Uint8Array(sha3.keccak_256(
					bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
				));
			}

			var payload = _buildPayload(claim, keccak);

			// Compute EIP-712 digest via eip712.js
			// This is the same module Q.Crypto.sign/verify use for EIP712 format
			return Q.Promise.resolve(
				import(Q.url("{{Q}}/src/js/crypto/eip712.js"))
			).then(function (eip712) {

				var digest = new Uint8Array(eip712.hashTypedData(
					payload.domain,
					payload.primaryType,
					payload.value,
					payload.types
				));

				return { digest: digest, payload: payload };
			});
		});
	};

	// ── Type definitions ──────────────────────────────────────────────────────
	// Identical to Q_OpenClaim_EVM::$PAYMENT_TYPES / $AUTHORIZATION_TYPES in PHP.

	var PAYMENT_TYPES = {
		EIP712Domain: [
			{ name: "name",              type: "string"  },
			{ name: "version",           type: "string"  },
			{ name: "chainId",           type: "uint256" },
			{ name: "verifyingContract", type: "address" }
		],
		Payment: [
			{ name: "payer",          type: "address" },
			{ name: "token",          type: "address" },
			{ name: "recipientsHash", type: "bytes32" },
			{ name: "max",            type: "uint256" },
			{ name: "line",           type: "uint256" },
			{ name: "nbf",            type: "uint256" },
			{ name: "exp",            type: "uint256" }
		]
	};

	var AUTHORIZATION_TYPES = {
		EIP712Domain: [
			{ name: "name",              type: "string"  },
			{ name: "version",           type: "string"  },
			{ name: "chainId",           type: "uint256" },
			{ name: "verifyingContract", type: "address" }
		],
		Authorization: [
			{ name: "authority",       type: "address" },
			{ name: "subject",         type: "address" },
			{ name: "actorsHash",      type: "bytes32" },
			{ name: "rolesHash",       type: "bytes32" },
			{ name: "actionsHash",     type: "bytes32" },
			{ name: "constraintsHash", type: "bytes32" },
			{ name: "contextsHash",    type: "bytes32" },
			{ name: "nbf",             type: "uint256" },
			{ name: "exp",             type: "uint256" }
		]
	};

	// ── Payload builder ───────────────────────────────────────────────────────

	function _buildPayload(claim, keccak) {
		var payer     = _read(claim, "payer");
		var token     = _read(claim, "token");
		var line      = _read(claim, "line");
		var authority = _read(claim, "authority");
		var subject   = _read(claim, "subject");

		if (payer && token != null && line != null) {
			return _paymentPayload(claim, keccak);
		}
		if (authority && subject) {
			return _authorizationPayload(claim, keccak);
		}
		throw new Error("Q.Crypto.OpenClaim.EVM.hashTypedData: cannot detect claim extension");
	}

	function _paymentPayload(claim, keccak) {
		var recipients = _arr(_read(claim, "recipients", []));
		return {
			primaryType: "Payment",
			domain: {
				name:              "OpenClaiming.payments",
				version:           "1",
				chainId:           claim.chainId,
				verifyingContract: claim.contract
			},
			types: PAYMENT_TYPES,
			value: {
				payer:          _lower(_read(claim, "payer", "")),
				token:          _lower(_read(claim, "token", "")),
				recipientsHash: _hashAddresses(keccak, recipients),
				max:            BigInt(_read(claim, "max",  0) || 0),
				line:           BigInt(_read(claim, "line", 0) || 0),
				nbf:            BigInt(_read(claim, "nbf",  0) || 0),
				exp:            BigInt(_read(claim, "exp",  0) || 0)
			}
		};
	}

	function _authorizationPayload(claim, keccak) {
		var actors      = _arr(_read(claim, "actors",      []));
		var roles       = _arr(_read(claim, "roles",       []));
		var actions     = _arr(_read(claim, "actions",     []));
		var constraints = _arr(_read(claim, "constraints", []));
		var contexts    = _arr(_read(claim, "contexts",    []));
		return {
			primaryType: "Authorization",
			domain: {
				name:              "OpenClaiming.authorizations",
				version:           "1",
				chainId:           claim.chainId,
				verifyingContract: claim.contract
			},
			types: AUTHORIZATION_TYPES,
			value: {
				authority:       _lower(_read(claim, "authority", "")),
				subject:         _lower(_read(claim, "subject",   "")),
				actorsHash:      _hashAddresses(keccak, actors),
				rolesHash:       _hashStrings(keccak, roles),
				actionsHash:     _hashStrings(keccak, actions),
				constraintsHash: _hashConstraints(keccak, constraints),
				contextsHash:    _hashContexts(keccak, contexts),
				nbf:             BigInt(_read(claim, "nbf", 0) || 0),
				exp:             BigInt(_read(claim, "exp", 0) || 0)
			}
		};
	}

	// ── ABI sub-hash helpers ──────────────────────────────────────────────────
	// Byte-identical to Q_OpenClaim_EVM hash helpers in PHP.

	var te = new TextEncoder();

	function _concat() {
		var parts = Array.prototype.slice.call(arguments);
		var len = 0;
		parts.forEach(function (p) { len += p.length; });
		var out = new Uint8Array(len);
		var pos = 0;
		parts.forEach(function (p) { out.set(p, pos); pos += p.length; });
		return out;
	}

	function _padLeft32(bytes) {
		var out = new Uint8Array(32);
		out.set(bytes, 32 - bytes.length);
		return out;
	}

	function _encodeAddress(addr) {
		var hex = String(addr).replace(/^0x/i, "").toLowerCase().padStart(40, "0");
		var b = new Uint8Array(20);
		for (var i = 0; i < 20; i++) { b[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16); }
		return _padLeft32(b);
	}

	function _hashAddresses(keccak, addrs) {
		if (!addrs.length) { return keccak(new Uint8Array(0)); }
		return keccak(_concat.apply(null, addrs.map(_encodeAddress)));
	}

	function _hashStrings(keccak, strings) {
		if (!strings.length) { return keccak(new Uint8Array(0)); }
		var hashes = strings.map(function (s) { return keccak(te.encode(String(s))); });
		return keccak(_concat.apply(null, hashes));
	}

	function _hashConstraints(keccak, constraints) {
		if (!constraints.length) { return keccak(new Uint8Array(0)); }
		var th = keccak(te.encode("Constraint(string key,string op,string value)"));
		var hashes = constraints.map(function (c) {
			return keccak(_concat(
				th,
				keccak(te.encode(c.key   || "")),
				keccak(te.encode(c.op    || "")),
				keccak(te.encode(c.value || ""))
			));
		});
		return keccak(_concat.apply(null, hashes));
	}

	function _hashContexts(keccak, contexts) {
		if (!contexts.length) { return keccak(new Uint8Array(0)); }
		var th = keccak(te.encode("Context(string type,string value)"));
		var hashes = contexts.map(function (ctx) {
			return keccak(_concat(
				th,
				keccak(te.encode(ctx.type  || ctx.fmt || "")),
				keccak(te.encode(ctx.value || ""))
			));
		});
		return keccak(_concat.apply(null, hashes));
	}

	// ── Utility ───────────────────────────────────────────────────────────────

	function _arr(v)   { return v == null ? [] : Array.isArray(v) ? v : [v]; }
	function _lower(v) { return String(v).toLowerCase(); }

	function _read(claim, key, fallback) {
		if (claim[key] != null)                  { return claim[key]; }
		if (claim.stm && claim.stm[key] != null) { return claim.stm[key]; }
		return fallback !== undefined ? fallback : null;
	}

});
