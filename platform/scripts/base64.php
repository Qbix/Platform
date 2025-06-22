<?php

$argv = $_SERVER['argv'];
$script = array_shift($argv);
$usage = "Usage: php $script <file>";

$help = <<<EOT
$usage

Outputs a data: URI with base64-encoded file contents.
MIME types are determined using Q_Utils::mimeType(\$ext).

EOT;

// Help flag
if (isset($argv[0]) && in_array($argv[0], ['--help', '/?', '-h', '-?', '/h'])) {
	die($help);
}

// Validate argument count
if (count($argv) < 1) {
	die($usage . PHP_EOL);
}

$inputFile = $argv[0];

// Check file existence
if (!file_exists($inputFile)) {
	fwrite(STDERR, "Error: File not found: $inputFile\n");
	exit(1);
}

include(dirname(dirname(__FILE__)) . DIRECTORY_SEPARATOR . 'classes' . DIRECTORY_SEPARATOR . 'Q' . DIRECTORY_SEPARATOR . 'Utils.php');

// Determine MIME type and encode
$ext = strtolower(pathinfo($inputFile, PATHINFO_EXTENSION));
$mimeType = Q_Utils::mimeType($ext);
$data = base64_encode(file_get_contents($inputFile));

// Output data URI
echo "data:$mimeType;charset=utf-8;base64,$data\n";
