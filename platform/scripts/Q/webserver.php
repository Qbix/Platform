<?php
/**
 * Qbix Web Server — production-ready pure PHP server.
 *
 * Usage:
 *   php scripts/Q/webserver.php [options]
 *
 * Options:
 *   --host=IP        Bind address (default: 0.0.0.0)
 *   --port=PORT      Listen port (default: 8080)
 *   --workers=N      Pre-fork PHP workers (default: 0 = in-process)
 *   --reload=SEC     Config file check interval (default: 2)
 *   --debug          Enable xdebug-friendly mode
 *   --pid=PATH       Write PID file (for systemd/process managers)
 *   --systemd        Generate a systemd unit file and exit
 *
 * Endpoints:
 *   /Q/dashboard    Live stats + request log (WebSocket)
 *   /Q/health       JSON health check (for load balancers)
 *   /Q/stats        JSON server statistics
 *   /Q/ws           WebSocket endpoint
 *
 * Signals:
 *   SIGINT/SIGTERM   Graceful shutdown (finish current requests)
 *   SIGHUP           Reload config + restart workers (zero downtime)
 */

$FROM_APP = defined('RUNNING_FROM_APP');
$argv = $_SERVER['argv'];

$options = array(
	'host' => '0.0.0.0', 'port' => 8080, 'workers' => 0,
	'reload' => 2, 'debug' => false, 'pid' => '', 'systemd' => false
);
foreach ($argv as $arg) {
	if (preg_match('/^--(\w+)=(.+)$/', $arg, $m)) $options[$m[1]] = $m[2];
	if ($arg === '--debug') $options['debug'] = true;
	if ($arg === '--systemd') $options['systemd'] = true;
	if (in_array($arg, array('--help', '-h'))) {
		echo "Qbix Web Server — pure PHP, production-ready\n\n";
		echo "Usage: php {$argv[0]} [--host=IP] [--port=PORT] [--workers=N] [--debug]\n\n";
		echo "  --workers=N   Pre-fork N workers. Each handles one request, exits\n";
		echo "                (clean state), re-forks (~0.5ms). Requires pcntl.\n";
		echo "  --debug       Auto-sets workers=2, xdebug per-worker.\n";
		echo "  --pid=PATH    Write PID file for process management.\n";
		echo "  --systemd     Generate a systemd unit file and exit.\n\n";
		echo "  Features: keep-alive, gzip, X-Accel-Redirect, WebSocket,\n";
		echo "  TLS (certbot/remote), reverse proxy headers, file logging.\n\n";
		echo "  HTTPS: built-in TLS for dev/personal. For production:\n";
		echo "    Cloud:  Cloudflare, AWS ALB/CloudFront (free TLS at edge)\n";
		echo "    Proxy:  caddy reverse-proxy --from domain.com --to :8080\n";
		echo "    Direct: configure Q.web.https in app.json\n";
		exit(0);
	}
}

// ── Bootstrap ────────────────────────────────────────────

$LOCAL_DIR = $FROM_APP ? APP_DIR : ($argv[1] ?? dirname(dirname(dirname(__FILE__))));
if (!defined('APP_DIR')) define('APP_DIR', $LOCAL_DIR);
$Q_inc = dirname(__FILE__) . DIRECTORY_SEPARATOR . 'Q.inc.php';
if (!file_exists($Q_inc)) die("[ERROR] Q.inc.php not found\n");
include($Q_inc);

$host    = $options['host'];
$port    = (int) $options['port'];
$workers = (int) $options['workers'];
$debug   = $options['debug'];
$hasPcntl = function_exists('pcntl_fork');

// ── Systemd unit generation ──────────────────────────────

if ($options['systemd']) {
	$phpBin = PHP_BINARY;
	$script = realpath(__FILE__);
	$appDir = APP_DIR;
	$unit = <<<UNIT
[Unit]
Description=Qbix Web Server
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=$appDir
ExecStart=$phpBin $script --host=0.0.0.0 --port=8080 --workers=4 --pid=/run/qbix/server.pid
ExecReload=/bin/kill -HUP \$MAINPID
PIDFile=/run/qbix/server.pid
Restart=always
RestartSec=5
RuntimeDirectory=qbix

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$appDir/config $appDir/files $appDir/web

[Install]
WantedBy=multi-user.target
UNIT;
	echo $unit . "\n";
	echo "\n# Save as /etc/systemd/system/qbix.service then:\n";
	echo "#   systemctl daemon-reload\n";
	echo "#   systemctl enable qbix\n";
	echo "#   systemctl start qbix\n";
	exit(0);
}

// ── Debug mode ───────────────────────────────────────────

if ($debug && $workers === 0 && $hasPcntl) $workers = 2;

// ── PID file ─────────────────────────────────────────────

$pidFile = $options['pid'];
if (!$pidFile) {
	$pidFile = Q_Config::get('Q', 'webserver', 'pidFile', '');
}
if ($pidFile) {
	$dir = dirname($pidFile);
	if (!is_dir($dir)) mkdir($dir, 0755, true);
	file_put_contents($pidFile, getmypid());
	register_shutdown_function(function () use ($pidFile) {
		@unlink($pidFile);
	});
}

// ── Preheat classes ──────────────────────────────────────

$preload = Q_Config::get('Q', 'webserver', 'preload', array(
	'Q_Dispatcher', 'Q_Request', 'Q_Response',
	'Q_Uri', 'Q_Html', 'Q_Utils', 'Q_Session', 'Q_Cache',
));
$preloaded = 0;
foreach ($preload as $cls) {
	if (class_exists($cls, true)) $preloaded++;
}

// ── Banner ───────────────────────────────────────────────

$wl = $workers > 0
	? ($hasPcntl ? "$workers workers (prefork)" : "no pcntl, in-process")
	: "in-process";
$httpsMode = Q_Config::get('Q', 'web', 'https', 'mode', '');
$httpsPort = (int) Q_Config::get('Q', 'web', 'https', 'port', 443);

echo "\n";
echo "  ┌──────────────────────────────────────┐\n";
echo "  │  Qbix Web Server                     │\n";
echo "  ├──────────────────────────────────────┤\n";
printf("  │  %-36s │\n", "http://$host:$port");
if ($httpsMode) printf("  │  %-36s │\n", "https://$host:$httpsPort ($httpsMode)");
printf("  │  %-36s │\n", "PHP: $wl");
printf("  │  %-36s │\n", "Preloaded: $preloaded classes");
printf("  │  %-36s │\n", "Keep-alive: on (100 req, 15s idle)");
if ($debug) printf("  │  %-36s │\n", "Debug: ON" . (extension_loaded('xdebug') ? ', xdebug' : ''));
printf("  │  %-36s │\n", "Dashboard: /Q/dashboard");
printf("  │  %-36s │\n", "Health: /Q/health");
echo "  ├──────────────────────────────────────┤\n";
echo "  │  Ctrl+C to stop, SIGHUP to reload   │\n";
echo "  └──────────────────────────────────────┘\n\n";

// ── Start ────────────────────────────────────────────────

Q_WebServer_Dashboard::init();
Q_WebServer_Log::init();
Q_WebServer_Cache::init();
Q_WebServer::start(APP_WEB_DIR, $host, $port, $workers);

// ── SIGHUP: reload config + restart workers ──────────────

if ($hasPcntl) {
	Q_Evented::onSignal(SIGHUP, function () use ($workers) {
		echo date('H:i:s') . " \033[33mSIGHUP\033[0m — reloading config\n";
		Q_FileCache::clear();
		Q_Cache::clear(true);
		// Re-read config from disk
		// If we have workers, the next fork will pick up new code
		if (Q_WebServer::$pool) {
			echo date('H:i:s') . " Workers will pick up new code on next request\n";
		}
	});
}

// ── Hot reload timer ─────────────────────────────────────

Q_Evented::repeat((float) $options['reload'], function () {
	$changed = Q_FileCache::checkAll();
	if ($changed) {
		foreach ($changed as $p) {
			echo date('H:i:s') . " \033[36m↻\033[0m " . basename($p) . "\n";
			Q_FileCache::invalidate($p);
		}
		Q_Cache::clear(true);
	}
});

// ── Request logging (stdout) ─────────────────────────────

Q_WebServer::$onRequest = function ($method, $uri, $status, $ms) {
	$c = $status < 300 ? '32' : ($status < 400 ? '33' : '31');
	echo date('H:i:s') . " \033[{$c}m$status\033[0m $method $uri ({$ms}ms)\n";
};

// ── IndieWeb outbox ──────────────────────────────────────

if (class_exists('IndieWeb')) {
	Q_Evented::repeat(60.0, function () { IndieWeb::processOutbox(5); });
}

// ── Run ──────────────────────────────────────────────────

Q_WebServer::run();
Q_WebServer_Log::shutdown();
echo "\nStopped.\n";
