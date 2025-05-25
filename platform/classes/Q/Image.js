/**
 * @module Q
 */

var Q = require('../Q');

/**
 * Utilities for managing image sizes and filenames.
 * @class Image
 * @namespace Q
 * @static
 */
var Image = {};

/**
 * Gets an object of "WxH" => "$filename.png" pairs from config.
 * @method getSizes
 * @static
 * @param {string} type
 * @param {object} [refs] Optionally pass { maxStretch, defaultSize } to be filled.
 * @returns {object}
 */
Image.getSizes = function(type, refs) {
	const sizes = Q.Config.get(['Q', 'images', type, 'sizes']);
	if (!sizes) {
		throw new Error(`Missing config: Q/images/${type}/sizes`);
	}

	if (refs) {
		refs.maxStretch = Q.Config.get(['Q', 'images', type, 'maxStretch'], 1);
		refs.defaultSize = Q.Config.get(['Q', 'images', type, 'defaultSize'], '40');
	}

	if (Q.isAssociative(sizes)) {
		Q.Utils.sortKeysByLargestNumber(sizes);
		return sizes;
	}

	const result = {};
	for (const size of sizes) {
		result[size] = `${size}.png`;
	}
	Q.Utils.sortKeysByLargestNumber(result);
	return result;
};

/**
 * Finds the largest width or height from given sizes.
 * @method largestSize
 * @static
 * @param {object|string} sizes
 * @param {boolean} [useHeight=false]
 * @param {object} [options={}]
 * @returns {string|null}
 */
Image.largestSize = function(sizes, useHeight, options) {
	useHeight = !!useHeight;
	options = options || {};

	if (typeof sizes === 'string') {
		try {
			sizes = Image.getSizes(sizes);
		} catch (e) {
			if (options.dontThrow) return null;
			throw e;
		}
	}

	let wMax = 0, hMax = 0;
	let largestIndex = null;
	const keys = Array.isArray(sizes) ? sizes : Object.keys(sizes);
	const minDims = options.minimumDimensions ? options.minimumDimensions.split('x').map(Number) : null;

	if (keys.includes('x') && !minDims) return 'x';

	for (const size of keys) {
		if (!size) continue;
		const [wStr, hStr] = size.split('x');
		const w = parseInt(wStr || hStr, 10);
		const h = parseInt(hStr || wStr, 10);

		const isBetter = useHeight
			? (h > hMax || (h === hMax && w >= wMax && hStr))
			: (w > wMax || (w === wMax && h >= hMax && wStr));

		if (isBetter) {
			wMax = w;
			hMax = h;
			largestIndex = size;
		}

		if (minDims && w >= minDims[0] && h >= minDims[1]) {
			return size;
		}
	}
	return largestIndex || (keys.includes('x') ? 'x' : null);
};

/**
 * Builds an object of size => url entries.
 * @method iconArrayWithUrl
 * @static
 * @param {string} url
 * @param {string} type
 * @param {object} [refs]
 * @returns {object}
 */
Image.iconArrayWithUrl = function(url, type, refs) {
	const sizes = Image.getSizes(type, refs);
	const result = {};
	for (const size in sizes) {
		result[size] = url;
	}
	return result;
};

/**
 * Gets the default size from config for a given image type.
 * @method getDefaultSize
 * @static
 * @param {string} type
 * @returns {string}
 */
Image.getDefaultSize = function(type) {
	return Q.Config.get(['Q', 'images', type, 'defaultSize']);
};

/**
 * Chooses best image size based on device pixel ratio.
 * @method calculateSize
 * @static
 * @param {number} size
 * @param {object} sizes
 * @returns {string}
 */
Image.calculateSize = function(size, sizes) {
	sizes = sizes || {};
	const dpr = parseFloat(Q.Cookie?.get('Q_dpr') || 1);
	const scaled = size * dpr;
	let closest = Infinity;
	let selected = null;

	for (const k in sizes) {
		const [w, h] = k.split('x').map(Number);
		const minDim = Math.min(w || h, h || w);
		const diff = scaled - minDim;
		if (diff >= 0 && diff < closest) {
			closest = diff;
			selected = k;
		}
	}

	return selected || Object.keys(sizes).pop();
};

module.exports = Image;