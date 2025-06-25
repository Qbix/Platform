#!/usr/bin/env php
<?php

set_time_limit(600);
ini_set('display_errors', 1);
error_reporting(E_ALL);

$configPath = dirname(__DIR__) . "/config/apps.json";
if (!file_exists($configPath)) {
	echo "❌ Config file missing: $configPath\n";
	exit(1);
}

$config = json_decode(file_get_contents($configPath), true);
$apps = isset($config['apps']) ? $config['apps'] : array();
$mtimes = isset($config['mtimes']) ? $config['mtimes'] : array();

$changed = false;

foreach ($apps as $appName => $appPath) {
	if (!is_dir($appPath)) {
		echo "❌ Skipping $appName — path missing: $appPath\n";
		continue;
	}

	$scriptPath = "$appPath/scripts/Q/install.php";
	if (!file_exists($scriptPath)) {
		echo "❌ Skipping $appName — install script not found\n";
		continue;
	}

	// Find the most recent mtime of .mysql or .mysql.php files
	$pattern1 = glob("$appPath/plugins/*/scripts/*.mysql");
	$pattern2 = glob("$appPath/plugins/*/scripts/*.mysql.php");
	$allFiles = array_merge($pattern1, $pattern2);
	$latestMtime = 0;

	foreach ($allFiles as $file) {
		$mtime = filemtime($file);
		if ($mtime > $latestMtime) $latestMtime = $mtime;
	}

	$lastRecorded = isset($mtimes[$appName]) ? $mtimes[$appName] : 0;

	if ($latestMtime > $lastRecorded) {
		echo "🔧 Running installer for $appName (new schema changes)...\n";
		try {
			passthru("php " . escapeshellarg($scriptPath) . " --plugins", $exitCode);
			if ($exitCode === 0) {
				echo "✅ $appName updated successfully\n";
				$mtimes[$appName] = $latestMtime;
				$changed = true;
			} else {
				echo "⚠️  Installer exited with code $exitCode for $appName\n";
			}
		} catch (Throwable $e) {
			echo "❌ Error updating $appName: " . $e->getMessage() . "\n";
		}
	} else {
		echo "ℹ️  $appName is up-to-date\n";
	}
}

// Save updated mtimes only if needed
if ($changed) {
	$config['mtimes'] = $mtimes;
	file_put_contents($configPath, json_encode($config, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
	echo "\n📦 Config file updated.\n";
}
