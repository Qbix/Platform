/**
 * Q.Data.Bloom.fromElements
 * Build a Bloom filter from an existing array of elements in one call.
 * All SHA-256 calls run in parallel for speed.
 *
 * @param {Array<String>} elements
 * @param {Number}   [p=0.01]
 * @param {Function} [callback]  (err, BloomFilter)
 * @return {Q.Promise<BloomFilter>}
 */
Q.exports(function (Q, _) {

    return Q.promisify(function (elements, p, callback) {
        if (typeof p === 'function') { callback = p; p = 0.01; }
        p = p || 0.01;

        if (!elements || !elements.length) {
            return callback(new Error('Q.Data.Bloom.fromElements: no elements provided'));
        }

        var params = _.optimalParams(elements.length, p);
        var bits   = new Uint8Array(Math.ceil(params.m / 8));

        Promise.all(elements.map(function (el) {
            return _.positions(el, params.k, params.m).then(function (positions) {
                positions.forEach(function (pos) { _.setBit(bits, pos); });
            });
        })).then(function () {
            callback(null, new _.BloomFilter(bits, params.k, params.m, elements.length));
        }).catch(callback);
    }, false, 2);

});
