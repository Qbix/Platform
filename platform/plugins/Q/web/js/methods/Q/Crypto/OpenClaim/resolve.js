Q.exports(function (Q) {

	/**
	 * Resolve a key URI string to a parsed key object.
	 *
	 * Supported URI formats:
	 *   data:key/es256;base64,<SPKI-DER-base64>
	 *       → { fmt: "ES256", value: Uint8Array }  (raw SPKI DER bytes)
	 *
	 *   data:key/eip712,<0x-address>
	 *       → { fmt: "EIP712", value: "0x..." }    (address string)
	 *
	 *   https://example.com/...#fragment
	 *       → fetches JSON, follows fragment path, resolves recursively
	 *       → returns { fmt, value } or array of same
	 *
	 *   es256:<value> / eip712:<value>
	 *       → legacy shorthand, parsed directly
	 *
	 * Results are cached for 60 seconds.
	 *
	 * @static
	 * @method resolve
	 * @param  {String} keyStr
	 * @return {Q.Promise<Object|Array|null>}
	 */
	return function Q_Crypto_OpenClaim_resolve(keyStr) {

		// Cache
		var cache    = Q.Crypto.OpenClaim._keyCache    || (Q.Crypto.OpenClaim._keyCache    = {});
		var urlCache = Q.Crypto.OpenClaim._urlCache    || (Q.Crypto.OpenClaim._urlCache    = {});
		var TTL      = 60000;
		var now      = Date.now();

		function getCached(map, k) {
			var e = map[k];
			if (!e) return undefined;
			if (now > e.exp) { delete map[k]; return undefined; }
			return e.val;
		}
		function setCached(map, k, v) {
			map[k] = { val: v, exp: now + TTL };
		}

		function resolveOne(k, seen) {
			seen = seen || [];
			if (seen.indexOf(k) >= 0) {
				return Q.reject(new Error("Q.Crypto.OpenClaim.resolve: cyclic key reference"));
			}

			var cached = getCached(cache, k);
			if (cached !== undefined) return Q.resolve(cached);

			var nextSeen = seen.concat([k]);

			// data:key/
			if (k.indexOf("data:key/") === 0) {
				var result = _parseDataKey(k);
				setCached(cache, k, result);
				return Q.resolve(result);
			}

			// URL document
			if (k.indexOf("http") === 0) {
				var parts = k.split("#");
				var url   = parts[0];

				var cachedDoc = getCached(urlCache, url);
				var fetchPromise = cachedDoc !== undefined
					? Q.resolve(cachedDoc)
					: Q.request({ url: url, parse: "json" }).then(function (data) {
						setCached(urlCache, url, data);
						return data;
					}).catch(function () { return null; });

				return fetchPromise.then(function (doc) {
					if (!doc) { setCached(cache, k, null); return null; }

					var current = doc;
					for (var i = 1; i < parts.length; i++) {
						if (parts[i]) current = current && current[parts[i]];
					}

					if (Array.isArray(current)) {
						setCached(cache, k, current);
						return current;
					}
					if (typeof current === "string") {
						return resolveOne(current, nextSeen).then(function (res) {
							setCached(cache, k, res);
							return res;
						});
					}
					setCached(cache, k, null);
					return null;
				});
			}

			// legacy shorthand: fmt:value
			var colonIdx = k.indexOf(":");
			if (colonIdx > 0) {
				var res = {
					fmt:   k.slice(0, colonIdx).toUpperCase(),
					value: k.slice(colonIdx + 1)
				};
				setCached(cache, k, res);
				return Q.resolve(res);
			}

			setCached(cache, k, null);
			return Q.resolve(null);
		}

		return resolveOne(keyStr);
	};

	// ── private ──────────────────────────────────────────────────────────────

	function _parseDataKey(keyStr) {
		var commaIdx = keyStr.indexOf(",");
		if (commaIdx < 0) return null;

		var meta     = keyStr.slice(5, commaIdx);   // "key/es256;base64"
		var data     = keyStr.slice(commaIdx + 1);
		var parts    = meta.split(";");
		var fmt      = parts[0].replace("key/", "").toUpperCase();
		var encoding = "raw";

		for (var i = 1; i < parts.length; i++) {
			if (parts[i] === "base64")    encoding = "base64";
			if (parts[i] === "base64url") encoding = "base64url";
		}

		var value;
		if (encoding === "base64") {
			value = Q.Data.fromBase64(data);
		} else if (encoding === "base64url") {
			var pad = data.length % 4;
			var b64 = data.replace(/-/g, "+").replace(/_/g, "/") +
				(pad ? "===".slice(0, 4 - pad) : "");
			value = Q.Data.fromBase64(b64);
		} else {
			value = data; // raw string (e.g. EIP712 address)
		}

		return { fmt: fmt, value: value };
	}

});
