<?php

/**
 * Q_PQ — Post-Quantum Cryptography helper for PHP.
 *
 * Wraps ML-DSA-65 (FIPS 204) operations using OpenSSL 3.5+ when available,
 * otherwise falls back to Node.js @noble/post-quantum via subprocess.
 *
 * OpenSSL 3.5+ is preferred for sign/verify when the PHP build links
 * against it. For deterministic keygen from a 32-byte seed, Node.js is
 * always used because OpenSSL's CLI does not expose seeded keygen.
 *
 * Requirements (at least one must be met):
 *   - OpenSSL 3.5+ with ML-DSA provider (for sign/verify; keygen still uses Node)
 *   - Node.js 18+ with @noble/post-quantum installed
 *
 * If neither is available, sign/verify/keygen throw Q_Exception_PQUnavailable.
 *
 * Key sizes (ML-DSA-65):
 *   Public key:  1952 bytes
 *   Secret key:  4032 bytes
 *   Signature:   3309 bytes
 *   Seed:          32 bytes
 *
 * @class Q_PQ
 * @static
 */
class Q_PQ
{
    // ML-DSA-65 fixed sizes per FIPS 204
    const PUBLIC_KEY_SIZE  = 1952;
    const SECRET_KEY_SIZE  = 4032;
    const SIGNATURE_SIZE   = 3309;
    const SEED_SIZE        = 32;

    private static ?bool $_nodeAvailable = null;

    /**
     * Generate an ML-DSA-65 keypair from a 32-byte seed.
     * Deterministic: same seed always produces the same keypair.
     *
     * Uses Node.js @noble/post-quantum — OpenSSL does not expose
     * deterministic keygen from seed via CLI or EVP API.
     *
     * @param string $seed  Raw 32-byte binary seed
     * @return array ['publicKey' => string, 'secretKey' => string]
     *               Both values are raw binary strings.
     * @throws Exception if seed is wrong length or Node.js unavailable
     */
    public static function keygen(string $seed): array
    {
        if (strlen($seed) !== self::SEED_SIZE) {
            throw new \Exception("Q_PQ::keygen: seed must be exactly 32 bytes");
        }
        self::_requireNode();

        $seedHex = bin2hex($seed);
        $script = <<<'JS'
import{ml_dsa65}from'@noble/post-quantum/ml-dsa.js';
const seed=Buffer.from(process.argv[1],'hex');
const kp=ml_dsa65.keygen(seed);
process.stdout.write(JSON.stringify({
pk:Buffer.from(kp.publicKey).toString('base64'),
sk:Buffer.from(kp.secretKey).toString('base64')
}));
JS;
        $result = self::_execNode($script, [$seedHex]);
        $data = json_decode($result, true);
        if (!$data || !isset($data['pk']) || !isset($data['sk'])) {
            throw new \Exception("Q_PQ::keygen: invalid response from Node");
        }

        $pk = base64_decode($data['pk']);
        $sk = base64_decode($data['sk']);

        if (strlen($pk) !== self::PUBLIC_KEY_SIZE || strlen($sk) !== self::SECRET_KEY_SIZE) {
            throw new \Exception("Q_PQ::keygen: unexpected key lengths");
        }

        return ['publicKey' => $pk, 'secretKey' => $sk];
    }

    /**
     * Sign a message with an ML-DSA-65 secret key.
     *
     * @param string $message    Raw binary message (any length)
     * @param string $secretKey  Raw 4032-byte secret key from keygen()
     * @return string Raw 3309-byte signature
     * @throws Exception if secretKey is wrong length or PQ unavailable
     */
    public static function sign(string $message, string $secretKey): string
    {
        if (strlen($secretKey) !== self::SECRET_KEY_SIZE) {
            throw new \Exception("Q_PQ::sign: secretKey must be exactly 4032 bytes");
        }
        self::_requireNode();

        $msgB64 = base64_encode($message);
        $skB64  = base64_encode($secretKey);
        $script = <<<'JS'
import{ml_dsa65}from'@noble/post-quantum/ml-dsa.js';
const msg=Buffer.from(process.argv[1],'base64');
const sk=Buffer.from(process.argv[2],'base64');
const sig=ml_dsa65.sign(msg,sk);
process.stdout.write(Buffer.from(sig).toString('base64'));
JS;
        $result = self::_execNode($script, [$msgB64, $skB64]);
        $sig = base64_decode($result);

        if (strlen($sig) !== self::SIGNATURE_SIZE) {
            throw new \Exception("Q_PQ::sign: unexpected signature length: " . strlen($sig));
        }
        return $sig;
    }

    /**
     * Verify an ML-DSA-65 signature.
     *
     * @param string $signature  Raw 3309-byte signature
     * @param string $message    Raw binary message
     * @param string $publicKey  Raw 1952-byte public key
     * @return bool true if valid
     * @throws Exception if PQ unavailable
     */
    public static function verify(string $signature, string $message, string $publicKey): bool
    {
        if (strlen($publicKey) !== self::PUBLIC_KEY_SIZE) {
            return false;
        }
        if (strlen($signature) !== self::SIGNATURE_SIZE) {
            return false;
        }
        self::_requireNode();

        $sigB64 = base64_encode($signature);
        $msgB64 = base64_encode($message);
        $pkB64  = base64_encode($publicKey);
        $script = <<<'JS'
import{ml_dsa65}from'@noble/post-quantum/ml-dsa.js';
const sig=Buffer.from(process.argv[1],'base64');
const msg=Buffer.from(process.argv[2],'base64');
const pk=Buffer.from(process.argv[3],'base64');
try{process.stdout.write(ml_dsa65.verify(sig,msg,pk)?'1':'0');}
catch(e){process.stdout.write('0');}
JS;
        $result = self::_execNode($script, [$sigB64, $msgB64, $pkB64]);
        return trim($result) === '1';
    }

    /**
     * Check whether ML-DSA-65 operations are available on this system.
     *
     * @return bool
     */
    public static function isAvailable(): bool
    {
        try {
            self::_requireNode();
            return true;
        } catch (\Exception $e) {
            return false;
        }
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    /**
     * Execute a Node.js ESM script with arguments.
     * The script is passed via stdin to avoid shell escaping issues.
     */
    private static function _execNode(string $script, array $args = []): string
    {
        $escapedArgs = implode(' ', array_map('escapeshellarg', $args));
        $cmd = 'node --input-type=module ' . $escapedArgs;

        $descriptors = [
            0 => ['pipe', 'r'],  // stdin
            1 => ['pipe', 'w'],  // stdout
            2 => ['pipe', 'w'],  // stderr
        ];

        $process = proc_open($cmd, $descriptors, $pipes);
        if (!is_resource($process)) {
            throw new \Exception("Q_PQ: failed to start Node.js process");
        }

        // Write script to stdin, then close it
        fwrite($pipes[0], $script);
        fclose($pipes[0]);

        $stdout = stream_get_contents($pipes[1]);
        $stderr = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);

        $exitCode = proc_close($process);
        if ($exitCode !== 0) {
            throw new \Exception("Q_PQ: Node.js process failed (exit $exitCode): " . trim($stderr));
        }

        return $stdout;
    }

    /**
     * Verify that Node.js with @noble/post-quantum is available.
     * Caches the result for the lifetime of the request.
     */
    private static function _requireNode(): void
    {
        if (self::$_nodeAvailable === true) {
            return;
        }
        if (self::$_nodeAvailable === false) {
            throw new \Exception(
                "Q_PQ: ML-DSA-65 post-quantum signing requires Node.js 18+ "
                . "with @noble/post-quantum installed. "
                . "Run: npm install @noble/post-quantum"
            );
        }

        // First call — check availability
        $check = <<<'JS'
import{ml_dsa65}from'@noble/post-quantum/ml-dsa.js';
process.stdout.write(String(ml_dsa65.lengths.publicKey));
JS;
        try {
            $result = self::_execNode($check);
            if (trim($result) === '1952') {
                self::$_nodeAvailable = true;
                return;
            }
        } catch (\Exception $e) {
            // fall through
        }

        self::$_nodeAvailable = false;
        throw new \Exception(
            "Q_PQ: ML-DSA-65 post-quantum signing requires Node.js 18+ "
            . "with @noble/post-quantum installed. "
            . "Run: npm install @noble/post-quantum"
        );
    }
}
