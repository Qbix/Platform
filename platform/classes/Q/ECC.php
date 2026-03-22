<?php

require_once Q_PLUGIN_DIR.DS.'vendor'.DS.'autoload.php';

use Mdanter\Ecc\Crypto\Signature\SignHasher;
use Mdanter\Ecc\EccFactory;
use Mdanter\Ecc\Curves\CurveFactory;
use Mdanter\Ecc\Crypto\Signature\Signer;
use Mdanter\Ecc\Crypto\Signature\Signature;
use Mdanter\Ecc\Serializer\PublicKey\PemPublicKeySerializer;
use Mdanter\Ecc\Serializer\PublicKey\DerPublicKeySerializer;
use Mdanter\Ecc\Serializer\Signature\DerSignatureSerializer;

/**
 * @module Q
 */
/**
 * Used for elliptic curve operations in Q
 * @class Q_ECC
 */
class Q_ECC
{
    /**
     * Sign a payload (hashes internally once).
     *
     * @method sign
     * @static
     * @param {string} $serialized canonical string
     * @param {string} $privateKeyHex
     * @param {string} [$curve='P256']
     * @return {array} [r, s]
     */
    static function sign($serialized, $privateKeyHex, $curve = 'P256')
    {
        switch ($curve) {
            case 'K256':
                $hash = \Crypto\Keccak::hash($serialized, 256, true);
                break;
            case 'P256':
                $hash = hash('sha256', $serialized, true);
                break;
            case 'P384':
                $hash = hash('sha384', $serialized, true);
                break;
            case 'P521':
                $hash = hash('sha512', $serialized, true);
                break;
            default:
                throw new Q_Exception_WrongType([
                    'field' => 'curve',
                    'type' => 'K256, P256, P384 or P521'
                ]);
        }

        return self::signDigest($hash, $privateKeyHex, $curve);
    }


    /**
     * Verify a signature (hashes internally once).
     *
     * @method verify
     * @static
     * @param {string} $serialized canonical string
     * @param {string|array} $signature
     * @param {string} $publicKey
     * @param {string} [$curve='P256']
     * @return {boolean}
     */
    static function verify($serialized, $signature, $publicKey, $curve = 'P256')
    {
        if (empty($signature)) {
            return false;
        }

        switch ($curve) {
            case 'K256':
                $hash = \Crypto\Keccak::hash($serialized, 256, true);
                break;
            case 'P256':
                $hash = hash('sha256', $serialized, true);
                break;
            case 'P384':
                $hash = hash('sha384', $serialized, true);
                break;
            case 'P521':
                $hash = hash('sha512', $serialized, true);
                break;
            default:
                throw new Q_Exception_WrongType([
                    'field' => 'curve',
                    'type' => 'K256, P256, P384 or P521'
                ]);
        }

        return self::verifyDigest($hash, $signature, $publicKey, $curve);
    }

    /**
     * Sign a precomputed digest (NO hashing performed).
     *
     * @method signDigest
     * @static
     * @param {string} $digest binary message digest
     * @param {string} $privateKeyHex private key scalar (hex)
     * @param {string} [$curve='P256']
     * @return {array} [r, s] hex
     */
    static function signDigest($digest, $privateKeyHex, $curve = 'P256')
    {
        $adapter = EccFactory::getAdapter();

        switch ($curve) {
            case 'K256':
                $generator = CurveFactory::getGeneratorByName('secp256k1');
                break;
            case 'P256':
                $generator = EccFactory::getNistCurves()->generator256();
                break;
            case 'P384':
                $generator = EccFactory::getNistCurves()->generator384();
                break;
            case 'P521':
                $generator = EccFactory::getNistCurves()->generator521();
                break;
            default:
                throw new Q_Exception_WrongType([
                    'field' => 'curve',
                    'type' => 'K256, P256, P384 or P521'
                ]);
        }

        if (!ctype_xdigit($privateKeyHex)) {
            $privateKeyHex = bin2hex($privateKeyHex);
        }
        $d = gmp_init($privateKeyHex, 16);
        $privateKey = $generator->getPrivateKeyFrom($d);

        $signer = new Signer($adapter);
        $sig = $signer->sign($privateKey, $digest);

        // ---- LOW-S NORMALIZATION (Ethereum / noble compatible) ----
        $n = $generator->getOrder();
        $s = $sig->getS();

        if (gmp_cmp($s, gmp_div_q($n, 2)) > 0) {
            $s = gmp_sub($n, $s);
        }

        $r = $sig->getR();
        $sig = new Signature($r, $s);

        $pad = ($curve === 'P521') ? 132 : (($curve === 'P384') ? 96 : 64);

        return [
            str_pad(gmp_strval($sig->getR(), 16), $pad, '0', STR_PAD_LEFT),
            str_pad(gmp_strval($sig->getS(), 16), $pad, '0', STR_PAD_LEFT)
        ];
    }

    /**
     * Verify a signature against a precomputed digest (NO hashing performed).
     *
     * @method verifyDigest
     * @static
     * @param {string} $digest binary message digest
     * @param {string|array} $signature [r,s] or concatenated hex
     * @param {string} $publicKey raw uncompressed public key (binary or hex)
     * @param {string} [$curve='P256']
     * @return {boolean}
     */
    static function verifyDigest($digest, $signature, $publicKey, $curve = 'P256')
    {
        $adapter = EccFactory::getAdapter();

        switch ($curve) {
            case 'K256':
                $generator = CurveFactory::getGeneratorByName('secp256k1');
                break;
            case 'P256':
                $generator = EccFactory::getNistCurves()->generator256();
                break;
            case 'P384':
                $generator = EccFactory::getNistCurves()->generator384();
                break;
            case 'P521':
                $generator = EccFactory::getNistCurves()->generator521();
                break;
            default:
                throw new Q_Exception_WrongType([
                    'field' => 'curve',
                    'type' => 'K256, P256, P384 or P521'
                ]);
        }

        // -----------------------------
        // Normalize signature
        // -----------------------------
        if (is_array($signature)) {
            $signature = new Signature(
                gmp_init($signature[0], 16),
                gmp_init($signature[1], 16)
            );
        } else {
            if (!ctype_xdigit($signature)) {
                throw new Exception("signature must be hex string or [r,s]");
            }

            $len = strlen($signature);
            if ($len % 2 !== 0) {
                throw new Exception("invalid signature length");
            }

            $half = $len / 2;

            $r = gmp_init(substr($signature, 0, $half), 16);
            $s = gmp_init(substr($signature, $half), 16);

            $signature = new Signature($r, $s);
        }
        
        $n = $generator->getOrder();
        $s = $signature->getS();

        if (gmp_cmp($s, gmp_div_q($n, 2)) > 0) {
            return false; // reject non-canonical signature
        }

        // -----------------------------
        // Normalize public key (raw 04||X||Y)
        // -----------------------------
        if (is_string($publicKey) && ctype_xdigit($publicKey)) {
            $publicKey = hex2bin($publicKey);
        }

        if (!is_string($publicKey)) {
            throw new Exception("publicKey must be binary or hex");
        }

        switch ($curve) {
            case 'K256':
            case 'P256':
                $expectedLen = 65;
                break;
            case 'P384':
                $expectedLen = 97;
                break;
            case 'P521':
                $expectedLen = 133;
                break;
        }

        if (strlen($publicKey) !== $expectedLen || ord($publicKey[0]) !== 0x04) {
            throw new Exception("publicKey must be uncompressed raw EC point");
        }

        $coordLen = ($expectedLen - 1) / 2;

        $x = gmp_init(bin2hex(substr($publicKey, 1, $coordLen)), 16);
        $y = gmp_init(bin2hex(substr($publicKey, 1 + $coordLen, $coordLen)), 16);

        $point = $generator->getCurve()->getPoint($x, $y);
        $publicKeyObj = $generator->getPublicKeyFrom($point);

        // -----------------------------
        // Convert to DER → PEM (for library compatibility)
        // -----------------------------
        $derSerializer = new DerPublicKeySerializer($adapter);
        $publicKeyDer = $derSerializer->serialize($publicKeyObj);

        $key_PEM =
            "-----BEGIN PUBLIC KEY-----\n" .
            chunk_split(base64_encode($publicKeyDer), 64, "\n") .
            "-----END PUBLIC KEY-----";

        $pemSerializer = new PemPublicKeySerializer($derSerializer);
        $key = $pemSerializer->parse($key_PEM);

        // -----------------------------
        // Verify
        // -----------------------------
        $signer = new Signer($adapter);
        return $signer->verify($key, $signature, $digest);
    }

    /**
     * Sign a digest using secp256k1 and produce a recoverable signature.
     *
     * This method produces:
     * - 64-byte compact signature (r || s)
     * - recovery id (0 or 1)
     *
     * It brute-forces the recovery id by attempting public key recovery
     * and matching against the derived public key from the private key.
     *
     * Intended for:
     * - EIP-712 signing
     * - Ethereum-compatible signatures (r || s || v)
     *
     * @method signRecoverable
     * @static
     *
     * @param {string} $digest
     *   32-byte binary message digest (already hashed).
     * @param {string} $privateKeyHex
     *   Private key scalar as hex string (no 0x prefix).
     * @param {string} [$curve='K256']
     *   Only 'K256' is supported.
     *
     * @return {array}
     * @return {string} return.compact
     *   64-byte binary signature (r || s).
     * @return {number} return.recovery
     *   Recovery id (0 or 1).
     *
     * @throws {Exception}
     */
    static function signRecoverable($digest, $privateKeyHex, $curve = 'K256')
    {
        if ($curve !== 'K256') {
            throw new Exception("signRecoverable only supports K256");
        }

        // Step 1: sign normally (r,s)
        $rs = self::signDigest($digest, $privateKeyHex, 'K256');

        $rHex = str_pad($rs[0], 64, '0', STR_PAD_LEFT);
        $sHex = str_pad($rs[1], 64, '0', STR_PAD_LEFT);

        $compact = hex2bin($rHex . $sHex);

        // Step 2: derive public key from private key
        $generator = CurveFactory::getGeneratorByName('secp256k1');
        
        if (!ctype_xdigit($privateKeyHex)) {
            $privateKeyHex = bin2hex($privateKeyHex);
        }
        $d = gmp_init($privateKeyHex, 16);

        $privateKey = $generator->getPrivateKeyFrom($d);
        $publicKey = $privateKey->getPublicKey();

        $x = str_pad(gmp_strval($publicKey->getPoint()->getX(), 16), 64, '0', STR_PAD_LEFT);
        $y = str_pad(gmp_strval($publicKey->getPoint()->getY(), 16), 64, '0', STR_PAD_LEFT);
        $pubRaw = hex2bin('04' . $x . $y);

        // Step 3: brute-force recovery id (0 or 1, maybe 2 or 3)
        for ($recovery = 0; $recovery <= 3; $recovery++) {

            $recovered = self::recoverPublicKey($digest, $compact, $recovery, 'K256');

            if ($recovered && $recovered === $pubRaw) {
                return [
                    'compact' => $compact,
                    'recovery' => $recovery
                ];
            }
        }

        throw new Exception("Failed to determine recovery id");
    }

    /**
     * Recover an uncompressed public key from a secp256k1 signature.
     *
     * Uses compact signature (r || s) and recovery id to reconstruct
     * the public key corresponding to the signer.
     *
     * Internally adapts to Crypto\Signature::getPubKeyWithRS.
     *
     * Output is always:
     * - 65-byte uncompressed key: 0x04 || X || Y
     *
     * @method recoverPublicKey
     * @static
     *
     * @param {string} $digest
     *   32-byte binary message digest.
     * @param {string} $compact
     *   64-byte binary signature (r || s).
     * @param {number} $recovery
     *   Recovery id (0 or 1).
     * @param {string} [$curve='K256']
     *   Only 'K256' is supported.
     *
     * @return {string|boolean}
     *   Returns 65-byte binary public key if successful, or false.
     *
     * @throws {Exception}
     */
    static function recoverPublicKey($digest, $compact, $recovery, $curve = 'K256')
    {
        if ($curve !== 'K256') {
            throw new Exception("recoverPublicKey only supports K256");
        }

        if (!is_string($digest) || strlen($digest) !== 32) {
            throw new Exception("digest must be 32-byte binary");
        }

        if (!is_string($compact) || strlen($compact) !== 64) {
            throw new Exception("compact signature must be 64 bytes");
        }

        // Split compact signature
        $r = substr($compact, 0, 32);
        $s = substr($compact, 32, 32);

        $rHex = bin2hex($r);
        $sHex = bin2hex($s);
        $hashHex = bin2hex($digest);

        // Convert recovery id → flag
        // Ethereum uses v = 27/28 → recovery = 0/1
        // Library expects 27/28
        $flag = 27 + (int)$recovery;

        // Use your existing Crypto\Signature implementation
        $pub = \Crypto\Signature::getPubKeyWithRS(
            $flag,
            $rHex,
            $sHex,
            $hashHex
        );

        if (!$pub) {
            return false;
        }

        // Convert to uncompressed raw key (04 + X + Y)
        if (strlen($pub) === 130) {
            return hex2bin($pub);
        }

        // If compressed, decompress
        $pt = \Crypto\AddressCodec::Decompress($pub);

        $x = str_pad($pt['x'], 64, '0', STR_PAD_LEFT);
        $y = str_pad($pt['y'], 64, '0', STR_PAD_LEFT);

        return hex2bin('04' . $x . $y);
    }

    /**
     * Convert an (r,s) signature to ASN.1 DER.
     *
     * @method RStoDER
     * @static
     * @param {array} $signature [r, s] hex
     * @return {string} DER signature (binary)
     */
    static function RStoDER($signature)
    {
        $sig = new Signature(
            gmp_init($signature[0], 16),
            gmp_init($signature[1], 16)
        );

        $serializer = new DerSignatureSerializer();
        return $serializer->serialize($sig);
    }

    /**
     * Convert ASN.1 DER signature to (r,s).
     *
     * @method DERtoRS
     * @static
     * @param {string} $der DER signature (binary)
     * @return {array} [r, s] hex
     */
    static function DERtoRS($der)
    {
        $serializer = new DerSignatureSerializer();
        $sig = $serializer->parse($der);

        return array(
            gmp_strval($sig->getR(), 16),
            gmp_strval($sig->getS(), 16)
        );
    }

    /**
     * Compute Ethereum-prefixed message hash (EIP-191).
     *
     * @method ethereumMessageHash
     * @static
     * @param {string} $message raw message
     * @return {string} binary hash
     */
    static function ethereumMessageHash($message)
    {
        $prefix = "\x19Ethereum Signed Message:\n" . strlen($message);
        return \Crypto\Keccak::hash($prefix . $message, 256, true);
    }

    /**
     * Sign an Ethereum message using secp256k1.
     *
     * @method ethereumSign
     * @static
     * @param {string} $message raw message
     * @param {string} $privateKeyHex private key scalar
     * @return {array} [r, s] hex
     */
    static function ethereumSign($message, $privateKeyHex)
    {
        $hash = self::ethereumMessageHash($message);
        return self::signDigest($hash, $privateKeyHex, 'K256');
    }

    private static function p1363_to_asn1($p1363)
    {
        $asn1  = '';
        $len   = 0;
        $c_len = intdiv(strlen($p1363), 2);

        foreach (str_split($p1363, $c_len) as $c) {
            $asn1 .= "\x02";

            if (unpack('C', $c)[1] > 0x7f) {
                $asn1 .= pack('C', $c_len + 1) . "\x00";
                $len += 2 + ($c_len + 1);
            } else {
                $asn1 .= pack('C', $c_len);
                $len += 2 + $c_len;
            }

            $asn1 .= $c;
        }

        return "\x30" . pack('C', $len) . $asn1;
    }
}
