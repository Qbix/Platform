<?php

$FROM_APP = defined('RUNNING_FROM_APP');
$argv = $_SERVER['argv'];
$count = count($argv);

$usage = "Usage: php {$argv[0]} " . ($FROM_APP ? '<file>' : '<app_root> <file>');
$help = <<<EOT
$usage

Outputs a data: URI with base64-encoded file contents.
MIME types are determined using Q_Utils::mimeType(\$ext).

EOT;

// Help
if (isset($argv[1]) && in_array($argv[1], ['--help', '/?', '-h', '-?', '/h'])) {
	die($help);
}

// Validate args
if ((!$FROM_APP && $count < 3) || ($FROM_APP && $count < 2)) {
	die($usage . PHP_EOL);
}

// Load Q framework if needed
if (!$FROM_APP) {
	$LOCAL_DIR = $argv[1];
	if (!is_dir($LOCAL_DIR)) {
		die("[ERROR] $LOCAL_DIR doesn't exist or is not a directory\n");
	}
	if (!defined('APP_DIR')) define('APP_DIR', $LOCAL_DIR);
	$Q_filename = dirname(__FILE__) . DIRECTORY_SEPARATOR . 'Q.inc.php';
	if (!file_exists($Q_filename)) {
		die("[ERROR] $Q_filename not found\n");
	}
	include($Q_filename);
	$inputFile = $argv[2];
} else {
	$inputFile = $argv[1];
}

// Check file
if (!file_exists($inputFile)) {
	fwrite(STDERR, "Error: File not found: $inputFile\n");
	exit(1);
}

// Build data URI
$ext = strtolower(pathinfo($inputFile, PATHINFO_EXTENSION));
$mimeType = Q_Utils::mimeType($ext);
$data = base64_encode(file_get_contents($inputFile));

echo "data:$mimeType;charset=utf-8;base64,$data\n";