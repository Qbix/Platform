Q.exports(function (Q) {
    /**
     * Generates a public/private key pair and exports them as base64 strings.
     * Compatible with Q.Data.verify and Q.Data.sign using SubtleCrypto.
     *
     * @module Q
     * @class Q.Data
     */

    /**
     * @static
     * @method generateKey
     * @param {Object} [algo] optional algorithm override
     * @param {String} [algo.name="ECDSA"]
     * @param {String} [algo.namedCurve="P-256"]
     * @param {String} [algo.hash="SHA-256"]
     * @return {Q.Promise} Resolves with { publicKey, privateKey, algorithm },
     * where each key is a base64 string and algorithm is the resolved object.
     */
    return function Q_Data_generateKey(algo) {
        algo = Q.extend({
            name: 'ECDSA',
            namedCurve: 'P-256',
            hash: { name: "SHA-256" }
        }, algo);

        return crypto.subtle.generateKey(algo, true, ['sign', 'verify']).then(function (keyPair) {
            return Q.Promise.all([
                crypto.subtle.exportKey('raw', keyPair.publicKey),
                crypto.subtle.exportKey('pkcs8', keyPair.privateKey)
            ]).then(function ([pubKeyBuf, privKeyBuf]) {
                return {
                    publicKey: Q.Data.toBase64(pubKeyBuf),
                    privateKey: Q.Data.toBase64(privKeyBuf),
                    algorithm: algo
                };
            });
        });
    };
});