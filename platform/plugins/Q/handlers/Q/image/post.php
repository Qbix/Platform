<?php

/**
 * @module Q
 */

/**
 * Used by HTTP clients to upload a new image to the server
 * @class HTTP Q image
 * @method post
 * @param {array} [$params] Parameters that can come from the request
 *   @param {string} [$params.icon.data]  Required if $_FILES is empty. Base64-encoded  data URI - see RFC 2397
 *   @param {string} [$params.icon.path="Q/uploads"] parent path under web dir (see subpath)
 *   @param {string} [$params.icon.subpath=""] subpath that should follow the path, to save the image under
 *   @param {string} [$params.icon.merge=""] path under web dir for an optional image to use as a background
 *   @param {string} [$params.icon.crop] array with keys "x", "y", "w", "h" to crop the original image
 * @param {string} [$params.save='x'] name of config under Q/image/sizes, which
 *  are an array of $size => $basename pairs
 *  where the size is of the format "WxH", and either W or H can be empty.
 *  These are stored in the config for various types of images, 
 *  and you pass the name of the config, so that e.g. clients can't simply
 *  specify their own sizes.
 * @return {array} Information about the saved image
 */
function Q_image_post($params = null)
{
	// First check FILES: Blob upload case
	if (!empty($_FILES)) {
		// Normalize into the same format used by base64 handler
		// You may have multiple fields, but we expect "icon"
		foreach ($_FILES as $field => $info) {
			$params[$field]['_file'] = $info;
		}
		$params['icon'] = $_REQUEST['icon'];
		$params['save'] = $_REQUEST['save'];
	}
	$params['setSlot'] = 'data';

	$data = Q_Image::postNewImage($params);
	return Q_Response::setSlot('data', $data);
}