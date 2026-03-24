<?php

use Crypto\Keccak;

/**
 * @module Q
 */
/**
 * Canonical EIP-712 encoder and hasher.
 *
 * Direct PHP port of eip712.js — byte-identical output guaranteed.
 * Depends ONLY on Crypto\Keccak (already a Q dependency).
 *
 * Public API:
 *   Q_Crypto_EIP712::hashTypedData($domain, $primaryType, $message, $types)
 *
 * All other methods are internal and should not be called directly.
 *
 * @class Q_Crypto_EIP712
 */
class Q_Crypto_EIP712
{
    // -------------------------------------------------------
    // Public API
    // -------------------------------------------------------

    /**
     * Compute the EIP-712 typed data digest.
     *
     * This is the single entry point. Returns the 32-byte binary digest:
     *   keccak256("\x19\x01" || domainSeparator || structHash)
     *
     * The result is suitable for signing with secp256k1 (ecrecover-compatible).
     *
     * @method hashTypedData
     * @static
     *
     * @param {array}  $domain      Associative array of domain fields.
     *                              Must match the fields declared in $types['EIP712Domain'].
     * @param {string} $primaryType Root type name (e.g. "Payment", "Delegation").
     *                              Must not be "EIP712Domain".
     * @param {array}  $message     Associative array of message fields.
     * @param {array}  $types       Associative array of type definitions.
     *                              Must include 'EIP712Domain' key.
     *                              Each value is an array of ['name' => ..., 'type' => ...].
     *
     * @return {string} 32-byte binary digest.
     *
     * @throws {Exception} If types is missing or invalid.
     * @throws {Exception} If EIP712Domain type is missing.
     * @throws {Exception} If primaryType is invalid or unknown.
     */
    public static function hashTypedData(
        array  $domain,
        string $primaryType,
        array  $message,
        array  $types
    ): string {
        if (empty($types) || !is_array($types)) {
            throw new Exception("types required");
        }
        if (!isset($types['EIP712Domain'])) {
            throw new Exception("EIP712Domain type missing");
        }
        if (!$primaryType || $primaryType === 'EIP712Domain') {
            throw new Exception("Invalid primaryType");
        }
        if (!isset($types[$primaryType])) {
            throw new Exception("Unknown primaryType: $primaryType");
        }

        $domainHash  = self::keccak256(self::encodeData('EIP712Domain', $domain  ?: [], $types));
        $messageHash = self::keccak256(self::encodeData($primaryType,   $message ?: [], $types));

        return self::keccak256(
            "\x19\x01" . $domainHash . $messageHash
        );
    }

    // -------------------------------------------------------
    // Type string encoding
    // -------------------------------------------------------

    /**
     * Collect all referenced types for a given primary type (recursive).
     * Mirrors JS findDeps().
     */
    private static function findDeps(string $type, array $types, array &$out = []): void
    {
        if (in_array($type, $out, true)) return;
        $out[] = $type;
        foreach ($types[$type] ?? [] as $field) {
            // Strip array suffix: "Foo[]" → "Foo"
            $base = preg_replace('/\[.*\]$/', '', $field['type']);
            if (isset($types[$base])) {
                self::findDeps($base, $types, $out);
            }
        }
    }

    /**
     * Build the canonical type string for a primary type.
     * Primary type comes first; dependent types follow in alphabetical order.
     * Mirrors JS encodeType().
     */
    private static function encodeType(string $primary, array $types): string
    {
        if (!isset($types[$primary])) {
            throw new Exception("Unknown type: $primary");
        }

        $deps = [];
        self::findDeps($primary, $types, $deps);

        // Remove primary — it goes first, deps sorted alphabetically after
        $deps = array_values(array_filter($deps, fn($t) => $t !== $primary));
        sort($deps, SORT_STRING);

        $all = array_merge([$primary], $deps);

        return implode('', array_map(function ($t) use ($types) {
            $fields = array_map(
                fn($f) => $f['type'] . ' ' . $f['name'],
                $types[$t]
            );
            return $t . '(' . implode(',', $fields) . ')';
        }, $all));
    }

    /**
     * keccak256 of the canonical type string.
     * Mirrors JS typeHash().
     */
    private static function typeHash(string $primary, array $types): string
    {
        return self::keccak256(self::encodeType($primary, $types));
    }

    // -------------------------------------------------------
    // Value encoding
    // -------------------------------------------------------

    /**
     * Encode a single typed value to its 32-byte ABI representation.
     * Mirrors JS encodeValue().
     *
     * Rules (matching EIP-712 spec):
     * - address   → left-pad 20 bytes to 32
     * - bool      → left-pad 0x00/0x01 to 32
     * - uint<N>   → left-pad big-endian integer to 32
     * - int<N>    → left-pad two's-complement integer to 32
     * - bytes<N>  → right-pad N bytes to 32
     * - bytes     → keccak256(bytes)
     * - string    → keccak256(utf8)
     * - T[]       → keccak256(concat of encoded items)
     * - struct    → keccak256(encodeData(struct))
     */
    private static function encodeValue(string $type, $value, array $types): string
    {
        if ($value === null) $value = 0;

        // ---- Arrays ----
        if (substr($type, -2) === '[]') {
            if (!is_array($value)) {
                throw new Exception("$type expects array");
            }
            $base  = substr($type, 0, -2);
            $items = array_map(fn($v) => self::encodeValue($base, $v, $types), $value);
            return self::keccak256(count($items) ? implode('', $items) : '');
        }

        // ---- Struct ----
        if (isset($types[$type])) {
            if (!is_array($value)) {
                throw new Exception("$type expects array/object");
            }
            return self::keccak256(self::encodeData($type, $value, $types));
        }

        // ---- string ----
        if ($type === 'string') {
            return self::keccak256((string)$value);
        }

        // ---- bytes (dynamic) ----
        if ($type === 'bytes') {
            return self::keccak256(self::toBytes($value));
        }

        // ---- bool ----
        if ($type === 'bool') {
            return self::padLeft32(chr($value ? 1 : 0));
        }

        // ---- address (20 bytes) ----
        if ($type === 'address') {
            $b = self::toBytes($value);
            if (strlen($b) !== 20) {
                throw new Exception("Invalid address length: " . strlen($b) . " bytes");
            }
            return self::padLeft32($b);
        }

        // ---- bytes<N> (1–31) ----
        if (preg_match('/^bytes([1-9]|[12][0-9]|3[01])$/', $type, $m)) {
            $n = (int)$m[1];
            $b = self::toBytes($value);
            if (strlen($b) !== $n) {
                throw new Exception("Invalid $type length: expected $n, got " . strlen($b));
            }
            return self::padRight32($b);
        }

        // ---- uint<N> ----
        if (preg_match('/^uint(\d{0,3})$/', $type, $m)) {
            $bits = $m[1] !== '' ? (int)$m[1] : 256;
            if ($bits === 0 || $bits > 256 || $bits % 8 !== 0) {
                throw new Exception("Invalid type: $type");
            }
            $v = self::toBigInt($value);
            $max = gmp_pow(2, $bits);
            if (gmp_cmp($v, 0) < 0 || gmp_cmp($v, $max) >= 0) {
                throw new Exception("$type overflow");
            }
            return self::padLeft32(self::bigIntToBytes($v));
        }

        // ---- int<N> ----
        if (preg_match('/^int(\d{0,3})$/', $type, $m)) {
            $bits = $m[1] !== '' ? (int)$m[1] : 256;
            if ($bits === 0 || $bits > 256 || $bits % 8 !== 0) {
                throw new Exception("Invalid type: $type");
            }
            $v   = self::toBigInt($value);
            $min = gmp_neg(gmp_pow(2, $bits - 1));
            $max = gmp_sub(gmp_pow(2, $bits - 1), 1);
            if (gmp_cmp($v, $min) < 0 || gmp_cmp($v, $max) > 0) {
                throw new Exception("$type overflow");
            }
            // Two's complement for negatives
            if (gmp_cmp($v, 0) < 0) {
                $v = gmp_add(gmp_pow(2, 256), $v);
            }
            return self::padLeft32(self::bigIntToBytes($v));
        }

        throw new Exception("Unsupported type: $type");
    }

    /**
     * Encode a full struct (typeHash || encoded fields).
     * Mirrors JS encodeData().
     */
    private static function encodeData(string $primary, array $data, array $types): string
    {
        $enc = self::typeHash($primary, $types);
        foreach ($types[$primary] as $field) {
            $value = $data[$field['name']] ?? null;
            $enc  .= self::encodeValue($field['type'], $value, $types);
        }
        return $enc;
    }

    // -------------------------------------------------------
    // Helpers
    // -------------------------------------------------------

    /**
     * keccak256 of a binary string. Returns 32-byte binary string.
     */
    private static function keccak256(string $data): string
    {
        return Keccak::hash($data, 256, true);
    }

    /**
     * Left-pad a binary string with zero bytes to exactly 32 bytes.
     * Mirrors JS padLeft32().
     */
    private static function padLeft32(string $b): string
    {
        $len = strlen($b);
        if ($len > 32) {
            throw new Exception("value exceeds 32 bytes ($len)");
        }
        return str_pad($b, 32, "\x00", STR_PAD_LEFT);
    }

    /**
     * Right-pad a binary string with zero bytes to exactly 32 bytes.
     * Mirrors JS padRight32().
     */
    private static function padRight32(string $b): string
    {
        $len = strlen($b);
        if ($len > 32) {
            throw new Exception("value exceeds 32 bytes ($len)");
        }
        return str_pad($b, 32, "\x00", STR_PAD_RIGHT);
    }

    /**
     * Convert a hex string or binary string to raw binary.
     * Mirrors JS toBytes() / hexToBytes().
     *
     * Accepts:
     * - "0x"-prefixed hex string
     * - bare hex string (even length, all hex chars)
     * - raw binary string (passed through as-is)
     */
    private static function toBytes($value): string
    {
        if (!is_string($value)) {
            throw new Exception("Expected string, got " . gettype($value));
        }

        // 0x-prefixed hex
        if (strpos($value, '0x') === 0 || strpos($value, '0X') === 0) {
            $hex = substr($value, 2);
            if ($hex === '') return '';
            if (strlen($hex) % 2 !== 0) {
                throw new Exception("Invalid hex length");
            }
            $bin = hex2bin($hex);
            if ($bin === false) throw new Exception("Invalid hex string");
            return $bin;
        }

        // Bare hex (even length, all hex chars)
        if (strlen($value) % 2 === 0 && ctype_xdigit($value) && strlen($value) > 0) {
            $bin = hex2bin($value);
            if ($bin !== false) return $bin;
        }

        // Raw binary
        return $value;
    }

    /**
     * Convert a numeric value to a GMP integer.
     * Mirrors JS toBigInt().
     *
     * Accepts: int, float, decimal string, hex string ("0x..."), GMP resource.
     */
    private static function toBigInt($value)
    {
        if (is_resource($value) || $value instanceof GMP) {
            return $value;
        }
        if (is_int($value)) {
            return gmp_init($value);
        }
        if (is_float($value)) {
            return gmp_init((int)$value);
        }
        if (is_string($value)) {
            if (strpos($value, '0x') === 0 || strpos($value, '0X') === 0) {
                return gmp_init(substr($value, 2), 16);
            }
            return gmp_init($value, 10);
        }
        throw new Exception("Invalid numeric value: " . gettype($value));
    }

    /**
     * Convert a GMP integer to a minimal big-endian binary string.
     * Zero returns a single null byte.
     */
    private static function bigIntToBytes($gmp): string
    {
        $hex = gmp_strval($gmp, 16);
        if (strlen($hex) % 2 !== 0) $hex = '0' . $hex;
        $bin = hex2bin($hex);
        return $bin === '' ? "\x00" : $bin;
    }
}