/**
 * Q.Data.Bloom.create
 * Create a new empty Bloom filter sized for n elements at false positive rate p.
 *
 * @param {Number}   n
 * @param {Number}   [p=0.01]
 * @param {Function} [callback]  (err, BloomFilter)
 * @return {Q.Promise<BloomFilter>}
 */
Q.exports(function (Q, _) {

    return Q.promisify(function (n, p, callback) {
        if (typeof p === 'function') { callback = p; p = 0.01; }
        p = p || 0.01;
        if (n <= 0)           { return callback(new Error('Q.Data.Bloom.create: n must be > 0')); }
        if (p <= 0 || p >= 1) { return callback(new Error('Q.Data.Bloom.create: p must be in (0,1)')); }

        var params = _.optimalParams(n, p);
        var bits   = new Uint8Array(Math.ceil(params.m / 8));
        callback(null, new _.BloomFilter(bits, params.k, params.m, 0));
    }, false, 2);

});
