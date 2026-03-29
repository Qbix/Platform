<?php

use Crypto\Keccak;

/**
 * @module Q
 */
/**
 * Canonical EIP-712 encoder and hasher.
 *
 * Direct PHP port of eip712.js — byte-identical output guaranteed.
 * Depends ONLY on Crypto\Keccak (already a Q dependency via mdanter/phpecc).
 *
 * Public API:
 *   Q_Crypto_EIP712::hashTypedData($domain, $primaryType, $message, $types)
 *       → 32-byte binary digest
 *
 *   Q_Crypto_EIP712::hashTypedDataHex($domain, $primaryType, $message, $types)
 *       → 0x-prefixed 64-char hex string (for wallet APIs)
 *
 *   Q_Crypto_EIP712::ecRecover($digest, $signature)
 *       → 0x-prefixed Ethereum address (delegates to Crypto\EthSigRecover)
 *
 * All other methods are internal.
 *
 * @class Q_Crypto_EIP712
 */
class Q_Crypto_EIP712
{
    // ─── Public API ──────────────────────────────────────────────────────────────

    /**
     * Compute the EIP-712 typed data digest.
     *
     * Returns the 32-byte binary digest:
     *   keccak256("\x19\x01" || domainSeparator || structHash)
     *
     * Suitable for signing with secp256k1 (ecrecover-compatible).
     *
     * @method hashTypedData
     * @static
     * @param {array}  $domain      Domain fields (must match $types['EIP712Domain'])
     * @param {string} $primaryType Root type name. Must not be "EIP712Domain".
     * @param {array}  $message     Message fields.
     * @param {array}  $types       Full type map including EIP712Domain.
     * @return {string} 32-byte binary digest.
     * @throws {Exception}
     */
    public static function hashTypedData(
        array  $domain,
        string $primaryType,
        array  $message,
        array  $types
    ) {
        if (empty($types) || !is_array($types)) {
            throw new Exception('Q_Crypto_EIP712: types required');
        }
        if (!isset($types['EIP712Domain'])) {
            throw new Exception('Q_Crypto_EIP712: EIP712Domain type missing');
        }
        if (!$primaryType || $primaryType === 'EIP712Domain') {
            throw new Exception('Q_Crypto_EIP712: invalid primaryType');
        }
        if (!isset($types[$primaryType])) {
            throw new Exception("Q_Crypto_EIP712: unknown primaryType: $primaryType");
        }

        $domainHash  = self::keccak256(self::encodeData('EIP712Domain', $domain  ?: [], $types));
        $messageHash = self::keccak256(self::encodeData($primaryType,   $message ?: [], $types));

        return self::keccak256("\x19\x01" . $domainHash . $messageHash);
    }

    /**
     * Compute the EIP-712 typed data digest, returned as 0x-prefixed hex.
     *
     * Convenience wrapper around hashTypedData() for wallet APIs and logging.
     *
     * @method hashTypedDataHex
     * @static
     * @param {array}  $domain
     * @param {string} $primaryType
     * @param {array}  $message
     * @param {array}  $types
     * @return {string} 0x-prefixed 64-char hex string
     */
    public static function hashTypedDataHex(
        array  $domain,
        string $primaryType,
        array  $message,
        array  $types
    ) {
        return '0x' . bin2hex(self::hashTypedData($domain, $primaryType, $message, $types));
    }

    /**
     * Recover the Ethereum address that signed a given EIP-712 digest.
     *
     * Delegates to Crypto\EthSigRecover::ecRecover() which uses
     * Crypto\Signature::recoverPublicKey() (mdanter/phpecc, already a Q dep).
     * No new external dependencies.
     *
     * This is a standalone helper — you supply the raw digest and the signature.
     * To recover from a claim object, use Q_OpenClaim_EVM::recoverSigner().
     *
     * Signature format: 65 bytes, r||s||v, v = 27 or 28 (Ethereum convention).
     * Input may be raw binary (32 bytes) or 0x-prefixed hex (66 chars).
     *
     * @method ecRecover
     * @static
     * @param {string} $digest     Raw 32-byte binary OR 0x-prefixed 64-char hex
     * @param {string} $signature  0x-prefixed 130-char hex (65 bytes: r||s||v)
     * @return {string} 0x-prefixed lowercase Ethereum address
     * @throws {Exception} On invalid signature length or recovery failure
     */
    public static function ecRecover(string $digest, string $signature): string
    {
        // Normalise digest to 0x-prefixed hex
        $hexDigest = (strpos($digest, '0x') === 0)
            ? $digest
            : '0x' . bin2hex($digest);

        // Normalise signature
        $sig = (strpos($signature, '0x') === 0) ? $signature : '0x' . $signature;
        if (strlen($sig) !== 132) { // 0x + 130 hex chars = 65 bytes
            throw new Exception('Q_Crypto_EIP712::ecRecover: invalid signature length (expected 65 bytes)');
        }

        $recover = new \Crypto\EthSigRecover();
        return $recover->ecRecover($hexDigest, $sig); // 0x-prefixed lowercase
    }

    // ─── Type string encoding ─────────────────────────────────────────────────

    /** Collect all referenced types (recursive). Mirrors JS findDeps(). */
    private static function findDeps(string $type, array $types, array &$out = []): void
    {
        if (in_array($type, $out, true)) { return; }
        $out[] = $type;
        foreach ($types[$type] ?? [] as $field) {
            $base = preg_replace('/\[.*\]$/', '', $field['type']);
            if (isset($types[$base])) {
                self::findDeps($base, $types, $out);
            }
        }
    }

    /**
     * Build the canonical type string for a primary type.
     * Primary first; dependent types sorted alphabetically after.
     * Mirrors JS encodeType().
     */
    private static function encodeType(string $primary, array $types): string
    {
        if (!isset($types[$primary])) {
            throw new Exception("Q_Crypto_EIP712: unknown type: $primary");
        }

        $deps = [];
        self::findDeps($primary, $types, $deps);
        $deps = array_values(array_filter($deps, fn($t) => $t !== $primary));
        sort($deps, SORT_STRING);

        $all = array_merge([$primary], $deps);

        return implode('', array_map(function ($t) use ($types) {
            $fields = array_map(fn($f) => $f['type'] . ' ' . $f['name'], $types[$t]);
            return $t . '(' . implode(',', $fields) . ')';
        }, $all));
    }

    /** keccak256 of the canonical type string. Mirrors JS typeHash(). */
    private static function typeHash(string $primary, array $types): string
    {
        return self::keccak256(self::encodeType($primary, $types));
    }

    // ─── Value encoding ───────────────────────────────────────────────────────

    /**
     * Encode a single typed value to its 32-byte ABI representation.
     * Mirrors JS encodeValue().
     */
    private static function encodeValue(string $type, $value, array $types): string
    {
        if ($value === null) { $value = 0; }

        // Arrays (dynamic T[] and fixed T[N])
        if (preg_match('/\[\d*\]$/', $type)) {
            if (!is_array($value)) { throw new Exception("$type expects array"); }
            $base  = preg_replace('/\[\d*\]$/', '', $type);
            $items = array_map(fn($v) => self::encodeValue($base, $v, $types), $value);
            return self::keccak256(count($items) ? implode('', $items) : '');
        }

        // Struct
        if (isset($types[$type])) {
            if (!is_array($value)) { throw new Exception("$type expects array/object"); }
            return self::keccak256(self::encodeData($type, $value, $types));
        }

        // string
        if ($type === 'string') { return self::keccak256((string)$value); }

        // bytes (dynamic)
        if ($type === 'bytes') { return self::keccak256(self::toBytes($value)); }

        // bool
        if ($type === 'bool') { return self::padLeft32(chr($value ? 1 : 0)); }

        // address (20 bytes, left-padded)
        if ($type === 'address') {
            $b = self::toBytes($value);
            if (strlen($b) !== 20) {
                throw new Exception("Q_Crypto_EIP712: invalid address length: " . strlen($b));
            }
            return self::padLeft32($b);
        }

        // bytes<N> (1–32), right-padded
        if (preg_match('/^bytes([1-9]|[12][0-9]|3[012])$/', $type, $m)) {
            $n = (int)$m[1];
            $b = self::toBytes($value);
            if (strlen($b) !== $n) {
                throw new Exception("Q_Crypto_EIP712: invalid $type length: expected $n, got " . strlen($b));
            }
            return self::padRight32($b);
        }

        // uint<N>
        if (preg_match('/^uint(\d{0,3})$/', $type, $m)) {
            $bits = $m[1] !== '' ? (int)$m[1] : 256;
            if ($bits === 0 || $bits > 256 || $bits % 8 !== 0) {
                throw new Exception("Q_Crypto_EIP712: invalid type: $type");
            }
            $v   = self::toBigInt($value);
            $max = gmp_pow(2, $bits);
            if (gmp_cmp($v, 0) < 0 || gmp_cmp($v, $max) >= 0) {
                throw new Exception("Q_Crypto_EIP712: $type overflow");
            }
            return self::padLeft32(self::bigIntToBytes($v));
        }

        // int<N>
        if (preg_match('/^int(\d{0,3})$/', $type, $m)) {
            $bits = $m[1] !== '' ? (int)$m[1] : 256;
            if ($bits === 0 || $bits > 256 || $bits % 8 !== 0) {
                throw new Exception("Q_Crypto_EIP712: invalid type: $type");
            }
            $v   = self::toBigInt($value);
            $min = gmp_neg(gmp_pow(2, $bits - 1));
            $max = gmp_sub(gmp_pow(2, $bits - 1), 1);
            if (gmp_cmp($v, $min) < 0 || gmp_cmp($v, $max) > 0) {
                throw new Exception("Q_Crypto_EIP712: $type overflow");
            }
            if (gmp_cmp($v, 0) < 0) { $v = gmp_add(gmp_pow(2, 256), $v); }
            return self::padLeft32(self::bigIntToBytes($v));
        }

        throw new Exception("Q_Crypto_EIP712: unsupported type: $type");
    }

    /** Encode a full struct (typeHash || encoded fields). Mirrors JS encodeData(). */
    private static function encodeData(string $primary, array $data, array $types): string
    {
        $enc = self::typeHash($primary, $types);
        foreach ($types[$primary] as $field) {
            $enc .= self::encodeValue($field['type'], $data[$field['name']] ?? null, $types);
        }
        return $enc;
    }

    // ─── Low-level helpers ────────────────────────────────────────────────────

    /** keccak256 of raw binary. Returns 32-byte binary. */
    private static function keccak256(string $data): string
    {
        return Keccak::hash($data, 256, true);
    }

    /** Left-pad to 32 bytes. */
    private static function padLeft32(string $b): string
    {
        if (strlen($b) > 32) { throw new Exception('Q_Crypto_EIP712: value exceeds 32 bytes'); }
        return str_pad($b, 32, "\x00", STR_PAD_LEFT);
    }

    /** Right-pad to 32 bytes. */
    private static function padRight32(string $b): string
    {
        if (strlen($b) > 32) { throw new Exception('Q_Crypto_EIP712: value exceeds 32 bytes'); }
        return str_pad($b, 32, "\x00", STR_PAD_RIGHT);
    }

    /**
     * Convert hex string or raw binary to raw binary.
     * Accepts: 0x-prefixed hex, bare hex (even-length all-hex), or raw binary.
     */
    private static function toBytes($value): string
    {
        if (!is_string($value)) {
            throw new Exception('Q_Crypto_EIP712: expected string, got ' . gettype($value));
        }
        if (strpos($value, '0x') === 0 || strpos($value, '0X') === 0) {
            $hex = substr($value, 2);
            if ($hex === '') { return ''; }
            if (strlen($hex) % 2 !== 0) { throw new Exception('Q_Crypto_EIP712: invalid hex length'); }
            $bin = hex2bin($hex);
            if ($bin === false) { throw new Exception('Q_Crypto_EIP712: invalid hex string'); }
            return $bin;
        }
        if (strlen($value) % 2 === 0 && strlen($value) > 0 && ctype_xdigit($value)) {
            $bin = hex2bin($value);
            if ($bin !== false) { return $bin; }
        }
        return $value;
    }

    /** Convert numeric value to GMP integer. */
    private static function toBigInt($value)
    {
        if ($value instanceof GMP || is_resource($value)) { return $value; }
        if (is_int($value))   { return gmp_init($value); }
        if (is_float($value)) { return gmp_init((int)$value); }
        if (is_string($value)) {
            return (strpos($value, '0x') === 0 || strpos($value, '0X') === 0)
                ? gmp_init(substr($value, 2), 16)
                : gmp_init($value, 10);
        }
        throw new Exception('Q_Crypto_EIP712: invalid numeric value: ' . gettype($value));
    }

    /** GMP integer to minimal big-endian binary. Zero → single null byte. */
    private static function bigIntToBytes($gmp): string
    {
        $hex = gmp_strval($gmp, 16);
        if (strlen($hex) % 2 !== 0) { $hex = '0' . $hex; }
        $bin = hex2bin($hex);
        return ($bin === '' || $bin === false) ? "\x00" : $bin;
    }
}
