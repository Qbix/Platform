<?php

/**
 * Q_Crypto_OpenClaim_EVM — EIP-712 Payment and Authorization extensions for OCP (PHP).
 *
 * Q-framework implementation. Parity counterpart of Q.Crypto.OpenClaim.EVM (JS).
 *
 * Delegates all crypto to Q_Crypto::sign() / Q_Crypto::verify() (EIP712 format)
 * since the EIP-712 digest is identical to what Q_Crypto already computes
 * via Q_Crypto_EIP712::hashTypedData().
 *
 * Depends on:
 *   Q_Crypto            — sign, verify, internalKeypair
 *   Q_Crypto_EIP712     — hashTypedData (already used by Q_Crypto)
 *   Crypto\Keccak       — keccak256 for sub-hashes
 *
 * No web3.php, no kornrunner/keccak, no ethers — only Q deps.
 *
 * @class Q_Crypto_OpenClaim_EVM
 * @static
 */
class Q_Crypto_OpenClaim_EVM
{
    // ─── Type definitions ─────────────────────────────────────────────────────
    // Byte-identical to the JS PAYMENT_TYPES / AUTHORIZATION_TYPES constants.

    public static array $PAYMENT_TYPES = [
        'EIP712Domain' => [
            ['name' => 'name',              'type' => 'string'],
            ['name' => 'version',           'type' => 'string'],
            ['name' => 'chainId',           'type' => 'uint256'],
            ['name' => 'verifyingContract', 'type' => 'address'],
        ],
        'Payment' => [
            ['name' => 'payer',          'type' => 'address'],
            ['name' => 'token',          'type' => 'address'],
            ['name' => 'recipientsHash', 'type' => 'bytes32'],
            ['name' => 'max',            'type' => 'uint256'],
            ['name' => 'line',           'type' => 'uint256'],
            ['name' => 'nbf',            'type' => 'uint256'],
            ['name' => 'exp',            'type' => 'uint256'],
        ],
    ];

    public static array $AUTHORIZATION_TYPES = [
        'EIP712Domain' => [
            ['name' => 'name',              'type' => 'string'],
            ['name' => 'version',           'type' => 'string'],
            ['name' => 'chainId',           'type' => 'uint256'],
            ['name' => 'verifyingContract', 'type' => 'address'],
        ],
        'Authorization' => [
            ['name' => 'authority',       'type' => 'address'],
            ['name' => 'subject',         'type' => 'address'],
            ['name' => 'actorsHash',      'type' => 'bytes32'],
            ['name' => 'rolesHash',       'type' => 'bytes32'],
            ['name' => 'actionsHash',     'type' => 'bytes32'],
            ['name' => 'constraintsHash', 'type' => 'bytes32'],
            ['name' => 'contextsHash',    'type' => 'bytes32'],
            ['name' => 'nbf',             'type' => 'uint256'],
            ['name' => 'exp',             'type' => 'uint256'],
        ],
    ];

    // ─── hashTypedData ────────────────────────────────────────────────────────

    /**
     * Compute the EIP-712 typed-data digest for an OpenClaim EVM claim.
     *
     * Builds the full Payment or Authorization typed payload (including all
     * sub-hashes: recipientsHash, actorsHash, etc.) then delegates to
     * Q_Crypto_EIP712::hashTypedData() for the final digest.
     *
     * Returns raw 32 bytes. Byte-identical to:
     *   JS: Q.Crypto.OpenClaim.EVM.hashTypedData(claim).digest
     *   Standalone: Q_OpenClaim_EVM::hashTypedData($claim)
     *
     * Also returns the full payload array for callers that need to pass
     * domain/primaryType/types/value directly to Q_Crypto::sign/verify.
     *
     * @method hashTypedData
     * @static
     * @param  array $claim
     * @return array { 'digest' => string(32), 'payload' => array }
     */
    public static function hashTypedData(array $claim): array
    {
        $payload = self::_buildPayload($claim);

        $digest = Q_Crypto_EIP712::hashTypedData(
            $payload['domain'],
            $payload['primaryType'],
            $payload['value'],
            $payload['types']
        );

        return ['digest' => $digest, 'payload' => $payload];
    }

    // ─── Sign ─────────────────────────────────────────────────────────────────

    /**
     * Sign an OpenClaim EVM claim from a secret.
     *
     * Builds the typed payload, then delegates to Q_Crypto::sign() (EIP712 format).
     * Q_Crypto::sign handles keypair derivation, EIP-712 digest, and signing.
     *
     * The derived Ethereum address is stored as data:key/eip712,<address> in key[].
     * The 65-byte r||s||v signature is base64-encoded and stored in sig[].
     *
     * @method sign
     * @static
     * @param  array  $claim
     * @param  string $secret    Raw binary secret (32 bytes)
     * @param  array  $existing  ['keys'=>[], 'signatures'=>[]] for multisig
     * @return array  Claim with key[] and sig[] populated
     */
    public static function sign(array $claim, string $secret, array $existing = []): array
    {
        $result  = self::hashTypedData($claim);
        $payload = $result['payload'];

        // Q_Crypto::sign handles: keypair derivation, EIP-712 digest, signing
        $proof = Q_Crypto::sign([
            'secret'      => $secret,
            'format'      => 'EIP712',
            'domain'      => $payload['domain'],
            'primaryType' => $payload['primaryType'],
            'types'       => $payload['types'],
            'message'     => $payload['value'],
        ]);

        $signerKey = 'data:key/eip712,' . $proof['address'];

        $keys = self::_toArray($existing['keys'] ?? ($claim['key'] ?? []));
        $sigs = self::_normalizeSigs($existing['signatures'] ?? ($claim['sig'] ?? []));

        if (!in_array($signerKey, $keys, true)) { $keys[] = $signerKey; }

        $state = self::_buildSortedState($keys, $sigs);
        $idx   = array_search($signerKey, $state['keys'], true);

        // Store as base64 for OCP wire format
        $state['signatures'][$idx] = base64_encode($proof['signature']);

        return array_merge($claim, [
            'key' => $state['keys'],
            'sig' => $state['signatures']
        ]);
    }

    // ─── Verify ───────────────────────────────────────────────────────────────

    /**
     * Verify an OpenClaim EVM signature against an expected Ethereum address.
     *
     * Builds the typed payload, then delegates entirely to Q_Crypto::verify()
     * (EIP712 format) — the single source of truth for secp256k1 recovery.
     *
     * Q_Crypto::verify uses eip712.js / Q_Crypto_EIP712 for the digest and
     * Q_ECC::recoverPublicKey for the recovery — both byte-identical to JS.
     *
     * @method verify
     * @static
     * @param  array   $claim
     * @param  string  $signature        65-byte r||s||v (base64 or hex or binary)
     * @param  string  $expectedAddress  "0x..." Ethereum address
     * @param  array   &$recovered       Optional: ['address'=>'0x...'] written here
     * @return bool
     */
    public static function verify(
        array  $claim,
        string $signature,
        string $expectedAddress,
        array  &$recovered = []
    ): bool {
        try {
            $result  = self::hashTypedData($claim);
            $payload = $result['payload'];

            // Normalize signature to binary
            $sigBin = self::_normalizeSigToBinary($signature);

            // Q_Crypto::verify writes recovered signer info into $recovered
            // by passing it as a reference in the options array.
            $options = [
                'format'      => 'EIP712',
                'domain'      => $payload['domain'],
                'primaryType' => $payload['primaryType'],
                'types'       => $payload['types'],
                'message'     => $payload['value'],
                'signature'   => $sigBin,
                'address'     => $expectedAddress,
                'recovered'   => &$recovered,
            ];

            return Q_Crypto::verify($options);

        } catch (\Exception $e) {
            return false;
        }
    }

    // ─── Payload builders ─────────────────────────────────────────────────────

    private static function _buildPayload(array $claim): array
    {
        $payer     = self::_read($claim, 'payer');
        $token     = self::_read($claim, 'token');
        $line      = self::_read($claim, 'line');
        $authority = self::_read($claim, 'authority');
        $subject   = self::_read($claim, 'subject');

        if ($payer !== null && $token !== null && $line !== null) {
            return self::_paymentPayload($claim);
        }
        if ($authority && $subject) {
            return self::_authorizationPayload($claim);
        }
        throw new \Exception('Q_Crypto_OpenClaim_EVM: cannot detect claim extension');
    }

    private static function _paymentPayload(array $claim): array
    {
        $recipients = self::_arr(self::_read($claim, 'recipients', []));
        return [
            'primaryType' => 'Payment',
            'domain' => [
                'name'              => 'OpenClaiming.payments',
                'version'           => '1',
                'chainId'           => $claim['chainId'],
                'verifyingContract' => $claim['contract'],
            ],
            'types' => self::$PAYMENT_TYPES,
            'value' => [
                'payer'          => strtolower((string)self::_read($claim, 'payer', '')),
                'token'          => strtolower((string)self::_read($claim, 'token', '')),
                'recipientsHash' => self::_hashAddresses($recipients),
                // uint256 fields: keep as string to avoid PHP int overflow on large amounts
                'max'            => (string)(self::_read($claim, 'max',  0) ?? 0),
                'line'           => (string)(self::_read($claim, 'line', 0) ?? 0),
                'nbf'            => (string)(self::_read($claim, 'nbf',  0) ?? 0),
                'exp'            => (string)(self::_read($claim, 'exp',  0) ?? 0),
            ],
        ];
    }

    private static function _authorizationPayload(array $claim): array
    {
        $actors      = self::_arr(self::_read($claim, 'actors',      []));
        $roles       = self::_arr(self::_read($claim, 'roles',       []));
        $actions     = self::_arr(self::_read($claim, 'actions',     []));
        $constraints = self::_arr(self::_read($claim, 'constraints', []));
        $contexts    = self::_arr(self::_read($claim, 'contexts',    []));
        return [
            'primaryType' => 'Authorization',
            'domain' => [
                'name'              => 'OpenClaiming.authorizations',
                'version'           => '1',
                'chainId'           => $claim['chainId'],
                'verifyingContract' => $claim['contract'],
            ],
            'types' => self::$AUTHORIZATION_TYPES,
            'value' => [
                'authority'       => strtolower((string)self::_read($claim, 'authority', '')),
                'subject'         => strtolower((string)self::_read($claim, 'subject',   '')),
                'actorsHash'      => self::_hashAddresses($actors),
                'rolesHash'       => self::_hashStringArray($roles),
                'actionsHash'     => self::_hashStringArray($actions),
                'constraintsHash' => self::_hashConstraints($constraints),
                'contextsHash'    => self::_hashContexts($contexts),
                // uint256 fields: keep as string to avoid PHP int overflow
                'nbf'             => (string)(self::_read($claim, 'nbf', 0) ?? 0),
                'exp'             => (string)(self::_read($claim, 'exp', 0) ?? 0),
            ],
        ];
    }

    // ─── ABI sub-hash helpers ─────────────────────────────────────────────────
    // Byte-identical to Q_OpenClaim_EVM hash helpers and JS counterparts.

    private static function keccak256(string $data): string
    {
        return \Crypto\Keccak::hash($data, 256, true); // raw binary
    }

    private static function _padLeft32(string $b): string
    {
        if (strlen($b) > 32) throw new \Exception('value exceeds 32 bytes');
        return str_pad($b, 32, "\x00", STR_PAD_LEFT);
    }

    private static function _encodeAddress(string $addr): string
    {
        $hex = str_pad(strtolower(str_replace('0x', '', $addr)), 40, '0', STR_PAD_LEFT);
        return self::_padLeft32(hex2bin($hex));
    }

    private static function _hashAddresses(array $addrs): string
    {
        if (!$addrs) return self::keccak256('');
        return self::keccak256(implode('', array_map([self::class, '_encodeAddress'], $addrs)));
    }

    private static function _hashStringArray(array $strings): string
    {
        if (!$strings) return self::keccak256('');
        $hashes = array_map(function ($s) { return self::keccak256((string)$s); }, $strings);
        return self::keccak256(implode('', $hashes));
    }

    private static function _hashConstraints(array $constraints): string
    {
        if (!$constraints) return self::keccak256('');
        $th = self::keccak256('Constraint(string key,string op,string value)');
        $hashes = array_map(function ($c) use ($th) {
            return self::keccak256(
                $th .
                self::keccak256($c['key']   ?? '') .
                self::keccak256($c['op']    ?? '') .
                self::keccak256($c['value'] ?? '')
            );
        }, $constraints);
        return self::keccak256(implode('', $hashes));
    }

    private static function _hashContexts(array $contexts): string
    {
        if (!$contexts) return self::keccak256('');
        $th = self::keccak256('Context(string type,string value)');
        $hashes = array_map(function ($ctx) use ($th) {
            return self::keccak256(
                $th .
                self::keccak256($ctx['type']  ?? $ctx['fmt'] ?? '') .
                self::keccak256($ctx['value'] ?? '')
            );
        }, $contexts);
        return self::keccak256(implode('', $hashes));
    }

    // ─── Utility ──────────────────────────────────────────────────────────────

    private static function _read(array $claim, string $key, $fallback = null)
    {
        if (isset($claim[$key]))        return $claim[$key];
        if (isset($claim['stm'][$key])) return $claim['stm'][$key];
        return $fallback;
    }

    private static function _arr($v): array
    {
        return $v === null ? [] : (is_array($v) ? $v : [$v]);
    }

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
            'signatures' => array_column($pairs, 'sig'),
        ];
    }

    private static function _normalizeSigToBinary(string $sig): string
    {
        // hex with 0x prefix
        if (str_starts_with($sig, '0x') || str_starts_with($sig, '0X')) {
            return hex2bin(substr($sig, 2));
        }
        // hex without prefix (130 chars = 65 bytes)
        if (strlen($sig) === 130 && ctype_xdigit($sig)) {
            return hex2bin($sig);
        }
        // base64
        $bin = base64_decode($sig, true);
        if ($bin !== false && strlen($bin) === 65) return $bin;
        // assume raw binary
        return $sig;
    }
}
