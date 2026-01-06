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
 * Used for crypto operations in Q
 * @class Q_Crypto
 */
class Q_Crypto {

    /**
     * Verify a signature on a payload serialized into a canonical string,
     * using P-256 ECDSA curve.
     *
     * DO NOT MODIFY: relied upon by Ethereum/K256 users.
     *
     * @method verify
     * @static
     * @param {string} $serialized the serialized data
     * @param {string|array} $signature 192 hex chars (r||s) or [r, s]
     * @param {string} $publicKey ECDSA public key hex
     * @param {string} [$curve='P256'] "P256", "P384", "P521", or "K256"
     * @return {boolean} true if the signature is correct
     */
    static function verify($serialized, $signature, $publicKey, $curve = 'P256')
    {
        if (empty($signature)) {
            return false;
        }

        $adapter = EccFactory::getAdapter();

        switch ($curve) {
            case 'K256':
                $generator = CurveFactory::getGeneratorByName('secp256k1');
                $hasher = new SignHasher('sha256', $adapter);
                break;
            case 'P256':
                $generator = EccFactory::getNistCurves()->generator256();
                $hasher = new SignHasher('sha256', $adapter);
                break;
            case 'P384':
                $generator = EccFactory::getNistCurves()->generator384();
                $hasher = new SignHasher('sha384', $adapter);
                break;
            case 'P521':
                $generator = EccFactory::getNistCurves()->generator521();
                $hasher = new SignHasher('sha512', $adapter);
                break;
            default:
                throw new Q_Exception_WrongType(array(
                    'field' => 'curve',
                    'type' => 'K256, P256, P384 or P521'
                ));
        }

        if (is_array($signature)) {
            $signature = new Signature(
                gmp_init($signature[0], 16),
                gmp_init($signature[1], 16)
            );
        } else {
            $r = gmp_init(substr($signature, 0, 96), 16);
            $s = gmp_init(substr($signature, 96), 16);
            $signature = new Signature($r, $s);
        }

        $key_PEM = (
            "-----BEGIN PUBLIC KEY-----" . PHP_EOL .
            chunk_split(base64_encode(hex2bin($publicKey)), 64, PHP_EOL) .
            "-----END PUBLIC KEY-----"
        );

        $derSerializer = new DerPublicKeySerializer($adapter);
        $pemSerializer = new PemPublicKeySerializer($derSerializer);
        $key = $pemSerializer->parse($key_PEM);

        $hash = $hasher->makeHash($serialized, $generator);

        $signer = new Signer($adapter);
        return $signer->verify($key, $signature, $hash);
    }

    /**
     * Sign a payload serialized into a canonical string.
     *
     * @method sign
     * @static
     * @param {string} $serialized the serialized data
     * @param {string} $privateKeyHex private key scalar (hex)
     * @param {string} [$curve='P256'] "P256", "P384", "P521", or "K256"
     * @return {array} [r, s] signature components as hex strings
     */
    static function sign($serialized, $privateKeyHex, $curve = 'P256')
    {
        $adapter = EccFactory::getAdapter();

        switch ($curve) {
            case 'K256':
                $generator = CurveFactory::getGeneratorByName('secp256k1');
                $hasher = new SignHasher('sha256', $adapter);
                break;
            case 'P256':
                $generator = EccFactory::getNistCurves()->generator256();
                $hasher = new SignHasher('sha256', $adapter);
                break;
            case 'P384':
                $generator = EccFactory::getNistCurves()->generator384();
                $hasher = new SignHasher('sha384', $adapter);
                break;
            case 'P521':
                $generator = EccFactory::getNistCurves()->generator521();
                $hasher = new SignHasher('sha512', $adapter);
                break;
            default:
                throw new Q_Exception_WrongType(array(
                    'field' => 'curve',
                    'type' => 'K256, P256, P384 or P521'
                ));
        }

        $d = gmp_init($privateKeyHex, 16);
        $privateKey = $generator->getPrivateKeyFrom($d);

        $hash = $hasher->makeHash($serialized, $generator);
        $signer = new Signer($adapter);

        $sig = $signer->sign($privateKey, $hash);

        return array(
            str_pad(gmp_strval($sig->getR(), 16), 96, '0', STR_PAD_LEFT),
            str_pad(gmp_strval($sig->getS(), 16), 96, '0', STR_PAD_LEFT)
        );
    }

    /**
     * Convert an (r,s) signature to ASN.1 DER.
     *
     * @method rsToDer
     * @static
     * @param {array} $signature [r, s] hex
     * @return {string} DER signature (binary)
     */
    static function rsToDer($signature)
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
     * @method derToRs
     * @static
     * @param {string} $der DER signature (binary)
     * @return {array} [r, s] hex
     */
    static function derToRs($der)
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
        return hash('sha3-256', $prefix . $message, true);
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
        return self::sign($hash, $privateKeyHex, 'K256');
    }

    /**
     * Converts an IEEE P1363 signature into ASN.1/DER.
     *
     * @param string $p1363 Binary IEEE P1363 signature.
     */
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
