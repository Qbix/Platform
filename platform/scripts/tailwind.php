<?php
$FROM_APP = defined('RUNNING_FROM_APP'); // Are we running from app or framework?

// Arguments
$argv = isset($_SERVER['argv']) ? $_SERVER['argv'] : array();
$count = count($argv);

// Usage strings
$usage = "Usage: php {$argv[0]} " . ($FROM_APP ? '' : '<app_root> ');

if (!$FROM_APP) {
	$usage .= PHP_EOL.PHP_EOL.'<app_root> must be a path to the application root directory';
}

$usage = <<<EOT
$usage

Script to build Tailwind CSS for the Q plugin.

This will:

1) Install npm dependencies if needed
2) Compile tailwind.input.css into tailwind.css

EOT;

// Help
if (isset($argv[1]) and in_array($argv[1], array('--help', '/?', '-h', '-?', '/h'))) {
	die($usage);
}

// Validate arguments
if ($count < 1 or !$FROM_APP) {
	die($usage);
}

// Determine application directory
$LOCAL_DIR = $FROM_APP ? APP_DIR : $argv[1];

if (!defined('APP_DIR')) {
	define('APP_DIR', $LOCAL_DIR);
}

// Include Q
if (!file_exists($Q_filename = dirname(__FILE__) . DIRECTORY_SEPARATOR . 'Q.inc.php')) {
	die("[ERROR] $Q_filename not found" . PHP_EOL);
}

include($Q_filename);

// Ensure working directory is the app root
chdir(APP_DIR);

// Q plugin directory
$pluginDir = Q_DIR . DS . 'plugins' . DS . 'Q';

if (!is_dir($pluginDir)) {
	die("[ERROR] Q plugin directory not found: $pluginDir".PHP_EOL);
}

// Tailwind binary
$nodeModules = $pluginDir . DS . 'node_modules';
$tailwindBin = $nodeModules . DS . '.bin' . DS . 'tailwindcss';

// Install npm dependencies if missing
if (!file_exists($tailwindBin)) {
	echo "Installing npm dependencies..." . PHP_EOL;

	chdir($pluginDir);

	passthru('npm install', $code);

	if ($code !== 0) {
		die("[ERROR] npm install failed".PHP_EOL);
	}
}

// Run Tailwind build
chdir($pluginDir);

$input  = 'web/css/tailwind.input.css';
$output = 'web/css/tailwind.css';

$cmd = escapeshellarg($tailwindBin)
     . " -i " . escapeshellarg($input)
     . " -o " . escapeshellarg($output)
     . " --minify";

echo "Building Tailwind CSS..." . PHP_EOL;

passthru($cmd, $code);

if ($code !== 0) {
	die("[ERROR] Tailwind build failed".PHP_EOL);
}

echo Q_Utils::colored("Produced $output", 'white', 'green') . PHP_EOL;
echo "Success." . PHP_EOL;
