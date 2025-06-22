<?php

function Q_file($params, &$result)
{
	$filename = Q::ifset($params, 'filename', Q_Request::filename());
	$ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));

	// Default MIME type using Q_Utils::mimeType
	$mimeType = Q_Utils::mimeType($ext);

	// If file doesn't exist, fallback
	if (!file_exists($filename)) {
		header("Content-Type: text/plain");
		Q_Response::code(404);
		Q_Dispatcher::result('404 file generated');
		$ext = 'txt';
		$filename = Q_PLUGIN_WEB_DIR.DS.'img'.DS.'404'.DS."404.$ext";
		readfile($filename);
		return false;
	}

	// If MIME type couldn't be determined, fallback to OS-level detection
	if ($mimeType === 'application/octet-stream') {
		$mimeType = mime_content_type($filename);
	}

	header("Content-Type: $mimeType");

	// Authorization hook
	if (false === Q::event("Q/file/authorize", compact('filename', 'ext'), 'before')) {
		Q_Response::code(404);
		$filename = Q_PLUGIN_WEB_DIR.DS.'img'.DS.'403'.DS."403.$ext";
		readfile($filename);
		return false;
	}

	// Output the file to the client
	readfile($filename);
	$result = true;
}
