<?php

class Q_Data
{
	/**
	 * Compute a cryptographic hash of binary data.
	 *
	 * Accepts PHP-style algorithm names (e.g. "sha256") as well as
	 * common JS-style names (e.g. "SHA-256", "KECCAK-256").
	 *
	 * @method digest
	 * @static
	 * @param {string} data
	 *   Raw binary string to hash.
	 * @param {string} [algo="sha256"]
	 *   Hash algorithm. Supported values depend on the PHP build,
	 *   but typically include sha256, sha384, sha512, sha3-256.
	 * @return {string}
	 *   Raw binary hash output.
	 * @throws {Exception}
	 *   If the algorithm is unsupported.
	 */

	public static function digest($data, $algo = 'sha256') {
		return hash($algo, $data, true);
	}

	/**
	 * Decompress gzip-compressed data.
	 *
	 * Supports data produced by gzcompress() as well as
	 * some raw DEFLATE variants via fallback.
	 *
	 * @method decompress
	 * @static
	 * @param {string} data
	 *   Gzip-compressed binary string.
	 * @return {string}
	 *   Decompressed raw data.
	 * @throws {Exception}
	 *   If decompression fails.
	 */
	public static function compress($data) {
		return gzcompress($data);
	}

	/**
	 * Decompress gzip-compressed data.
	 *
	 * Supports data produced by gzcompress() as well as
	 * some raw DEFLATE variants via fallback.
	 *
	 * @method decompress
	 * @static
	 * @param {string} data
	 *   Gzip-compressed binary string.
	 * @return {string}
	 *   Decompressed raw data.
	 * @throws {Exception}
	 *   If decompression fails.
	 */
	public static function decompress($data) {
		return gzuncompress($data);
	}

	/**
	 * Sign data using one or more ECDSA private keys (P-256).
	 *
	 * Private keys must be provided as base64-encoded DER PKCS#8 blobs,
	 * compatible with WebCrypto `importKey("pkcs8")`.
	 *
	 * Signatures are returned in raw r||s format (64 bytes),
	 * suitable for JavaScript verification.
	 *
	 * @method sign
	 * @static
	 * @param {string} data
	 *   Raw data to sign (not hashed beforehand).
	 * @param {array} privateKeyPKCS8Strings
	 *   Array of base64-encoded PKCS#8 private keys.
	 * @param {Object} [algo]
	 * @param {string} [algo.hash="sha256"]
	 *   Hash algorithm used by ECDSA.
	 * @return {array}
	 *   Array of raw signatures (each 64-byte binary string).
	 * @throws {Exception}
	 *   If key import or signing fails.
	 */
	public static function sign($data, $privateKeyPKCS8Strings, $algo = []) {
		$algo = array_merge([
			'name' => 'ECDSA',
			'hash' => 'sha256'
		], $algo);

		$signatures = [];

		foreach ($privateKeyPKCS8Strings as $pks) {
			$der = base64_decode($pks);
			if ($der === false) {
				throw new Exception("Invalid Base64 encoding in private key");
			}

			$pem = self::DERtoPEM($der, 'PRIVATE');
			$privateKey = openssl_pkey_get_private($pem);
			if (!$privateKey) {
				throw new Exception("Failed to import private key");
			}

			$signature = '';
			$ok = openssl_sign($data, $signature, $privateKey, $algo['hash']);
			openssl_free_key($privateKey);

			if (!$ok) {
				throw new Exception("Signing failed with given key");
			}

			// Convert DER signature to raw r||s for JS compatibility
			$signatures[] = self::DERToRAW($signature);
		}

		return $signatures;
	}

	/**
	 * Verify one or more ECDSA signatures against corresponding public keys.
	 *
	 * Public keys may be provided in either of the following base64-encoded forms:
	 * - DER SubjectPublicKeyInfo (PKCS#8 public key)
	 * - Raw uncompressed P-256 point (65 bytes, 0x04 || X || Y)
	 *
	 * Signatures must be provided in raw r||s format (64 bytes),
	 * or base64-encoded raw format.
	 *
	 * @method verify
	 * @static
	 * @param {string} data
	 *   Raw signed data.
	 * @param {array} publicKeyRawStrings
	 *   Array of base64-encoded public keys.
	 * @param {array} signatures
	 *   Array of signatures corresponding to each public key.
	 * @param {Object} [algo]
	 * @param {string} [algo.hash="sha256"]
	 *   Hash algorithm used by ECDSA.
	 * @return {array}
	 *   Array of booleans indicating verification success per key.
	 * @throws {Exception}
	 *   If key import or verification fails.
	 */
	public static function verify($data, $publicKeyRawStrings, $signatures, $algo = []) {
		$algo = array_merge([
			'name' => 'ECDSA',
			'hash' => 'sha256'
		], $algo);

		$results = [];

		foreach ($publicKeyRawStrings as $i => $pubkeyBase64) {
			$der = base64_decode($pubkeyBase64);
			if ($der === false) {
				throw new Exception("Invalid Base64 in public key");
			}

			if (strlen($der) === 65 && ord($der[0]) === 0x04) {
				$pem = self::pkRAWtoPEM($der);
			} else {
				$pem = self::DERtoPEM($der, 'PUBLIC');
			}
			$publicKey = openssl_pkey_get_public($pem);
			if (!$publicKey) {
				throw new Exception("Failed to import public key");
			}

			if (!isset($signatures[$i])) {
				throw new Exception("Missing signature for index $i");
			}

			$sig = $signatures[$i];
			if (is_string($sig) && base64_encode(base64_decode($sig, true)) === $sig) {
				$sig = base64_decode($sig);
			}

			// Convert raw signature to DER before verifying
			$sig = self::RAWtoDER($sig);

			$result = openssl_verify($data, $sig, $publicKey, $algo['hash']);
			openssl_free_key($publicKey);

			$results[] = ($result === 1);
		}

		return $results;
	}

	/**
	 * Encode binary data as base64.
	 *
	 * Optionally accepts hex-encoded input.
	 *
	 * @method toBase64
	 * @static
	 * @param {string} data
	 *   Binary string or hex string.
	 * @param {boolean} [isHex=false]
	 *   Whether the input string is hex-encoded.
	 * @return {string}
	 *   Base64-encoded string.
	 */
	public static function toBase64($data, $isHex = false) {
		if ($isHex) {
			$data = pack('H*', $data);
		}
		return base64_encode($data);
	}

	/**
	 * Decode a base64-encoded string.
	 *
	 * @method fromBase64
	 * @static
	 * @param {string} base64
	 *   Base64-encoded data.
	 * @return {string}
	 *   Decoded binary string.
	 */
	public static function fromBase64($base64) {
		return base64_decode($base64);
	}

	/**
	 * Convert a DER-encoded ECDSA signature into raw r||s format.
	 *
	 * @method DERToRAW
	 * @static
	 * @param {string} der
	 *   DER-encoded ECDSA signature.
	 * @return {string}
	 *   Raw signature (64 bytes).
	 * @throws {Exception}
	 *   If the DER structure is invalid.
	 */
	public static function DERToRAW($der) {
		$offset = 0;
		if (ord($der[$offset++]) !== 0x30) throw new Exception("Invalid DER");
		$length = ord($der[$offset++]);
		if (ord($der[$offset++]) !== 0x02) throw new Exception("Invalid DER");
		$lenR = ord($der[$offset++]);
		$r = substr($der, $offset, $lenR);
		$offset += $lenR;
		if (ord($der[$offset++]) !== 0x02) throw new Exception("Invalid DER");
		$lenS = ord($der[$offset++]);
		$s = substr($der, $offset, $lenS);

		$r = str_pad(ltrim($r, "\x00"), 32, "\x00", STR_PAD_LEFT);
		$s = str_pad(ltrim($s, "\x00"), 32, "\x00", STR_PAD_LEFT);

		return $r . $s;
	}

	/**
	 * Convert a raw r||s ECDSA signature into DER format.
	 *
	 * @method RAWtoDER
	 * @static
	 * @param {string} raw
	 *   Raw signature (64 bytes).
	 * @return {string}
	 *   DER-encoded ECDSA signature.
	 * @throws {Exception}
	 *   If the raw signature length is invalid.
	 */
	public static function RAWtoDER($raw) {
		if (strlen($raw) !== 64) {
			throw new Exception("Invalid raw signature length");
		}

		$r = substr($raw, 0, 32);
		$s = substr($raw, 32, 32);

		$r = ltrim($r, "\x00");
		$s = ltrim($s, "\x00");

		if (ord($r[0]) & 0x80) $r = "\x00" . $r;
		if (ord($s[0]) & 0x80) $s = "\x00" . $s;

		$der = "\x30" .
			chr(4 + strlen($r) + strlen($s)) .
			"\x02" . chr(strlen($r)) . $r .
			"\x02" . chr(strlen($s)) . $s;

		return $der;
	}

	/**
	 * Convert a raw uncompressed P-256 public key into PEM format.
	 *
	 * @method pkRAWtoPEM
	 * @static
	 * @private
	 * @param {string} raw
	 *   Raw public key (65 bytes: 0x04 || X || Y).
	 * @return {string}
	 *   PEM-encoded public key.
	 * @throws {Exception}
	 *   If the key is not a valid uncompressed P-256 point.
	 */
	public static function pkRAWtoPEM($raw)
	{
		// Only uncompressed P-256 supported
		if (strlen($raw) !== 65 || ord($raw[0]) !== 0x04) {
			throw new Exception("Invalid raw EC public key");
		}

		// ASN.1 for:
		// SEQUENCE(
		//   SEQUENCE(ecPublicKey, prime256v1),
		//   BIT STRING (uncompressed point)
		// )

		$algo = hex2bin(
			"301306072A8648CE3D020106082A8648CE3D030107"
		); // ecPublicKey + prime256v1

		$bitstring = "\x03" . chr(strlen($raw) + 1) . "\x00" . $raw;

		$seq = "\x30" . chr(strlen($algo . $bitstring)) . $algo . $bitstring;

		return self::DERtoPEM($seq, 'PUBLIC');
	}

	/**
	 * Deterministically assign a session to a variant bucket.
	 *
	 * Used for A/B testing and feature gating.
	 * The same inputs will always produce the same result.
	 *
	 * @method variant
	 * @static
	 * @param {string} sessionId
	 *   Session identifier (UUID or similar).
	 * @param {number} index
	 *   Variant index.
	 * @param {number} [segments=2]
	 *   Number of total segments.
	 * @param {number} [seed=0xBABE]
	 *   Optional seed to change partitioning.
	 * @return {boolean}
	 *   True if the session belongs to this variant.
	 */
	public static function variant($sessionId, $index, $segments = 2, $seed = 0xBABE) {
		$sessionId = str_replace('-', '', $sessionId);
		$mixedStr = $sessionId . ":" . $index . ":" . $seed;
		$hash = 0x811c9dc5;

		for ($i = 0; $i < strlen($mixedStr); $i++) {
			$hash ^= ord($mixedStr[$i]);
			$hash = self::imul($hash, 0x01000193);
			$hash ^= self::unsignedRightShift($hash, 17);
			$hash = self::imul($hash, 0x85ebca6b);
			$hash ^= self::unsignedRightShift($hash, 13);
			$hash = self::imul($hash, 0xc2b2ae35);
			$hash ^= self::unsignedRightShift($hash, 16);
		}

		return self::unsignedRightShift($hash, 0) % $segments === 0;
	}

	private static function imul($a, $b) {
		$a = $a & 0xFFFFFFFF;
		$b = $b & 0xFFFFFFFF;
		$al = $a & 0xFFFF;
		$ah = self::unsignedRightShift($a, 16);
		$bl = $b & 0xFFFF;
		$bh = self::unsignedRightShift($b, 16);
		return (($al * $bl) + (((($ah * $bl + $al * $bh) & 0xFFFF) << 16))) & 0xFFFFFFFF;
	}

	private static function unsignedRightShift($value, $shift) {
		if ($value < 0) {
			$value += 0x100000000;
		}
		return ($value >> $shift) & (0x7FFFFFFF >> ($shift - 1));
	}

	private static function DERToPEM($der, $type = 'PRIVATE') {
		$base64 = chunk_split(base64_encode($der), 64, "\n");
		return "-----BEGIN {$type} KEY-----\n{$base64}-----END {$type} KEY-----\n";
	}

}