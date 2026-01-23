<?php

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
	 * This is the PHP counterpart of `Q_Crypto_sign` in JS.
	 * It performs protocol-level typed signing (not raw message signing).
	 *
	 * Supported formats:
	 * - `p256` → NIST P-256 + SHA-256 (Q-native)
	 * - `k256` → secp256k1 + keccak256 (Ethereum-style)
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
	 * @param {Object} options
	 * @param {String} options.secret
	 *   Raw binary secret material.
	 * @param {Object} options.message
	 *   Typed message payload.
	 * @param {Object} options.types
	 *   Type definitions (EIP-712–style).
	 * @param {String} options.primaryType
	 *   Root type name.
	 * @param {Object} [options.domain]
	 *   Optional domain separator.
	 * @param {String} [options.format="p256"]
	 *   Signing format: `"p256"` or `"k256"`.
	 *
	 * @return {Object}
	 * @return {String} return.format
	 *   Signing format used.
	 * @return {String} return.curve
	 *   Elliptic curve name.
	 * @return {String} return.hashAlg
	 *   Hash algorithm used.
	 * @return {Object} return.domain
	 *   Domain separator.
	 * @return {String} return.primaryType
	 *   Root type name.
	 * @return {String} return.digest
	 *   Hex-encoded message digest.
	 * @return {String} return.signature
	 *   DER-encoded ECDSA signature (binary).
	 * @return {String} return.publicKey
	 *   Raw uncompressed public key.
	 *
	 * @throws {Exception}
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
		$format      = $options['format'] ?? 'p256';

		// -------------------------------------------------
		// Derive keypair ONCE
		// -------------------------------------------------
		$kp = self::internalKeypair([
			'secret' => $secret,
			'format' => $format
		]);

		/* =================================================
		 * k256 (secp256k1 + keccak256)
		 * ================================================= */
		if ($format === 'k256') {

			$payload = array(
				'domain'       => $domain,
				'primaryType' => $primaryType,
				'types'        => $types,
				'message'      => $message
            );

			$canonical = Q_Utils::serialize($payload);
			$digest    = hash('sha3-256', $canonical, true);

			$rs = Q_ECC::sign(
				$digest,
				$kp['privateKey'],
				'K256'
			);

			return [
				'format'      => 'k256',
				'curve'       => 'secp256k1',
				'hashAlg'     => 'keccak256',
				'domain'      => $domain,
				'primaryType'=> $primaryType,
				'digest'      => bin2hex($digest),
				'signature'   => Q_ECC::RStoDER($rs),
				'publicKey'   => $kp['publicKey']
			];
		}

		/* =================================================
		 * p256 (NIST P-256 + SHA-256)
		 * ================================================= */

		$payload = array(
			'domain'       => $domain,
			'primaryType' => $primaryType,
			'types'        => $types,
			'message'      => $message
        );

		$canonical = Q_Utils::serialize($payload);
		$digest    = hash('sha256', $canonical, true);

		$rs = Q_ECC::sign(
			$digest,
			bin2hex($kp['privateKey']),
			'P256'
		);

		return [
			'format'      => 'p256',
			'curve'       => 'p256',
			'hashAlg'     => 'sha256',
			'domain'      => $domain,
			'primaryType'=> $primaryType,
			'digest'      => bin2hex($digest),
			'signature'   => Q_ECC::RStoDER($rs),
			'publicKey'   => $kp['publicKey']
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
     * - Authority is proven by the parent’s signature
     * - context is treated as an opaque, signed string
     *
     * @method delegate
     * @static
     *
     * @param {array} $options
     * @param {string} $options['rootSecret'] Raw binary parent secret
     * @param {string} $options['label'] Delegation label (domain-separated)
     * @param {string|null} $options['context'] Optional opaque context
     * @param {string} $options['format'] 'p256' (default) or 'k256'
     *
     * @return {array}
     * @throws {Exception}
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
        $format     = $options['format'] ?? 'p256';

        // -------------------------------------------------
        // Derive delegated capability secret
        // -------------------------------------------------
        $derivedSecret = Q_Data::derive(
            $rootSecret,
            "q.crypto.delegate." . $label,
            ['size' => 32]
        );

        // -------------------------------------------------
        // Derive parent identity
        // -------------------------------------------------
        $parentKp = Q_Crypto::internalKeypair([
            'secret' => $rootSecret,
            'format' => $format
        ]);

        if ($format === 'k256') {
            $parentIdentity = $parentKp['address'];
            $parentType = 'address';
        } else {
            $parentIdentity = bin2hex(
                Q_Data::digest($parentKp['publicKey'], 'sha256')
            );
            $parentType = 'bytes32';
        }

        // -------------------------------------------------
        // Construct delegation statement (protocol-fixed)
        // -------------------------------------------------
        $statement = array(
            'parent'     => $parentIdentity,
            'label'      => $label,
            'issuedTime' => time(),
            'context'    => $context,
            'secretHash' => bin2hex(
                Q_Data::digest($derivedSecret, 'sha256')
            )
        );

        // -------------------------------------------------
        // Parent signs the delegation
        // -------------------------------------------------
        $proof = Q_Crypto::sign([
            'secret'      => $rootSecret,
            'message'     => $statement,
            'types'       => [
                'Delegation' => [
                    ['name' => 'parent',     'type' => $parentType],
                    ['name' => 'label',      'type' => 'string'],
                    ['name' => 'issuedTime', 'type' => 'uint64'],
                    ['name' => 'context',    'type' => 'string'],
                    ['name' => 'secretHash', 'type' => 'bytes32']
                ]
            ],
            'primaryType' => 'Delegation',
            'format'      => $format
        ]);

        return [
            'label'   => $label,
            'context' => $context,
            'secret'  => $derivedSecret,
            'proof'   => $proof
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
     *   Signature format: "qcrypto" (default) or "eip712".
     * @param array $options['domain']
     *   Typed data domain.
     * @param array $options['types']
     *   Typed data schema.
     * @param array $options['message']
     *   Message payload.
     * @param string $options['signature']
     *   Signature (DER binary for qcrypto, hex r||s for eip712).
     * @param string $options['primaryType']
     *   Root type name (required for eip712).
     * @param string $options['address']
     *   Expected signer address (eip712).
     * @param string $options['publicKey']
     *   Expected signer public key hex (qcrypto).
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

        $format = $options['format'] ?? 'qcrypto';

        /* =================================================
        * Ethereum / EIP-712
        * ================================================= */
        if ($format === 'eip712') {

            if (empty($options['primaryType'])) {
                throw new Exception("primaryType required for eip712 verification");
            }

            try {
                // Canonical EIP-712 hash (same as JS path)
                $digest = Q_Data::hashTypedData(
                    $options['domain'] ?? [],
                    $options['primaryType'],
                    $options['message'],
                    $options['types']
                );

                // Signature: r||s hex
                $sigHex = $options['signature'];
                if (!is_string($sigHex) || strlen($sigHex) !== 128) {
                    return false;
                }

                $r = substr($sigHex, 0, 64);
                $s = substr($sigHex, 64, 64);

                // Recover public key
                $pub = Q_ECC::recoverPublicKey(
                    $digest,
                    [$r, $s],
                    'K256'
                );

                if (!$pub) {
                    return false;
                }

                // Ethereum address = keccak(pub[1:]) last 20 bytes
                $addr = '0x' . substr(
                    bin2hex(hash('sha3-256', substr($pub, 1), true)),
                    -40
                );

                if (isset($options['recovered']) && is_array($options['recovered'])) {
                    $options['recovered']['address'] = $addr;
                }

                if (!empty($options['address'])) {
                    return strtolower($addr) === strtolower($options['address']);
                }

                return true;

            } catch (Exception $e) {
                return false;
            }
        }

        /* =================================================
        * qcrypto (P-256 + SHA-256)
        * ================================================= */
        if ($format === 'qcrypto') {

            if (empty($options['publicKey']) || !is_string($options['publicKey'])) {
                throw new Exception("qcrypto verify requires publicKey (hex)");
            }
            if (empty($options['signature']) || !is_string($options['signature'])) {
                throw new Exception("qcrypto verify requires signature (DER binary)");
            }

            $payload = array(
                'domain'      => $options['domain'] ?? [],
                'primaryType' => $options['primaryType'],
                'types'       => $options['types'],
                'message'     => $options['message']
            );

            // Deep canonicalization (must match sign)
            $canonical = Q::serialize($payload);
            $digest = Q_Data::digest($canonical, 'sha256');

            try {
                return Q_ECC::verify(
                    $digest,
                    Q_ECC::DERtoRS($options['signature']),
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
     * @param string $options['format'] 'qcrypto' (default) or 'eip712'
     * @param array  $options['statement'] Delegation statement
     * @param string $options['signature'] Signature (DER for qcrypto, hex/bytes for eip712)
     * @param string $options['derivedSecret'] Raw binary derived secret
     * @param string $options['parentPublicKey'] Raw public key (qcrypto only)
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

        $format    = isset($options['format']) ? $options['format'] : 'qcrypto';
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
        $actualHash = bin2hex(
            Q_Data::digest($options['derivedSecret'], 'sha256')
        );

        if (!hash_equals($actualHash, $statement['secretHash'])) {
            return false;
        }

        // -------------------------------------------------
        // Protocol-fixed delegation schema
        // -------------------------------------------------
        $types = array(
            'Delegation' => array(
                array(
                    'name' => 'parent',
                    'type' => ($format === 'eip712') ? 'address' : 'bytes32'
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
        if ($format === 'eip712') {

            if (empty($options['signature'])) {
                throw new Exception("signature required");
            }

            $recovered = array();

            $ok = Q_Crypto::verify(array(
                'format'      => 'eip712',
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
        // qcrypto (P-256)
        // -------------------------------------------------
        if ($format === 'qcrypto') {

            if (empty($options['parentPublicKey']) || !is_string($options['parentPublicKey'])) {
                throw new Exception("parentPublicKey required for qcrypto");
            }

            $expectedParent = bin2hex(
                Q_Data::digest($options['parentPublicKey'], 'sha256')
            );

            if (!hash_equals($expectedParent, $statement['parent'])) {
                return false;
            }

            return Q_Crypto::verify(array(
                'format'      => 'qcrypto',
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
     * @method internalKeypair
     * @static
     *
     * @param {array} $options
     * @param {string} $options['secret'] Raw binary secret
     * @param {string} $options['format'] "k256" or "p256" (default: "p256")
     *
     * @return {array}
     * @throws {Exception}
     */
    public static function internalKeypair(array $options): array
    {
        if (empty($options['secret']) || !is_string($options['secret'])) {
            throw new Exception("secret must be a binary string");
        }

        $secret = $options['secret'];
        $format = $options['format'] ?? 'p256';

        $adapter = EccFactory::getAdapter();

        // -------------------------------------------------
        // k256 / secp256k1 (Ethereum)
        // -------------------------------------------------
        if ($format === 'k256') {

            $info = "q.crypto.k256.private-key";
            $material = $info . $secret;

            // keccak256
            $digest = hash('sha3-256', $material, true);

            $generator = CurveFactory::getGeneratorByName('secp256k1');
            $n = $generator->getOrder();

            $d = gmp_mod(gmp_init(bin2hex($digest), 16), $n);
            if (gmp_cmp($d, 0) === 0) {
                throw new Exception("Derived invalid secp256k1 scalar");
            }

            $privateKey = $generator->getPrivateKeyFrom($d);
            $publicKey  = $privateKey->getPublicKey();

            // Uncompressed public key: 04 || X || Y
            $x = str_pad(gmp_strval($publicKey->getPoint()->getX(), 16), 64, '0', STR_PAD_LEFT);
            $y = str_pad(gmp_strval($publicKey->getPoint()->getY(), 16), 64, '0', STR_PAD_LEFT);
            $publicKeyRaw = hex2bin('04' . $x . $y);

            return [
                'format'     => 'k256',
                'curve'      => 'secp256k1',
                'hashAlg'    => 'keccak256',
                'privateKey' => str_pad(gmp_strval($d, 16), 64, '0', STR_PAD_LEFT),
                'publicKey'  => $publicKeyRaw
            ];
        }

        // -------------------------------------------------
        // p256 / secp256r1 (Q-native)
        // -------------------------------------------------
        if ($format === 'p256') {

            $info = "q.crypto.p256.private-key";
            $material = $info . $secret;

            $digest = hash('sha256', $material, true);

            $generator = EccFactory::getNistCurves()->generator256();
            $n = $generator->getOrder();

            $d = gmp_mod(gmp_init(bin2hex($digest), 16), $n);
            if (gmp_cmp($d, 0) === 0) {
                throw new Exception("Derived invalid p256 scalar");
            }

            $privateKey = $generator->getPrivateKeyFrom($d);
            $publicKey  = $privateKey->getPublicKey();

            $x = str_pad(gmp_strval($publicKey->getPoint()->getX(), 16), 64, '0', STR_PAD_LEFT);
            $y = str_pad(gmp_strval($publicKey->getPoint()->getY(), 16), 64, '0', STR_PAD_LEFT);
            $publicKeyRaw = hex2bin('04' . $x . $y);

            return [
                'format'     => 'p256',
                'curve'      => 'p256',
                'hashAlg'    => 'sha256',
                'privateKey' => hex2bin(str_pad(gmp_strval($d, 16), 64, '0', STR_PAD_LEFT)),
                'publicKey'  => $publicKeyRaw
            ];
        }

        throw new Exception("Unsupported format: {$format}");
    }

}
