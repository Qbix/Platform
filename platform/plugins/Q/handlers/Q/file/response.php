<?php

function Q_image_response () {
	$slots = Q_Response::slots(true);
	if (isset($slots['data'])) {
		return;
	}
	if (!isset($_REQUEST['hash'])) {
		throw new Q_Exception_WrongValue(array(
	        'field' => 'hash',
	        'range' => "identifier hash"
		));
	}
	$hash = $_REQUEST['hash'];
	header ("Content-type: image/png");
	// Config decides whether the server may fetch from gravatar.com; the
	// request can only turn that off (gravatar=0), never on.
	$gravatar = Q_Config::get('Users', 'login', 'gravatar', false);
	if (isset($_REQUEST['gravatar'])
	&& (!$_REQUEST['gravatar'] || $_REQUEST['gravatar'] === 'false')) {
		$gravatar = false;
	}
	$size = isset($_REQUEST['size']) && is_string($_REQUEST['size']) ? $_REQUEST['size'] : null;
	$type = isset($_REQUEST['type']) && is_string($_REQUEST['type']) ? $_REQUEST['type'] : null;
	$result = Q_Image::avatar(
		is_string($hash) ? $hash : '',
		$size,
		$type,
		!!$gravatar
	);
	if ($gravatar) {
		echo $result;
	} else {
		imagepng($result);
	}
	return false;
}