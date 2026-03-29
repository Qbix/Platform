<?php

/**
 * Q_Crypto_OpenClaim_EVM — EIP-712 Payment and Authorization extensions for OCP (PHP).
 *
 * Q-framework implementation. Parity counterpart of Q.Crypto.OpenClaim.EVM (JS).
 *
 * recipientsHash encoding:
 *   Matches Solidity paymentsHashRecipients() = keccak256(abi.encode(address[])).
 *   abi.encode of a dynamic array = 32-byte offset + 32-byte length + 32-byte elements.
 *   This is NOT abi.encodePacked — the contract uses abi.encode.
 *
 * chainId:
 *   CAIP-2 strings like 'eip155:56' are stripped to integer 56 for the EIP-712 domain.
 *   The Solidity contract uses block.chainid (uint256 integer).
 *
 * @class Q_Crypto_OpenClaim_EVM
 * @static
 */
class Q_Crypto_OpenClaim_EVM
{
    // ─── Type definitions ─────────────────────────────────────────────────────

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


    public static array $ACTIONS_TYPES = [
        'EIP712Domain' => [
            ['name' => 'name',              'type' => 'string'],
            ['name' => 'version',           'type' => 'string'],
            ['name' => 'chainId',           'type' => 'uint256'],
            ['name' => 'verifyingContract', 'type' => 'address'],
        ],
        'Action' => [
            ['name' => 'authority',       'type' => 'address'],
            ['name' => 'subject',         'type' => 'address'],
            ['name' => 'contractAddress', 'type' => 'address'],
            ['name' => 'method',          'type' => 'bytes4'],
            ['name' => 'paramsHash',      'type' => 'bytes32'],
            ['name' => 'minimum',         'type' => 'uint256'],
            ['name' => 'fraction',        'type' => 'uint256'],
            ['name' => 'delay',           'type' => 'uint256'],
            ['name' => 'nbf',             'type' => 'uint256'],
            ['name' => 'exp',             'type' => 'uint256'],
        ],
    ];

    public static array $MESSAGES_TYPES = [
        'EIP712Domain' => [
            ['name' => 'name',              'type' => 'string'],
            ['name' => 'version',           'type' => 'string'],
            ['name' => 'chainId',           'type' => 'uint256'],
            ['name' => 'verifyingContract', 'type' => 'address'],
        ],
        'MessageAssociation' => [
            ['name' => 'account',      'type' => 'address'],
            ['name' => 'endpointType', 'type' => 'bytes32'],
            ['name' => 'commitment',   'type' => 'bytes32'],
        ],
    ];

    // ─── hashTypedData ────────────────────────────────────────────────────────

    /**
     * Compute the EIP-712 typed-data digest for an OpenClaim EVM claim.
     *
     * @method hashTypedData
     * @static
     * @param  array $claim
     * @return array { 'digest' => string(32 raw bytes), 'payload' => array }
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
     * @method verify
     * @static
     * @param  array   $claim
     * @param  string  $signature        65-byte r||s||v (base64, hex, or raw binary)
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
            $sigBin  = self::_normalizeSigToBinary($signature);

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
        $payer           = self::_read($claim, 'payer');
        $token           = self::_read($claim, 'token');
        $line            = self::_read($claim, 'line');
        $authority       = self::_read($claim, 'authority');
        $subject         = self::_read($claim, 'subject');
        $contractAddress = self::_read($claim, 'contractAddress') ?? self::_read($claim, 'contract');
        $account         = self::_read($claim, 'account');
        $endpointType    = self::_read($claim, 'endpointType');

        if ($payer !== null && $token !== null && $line !== null) {
            return self::_paymentPayload($claim);
        }
        if ($authority !== null && $subject !== null && $contractAddress !== null) {
            return self::_actionsPayload($claim);
        }
        if ($account !== null && $endpointType !== null) {
            return self::_messagesPayload($claim);
        }
        throw new \Exception('Q_Crypto_OpenClaim_EVM: cannot detect extension (payments, actions, or messages)');
    }

    private static function _paymentPayload(array $claim): array
    {
        $recipients = self::_arr(self::_read($claim, 'recipients', []));
        return [
            'primaryType' => 'Payment',
            'domain' => [
                'name'              => 'OpenClaiming.payments',
                'version'           => '1',
                'chainId'           => self::_caip2ToChainId(self::_read($claim, 'chainId')),
                'verifyingContract' => self::_read($claim, 'contract'),
            ],
            'types' => self::$PAYMENT_TYPES,
            'value' => [
                'payer'          => strtolower((string)self::_read($claim, 'payer', '')),
                'token'          => strtolower((string)self::_read($claim, 'token', '')),
                'recipientsHash' => self::_hashAddresses($recipients),
                'max'            => (string)(self::_read($claim, 'max',  0) ?? 0),
                'line'           => (string)(self::_read($claim, 'line', 0) ?? 0),
                'nbf'            => (string)(self::_read($claim, 'nbf',  0) ?? 0),
                'exp'            => (string)(self::_read($claim, 'exp',  0) ?? 0),
            ],
        ];
    }

    private static function _actionsPayload(array $claim): array
    {
        $contractAddress = self::_read($claim, 'contractAddress') ?? self::_read($claim, 'contract');
        $methodHex = str_pad(
            preg_replace('/^0x/i', '', (string)(self::_read($claim, 'method') ?? '')),
            8, '0'
        );
        $methodBuf = hex2bin(substr($methodHex, 0, 8)); // 4 bytes

        $paramsHash = self::_read($claim, 'paramsHash');
        if ($paramsHash === null) {
            $params = (string)(self::_read($claim, 'params') ?? '');
            $paramBuf = hex2bin(ltrim(preg_replace('/^0x/i', '', $params), '0') ?: '');
            $paramsHash = self::keccak256($paramBuf);
        }

        return [
            'primaryType' => 'Action',
            'domain' => [
                'name'              => 'OpenClaiming.actions',
                'version'           => '1',
                'chainId'           => self::_caip2ToChainId(self::_read($claim, 'chainId')),
                'verifyingContract' => self::_read($claim, 'contract'),
            ],
            'types' => self::$ACTIONS_TYPES,
            'value' => [
                'authority'       => strtolower((string)self::_read($claim, 'authority', '')),
                'subject'         => strtolower((string)self::_read($claim, 'subject', '')),
                'contractAddress' => strtolower(preg_replace('/^evm:\d+:address:/i', '', (string)($contractAddress ?? ''))),
                'method'          => $methodBuf,
                'paramsHash'      => $paramsHash,
                'minimum'         => (string)(self::_read($claim, 'minimum', 0) ?? 0),
                'fraction'        => (string)(self::_read($claim, 'fraction', 0) ?? 0),
                'delay'           => (string)(self::_read($claim, 'delay',   0) ?? 0),
                'nbf'             => (string)(self::_read($claim, 'nbf',     0) ?? 0),
                'exp'             => (string)(self::_read($claim, 'exp',     0) ?? 0),
            ],
        ];
    }

    private static function _messagesPayload(array $claim): array
    {
        return [
            'primaryType' => 'MessageAssociation',
            'domain' => [
                'name'              => 'OpenClaiming.messages',
                'version'           => '1',
                'chainId'           => self::_caip2ToChainId(self::_read($claim, 'chainId')),
                'verifyingContract' => self::_read($claim, 'contract'),
            ],
            'types' => self::$MESSAGES_TYPES,
            'value' => [
                'account'      => strtolower((string)self::_read($claim, 'account', '')),
                'endpointType' => self::_read($claim, 'endpointType'),
                'commitment'   => self::_read($claim, 'commitment'),
            ],
        ];
    }

    // ─── ABI sub-hash helpers ─────────────────────────────────────────────────

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
        // Strip OCP URI prefix: "evm:56:address:0xABC" → "0xABC"
        $addr = preg_replace('/^evm:\d+:address:/i', '', $addr);
        $hex  = str_pad(strtolower(str_replace('0x', '', $addr)), 40, '0', STR_PAD_LEFT);
        return self::_padLeft32(hex2bin($hex));
    }

    /**
     * Hash an address array matching Solidity paymentsHashRecipients():
     *   keccak256(abi.encode(address[]))
     *
     * abi.encode of a dynamic array = 32-byte offset (0x20) + 32-byte length + elements.
     */
    private static function _hashAddresses(array $addrs): string
    {
        // 32-byte offset pointing to the array data (always 0x20 for single dynamic param)
        $offset = str_pad("\x20", 32, "\x00", STR_PAD_LEFT);

        // 32-byte length (big-endian uint256)
        $n      = count($addrs);
        $length = str_pad(pack('N', $n), 32, "\x00", STR_PAD_LEFT);

        // 32-byte-padded addresses
        $elements = implode('', array_map([self::class, '_encodeAddress'], $addrs));

        return self::keccak256($offset . $length . $elements);
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

    /**
     * Convert CAIP-2 chain ID ('eip155:56') or plain string to integer.
     * EIP-712 domain requires chainId as uint256, matching block.chainid.
     */
    private static function _caip2ToChainId($v): int
    {
        if (is_int($v)) { return $v; }
        $s = (string)$v;
        if (str_starts_with($s, 'eip155:')) { return (int)substr($s, 7); }
        if (preg_match('/^evm:(\d+):/', $s, $m)) { return (int)$m[1]; }
        return (int)$s;
    }

    private static function _normalizeSigToBinary(string $sig): string
    {
        if (str_starts_with($sig, '0x') || str_starts_with($sig, '0X')) {
            return hex2bin(substr($sig, 2));
        }
        if (strlen($sig) === 130 && ctype_xdigit($sig)) {
            return hex2bin($sig);
        }
        $bin = base64_decode($sig, true);
        if ($bin !== false && strlen($bin) === 65) return $bin;
        return $sig;
    }
}
