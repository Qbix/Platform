<?php

class Q_Data
{
	public static function digest($data, $algo = 'sha256') {
		return hash($algo, $data, true);
	}

	public static function compress($data) {
		return gzcompress($data);
	}

	public static function decompress($data) {
		return gzuncompress($data);
	}

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

			// Convert DER signature to raw r||s for JS compatibility
			$signatures[] = self::DERToRaw($signature);
		}

		return $signatures;
	}

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

			// Convert raw signature to DER before verifying
			$sig = self::DERFromRaw($sig);

			$result = openssl_verify($data, $sig, $publicKey, $algo['hash']);
			openssl_free_key($publicKey);

			$results[] = ($result === 1);
		}

		return $results;
	}

	public static function toBase64($data, $isHex = false) {
		if ($isHex) {
			$data = pack('H*', $data);
		}
		return base64_encode($data);
	}

	public static function fromBase64($base64) {
		return base64_decode($base64);
	}

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

	private static function pemFromDer($der, $type = 'PRIVATE') {
		$base64 = chunk_split(base64_encode($der), 64, "\n");
		return "-----BEGIN {$type} KEY-----\n{$base64}-----END {$type} KEY-----\n";
	}

	/**
	 * Convert DER-encoded ECDSA signature to raw r||s (64 bytes)
	 */
	public static function DERToRaw($der) {
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
	 * Convert raw r||s (64 bytes) to DER-encoded ECDSA signature
	 */
	public static function DERFromRaw($raw) {
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
}