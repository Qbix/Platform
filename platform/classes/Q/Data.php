<?php

class Q_Data
{
	/**
	 * Computes the binary digest of the given data using a hash algorithm.
	 * @method digest
	 * @static
	 * @param {string} $data The input data
	 * @param {string} $algo The hash algorithm to use (default "sha256")
	 * @return {string} Binary hash output
	 */
	public static function digest($data, $algo = 'sha256') {
		return hash($algo, $data, true);
	}

	/**
	 * Compresses a string using gzip.
	 * @method compress
	 * @static
	 * @param {string} $data The input data
	 * @return {string} The compressed string
	 */
	public static function compress($data) {
		return gzcompress($data);
	}

	/**
	 * Decompresses a gzip-compressed string.
	 * @method decompress
	 * @static
	 * @param {string} $data The compressed input data
	 * @return {string} The original uncompressed string
	 */
	public static function decompress($data) {
		return gzuncompress($data);
	}

	/**
	 * Signs the given data using an array of private keys (PKCS8 base64).
	 * @method sign
	 * @static
	 * @param {string} $data The data to sign
	 * @param {array} $privateKeyPKCS8Strings An array of base64-encoded PKCS8 private keys
	 * @param {array} [$algo] Optional: algorithm config (default uses ECDSA/sha256)
	 * @return {array} Array of binary signatures
	 * @throws {Exception} If any key cannot be imported or signing fails
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

			$pem = self::pemFromDer($der, 'PRIVATE');

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

			$signatures[] = $signature;
		}

		return $signatures;
	}

	/**
	 * Verifies the given data against multiple public keys and signatures.
	 * @method verify
	 * @static
	 * @param {string} $data The signed data
	 * @param {array} $publicKeyRawStrings Array of base64-encoded raw public keys
	 * @param {array} $signatures Array of corresponding signatures
	 * @param {array} [$algo] Optional: algorithm config (default uses ECDSA/sha256)
	 * @return {array} Array of booleans indicating valid signatures
	 * @throws {Exception} If a public key or signature is invalid
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

			$pem = self::pemFromDer($der, 'PUBLIC');
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

			$result = openssl_verify($data, $sig, $publicKey, $algo['hash']);
			openssl_free_key($publicKey);

			$results[] = ($result === 1);
		}

		return $results;
	}

	/**
	 * Converts binary to base64. Optionally accepts hex input.
	 * @method toBase64
	 * @static
	 * @param {string} $data Input data (binary or hex)
	 * @param {bool} $isHex Whether to treat input as hex string
	 * @return {string} Base64-encoded result
	 */
	public static function toBase64($data, $isHex = false) {
		if ($isHex) {
			$data = pack('H*', $data);
		}
		return base64_encode($data);
	}

	/**
	 * Converts a base64 string into binary.
	 * @method fromBase64
	 * @static
	 * @param {string} $base64 The base64-encoded string
	 * @return {string} Binary decoded data
	 */
	public static function fromBase64($base64) {
		return base64_decode($base64);
	}

	/**
	 * Deterministically returns true if the hash falls into the 0th shard (out of segments).
	 * Useful for sharding, consistent partitioning, A/B testing.
	 * @method variant
	 * @static
	 * @param {string} $sessionId A unique session or user identifier
	 * @param {int} $index The index (e.g. user # or round #)
	 * @param {int} $segments Total number of segments
	 * @param {int} $seed Optional hash salt
	 * @return {bool} Whether the item falls into the first segment
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

	/**
	 * Emulates 32-bit integer multiplication (like JavaScript's Math.imul).
	 * @method imul
	 * @static
	 * @param {int} $a
	 * @param {int} $b
	 * @return {int}
	 */
	private static function imul($a, $b) {
		$a = $a & 0xFFFFFFFF;
		$b = $b & 0xFFFFFFFF;
		$al = $a & 0xFFFF;
		$ah = self::unsignedRightShift($a, 16);
		$bl = $b & 0xFFFF;
		$bh = self::unsignedRightShift($b, 16);
		return (($al * $bl) + (((($ah * $bl + $al * $bh) & 0xFFFF) << 16))) & 0xFFFFFFFF;
	}

	/**
	 * Emulates unsigned right shift (>>>), like in JavaScript.
	 * @method unsignedRightShift
	 * @static
	 * @param {int} $value
	 * @param {int} $shift
	 * @return {int}
	 */
	private static function unsignedRightShift($value, $shift) {
		if ($value < 0) {
			$value += 0x100000000;
		}
		return ($value >> $shift) & (0x7FFFFFFF >> ($shift - 1));
	}

	/**
	 * Converts a DER-encoded key to PEM format for OpenSSL.
	 * @method pemFromDer
	 * @static
	 * @param {string} $der DER-encoded key data
	 * @param {string} $type "PRIVATE" or "PUBLIC"
	 * @return {string} PEM-formatted key string
	 */
	private static function pemFromDer($der, $type = 'PRIVATE') {
		$base64 = chunk_split(base64_encode($der), 64, "\n");
		return "-----BEGIN {$type} KEY-----\n{$base64}-----END {$type} KEY-----\n";
	}
}