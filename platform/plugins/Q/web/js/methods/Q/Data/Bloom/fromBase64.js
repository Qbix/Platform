/**
 * Q.Data.Bloom.fromBase64
 * Deserialise a BloomFilter from a base64 string produced by filter.toBase64().
 *
 * @param {String}   base64
 * @param {Function} [callback]  (err, BloomFilter)
 * @return {Q.Promise<BloomFilter>}
 */
Q.exports(function (Q, _) {

    return Q.promisify(function (base64, callback) {
        var bytes;
        try {
            bytes = Q.Data.fromBase64(base64);
        } catch (e) {
            return callback(e);
        }
        _.fromUint8Array(bytes, callback);
    }, false, 1);

});
