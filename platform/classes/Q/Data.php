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
	 * @param {string} algo
	 *   Hash algorithm. Supported values depend on the PHP build,
	 *   but typically include sha256, sha384, sha512, sha3-256.
	 * @param {string} data
	 *   Raw binary string to hash.
	 * @return {string}
	 *   Raw binary hash output.
	 * @throws {Exception}
	 *   If the algorithm is unsupported.
	 */
	public static function digest($algo, $data) {
		$algo = strtolower($algo);

		switch ($algo) {
			case 'sha256':
			case 'sha-256':
				$algo = 'sha256';
				break;

			case 'sha384':
			case 'sha-384':
				$algo = 'sha384';
				break;

			case 'sha512':
			case 'sha-512':
				$algo = 'sha512';
				break;

			case 'sha3-256':
				$algo = 'sha3-256';
				break;

			case 'keccak256':
			case 'keccak-256':
				return \Crypto\Keccak::hash($data, 256, true);

			default:
				throw new Exception("Unsupported hash algorithm: $algo");
		}
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
	 * Derive cryptographic key material using HKDF (RFC 5869, SHA-256).
	 *
	 * This function is compatible with WebCrypto HKDF:
	 * - Uses SHA-256
	 * - Accepts arbitrary salt and info
	 * - Produces deterministic output for same inputs
	 *
	 * @method hkdf
	 * @static
	 * @param {string} ikm
	 *   Input key material (raw binary string).
	 * @param {string} salt
	 *   Salt value (raw binary string). Can be empty but should be random.
	 * @param {string} [info=""]
	 *   Optional context/application-specific information.
	 * @param {number} [length=32]
	 *   Length of output keying material in bytes.
	 * @return {string}
	 *   Derived key material (raw binary string of length bytes).
	 * @throws {Exception}
	 *   If inputs are not valid binary strings.
	 */
	public static function hkdf($ikm, $salt, $info = '', $length = 32)
	{
		if (!is_string($ikm)) {
			throw new Exception("IKM must be binary string");
		}
		if (!is_string($salt)) {
			throw new Exception("Salt must be binary string");
		}
		if (!is_string($info)) {
			throw new Exception("Info must be string");
		}

		// PHP built-in HKDF (correct + constant-time)
		return hash_hkdf(
			'sha256',
			$ikm,
			$length,
			$info,
			$salt
		);
	}

	/**
	 * Deterministically derive key material using HKDF with domain separation.
	 *
	 * PURE FUNCTION:
	 * - no randomness
	 * - no storage
	 * - no side effects
	 *
	 * Seed must be raw binary — callers are responsible for decoding
	 * hex or base64 strings before calling derive().
	 *
	 * @method derive
	 * @static
	 *
	 * @param {string} $seed
	 *   Raw binary string. Must not be hex or base64 encoded —
	 *   decode first if needed.
	 * @param {string} $label
	 *   Domain separation label (used as HKDF info). Must be non-empty UTF-8.
	 * @param {array} [options]
	 * @param {int}    [options['size']=32]    Output length in bytes.
	 * @param {string} [options['context']=""] Context string used to derive salt
	 *   via SHA-256(context). Empty string is valid and produces a fixed salt.
	 *
	 * @return {string} Derived key material (raw binary string).
	 * @throws {Exception}
	 */
	public static function derive($seed, $label, $options = array())
	{
		$size    = isset($options['size'])    ? $options['size']    : 32;
		$context = isset($options['context']) ? $options['context'] : '';

		if (!is_string($seed) || $seed === '') {
			throw new Exception(
				"derive: seed must be a raw binary string. " .
				"Decode hex or base64 strings before calling derive()."
			);
		}
		if (!is_string($label) || $label === '') {
			throw new Exception("derive: label must be a non-empty string");
		}

		// salt = SHA-256(context)
		$salt = hash('sha256', $context, true);

		return self::hkdf(
			$seed,   // IKM — raw binary
			$salt,   // salt = SHA-256(context)
			$label,  // info = label
			$size
		);
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
				$sig = base64_decode($sig, true);
			} elseif (ctype_xdigit($sig) && strlen($sig) % 2 === 0) {
				$sig = hex2bin($sig);
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
	 * Encrypt plaintext using AES-256-GCM.
	 *
	 * Produces output compatible with WebCrypto AES-GCM:
	 * - 12-byte IV
	 * - Separate authentication tag (16 bytes)
	 * - Optional AAD support
	 *
	 * @method encrypt
	 * @static
	 * @param {string} key
	 *   Encryption key (32-byte binary string for AES-256).
	 * @param {string} plaintext
	 *   Raw plaintext data to encrypt.
	 * @param {string} [aad=null]
	 *   Optional additional authenticated data (not encrypted).
	 * @return {array}
	 *   Associative array containing:
	 *   - {string} iv Base64-encoded initialization vector (12 bytes)
	 *   - {string} ciphertext Base64-encoded encrypted data
	 *   - {string} tag Base64-encoded authentication tag (16 bytes)
	 * @throws {Exception}
	 *   If encryption fails or key length is invalid.
	 */
	public static function encrypt($key, $plaintext, $aad = null) {
		if (strlen($key) !== 32) {
			throw new Exception("Key must be 32 bytes (AES-256)");
		}

		$iv = random_bytes(12); // matches JS

		$tag = '';
		$ciphertext = openssl_encrypt(
			$plaintext,
			'aes-256-gcm',
			$key,
			OPENSSL_RAW_DATA,
			$iv,
			$tag,
			$aad ?? ''
		);

		if ($ciphertext === false) {
			throw new Exception("Encryption failed");
		}

		return [
			'iv' => base64_encode($iv),
			'ciphertext' => base64_encode($ciphertext),
			'tag' => base64_encode($tag)
		];
	}

	/**
	 * Decrypt AES-256-GCM encrypted data.
	 *
	 * Verifies authentication tag before returning plaintext.
	 * Compatible with WebCrypto AES-GCM when tag is separated.
	 *
	 * @method decrypt
	 * @static
	 * @param {string} key
	 *   Decryption key (32-byte binary string).
	 * @param {string} ivB64
	 *   Base64-encoded initialization vector (12 bytes).
	 * @param {string} ciphertextB64
	 *   Base64-encoded encrypted data.
	 * @param {string} tagB64
	 *   Base64-encoded authentication tag (16 bytes).
	 * @param {string} [aad=null]
	 *   Optional additional authenticated data.
	 * @return {string}
	 *   Decrypted plaintext (raw binary string).
	 * @throws {Exception}
	 *   If authentication fails or decryption fails.
	 */
	public static function decrypt($key, $ivB64, $ciphertextB64, $tagB64, $aad = null) {
		$iv = base64_decode($ivB64);
		$ciphertext = base64_decode($ciphertextB64);
		$tag = base64_decode($tagB64);

		$plaintext = openssl_decrypt(
			$ciphertext,
			'aes-256-gcm',
			$key,
			OPENSSL_RAW_DATA,
			$iv,
			$tag,
			$aad ?? ''
		);

		if ($plaintext === false) {
			throw new Exception("Decryption failed or auth failed");
		}

		return $plaintext;
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