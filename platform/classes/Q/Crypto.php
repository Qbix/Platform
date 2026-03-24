<?php

use Mdanter\Ecc\Curves\CurveFactory;
use Crypto\Keccak;

/**
 * @module Q
 */
/**
 * Used for crypto operations in Q
 * @class Q_Crypto
 */
class Q_Crypto
{
    /**
     * Sign a typed message using a deterministically derived keypair.
     *
     * This is the PHP counterpart of Q_Crypto_sign in JS.
     * It performs protocol-level typed signing (not raw message signing).
     *
     * Supported formats:
     * - "ES256" / "p256" → NIST P-256 + SHA-256 (Q-native)
     * - "EIP712" / "k256" → secp256k1 + keccak256 (Ethereum-style)
     *
     * SECURITY PROPERTIES:
     * - Secret is never stored
     * - Keypair derivation is deterministic
     * - Exactly one hash + one signature
     * - Output is a verifiable proof object
     *
     * @method sign
     * @static
     *
     * @param array  $options
     * @param string $options['secret']      Raw binary secret material.
     * @param array  $options['message']     Typed message payload.
     * @param array  $options['types']       Type definitions (EIP-712 style).
     * @param string $options['primaryType'] Root type name.
     * @param array  $options['domain']      Optional domain separator fields.
     * @param string $options['format']      "ES256" or "EIP712" (default: "ES256").
     *
     * @return array Associative array with the following keys:
     *
     *   'format'       {string} Signing format used: "eip712" or "es256".
     *   'curve'        {string} Elliptic curve: "secp256k1" or "p256".
     *   'hashAlg'      {string} Hash algorithm: "keccak256" or "sha256".
     *   'domain'       {array}  Domain separator (may be empty for ES256).
     *   'primaryType'  {string} Root type name.
     *   'digest'       {string} Hex-encoded message digest.
     *   'signature'    {string} Raw binary signature.
     *                           EIP712: 65 bytes r||s||v (v = 27 + recovery).
     *                           ES256:  DER-encoded ECDSA signature.
     *   'signatureHex' {string} "0x"-prefixed hex of signature.
     *   'publicKey'    {string} Raw binary uncompressed public key (65 bytes).
     *
     *   EIP712 only:
     *   'address'      {string} Ethereum address of signer ("0x...").
     *
     * @throws Exception
     */
    public static function sign(array $options): array
    {
        if (empty($options['secret']) || !is_string($options['secret'])) {
            throw new Exception("secret must be a binary string");
        }
        if (empty($options['message']) || !is_array($options['message'])) {
            throw new Exception("message required");
        }
        if (empty($options['types']) || !is_array($options['types'])) {
            throw new Exception("types required");
        }
        if (empty($options['primaryType']) || !is_string($options['primaryType'])) {
            throw new Exception("primaryType required");
        }

        $secret      = $options['secret'];
        $message     = $options['message'];
        $types       = $options['types'];
        $primaryType = $options['primaryType'];
        $domain      = $options['domain'] ?? [];
        $format      = self::normalizeFormat($options['format'] ?? 'ES256');

        // -------------------------------------------------
        // Derive keypair ONCE
        // -------------------------------------------------
        $kp = self::internalKeypair([
            'secret' => $secret,
            'format' => $format
        ]);

        /* =================================================
         * k256 (secp256k1 + keccak256) — EIP-712
         * ================================================= */
        if ($format === 'k256') {

            // Full EIP-712 typed data digest.
            // Q_Crypto_EIP712::hashTypedData() is the single source of truth
            // for this encoding — byte-identical to eip712.js on the JS side.
            $digestBin = Q_Crypto_EIP712::hashTypedData(
                $domain,
                $primaryType,
                $message,
                $types
            );

            // Recoverable secp256k1 signature: compact(64) + recovery(1)
            $privateKeyHex = bin2hex($kp['privateKey']);

            $sig = Q_ECC::signRecoverable(
                $digestBin,
                $privateKeyHex,
                'K256'
            );

            $compact  = $sig['compact'];  // 64-byte binary r||s
            $recovery = $sig['recovery']; // 0 or 1

            if (!is_string($compact) || strlen($compact) !== 64) {
                throw new Exception("signRecoverable must return 64-byte compact signature");
            }

            // Ethereum-style: r||s||v  (v = 27 + recovery)
            $signature    = $compact . chr(27 + (int)$recovery);
            $signatureHex = '0x' . bin2hex($signature);

            return [
                'format'       => 'eip712',
                'curve'        => 'secp256k1',
                'hashAlg'      => 'keccak256',
                'domain'       => $domain,
                'primaryType'  => $primaryType,
                'digest'       => bin2hex($digestBin),
                'signature'    => $signature,
                'signatureHex' => $signatureHex,
                'publicKey'    => $kp['publicKey'],
                'address'      => $kp['address']
            ];
        }

        /* =================================================
         * p256 (NIST P-256 + SHA-256) — ES256
         * ================================================= */

        // Canonical JSON payload — must match JS Q.serialize() output exactly
        $payload = [
            'domain'      => $domain,
            'primaryType' => $primaryType,
            'types'       => $types,
            'message'     => $message
        ];

        $canonical = Q_Utils::serialize($payload);
        $digestBin = Q_Data::digest('sha256', $canonical);

        $privateKeyHex = bin2hex($kp['privateKey']);

        $rs  = Q_ECC::signDigest($digestBin, $privateKeyHex, 'P256');
        $der = Q_ECC::RStoDER($rs);

        return [
            'format'       => 'es256',
            'curve'        => 'p256',
            'hashAlg'      => 'sha256',
            'domain'       => $domain,
            'primaryType'  => $primaryType,
            'digest'       => bin2hex($digestBin),
            'signature'    => $der,
            'signatureHex' => '0x' . bin2hex($der),
            'publicKey'    => $kp['publicKey']
        ];
    }

    /**
     * Perform a cryptographic delegation ceremony.
     *
     * Delegation is capability-based:
     * - A child secret is deterministically derived from a parent secret
     * - The parent signs a typed delegation statement
     * - The result can be verified and chained
     *
     * SECURITY MODEL:
     * - rootSecret is never returned
     * - secret is the sole bearer of delegated capability
     * - Authority is proven by the parent's signature
     * - context is treated as an opaque, signed string
     *
     * SIGNING FORMATS:
     * - "p256" / "es256" → P-256 + SHA-256.
     *   Digest = SHA-256(canonical JSON payload).
     *   secretHash = sha256(derivedSecret).
     *   Domain: empty (unused).
     *
     * - "k256" / "EIP712" → secp256k1 + keccak256 + full EIP-712 struct encoding.
     *   Domain: { name: "Q.Crypto", version: "1", salt: keccak256(label) }
     *   The label is placed in the domain salt, making cross-label signature
     *   replay structurally impossible at the cryptographic level.
     *   secretHash = keccak256(derivedSecret).
     *
     * @method delegate
     * @static
     *
     * @param array  $options
     * @param string $options['rootSecret'] Raw binary parent secret
     * @param string $options['label']      Delegation label (domain-separated)
     * @param string $options['context']    Optional opaque context string
     * @param string $options['format']     "ES256" (default), 'p256', 'k256', or "EIP712"
     *
     * @return array {
     *   label:     string,
     *   context:   string,
     *   secret:    string (raw binary derived secret),
     *   statement: array,
     *   proof:     array (from Q_Crypto::sign())
     * }
     * @throws Exception
     */
    public static function delegate(array $options): array
    {
        if (empty($options['rootSecret']) || !is_string($options['rootSecret'])) {
            throw new Exception("rootSecret must be a binary string");
        }
        if (empty($options['label']) || !is_string($options['label'])) {
            throw new Exception("label required");
        }
        if (isset($options['context']) && !is_string($options['context'])) {
            throw new Exception("context must be a string if provided");
        }

        $rootSecret = $options['rootSecret'];
        $label      = $options['label'];
        $context    = $options['context'] ?? '';
        $format     = self::normalizeFormat($options['format'] ?? "ES256");

        // -------------------------------------------------
        // Derive delegated capability secret
        // -------------------------------------------------
        $derivedSecret = Q_Data::derive(
            $rootSecret,
            "q.crypto.delegate." . $label,
            ['size' => 32]
        );

        // -------------------------------------------------
        // Derive parent keypair + identity
        // -------------------------------------------------
        $parentKp = self::internalKeypair([
            'secret' => $rootSecret,
            'format' => $format
        ]);

        if ($format === 'k256') {
            // eip712: parent identity is the Ethereum address
            $parentIdentity = $parentKp['address'];
            $parentType     = 'address';
        } else {
            // es256: parent identity is SHA-256 of the public key
            $pub = $parentKp['publicKey'];
            if (ctype_xdigit($pub)) {
                $pub = hex2bin($pub);
            }
            $parentIdentity = bin2hex(Q_Data::digest('sha256', $pub));
            $parentType     = 'bytes32';
        }

        // -------------------------------------------------
        // Compute secret hash
        // k256/eip712: keccak256(derivedSecret)
        // p256/es256:  sha256(derivedSecret)
        // -------------------------------------------------
        if ($format === 'k256') {
            $secretHash = bin2hex(Keccak::hash($derivedSecret, 256, true));
        } else {
            $secretHash = bin2hex(Q_Data::digest('sha256', $derivedSecret));
        }

        // -------------------------------------------------
        // Construct delegation statement (protocol-fixed)
        // -------------------------------------------------
        $statement = [
            'parent'     => $parentIdentity,
            'label'      => $label,
            'issuedTime' => time(),
            'context'    => $context,
            'secretHash' => $secretHash
        ];

        // -------------------------------------------------
        // Build domain
        // k256/eip712: { name, version, salt }
        //   salt = keccak256(utf8(label)) as bytes32 hex.
        //   Placing the label in the domain salt makes cross-label
        //   replay impossible at the digest level.
        // p256/es256: empty (unused by sign()).
        // -------------------------------------------------
        if ($format === 'k256') {
            $labelSalt = bin2hex(Keccak::hash($label, 256, true));
            $domain = [
                'name'    => 'Q.Crypto',
                'version' => '1',
                'salt'    => $labelSalt
            ];
        } else {
            $domain = [];
        }

        // -------------------------------------------------
        // Sign via Q_Crypto::sign()
        // k256/eip712 path uses Q_Crypto_EIP712::hashTypedData().
        // p256/es256  path uses SHA-256(canonical JSON).
        // -------------------------------------------------
        $proof = self::sign([
            'secret'      => $rootSecret,
            'domain'      => $domain,
            'message'     => $statement,
            'types'       => [
                'EIP712Domain' => [
                    ['name' => 'name',    'type' => 'string'  ],
                    ['name' => 'version', 'type' => 'string'  ],
                    ['name' => 'salt',    'type' => 'bytes32' ]
                ],
                'Delegation' => [
                    ['name' => 'parent',     'type' => $parentType],
                    ['name' => 'label',      'type' => 'string'   ],
                    ['name' => 'issuedTime', 'type' => 'uint64'   ],
                    ['name' => 'context',    'type' => 'string'   ],
                    ['name' => 'secretHash', 'type' => 'bytes32'  ]
                ]
            ],
            'primaryType' => 'Delegation',
            'format'      => $format
        ]);

        return [
            'label'     => $label,
            'context'   => $context,
            'secret'    => $derivedSecret,
            'statement' => $statement,
            'proof'     => $proof
        ];
    }

    /**
     * Verify a typed cryptographic signature.
     *
     * Supports:
     * - Q-native typed crypto (P-256 + SHA-256)
     * - Ethereum EIP-712 (secp256k1 + keccak256)
     *
     * Always returns a boolean.
     *
     * Optional recovery:
     * - If `options['recovered']` is provided, recovered signer
     *   information is written into it (when supported).
     *
     * @method verify
     * @static
     *
     * @param array $options
     * @param string $options['format']
     *   Signature format: "es256" (default) or "EIP712".
     * @param array $options['domain']
     *   Typed data domain.
     * @param array $options['types']
     *   Typed data schema.
     * @param array $options['message']
     *   Message payload.
     * @param string $options['signature']
     *   Signature (DER binary for es256, binary or hex r||s||v for eip712).
     * @param string $options['primaryType']
     *   Root type name (required for eip712).
     * @param string $options['address']
     *   Expected signer address (eip712).
     * @param string $options['publicKey']
     *   Expected signer public key hex (es256).
     * @param array $options['recovered']
     *   If provided, signer info is written here.
     *
     * @return bool
     */
    public static function verify(array $options): bool
    {
        if (empty($options)) {
            throw new Exception("options required");
        }

        $format = self::normalizeFormat($options['format'] ?? "ES256");

        /* =================================================
        * Ethereum / EIP-712
        * ================================================= */
        if ($format === 'k256') {
            if (empty($options['primaryType'])) {
                throw new Exception("primaryType required for k256 verification");
            }

            try {
                $digest = Q_Crypto_EIP712::hashTypedData(
                    $options['domain'] ?? [],
                    $options['primaryType'],
                    $options['message'],
                    $options['types']
                );

                $sigBin = is_string($options['signature']) && (
                    strpos($options['signature'], '0x') === 0 ||
                    ctype_xdigit($options['signature'])
                )
                    ? self::hexToBinMaybe($options['signature'])
                    : $options['signature'];

                if (strlen($sigBin) === 65) {
                    $compact = substr($sigBin, 0, 64);
                    $v = ord($sigBin[64]);

                    if ($v === 27 || $v === 28) {
                        $recoveries = [$v - 27];
                    } elseif ($v === 0 || $v === 1) {
                        $recoveries = [$v];
                    } else {
                        return false;
                    }

                } elseif (strlen($sigBin) === 64) {
                    $compact = $sigBin;
                    $recoveries = [0, 1]; // match JS behavior

                } else {
                    return false;
                }

                $pub = null;

                foreach ($recoveries as $recovery) {
                    $pub = Q_ECC::recoverPublicKey(
                        $digest,
                        $compact,
                        $recovery,
                        'K256'
                    );
                    if ($pub) break;
                }

                if (!$pub) {
                    return false;
                }

                $addr = self::publicKeyToAddress($pub);

                if (isset($options['recovered']) && is_array($options['recovered'])) {
                    $options['recovered']['address'] = $addr;
                    $options['recovered']['publicKey'] = $pub;
                }

                if (!empty($options['address'])) {
                    return hash_equals(
                        strtolower($addr),
                        strtolower($options['address'])
                    );
                }

                return true;

            } catch (Exception $e) {
                return false;
            }
        }

        /* =================================================
        * es256 (P-256 + SHA-256)
        * ================================================= */
        if ($format === 'p256') {

            if (empty($options['publicKey']) || !is_string($options['publicKey'])) {
                throw new Exception("es256 verify requires publicKey (hex)");
            }
            if (empty($options['signature'])) {
                throw new Exception("es256 verify requires signature (DER binary)");
            }

            $payload = array(
                'domain'      => $options['domain'] ?? [],
                'primaryType' => $options['primaryType'],
                'types'       => $options['types'],
                'message'     => $options['message']
            );

            // Deep canonicalization (must match sign)
            $canonical = Q_Utils::serialize($payload);
            $digest = Q_Data::digest('sha256', $canonical);

            try {
                $sigBin = is_string($options['signature']) && (
                    strpos($options['signature'], '0x') === 0 ||
                    ctype_xdigit($options['signature'])
                )
                    ? self::hexToBinMaybe($options['signature'])
                    : $options['signature'];

                return Q_ECC::verifyDigest(
                    $digest,
                    Q_ECC::DERtoRS($sigBin),
                    $options['publicKey'],
                    'P256'
                );
            } catch (Exception $e) {
                return false;
            }
        }

        throw new Exception("Unknown signature format: {$format}");
    }

    /**
     * Verify exactly one delegation step.
     *
     * This validates a single parent → child delegation link.
     * It is intended to be called repeatedly to verify a full delegation chain.
     *
     * Guarantees:
     * - The derived secret matches statement.secretHash
     * - The delegation statement was correctly signed
     * - The signer matches the declared parent identity
     *
     * Does NOT verify:
     * - Parent legitimacy beyond this step
     * - Expiration or revocation policy
     *
     * @method verifyDelegated
     * @static
     *
     * @param array $options
     * @param string $options['format'] "ES256" (default) or "EIP712"
     * @param array  $options['statement'] Delegation statement
     * @param string $options['signature'] Signature (DER for es256, hex/bytes for eip712)
     * @param string $options['derivedSecret'] Raw binary derived secret
     * @param string $options['parentPublicKey'] Raw public key (es256 only)
     * @param array  $options['domain'] Optional EIP-712 domain
     *
     * @return bool
     * @throws Exception
     */
    public static function verifyDelegated(array $options)
    {
        if (empty($options['statement']) || !is_array($options['statement'])) {
            throw new Exception("statement required");
        }
        if (empty($options['derivedSecret']) || !is_string($options['derivedSecret'])) {
            throw new Exception("derivedSecret must be binary string");
        }

        $format = self::normalizeFormat(isset($options['format']) ? $options['format'] : "ES256");
        $statement = $options['statement'];
        $context   = isset($statement['context']) ? $statement['context'] : '';

        // -------------------------------------------------
        // Validate required statement fields
        // -------------------------------------------------
        foreach (array('parent', 'label', 'issuedTime', 'secretHash') as $f) {
            if (!isset($statement[$f])) {
                throw new Exception("statement.$f required");
            }
        }

        // -------------------------------------------------
        // Verify secret binding
        // -------------------------------------------------
        if ($format === 'k256') {
            $actualHash = bin2hex(Keccak::hash($options['derivedSecret'], 256, true));
        } else {
            $actualHash = bin2hex(Q_Data::digest('sha256', $options['derivedSecret']));
        }

        if (!hash_equals($actualHash, $statement['secretHash'])) {
            return false;
        }

        // -------------------------------------------------
        // Protocol-fixed delegation schema
        // -------------------------------------------------
        $types = array(
            'EIP712Domain' => [
                ['name' => 'name',    'type' => 'string'  ],
                ['name' => 'version', 'type' => 'string'  ],
                ['name' => 'salt',    'type' => 'bytes32' ]
            ],
            'Delegation' => array(
                array(
                    'name' => 'parent',
                    'type' => ($format === 'k256') ? 'address' : 'bytes32'
                ),
                array('name' => 'label',      'type' => 'string'),
                array('name' => 'issuedTime', 'type' => 'uint64'),
                array('name' => 'context',    'type' => 'string'),
                array('name' => 'secretHash', 'type' => 'bytes32')
            )
        );

        $message = $statement;
        $message['context'] = $context;

        // -------------------------------------------------
        // EIP-712 (secp256k1)
        // -------------------------------------------------
        if ($format === 'k256') {

            if (empty($options['signature'])) {
                throw new Exception("signature required");
            }

            $recovered = array();

            $ok = Q_Crypto::verify(array(
                'format'      => "EIP712",
                'domain'      => isset($options['domain']) ? $options['domain'] : array(),
                'types'       => $types,
                'primaryType' => 'Delegation',
                'message'     => $message,
                'signature'   => $options['signature'],
                'recovered'   => &$recovered
            ));

            if ($ok !== true) {
                return false;
            }

            if (
                empty($recovered['address']) ||
                strtolower($recovered['address']) !== strtolower($statement['parent'])
            ) {
                return false;
            }

            return true;
        }

        // -------------------------------------------------
        // es256 (P-256)
        // -------------------------------------------------
        if ($format === 'p256') {

            if (empty($options['parentPublicKey']) || !is_string($options['parentPublicKey'])) {
                throw new Exception("parentPublicKey required for es256");
            }

            $expectedParent = bin2hex(
                Q_Data::digest('sha256', $options['parentPublicKey'])
            );

            if (!hash_equals($expectedParent, $statement['parent'])) {
                return false;
            }

            return Q_Crypto::verify(array(
                'format'      => "ES256",
                'types'       => $types,
                'primaryType' => 'Delegation',
                'message'     => $message,
                'signature'   => $options['signature'],
                'publicKey'   => $options['parentPublicKey']
            )) === true;
        }

        throw new Exception("Unsupported format: {$format}");
    }

    /**
     * Deterministically derive a signing keypair from a secret.
     *
     * SECURITY INVARIANTS:
     * - This is the ONLY place secrets become private keys
     * - No randomness
     * - No storage
     * - Deterministic & reproducible
     *
     * Supported formats:
     * - "k256" → secp256k1 (Ethereum / EIP-712)
     * - "p256" → NIST P-256 (Q-native crypto)
     *
     * Derivation method:
     * - k256: digest = keccak256("q.crypto.k256.private-key" || secret),
     *         scalar = digest mod curveOrder.
     * - p256: scalar = HKDF-SHA256(secret, "q.crypto.p256.private-key")
     *         via Q_Data::derive() — matches JS Q.Data.derive() exactly.
     *
     * @method internalKeypair
     * @static
     *
     * @param array  $options
     * @param string $options['secret'] Raw binary secret (32 bytes recommended).
     *                                  Never hex or base64 — raw binary only.
     * @param string $options['format'] "ES256" / "EIP712" (default: "ES256").
     *
     * @return array Associative array with the following keys:
     *
     *   'format'     {string} Resolved format: "EIP712" (k256) or "ES256" (p256).
     *   'curve'      {string} Curve name: "secp256k1" or "p256".
     *   'hashAlg'    {string} Hash algorithm: "keccak256" or "sha256".
     *   'privateKey' {string} Raw binary private key scalar (32 bytes).
     *                         Never log, store, or transmit this value.
     *   'publicKey'  {string} Raw uncompressed public key (65 bytes): 0x04 || X || Y.
     *
     *   The following key is only present for k256:
     *   'address'    {string} Ethereum address: "0x" + last 20 bytes of
     *                         keccak256(publicKey[1..64]).
     *
     * @throws Exception If secret is missing or not a binary string.
     * @throws Exception If format is unsupported.
     * @throws Exception If derived private key scalar is zero (astronomically unlikely).
     */
    public static function internalKeypair(array $options): array
    {
        if (empty($options['secret']) || !is_string($options['secret'])) {
            throw new Exception("secret must be a binary string");
        }

        $secret = $options['secret'];
        $format = self::normalizeFormat($options['format'] ?? 'ES256');

        // -------------------------------------------------
        // k256 / secp256k1 (Ethereum)
        // Derivation: keccak256("q.crypto.k256.private-key" || secret) mod n
        // Matches JS internalKeypair EIP712 path exactly.
        // -------------------------------------------------
        if ($format === 'k256') {

            $material = "q.crypto.k256.private-key" . $secret;
            $digest   = Keccak::hash($material, 256, true);

            $generator = CurveFactory::getGeneratorByName('secp256k1');
            $n = $generator->getOrder();

            $d = gmp_mod(gmp_init(bin2hex($digest), 16), $n);
            if (gmp_cmp($d, 0) === 0) {
                throw new Exception("Derived invalid secp256k1 scalar");
            }

            $privateKey = $generator->getPrivateKeyFrom($d);
            $publicKey  = $privateKey->getPublicKey();

            $x = str_pad(gmp_strval($publicKey->getPoint()->getX(), 16), 64, '0', STR_PAD_LEFT);
            $y = str_pad(gmp_strval($publicKey->getPoint()->getY(), 16), 64, '0', STR_PAD_LEFT);

            $publicKeyRaw    = hex2bin('04' . $x . $y);
            $privateKeyBytes = hex2bin(str_pad(gmp_strval($d, 16), 64, '0', STR_PAD_LEFT));

            return [
                'format'     => 'EIP712',
                'curve'      => 'secp256k1',
                'hashAlg'    => 'keccak256',
                'privateKey' => $privateKeyBytes,
                'publicKey'  => $publicKeyRaw,
                'address'    => self::publicKeyToAddress($publicKeyRaw)
            ];
        }

        // -------------------------------------------------
        // p256 / secp256r1 (Q-native)
        // Derivation: HKDF-SHA256(secret, "q.crypto.p256.private-key")
        // Matches JS internalKeypair ES256 path exactly — both use Q.Data.derive().
        // -------------------------------------------------
        if ($format === 'p256') {

            // HKDF derivation — byte-identical to JS Q.Data.derive()
            $privateKeyBytes = Q_Data::derive(
                $secret,
                'q.crypto.p256.private-key',
                ['size' => 32]
            );

            $generator = EccFactory::getNistCurves()->generator256();
            $n = $generator->getOrder();

            $d = gmp_mod(gmp_init(bin2hex($privateKeyBytes), 16), $n);
            if (gmp_cmp($d, 0) === 0) {
                throw new Exception("Derived invalid p256 scalar");
            }

            $privateKey = $generator->getPrivateKeyFrom($d);
            $publicKey  = $privateKey->getPublicKey();

            $x = str_pad(gmp_strval($publicKey->getPoint()->getX(), 16), 64, '0', STR_PAD_LEFT);
            $y = str_pad(gmp_strval($publicKey->getPoint()->getY(), 16), 64, '0', STR_PAD_LEFT);

            $publicKeyRaw = hex2bin('04' . $x . $y);

            return [
                'format'     => 'ES256',
                'curve'      => 'p256',
                'hashAlg'    => 'sha256',
                'privateKey' => $privateKeyBytes,
                'publicKey'  => $publicKeyRaw
            ];
        }

        throw new Exception("Unsupported format: {$format}");
    }

    private static function normalizeFormat($format)
    {
        switch (strtolower((string)$format)) {
            case 'eip712':
            case 'k256':
                return 'k256';
            case 'es256':
            case 'p256':
                return 'p256';
            default:
                throw new Exception("Unsupported format: $format");
        }
    }

    private static function hexToBinMaybe($value)
    {
        if (!is_string($value)) {
            throw new Exception("signature must be a string");
        }

        if (strpos($value, '0x') === 0 || strpos($value, '0X') === 0) {
            $value = substr($value, 2);
        }

        if (strlen($value) % 2 !== 0) {
            throw new Exception("invalid hex");
        }

        $bin = hex2bin($value);
        if ($bin === false) {
            throw new Exception("invalid hex");
        }

        return $bin;
    }

    private static function publicKeyToAddress($publicKeyRaw)
    {
        if (!is_string($publicKeyRaw) || strlen($publicKeyRaw) !== 65 || ord($publicKeyRaw[0]) !== 0x04) {
            throw new Exception("publicKey must be 65-byte uncompressed key");
        }

        $hash = Keccak::hash(substr($publicKeyRaw, 1), 256, true);
        return '0x' . substr(bin2hex($hash), -40);
    }

}
