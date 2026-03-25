<?php

/**
 * Q_Crypto_OpenClaim — OpenClaiming Protocol (OCP) for PHP.
 *
 * Q-framework implementation of the OCP core protocol.
 * Parity counterpart of Q.Crypto.OpenClaim (JS).
 *
 * Dependencies — all already in Q, no OpenSSL required:
 *   Q_Crypto               — internalKeypair
 *   Q_ECC                  — signDigest, verifyDigest (mdanter/phpecc)
 *   Q_Data                 — digest, canonicalize
 *   Q_Crypto_OpenClaim_EVM — EIP712 key verification
 *
 * Wire format:
 *   { "ocp":1, "iss":..., "sub":..., "stm":{...}, "key":[], "sig":[] }
 *
 * Key URI formats:
 *   data:key/es256;base64,<SPKI-DER-base64>  — P-256 public key
 *   data:key/eip712,<0x-address>              — Ethereum address
 *   https://...#fragment                      — URL-hosted key document
 *
 * Canonicalization: RFC 8785 / JCS via Q_Data::canonicalize().
 *   sig field always stripped before canonicalizing.
 *   Numbers serialized per ECMAScript (not PHP json_encode defaults).
 *
 * Signing (ES256):
 *   digest = Q_Data::digest('sha256', canonicalize(claim))
 *   [r,s]  = Q_ECC::signDigest(digest, privKeyHex, 'P256')  — low-S normalized
 *   sig    = raw r||s 64 bytes → base64
 *   Matches: JS noble.p256.sign(digest, privateKey).normalizeS()
 *
 * Verification (ES256):
 *   digest     = Q_Data::digest('sha256', canonicalize(claim))
 *   rawPubKey  = spkiDer[27:]  — skip fixed 27-byte P-256 SPKI prefix
 *   Q_ECC::verifyDigest(digest, [rHex, sHex], rawPubKey, 'P256')
 *
 * @class Q_Crypto_OpenClaim
 * @static
 */
class Q_Crypto_OpenClaim
{
    // ─── Cache ────────────────────────────────────────────────────────────────

    private static array $fetchCache     = [];
    private static array $fetchCacheTime = [];
    private static array $keyCache       = [];
    private static int   $fetchTtl       = 60;

    // P-256 SPKI DER prefix length (constant for all P-256 uncompressed keys).
    // SPKI DER = 26-byte ASN.1 prefix + 0x04 uncompressed marker + 64-byte X||Y.
    // Skipping 27 bytes gives Q_ECC the 64-byte X||Y it expects.
    private const P256_SPKI_PREFIX_LEN = 27;

    // ─── Canonicalization ─────────────────────────────────────────────────────

    /**
     * Produce the canonical JSON string for signing/verification.
     *
     * Strips the sig field then delegates to Q_Data::canonicalize(),
     * which implements RFC 8785 / JCS inline — no external dependency,
     * no composer package. Fully compliant including ECMAScript number
     * serialization (1e30 → "1e+30", not PHP's "1.0E+30").
     *
     * Byte-identical to JS Q.Data.canonicalize() for all I-JSON inputs.
     *
     * @method canonicalize
     * @static
     * @param  array $claim
     * @return string
     */
    public static function canonicalize(array $claim): string
    {
        $obj = $claim;
        unset($obj['sig']);
        return Q_Data::canonicalize($obj);
    }

    // ─── Key resolution ───────────────────────────────────────────────────────

    /**
     * Resolve a key URI to ['fmt', 'value'].
     *
     * data:key/es256;base64,<DER>  → ['fmt'=>'ES256', 'value'=>raw SPKI DER bytes]
     * data:key/eip712,<address>    → ['fmt'=>'EIP712', 'value'=>address string]
     * https://...#fragment         → fetches JSON, follows fragment, resolves recursively
     * es256:<value>                → legacy shorthand
     *
     * Results are cached for 60 seconds.
     *
     * @method resolve
     * @static
     * @param  string $keyStr
     * @param  array  $seen    Internal cycle detection
     * @return array|null
     */
    public static function resolve(string $keyStr, array $seen = []): ?array
    {
        if (in_array($keyStr, $seen, true)) {
            throw new \Exception('Q_Crypto_OpenClaim: cyclic key reference detected');
        }
        if (isset(self::$keyCache[$keyStr])) {
            return self::$keyCache[$keyStr];
        }

        $seen[] = $keyStr;

        // data:key/
        if (str_starts_with($keyStr, 'data:key/')) {
            $parsed = self::_parseDataKey($keyStr);
            self::$keyCache[$keyStr] = $parsed;
            return $parsed;
        }

        // URL document
        if (str_starts_with($keyStr, 'http')) {
            $parts   = explode('#', $keyStr);
            $url     = $parts[0];
            $raw     = self::_fetchCached($url);
            if (!$raw) { return null; }
            $doc     = json_decode($raw, true);
            $current = $doc;
            foreach (array_slice($parts, 1) as $fragment) {
                if ($fragment === '') continue;
                $current = $current[$fragment] ?? null;
                if ($current === null) { return null; }
            }
            if (is_array($current)) {
                self::$keyCache[$keyStr] = $current;
                return $current;
            }
            if (is_string($current)) {
                $res = self::resolve($current, $seen);
                self::$keyCache[$keyStr] = $res;
                return $res;
            }
            return null;
        }

        // Legacy shorthand: fmt:value
        $colon = strpos($keyStr, ':');
        if ($colon !== false) {
            $res = [
                'fmt'   => strtoupper(substr($keyStr, 0, $colon)),
                'value' => substr($keyStr, $colon + 1),
            ];
            self::$keyCache[$keyStr] = $res;
            return $res;
        }

        return null;
    }

    // ─── Sign ─────────────────────────────────────────────────────────────────

    /**
     * Sign a claim with a P-256 keypair derived from the secret.
     *
     * Signing model (no OpenSSL):
     *   canon  = canonicalize(claim)                  RFC 8785, sig stripped
     *   digest = Q_Data::digest('sha256', canon)      raw 32-byte binary
     *   [r,s]  = Q_ECC::signDigest(digest, key, 'P256')  low-S normalized
     *   sig    = raw r||s 64 bytes → base64           stored in sig[]
     *
     * The public SPKI key URI is appended to key[] if not already present.
     * The signature is placed in sig[] at the matching index.
     *
     * Pass $existing = ['keys'=>[], 'signatures'=>[]] for multisig.
     *
     * @method sign
     * @static
     * @param  array  $claim
     * @param  string $secret    Raw binary secret (32 bytes recommended)
     * @param  array  $existing  ['keys'=>[], 'signatures'=>[]]
     * @return array  Claim with key[] and sig[] set
     */
    public static function sign(array $claim, string $secret, array $existing = []): array
    {
        self::_validateNumbers($claim);

        // Derive P-256 keypair from secret (HKDF-SHA256, same as JS internalKeypair ES256)
        $kp = Q_Crypto::internalKeypair([
            'secret' => $secret,
            'format' => 'ES256'
        ]);

        // Build SPKI key URI from raw uncompressed public key (65 bytes: 04||X||Y)
        $signerKey = self::_rawPublicKeyToKeyString($kp['publicKey']);

        // Merge into sorted key+sig state
        $keys = self::_toArray($existing['keys'] ?? ($claim['key'] ?? []));
        $sigs = self::_normalizeSigs($existing['signatures'] ?? ($claim['sig'] ?? []));

        if (!in_array($signerKey, $keys, true)) { $keys[] = $signerKey; }

        $state = self::_buildSortedState($keys, $sigs);

        $tmp        = $claim;
        $tmp['key'] = $state['keys'];
        $tmp['sig'] = $state['signatures'];
        $canon      = self::canonicalize($tmp);

        // Hash the canonical string — Q_Data::digest returns raw binary
        $digest = Q_Data::digest('sha256', $canon);

        // Sign via Q_ECC (mdanter/phpecc) — no OpenSSL needed
        // Returns [rHex, sHex] with low-S normalization already applied
        $rs = Q_ECC::signDigest($digest, bin2hex($kp['privateKey']), 'P256');

        // Pack to raw r||s (64 bytes) for OCP wire format
        $rawSig = hex2bin(str_pad($rs[0], 64, '0', STR_PAD_LEFT))
                . hex2bin(str_pad($rs[1], 64, '0', STR_PAD_LEFT));

        $idx = array_search($signerKey, $state['keys'], true);
        $state['signatures'][$idx] = base64_encode($rawSig);

        return array_merge($claim, [
            'key' => $state['keys'],
            'sig' => $state['signatures']
        ]);
    }

    // ─── Verify ───────────────────────────────────────────────────────────────

    /**
     * Verify signatures on a claim against its key[] array.
     *
     * ES256 keys: extracts raw 04||X||Y point from SPKI DER, verifies via Q_ECC.
     * EIP712 keys: delegates to Q_Crypto_OpenClaim_EVM::verify().
     *
     * Policy:
     *   null             → at least 1 valid signature required
     *   int N            → at least N valid signatures required
     *   ['mode'=>'all']  → all keys must have valid signatures
     *   ['minValid'=>N]  → at least N valid signatures required
     *
     * @method verify
     * @static
     * @param  array      $claim
     * @param  int|array  $policy
     * @return bool
     */
    public static function verify(array $claim, $policy = null): bool
    {
        $keys = self::_toArray($claim['key'] ?? []);
        $sigs = self::_normalizeSigs($claim['sig'] ?? []);

        if (!$keys) { return false; }

        $state = self::_buildSortedState($keys, $sigs);

        $tmp        = $claim;
        $tmp['key'] = $state['keys'];
        $tmp['sig'] = $state['signatures'];
        $canon      = self::canonicalize($tmp);

        // Hash once — reused for all ES256 verifications
        $digest = Q_Data::digest('sha256', $canon);

        $valid = 0;

        foreach ($state['keys'] as $i => $k) {
            $sig = $state['signatures'][$i] ?? null;
            if (!$sig) { continue; }

            $resolved = self::resolve($k);
            if (!$resolved) { continue; }

            $keyObjs = isset($resolved[0]) && is_array($resolved[0])
                ? $resolved : [$resolved];

            foreach ($keyObjs as $ko) {
                if (!$ko) { continue; }
                $fmt = strtoupper($ko['fmt'] ?? '');

                // ── ES256 ──────────────────────────────────────────────────
                if ($fmt === 'ES256') {
                    try {
                        // ko['value'] = raw SPKI DER bytes (parseDataKey base64-decoded it)
                        // Skip the fixed 27-byte P-256 SPKI prefix → 64-byte X||Y for Q_ECC
                        $spkiDer      = $ko['value'];
                        $rawPublicKey = substr($spkiDer, self::P256_SPKI_PREFIX_LEN);

                        if (strlen($rawPublicKey) !== 64) {
                            continue; // not a valid P-256 X||Y point
                        }

                        $sigRaw = base64_decode($sig);
                        if (strlen($sigRaw) !== 64) { continue; }

                        // Split r||s into hex strings for Q_ECC::verifyDigest
                        $rHex = bin2hex(substr($sigRaw, 0, 32));
                        $sHex = bin2hex(substr($sigRaw, 32, 32));

                        // Q_ECC::verifyDigest accepts raw 64-byte X||Y public key
                        $ok = Q_ECC::verifyDigest($digest, [$rHex, $sHex], $rawPublicKey, 'P256');
                        if ($ok) { $valid++; break; }
                    } catch (\Exception $e) { /* try next */ }
                    continue;
                }

                // ── EIP712 ────────────────────────────────────────────────
                if ($fmt === 'EIP712') {
                    try {
                        if (Q_Crypto_OpenClaim_EVM::verify($claim, $sig, (string)$ko['value'])) {
                            $valid++;
                            break;
                        }
                    } catch (\Exception $e) { /* try next */ }
                    continue;
                }
            }
        }

        return $valid >= self::_parsePolicy($policy, count($state['keys']));
    }

    // ─── Private helpers ──────────────────────────────────────────────────────

    private static function _toArray($v): array
    {
        return $v === null ? [] : (is_array($v) ? $v : [$v]);
    }

    private static function _normalizeSigs($v): array
    {
        return array_map(
            function ($x) { return $x === null ? null : (string)$x; },
            self::_toArray($v)
        );
    }

    private static function _buildSortedState(array $keys, array $sigs): array
    {
        $pairs = [];
        foreach ($keys as $i => $k) {
            $pairs[] = ['key' => $k, 'sig' => $sigs[$i] ?? null];
        }
        usort($pairs, function ($a, $b) { return strcmp($a['key'], $b['key']); });
        return [
            'keys'       => array_column($pairs, 'key'),
            'signatures' => array_column($pairs, 'sig')
        ];
    }

    private static function _parsePolicy($policy, int $totalKeys): int
    {
        if ($policy === null)                                           return 1;
        if (is_int($policy))                                           return $policy;
        if (isset($policy['mode']) && $policy['mode'] === 'all')       return $totalKeys;
        if (isset($policy['minValid']) && is_int($policy['minValid'])) return $policy['minValid'];
        return 1;
    }

    private static function _parseDataKey(string $keyStr): ?array
    {
        $comma = strpos($keyStr, ',');
        if ($comma === false) return null;
        $meta  = substr($keyStr, 5, $comma - 5);  // "key/es256;base64"
        $data  = substr($keyStr, $comma + 1);
        $parts = explode(';', $meta);
        $fmt   = strtoupper(str_replace('key/', '', $parts[0]));
        $enc   = 'raw';
        foreach ($parts as $p) {
            if ($p === 'base64')    $enc = 'base64';
            if ($p === 'base64url') $enc = 'base64url';
        }
        if ($enc === 'base64') {
            $data = base64_decode($data);
        } elseif ($enc === 'base64url') {
            $data = base64_decode(strtr($data, '-_', '+/'));
        }
        return ['fmt' => $fmt, 'value' => $data];
    }

    private static function _fetchCached(string $url): ?string
    {
        $now = time();
        if (isset(self::$fetchCache[$url]) &&
            ($now - self::$fetchCacheTime[$url]) < self::$fetchTtl) {
            return self::$fetchCache[$url];
        }
        $data = @file_get_contents($url);
        self::$fetchCache[$url]     = $data ?: null;
        self::$fetchCacheTime[$url] = $now;
        return self::$fetchCache[$url];
    }

    private static function _validateNumbers($v, string $path = 'claim'): void
    {
        if (is_array($v)) {
            foreach ($v as $k => $val) { self::_validateNumbers($val, $path . '.' . $k); }
            return;
        }
        // PHP integers are always 64-bit safe. Only reject non-finite floats.
        if (is_float($v) && !is_finite($v)) {
            throw new \Exception("Q_Crypto_OpenClaim: non-finite float at {$path}");
        }
    }

    /**
     * Build a data:key/es256;base64,<SPKI-DER> URI from a raw uncompressed P-256 point.
     *
     * P-256 SPKI DER = fixed 26-byte ASN.1 prefix + 65-byte uncompressed point (04||X||Y).
     * The prefix encodes:
     *   SEQUENCE {
     *     SEQUENCE { OID ecPublicKey, OID prime256v1 }
     *     BIT STRING { 0 unused bits }
     *   }
     *
     * @private
     */
    private static function _rawPublicKeyToKeyString(string $rawPublicKey): string
    {
        // 26-byte fixed P-256 SPKI prefix (hex):
        //   3059       SEQUENCE (89 bytes total)
        //     3013     SEQUENCE AlgorithmIdentifier
        //       0607 2a8648ce3d0201   OID ecPublicKey
        //       0608 2a8648ce3d030107 OID prime256v1
        //     0342 00  BIT STRING (66 bytes, 0 unused bits)
        //   then the 65-byte uncompressed point follows (04||X||Y)
        $prefix = hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200');
        $spki   = $prefix . $rawPublicKey;  // rawPublicKey is 65 bytes including 0x04
        return 'data:key/es256;base64,' . base64_encode($spki);
    }
}
