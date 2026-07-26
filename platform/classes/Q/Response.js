/**
 * @module Q
 */

var _cacheInvalidations = [];

/**
 * Server-side response utilities (mirrors Q_Response PHP class subset).
 * @class Response
 * @namespace Q
 */
var Response = {};

/**
 * Register dependency invalidations to send to the parent server.
 *
 * Called after a write operation that modifies a stream dependency.
 * Mirrors Q_Response::invalidateCacheDeps in PHP.
 *
 * @method invalidateCacheDeps
 * @static
 * @param {string|Array} keys Stream identifiers to invalidate
 */
Response.invalidateCacheDeps = function (keys) {
	if (!Array.isArray(keys)) {
		keys = [keys];
	}
	_cacheInvalidations.push.apply(_cacheInvalidations, keys);
};

/**
 * Get accumulated cache invalidations (for inspection/debugging).
 * @method cacheInvalidations
 * @static
 * @return {Array}
 */
Response.cacheInvalidations = function () {
	return _cacheInvalidations.slice();
};

module.exports = Response;
