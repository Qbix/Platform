<?php

call_user_func(function () {

//
// Constants -- you might have to change these
//
if (!defined('APP_DIR')) {
	define('APP_DIR', dirname(dirname(__FILE__)));
}

//
// Include Q
//
$header = "<html><body style='padding: 10px;'><h1>This is a Qbix project...</h1>\n";
$footer = "</body></html>";

if (!is_dir(APP_DIR)) {
	die("$header\nPlease edit index.php and define APP_DIR to point to your app's directory.\n$footer");
}

$basename = basename(APP_DIR);

if (!defined('Q_DIR')) {
	$paths_filename = realpath(implode(DIRECTORY_SEPARATOR, array(
		APP_DIR, 'local', 'paths.json'
	)));

	if (!file_exists($paths_filename)) {
		die("$header\nGo to $basename/scripts/Q directory and run php configure.php\n$footer");
	}

	$paths = json_decode(file_get_contents($paths_filename), true);

	define('Q_DIR', isset($paths['platform']) ? $paths['platform'] : '');
}

$Q_filename = realpath(Q_DIR.DIRECTORY_SEPARATOR.'Q.php');

if (!file_exists($Q_filename)) {
	die("Please edit $basename/local/paths.json to look like " .
		'{"platform": "path/to/Q/platform"}' .
		" then run configure.php again\n");
}

include($Q_filename);

//
// Allow CLI scripts normally.
// If accessed via web, require admin password.
//
if (php_sapi_name() !== 'cli') {

	try {
		$adminPassword = Q_Config::expect('web', 'admin', 'password');
	} catch (Exception $e) {
		http_response_code(500);
		die("Admin password not configured");
	}

	if (!isset($_POST['password'])) {

		echo "<!DOCTYPE html>
<html>
<head>
<meta charset='utf-8'>
<title>Qbix Admin Script</title>
<style>

html, body {
	height:100%;
	margin:0;
	font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
	background:#f4f6f8;
}

.q-admin-wrapper {
	display:flex;
	align-items:center;
	justify-content:center;
	height:100%;
}

.q-admin-card {
	background:#fff;
	padding:40px;
	border-radius:10px;
	box-shadow:0 10px 30px rgba(0,0,0,0.1);
	width:360px;
	text-align:center;
}

.q-admin-title {
	font-size:22px;
	margin-bottom:20px;
	color:#333;
}

.q-admin-input {
	width:100%;
	padding:12px 14px;
	font-size:16px;
	border:1px solid #dcdfe3;
	border-radius:6px;
	box-sizing:border-box;
	margin-bottom:16px;
	outline:none;
	transition:border-color .15s;
}

.q-admin-input:focus {
	border-color:#4a90e2;
}

.q-admin-button {
	width:100%;
	padding:12px;
	font-size:16px;
	background:#4a90e2;
	color:#fff;
	border:none;
	border-radius:6px;
	cursor:pointer;
	transition:background .15s;
}

.q-admin-button:hover {
	background:#3c7edb;
}

.q-admin-footer {
	margin-top:14px;
	font-size:12px;
	color:#999;
}

</style>
</head>
<body>

<div class='q-admin-wrapper'>
	<div class='q-admin-card'>
		<div class='q-admin-title'>Admin Script Execution</div>
		<form method='POST'>
			<input class='q-admin-input' type='password' name='password' placeholder='Admin password' autofocus />
			<button class='q-admin-button' type='submit'>Run Script</button>
		</form>
		<div class='q-admin-footer'>Qbix administrative access</div>
	</div>
</div>

</body>
</html>";

		exit;
	}

	if (!hash_equals($adminPassword, $_POST['password'])) {
		http_response_code(403);
		die("Invalid password");
	}

	define('RUNNING_FROM_WEB_ADMIN', true);
}

});