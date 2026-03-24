/**
 * Q.Data.Bloom.fromBytes
 * Deserialise a BloomFilter from a Uint8Array produced by filter.toBytes().
 *
 * @param {Uint8Array} bytes
 * @param {Function}   [callback]  (err, BloomFilter)
 * @return {Q.Promise<BloomFilter>}
 */
Q.exports(function (Q, _) {

    return Q.promisify(function (bytes, callback) {
        _.fromUint8Array(bytes, callback);
    }, false, 1);

});
