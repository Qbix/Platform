Q.exports(function (Q) {

	/**
	 * Compute the EIP-712 typed-data digest for an OpenClaim EVM claim.
	 *
	 * Supported extensions:
	 *   payments — Payment struct (payer, token, recipientsHash, max, line, nbf, exp)
	 *   actions  — Action struct (authority, subject, contractAddress, method,
	 *                             paramsHash, minimum, fraction, delay, nbf, exp)
	 *   messages — MessageAssociation struct (account, endpointType, commitment)
	 *
	 * Detection order:
	 *   payments  — payer + token + line present
	 *   actions   — authority + subject + contractAddress present
	 *   messages  — account + endpointType present
	 *
	 * Byte-identical to:
	 *   PHP: Q_Crypto_OpenClaim_EVM::hashTypedData($claim)
	 *   Node: Q.Crypto.OpenClaim.EVM.hashTypedData(claim)
	 *
	 * @static
	 * @method hashTypedData  (Q.Crypto.OpenClaim.EVM.hashTypedData)
	 * @param  {Object} claim
	 * @return {Q.Promise<{ digest: Uint8Array(32), payload: Object }>}
	 */
	return function Q_Crypto_OpenClaim_EVM_hashTypedData(claim) {

		return Q.Promise.resolve(
			import(Q.url("{{Q}}/src/js/crypto/sha3.js"))
		).then(function (sha3) {

			function keccak(bytes) {
				return new Uint8Array(sha3.keccak_256(
					bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
				));
			}

			var payload = _buildPayload(claim, keccak);

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

	var DOMAIN_FIELDS = [
		{ name: "name",              type: "string"  },
		{ name: "version",           type: "string"  },
		{ name: "chainId",           type: "uint256" },
		{ name: "verifyingContract", type: "address" }
	];

	var PAYMENT_TYPES = {
		EIP712Domain: DOMAIN_FIELDS,
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

	var ACTIONS_TYPES = {
		EIP712Domain: DOMAIN_FIELDS,
		Action: [
			{ name: "authority",        type: "address" },
			{ name: "subject",          type: "address" },
			{ name: "contractAddress",  type: "address" },
			{ name: "method",           type: "bytes4"  },
			{ name: "paramsHash",       type: "bytes32" },
			{ name: "minimum",          type: "uint256" },
			{ name: "fraction",         type: "uint256" },
			{ name: "delay",            type: "uint256" },
			{ name: "nbf",              type: "uint256" },
			{ name: "exp",              type: "uint256" }
		]
	};

	var MESSAGES_TYPES = {
		EIP712Domain: DOMAIN_FIELDS,
		MessageAssociation: [
			{ name: "account",      type: "address" },
			{ name: "endpointType", type: "bytes32" },
			{ name: "commitment",   type: "bytes32" }
		]
	};

	// ── Payload builder ───────────────────────────────────────────────────────

	function _buildPayload(claim, keccak) {
		var payer           = _read(claim, "payer");
		var token           = _read(claim, "token");
		var line            = _read(claim, "line");
		var authority       = _read(claim, "authority");
		var subject         = _read(claim, "subject");
		var contractAddress = _read(claim, "contractAddress") || _read(claim, "contract");
		var account         = _read(claim, "account");
		var endpointType    = _read(claim, "endpointType");

		if (payer != null && token != null && line != null) {
			return _paymentPayload(claim, keccak);
		}
		if (authority != null && subject != null && contractAddress != null) {
			return _actionsPayload(claim, keccak);
		}
		if (account != null && endpointType != null) {
			return _messagesPayload(claim);
		}
		throw new Error("Q.Crypto.OpenClaim.EVM.hashTypedData: cannot detect extension (payments, actions, or messages)");
	}

	function _paymentPayload(claim, keccak) {
		var recipients = _arr(_read(claim, "recipients", []));
		return {
			primaryType: "Payment",
			domain: {
				name:              "OpenClaiming.payments",
				version:           "1",
				chainId:           _caip2ToChainId(claim.chainId),
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

	function _actionsPayload(claim, keccak) {
		// stm.contract in OCP wire format → contractAddress in EIP-712 struct
		var contractAddress = _read(claim, "contractAddress") || _read(claim, "contract");
		// method: hex string "a9059cbb" → bytes4 Uint8Array(4)
		var methodHex = String(_read(claim, "method") || "").replace(/^0x/i, "").padEnd(8, "0").slice(0, 8);
		var methodBytes = new Uint8Array(4);
		for (var i = 0; i < 4; i++) {
			methodBytes[i] = parseInt(methodHex.slice(i * 2, i * 2 + 2), 16);
		}
		// paramsHash: if already bytes32 (hex string) pass through;
		// if raw params bytes/hex provided, hash them
		var paramsHash = _read(claim, "paramsHash");
		if (!paramsHash) {
			var params = _read(claim, "params") || "";
			var paramBytes = typeof params === "string"
				? _hexToBytes(params.replace(/^0x/i, ""))
				: new Uint8Array(params);
			paramsHash = keccak(paramBytes);
		}
		return {
			primaryType: "Action",
			domain: {
				name:              "OpenClaiming.actions",
				version:           "1",
				chainId:           _caip2ToChainId(claim.chainId),
				verifyingContract: claim.contract
			},
			types: ACTIONS_TYPES,
			value: {
				authority:       _lower(_read(claim, "authority", "")),
				subject:         _lower(_read(claim, "subject",   "")),
				contractAddress: _lower(String(contractAddress || "").replace(/^evm:\d+:address:/i, "")),
				method:          methodBytes,
				paramsHash:      paramsHash,
				minimum:         BigInt(_read(claim, "minimum", 0) || 0),
				fraction:        BigInt(_read(claim, "fraction", 0) || 0),
				delay:           BigInt(_read(claim, "delay",   0) || 0),
				nbf:             BigInt(_read(claim, "nbf",     0) || 0),
				exp:             BigInt(_read(claim, "exp",     0) || 0)
			}
		};
	}

	function _messagesPayload(claim) {
		return {
			primaryType: "MessageAssociation",
			domain: {
				name:              "OpenClaiming.messages",
				version:           "1",
				chainId:           _caip2ToChainId(claim.chainId),
				verifyingContract: claim.contract
			},
			types: MESSAGES_TYPES,
			value: {
				account:      _lower(_read(claim, "account", "")),
				endpointType: _read(claim, "endpointType"),
				commitment:   _read(claim, "commitment")
			}
		};
	}

	// ── ABI sub-hash helpers ──────────────────────────────────────────────────

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
		// Strip OCP URI prefix if present: "evm:56:address:0xABC" → "0xABC"
		var s = String(addr).replace(/^evm:\d+:address:/i, "");
		var hex = s.replace(/^0x/i, "").toLowerCase().padStart(40, "0");
		var b = new Uint8Array(20);
		for (var i = 0; i < 20; i++) { b[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16); }
		return _padLeft32(b);
	}

	function _hexToBytes(hex) {
		if (hex.length % 2) { hex = "0" + hex; }
		var out = new Uint8Array(hex.length / 2);
		for (var i = 0; i < out.length; i++) {
			out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
		}
		return out;
	}

	/**
	 * Hash an address array matching Solidity paymentsHashRecipients():
	 *   keccak256(abi.encode(address[]))
	 * = offset(32) + length(32) + padded elements(32 each)
	 */
	function _hashAddresses(keccak, addrs) {
		var offset = new Uint8Array(32);
		offset[31] = 0x20;

		var length = new Uint8Array(32);
		var n = addrs.length;
		for (var i = 0; i < 32; i++) { length[31 - i] = n & 0xff; n >>= 8; }

		var elements = addrs.length
			? _concat.apply(null, addrs.map(_encodeAddress))
			: new Uint8Array(0);

		return keccak(_concat(offset, length, elements));
	}

	// ── Utility ───────────────────────────────────────────────────────────────

	function _arr(v)   { return v == null ? [] : Array.isArray(v) ? v : [v]; }
	function _lower(v) { return String(v).toLowerCase(); }

	function _read(claim, key, fallback) {
		if (claim[key] != null)                  { return claim[key]; }
		if (claim.stm && claim.stm[key] != null) { return claim.stm[key]; }
		return fallback !== undefined ? fallback : null;
	}

	/**
	 * Convert CAIP-2 chain ID ('eip155:56') or OCP chain ID ('evm:56:...')
	 * or plain string/number to integer for the EIP-712 domain chainId.
	 */
	function _caip2ToChainId(v) {
		if (typeof v === "number") { return v; }
		if (typeof v === "string") {
			if (v.indexOf("eip155:") === 0) { return parseInt(v.slice(7), 10); }
			// OCP URI format: "evm:56:address:0x..." → extract chain id
			var m = v.match(/^evm:(\d+):/);
			if (m) { return parseInt(m[1], 10); }
			return parseInt(v, 10);
		}
		return v;
	}

});
