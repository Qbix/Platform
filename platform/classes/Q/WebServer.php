<?php
/**
 * @module Q
 */

/**
 * Pure-PHP web server for Qbix apps.
 *
 * Serves static files with readfile(), ETag/304, companion .headers.
 * Routes .php scripts to pre-forked workers (Q_WebServer_Pool).
 * Upgrades WebSocket connections via Q_WebSocket.
 * Responsive directory listings with media previews.
 * Runs entirely on Q_Evented.
 *
 * @class Q_WebServer
 */
class Q_WebServer
{
	/** @property $pool Q_WebServer_Pool|null */
	static $pool = null;
	/** @property $rootDir Document root with trailing DS */
	public static $rootDir;
	/** @property $host Bound host */
	public static $host;
	/** @property $port Bound port */
	public static $port;
	/** @property $onRequest Logging callback(method, uri, status, ms) */
	static $onRequest = null;

	// ── Lifecycle ────────────────────────────────────────

	/**
	 * @method start
	 * @static
	 * @param {string} $dir Document root
	 * @param {string} [$host='0.0.0.0']
	 * @param {int} [$port=8080]
	 * @param {int} [$workers=0] 0=in-process, N=prefork pool
	 */
	static function start($dir, $host = '0.0.0.0', $port = 8080, $workers = 0)
	{
		if (self::$running) {
			throw new Exception("Q_WebServer already running");
		}

		$root = realpath($dir);
		if (!$root || !is_dir($root)) {
			throw new Exception("Invalid document root: $dir");
		}
		self::$rootDir = rtrim(str_replace(array('/','\\'), DS, $root), DS) . DS;
		self::$host = $host;
		self::$port = $port;

		if ($ext = Q_Config::get('Q', 'webserver', 'extensions', null)) {
			self::$allowedExtensions = $ext;
		}

		// ── HTTP listener ────────────────────────────────
		$errno = $errstr = 0;
		self::$socket = stream_socket_server(
			"tcp://{$host}:{$port}", $errno, $errstr,
			STREAM_SERVER_BIND | STREAM_SERVER_LISTEN
		);
		if (!self::$socket) {
			throw new Exception("Could not bind to {$host}:{$port} — $errstr");
		}
		stream_set_blocking(self::$socket, false);
		self::$acceptWatcher = Q_Evented::onReadable(
			self::$socket, array(__CLASS__, 'onAccept')
		);

		// ── HTTPS listener (if certs configured) ─────────
		$httpsConfig = Q_Config::get('Q', 'web', 'https', array());
		$httpsPort = (int) Q::ifset($httpsConfig, 'port', 0);
		if ($httpsPort || Q::ifset($httpsConfig, 'mode', '')) {
			if (!$httpsPort) $httpsPort = 443;
			self::$httpsPort = $httpsPort;

			$domain = Q::ifset($httpsConfig, 'domain', '');
			$certsReady = Q_WebServer_Certs::init($domain);

			if ($certsReady) {
				self::startTls($host, $httpsPort);
			} else {
				echo "[HTTPS] No valid certs yet, HTTPS disabled. "
					. "HTTP still running on port $port.\n";
			}
		}

		// ── Worker pool ──────────────────────────────────
		if ($workers > 0 && function_exists('pcntl_fork')) {
			self::$pool = new Q_WebServer_Pool($workers);
		}

		self::$running = true;
	}

	/**
	 * Start or restart the TLS listener.
	 * Uses tcp:// + stream_socket_enable_crypto() for non-blocking
	 * TLS handshake. The handshake happens per-connection in the
	 * event loop, not during accept.
	 *
	 * @method startTls
	 * @static
	 */
	static function startTls($host, $port)
	{
		if (self::$tlsWatcher) {
			Q_Evented::cancel(self::$tlsWatcher);
			self::$tlsWatcher = null;
		}
		if (self::$tlsSocket) {
			@fclose(self::$tlsSocket);
			self::$tlsSocket = null;
		}

		if (!Q_WebServer_Certs::validateCerts()) return;

		// Listen on plain tcp:// — TLS handshake happens after accept
		$errno = $errstr = 0;
		self::$tlsSocket = stream_socket_server(
			"tcp://{$host}:{$port}", $errno, $errstr,
			STREAM_SERVER_BIND | STREAM_SERVER_LISTEN
		);
		if (!self::$tlsSocket) {
			echo "[HTTPS] Could not bind to {$host}:{$port} — $errstr\n";
			return;
		}
		stream_set_blocking(self::$tlsSocket, false);

		self::$tlsWatcher = Q_Evented::onReadable(
			self::$tlsSocket,
			function ($sock) { Q_WebServer::onAcceptTls($sock); }
		);
		echo "[HTTPS] Listening on https://{$host}:{$port}\n";
	}

	/**
	 * Accept a connection on the TLS port and begin
	 * non-blocking crypto handshake.
	 *
	 * @method onAcceptTls
	 * @static
	 */
	static function onAcceptTls($serverSocket)
	{
		$client = @stream_socket_accept($serverSocket, 0);
		if (!$client) return;

		stream_set_blocking($client, false);

		// Set SSL context options on this specific socket
		$certPath = Q_WebServer_Certs::$certPath;
		$keyPath = Q_WebServer_Certs::$keyPath;
		stream_context_set_option($client, 'ssl', 'local_cert', $certPath);
		stream_context_set_option($client, 'ssl', 'local_pk', $keyPath);
		stream_context_set_option($client, 'ssl', 'allow_self_signed', true);
		stream_context_set_option($client, 'ssl', 'verify_peer', false);

		$key = (int) $client;
		self::$clients[$key] = $client;
		self::$buffers[$key] = '';
		self::$tlsPending[$key] = true;

		// Start the handshake — may need multiple attempts
		self::continueTlsHandshake($key);
	}

	/**
	 * Continue a non-blocking TLS handshake.
	 * stream_socket_enable_crypto() returns:
	 *   true  → handshake complete
	 *   false → handshake failed
	 *   0     → handshake in progress, try again
	 *
	 * @method continueTlsHandshake
	 * @static
	 */
	static function continueTlsHandshake($key)
	{
		if (!isset(self::$clients[$key])) return;
		$client = self::$clients[$key];

		$cryptoMethod = STREAM_CRYPTO_METHOD_TLSv1_2_SERVER;
		if (defined('STREAM_CRYPTO_METHOD_TLSv1_3_SERVER')) {
			$cryptoMethod |= STREAM_CRYPTO_METHOD_TLSv1_3_SERVER;
		}

		$result = @stream_socket_enable_crypto($client, true, $cryptoMethod);

		if ($result === true) {
			// Handshake complete — treat like a normal client
			unset(self::$tlsPending[$key]);
			self::$clientWatchers[$key] = Q_Evented::onReadable(
				$client,
				function ($c) { Q_WebServer::onClientData($c); }
			);
		} elseif ($result === 0) {
			// In progress — watch for readability to retry
			self::$clientWatchers[$key] = Q_Evented::onReadable(
				$client,
				function ($c) {
					$k = (int) $c;
					// Cancel this watcher and retry handshake
					if (isset(Q_WebServer::$clientWatchers[$k])) {
						Q_Evented::cancel(Q_WebServer::$clientWatchers[$k]);
						unset(Q_WebServer::$clientWatchers[$k]);
					}
					Q_WebServer::continueTlsHandshake($k);
				}
			);
		} else {
			// Failed
			self::closeClient($key);
		}
	}

	/**
	 * Reload TLS after cert renewal. Called by Q_WebServer_Certs.
	 * New connections will use the new certs. Existing connections
	 * keep their old certs until they close (normal behavior).
	 *
	 * @method reloadTls
	 * @static
	 */
	static function reloadTls()
	{
		if (self::$httpsPort) {
			// No need to restart the listener — we set SSL context
			// per-connection in onAcceptTls, so new connections
			// will pick up the new cert files automatically.
			echo "[HTTPS] Certificates reloaded for new connections.\n";
		}
	}

	/**
	 * Graceful shutdown: stop accepting new connections,
	 * wait for in-flight requests to complete (up to timeout),
	 * then close everything.
	 * @method stop
	 * @static
	 * @param {float} $drainTimeout Max seconds to wait for in-flight requests
	 */
	static function stop($drainTimeout = 5.0)
	{
		if (!self::$running) return;
		self::$running = false;

		// 1. Stop accepting new connections
		if (self::$acceptWatcher) {
			Q_Evented::cancel(self::$acceptWatcher);
			self::$acceptWatcher = null;
		}
		if (self::$tlsWatcher) {
			Q_Evented::cancel(self::$tlsWatcher);
			self::$tlsWatcher = null;
		}
		if (self::$socket) { @fclose(self::$socket); self::$socket = null; }
		if (self::$tlsSocket) { @fclose(self::$tlsSocket); self::$tlsSocket = null; }

		// 2. Wait for in-flight connections to drain (up to timeout)
		$deadline = microtime(true) + $drainTimeout;
		while (!empty(self::$clients) && microtime(true) < $deadline) {
			Q_Evented::tick(0.1); // process pending I/O briefly
		}

		// 3. Force-close remaining connections
		foreach (self::$timeoutWatchers as $id) Q_Evented::cancel($id);
		self::$timeoutWatchers = array();
		foreach (self::$clientWatchers as $id) Q_Evented::cancel($id);
		self::$clientWatchers = array();
		foreach (self::$clients as $c) @fclose($c);
		self::$clients = array();
		self::$buffers = array();
		self::$clientInfo = array();
		self::$keepAliveCount = array();

		// 4. Disconnect WebSockets
		Q_WebSocket::disconnectAll();

		// 5. Gracefully shut down worker pool (SIGTERM → wait → SIGKILL)
		if (self::$pool) { self::$pool->shutdown(); self::$pool = null; }
	}

	static function run()
	{
		if (!self::$running) return;
		if (function_exists('pcntl_signal')) {
			Q_Evented::onSignal(SIGINT, function () {
				echo "\n  Graceful shutdown (SIGINT)...\n";
				self::stop();
				Q_Evented::stop();
			});
			Q_Evented::onSignal(SIGTERM, function () {
				echo "\n  Graceful shutdown (SIGTERM)...\n";
				self::stop();
				Q_Evented::stop();
			});
		}
		Q_Evented::run();
	}

	// ── Connection handling ──────────────────────────────

	static function onAccept($socket)
	{
		// Max connections check
		$maxConn = Q_Config::get('Q', 'webserver', 'maxConnections', 1024);
		if (count(self::$clients) >= $maxConn) {
			$reject = @stream_socket_accept($socket, 0);
			if ($reject) {
				@fwrite($reject, "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
				@fclose($reject);
			}
			return;
		}

		$client = @stream_socket_accept($socket, 0);
		if (!$client) return;
		stream_set_blocking($client, false);
		$key = (int) $client;
		self::$clients[$key] = $client;
		self::$buffers[$key] = '';
		self::$keepAliveCount[$key] = 0;

		// Store remote IP for logging + proxy resolution
		$peer = stream_socket_get_name($client, true);
		$ip = $peer ? explode(':', $peer)[0] : '0.0.0.0';
		self::$clientInfo[$key] = array(
			'ip' => $ip,
			'connectTime' => microtime(true)
		);

		// Rate limit check
		if (!self::checkRateLimit($ip)) {
			@fwrite($client, "HTTP/1.1 429 Too Many Requests\r\n"
				. "Retry-After: 60\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
			@fclose($client);
			unset(self::$clients[$key], self::$buffers[$key], self::$keepAliveCount[$key],
				self::$clientInfo[$key]);
			return;
		}

		self::$clientWatchers[$key] = Q_Evented::onReadable(
			$client, function ($c) { Q_WebServer::onClientData($c); }
		);

		// Read timeout — close if no complete request within N seconds
		$readTimeout = (float) Q_Config::get('Q', 'webserver', 'timeout', 'read', 30);
		self::$timeoutWatchers[$key] = Q_Evented::delay($readTimeout, function () use ($key) {
			Q_WebServer::closeClient($key);
		});
	}

	static function onClientData($client)
	{
		$key = (int) $client;
		$chunk = @fread($client, 8192);
		if ($chunk === false || $chunk === '') {
			self::closeClient($key);
			return;
		}
		self::$buffers[$key] .= $chunk;
		$buf = self::$buffers[$key];

		// Wait for complete headers
		$headerEnd = strpos($buf, "\r\n\r\n");
		if ($headerEnd === false) {
			if (strlen($buf) > 65536) self::closeClient($key);
			return;
		}

		// Wait for complete body on POST/PUT/PATCH
		if (preg_match('#^(POST|PUT|PATCH)\s#', $buf)) {
			$cl = 0;
			if (preg_match('/content-length:\s*(\d+)/i', $buf, $m)) {
				$cl = (int) $m[1];
			}
			if ($cl > 10485760) {
				self::sendResponse($client, 413, 'Payload Too Large');
				self::closeClient($key);
				return;
			}
			if (strlen($buf) - $headerEnd - 4 < $cl) return;
		}

		// Cancel read timeout (request received)
		if (isset(self::$timeoutWatchers[$key])) {
			Q_Evented::cancel(self::$timeoutWatchers[$key]);
			unset(self::$timeoutWatchers[$key]);
		}

		$start = microtime(true);
		$parsed = self::parseRequest($buf);

		// Resolve proxy headers for real client IP
		$directIp = self::$clientInfo[$key]['ip'] ?? '0.0.0.0';
		$parsed['clientIp'] = Q_WebServer_Proxy::clientIp($directIp, $parsed['headers']);

		try {
			$keepOpen = self::handleRequest($client, $parsed);
		} catch (\Throwable $e) {
			// Never let a request crash the event loop
			$msg = htmlspecialchars($e->getMessage());
			self::sendResponse($client, 500, "Internal Server Error: $msg");
			self::closeClient($key);
			$ms = round((microtime(true) - $start) * 1000, 1);
			Q_WebServer_Dashboard::recordRequest(
				$parsed['method'] ?? 'GET', $parsed['uri'] ?? '/', 500, $ms
			);
			if (self::$onRequest) {
				(self::$onRequest)($parsed['method'] ?? 'GET', $parsed['uri'] ?? '/', 500, $ms);
			}
			return;
		}
		$ms = round((microtime(true) - $start) * 1000, 1);

		if ($keepOpen) {
			// WebSocket upgraded — Q_WebSocket owns this socket now
			if (isset(self::$clientWatchers[$key])) {
				Q_Evented::cancel(self::$clientWatchers[$key]);
			}
			unset(self::$clientWatchers[$key], self::$clients[$key],
				self::$buffers[$key], self::$clientInfo[$key],
				self::$keepAliveCount[$key]);
			return;
		}

		// Stats + logging
		Q_WebServer_Dashboard::recordRequest(
			$parsed['method'], $parsed['uri'], self::$lastStatus, $ms
		);
		if (self::$onRequest) {
			(self::$onRequest)($parsed['method'], $parsed['uri'], self::$lastStatus, $ms);
		}

		// Log to file
		$bodyLen = strlen(self::$lastBody ?? '');
		Q_WebServer_Log::access(
			$parsed['clientIp'], $parsed['method'], $parsed['uri'],
			self::$lastStatus, $bodyLen,
			$parsed['headers']['referer'] ?? '',
			$parsed['headers']['user-agent'] ?? '',
			$ms
		);

		// ── Keep-alive decision ──────────────────────────
		$maxKeepAlive = (int) Q_Config::get('Q', 'webserver', 'keepAlive', 'max', 100);
		$keepAliveTimeout = (float) Q_Config::get('Q', 'webserver', 'keepAlive', 'timeout', 15);

		$connHeader = strtolower($parsed['headers']['connection'] ?? 'keep-alive');
		self::$keepAliveCount[$key] = (self::$keepAliveCount[$key] ?? 0) + 1;

		$shouldKeepAlive = ($connHeader !== 'close')
			&& self::$keepAliveCount[$key] < $maxKeepAlive
			&& self::$lastStatus < 500;

		if ($shouldKeepAlive) {
			// Reset buffer for next request on this connection
			self::$buffers[$key] = '';

			// Set idle timeout — close if no new request arrives
			self::$timeoutWatchers[$key] = Q_Evented::delay(
				$keepAliveTimeout,
				function () use ($key) {
					Q_WebServer::closeClient($key);
				}
			);
			// The existing onReadable watcher fires when next request arrives
		} else {
			self::closeClient($key);
		}
	}

	// ── Request routing ──────────────────────────────────

	/**
	 * Route a parsed request and return a response array.
	 *
	 * This is the clean interface that external HTTP drivers
	 * (like amphp/http-server) call. Handles all routing:
	 * blocked paths, static files, PHP dispatch, directory
	 * listings, X-Accel-Redirect, compression.
	 *
	 * The built-in server uses handleRequest() which writes
	 * directly to sockets. amphp calls route() and converts
	 * the response to its own format.
	 *
	 * @method route
	 * @static
	 * @param {array} $parsed [method, uri, path, query, headers, body, clientIp]
	 * @return {array} [status, headers, body]
	 */
	static function route($parsed)
	{
		$method = $parsed['method'];
		$path = $parsed['path'];

		// Reverse cache check (before any dispatch)
		$cached = Q_WebServer_Cache::get($parsed);
		if ($cached) return $cached;

		if ($path === '/Q/health') {
			$stats = Q_WebServer_Dashboard::getStats();
			return array('status'=>200, 'body'=>json_encode(array('status'=>'ok')+$stats),
				'headers'=>array('Content-Type'=>'application/json'));
		}
		if ($path === '/Q/dashboard' || $path === '/Q/dashboard/') {
			return array('status'=>200, 'body'=>Q_WebServer_Dashboard::renderHtml($parsed),
				'headers'=>array('Content-Type'=>'text/html; charset=utf-8'));
		}
		if (self::isBlocked($path)) {
			return array('status'=>403, 'body'=>'Forbidden',
				'headers'=>array('Content-Type'=>'text/plain'));
		}

		$fsPath = self::resolveStatic($path);

		// Directory
		if ($fsPath && is_dir($fsPath)) {
			if (substr($path, -1) !== '/') {
				return array('status'=>301, 'body'=>'',
					'headers'=>array('Location'=>$path.'/'));
			}
			foreach (array('index.html','index.php') as $idx) {
				$ip = $fsPath.DS.$idx;
				if (is_file($ip)) { $fsPath = $ip; break; }
			}
			if (is_dir($fsPath)) {
				if (self::isIndexed($path)) {
					return array('status'=>200,
						'body'=>self::renderDirectoryListing($fsPath, $path),
						'headers'=>array('Content-Type'=>'text/html; charset=utf-8',
							'Cache-Control'=>'no-store'));
				}
				return array('status'=>403, 'body'=>'Forbidden',
					'headers'=>array('Content-Type'=>'text/plain'));
			}
		}

		// File
		if ($fsPath && is_file($fsPath)) {
			$ext = strtolower(pathinfo($fsPath, PATHINFO_EXTENSION));

			if ($ext === 'php') {
				// PHP dispatch (in-process — amphp uses fibers for concurrency)
				$response = self::dispatchToQ($parsed);
				$response = self::processPhpResponse($response, $parsed['headers']);
				Q_WebServer_Cache::put($parsed, $response);
				return $response;
			}

			if (in_array($ext, self::$allowedExtensions)
				&& ($method === 'GET' || $method === 'HEAD')
			) {
				return self::buildFileResponse($fsPath, $ext, $method, $parsed['headers']);
			}
		}

		// Clean URL → index.php
		if (is_file(self::$rootDir . 'index.php')) {
			$response = self::dispatchToQ($parsed);
			$response = self::processPhpResponse($response, $parsed['headers']);
			Q_WebServer_Cache::put($parsed, $response);
			return $response;
		}

		return array('status'=>404, 'body'=>self::render404($path),
			'headers'=>array('Content-Type'=>'text/html; charset=utf-8'));
	}

	/**
	 * Process a PHP response: X-Accel-Redirect + compression.
	 * Used by both route() and handlePhp().
	 */
	static function processPhpResponse($response, $reqHeaders)
	{
		$headers = Q_WebServer_Headers::stripInternal($response['headers'] ?? array());
		$body = $response['body'] ?? '';

		// X-Accel-Redirect
		foreach ($response['headers'] ?? array() as $k => $v) {
			if (strtolower($k) === 'x-accel-redirect') {
				$af = Q_WebServer_Headers::resolveAccelPath($v);
				if ($af && is_file($af)) {
					$body = file_get_contents($af);
					$ext = strtolower(pathinfo($af, PATHINFO_EXTENSION));
					if (!Q_WebServer_Headers::hasHeader($headers, 'Content-Type')) {
						$headers['Content-Type'] = self::mimeType($ext);
					}
				}
				$headers = Q_WebServer_Headers::stripInternal($headers);
				break;
			}
		}

		$ct = '';
		foreach ($headers as $k => $v) {
			if (strtolower($k) === 'content-type') $ct = $v;
		}
		$body = Q_WebServer_Headers::maybeCompress($body, $ct, $reqHeaders, $headers);
		return array('status'=>$response['status']??200, 'body'=>$body, 'headers'=>$headers);
	}

	/**
	 * Build a static file response with ETag/compression.
	 * Used by route() for amphp compatibility.
	 */
	static function buildFileResponse($fsPath, $ext, $method, $reqHeaders)
	{
		clearstatcache(true, $fsPath);
		$mtime = filemtime($fsPath);
		$size = filesize($fsPath);
		$ct = self::mimeType($ext);
		$headers = array(
			'Content-Type' => $ct,
			'ETag' => '"' . dechex($mtime) . '-' . dechex($size) . '"',
			'Last-Modified' => gmdate('D, d M Y H:i:s', $mtime) . ' GMT',
			'Cache-Control' => 'public, max-age=0, must-revalidate'
		);
		$body = ($method === 'HEAD') ? '' : file_get_contents($fsPath);
		if ($method !== 'HEAD') {
			$body = Q_WebServer_Headers::maybeCompress($body, $ct, $reqHeaders, $headers);
		}
		return array('status'=>200, 'body'=>$body, 'headers'=>$headers);
	}

	// ── Built-in server: socket-based routing ────────────

	/**
	 * Route a request (built-in server).
	 * Returns true if the connection should stay open (WebSocket).
	 * @return {boolean}
	 */
	private static function handleRequest($client, $parsed)
	{
		$method = $parsed['method'];
		$path = $parsed['path'];

		// 1. Dashboard + Panel + WebSocket + Health (/Q/*)
		if (strpos($path, '/Q/') === 0) {
			if ($path === '/Q/ws') {
				$upgraded = Q_WebSocket::upgrade(
					$client, $parsed['headers'], null, 'dashboard'
				);
				return $upgraded; // true = keep open
			}
			if ($path === '/Q/health') {
				$stats = Q_WebServer_Dashboard::getStats();
				self::sendResponse($client, 200,
					json_encode(array('status' => 'ok') + $stats),
					'application/json');
				return false;
			}
			// Panel (control panel + API)
			$handled = Q_WebServer_Panel::handle($client, $parsed);
			if ($handled) return false;
			// Dashboard (live stats)
			$handled = Q_WebServer_Dashboard::handle($client, $parsed);
			if ($handled) return false;
		}

		// 2. Blocked paths
		if (self::isBlocked($path)) {
			self::sendResponse($client, 403, 'Forbidden');
			return false;
		}

		// 3. Component cache check (Merkle tree — serves from cached slots)
		if (Q_WebServer_Cache_Components::enabled()) {
			$pageKey = $parsed['path'] . '?' . ($parsed['query'] ?? '');
			$cachedPage = Q_WebServer_Cache_Components::getPage($pageKey);
			if ($cachedPage !== null) {
				self::sendResponse($client, 200, $cachedPage,
					'text/html; charset=utf-8',
					array('X-Cache' => 'HIT-COMPONENTS'));
				return false;
			}
		}

		// 4. Reverse cache check (before forking a worker)
		$cached = Q_WebServer_Cache::get($parsed);
		if ($cached) {
			self::sendResponse($client, $cached['status'],
				$cached['body'], $cached['headers']['Content-Type'] ?? 'text/html',
				$cached['headers']);
			return false;
		}

		// 4. Resolve filesystem path
		$fsPath = self::resolveStatic($path);

		// 4. Directory handling
		if ($fsPath && is_dir($fsPath)) {
			if (substr($path, -1) !== '/') {
				self::sendRedirect($client, $path . '/');
				return false;
			}
			// Check for index files
			foreach (array('index.html', 'index.php') as $idx) {
				$indexPath = $fsPath . DS . $idx;
				if (is_file($indexPath)) {
					$fsPath = $indexPath;
					break;
				}
			}
			if (is_dir($fsPath)) {
				// No index file → check if listings are enabled for this path
				if (self::isIndexed($path)) {
					$html = self::renderDirectoryListing($fsPath, $path);
					self::sendResponse($client, 200, $html, 'text/html; charset=utf-8',
						array('Cache-Control' => 'no-store'));
				} else {
					self::sendResponse($client, 403, 'Forbidden');
				}
				return false;
			}
		}

		// 5. File handling
		if ($fsPath && is_file($fsPath)) {
			$ext = strtolower(pathinfo($fsPath, PATHINFO_EXTENSION));

			// PHP scripts → worker pool or in-process
			if ($ext === 'php') {
				return self::handlePhp($client, $parsed, $fsPath);
			}

			// Static file
			if ($method === 'GET' || $method === 'HEAD') {
				self::serveStaticFile($client, $fsPath, $method, $parsed['headers']);
				return false;
			}
		}

		// 6. Clean URL → route through index.php
		$indexPhp = self::$rootDir . 'index.php';
		if (is_file($indexPhp)) {
			return self::handlePhp($client, $parsed, $indexPhp);
		}

		// 7. Not found
		self::sendResponse($client, 404, self::render404($path), 'text/html; charset=utf-8');
		return false;
	}

	/**
	 * Route a .php script to the worker pool or dispatch in-process.
	 * @return {boolean} false (connection closes after response)
	 */
	private static function handlePhp($client, $parsed, $scriptPath)
	{
		if (self::$pool) {
			self::$lastStatus = 200;
			self::$pool->dispatch($client, $parsed, $scriptPath);
			$key = (int) $client;
			if (isset(self::$clientWatchers[$key])) {
				Q_Evented::cancel(self::$clientWatchers[$key]);
			}
			unset(self::$clientWatchers[$key], self::$clients[$key], self::$buffers[$key]);
			return false;
		}
		// In-process: run through Headers for X-Accel-Redirect + compression
		$response = self::dispatchToQ($parsed);
		Q_WebServer_Headers::processResponse($client, $response, $parsed['headers']);
		self::$lastStatus = $response['status'] ?? 200;
		// Store in cache if cacheable
		Q_WebServer_Cache::put($parsed, $response);
		return false;
	}

	// ── Static file serving ──────────────────────────────

	private static function serveStaticFile($client, $fsPath, $method, $reqHeaders)
	{
		$ext = strtolower(pathinfo($fsPath, PATHINFO_EXTENSION));
		if (!in_array($ext, self::$allowedExtensions)) {
			self::sendResponse($client, 403, 'Forbidden');
			return;
		}

		clearstatcache(true, $fsPath);
		$mtime = filemtime($fsPath);
		$size = filesize($fsPath);
		$etag = '"' . dechex($mtime) . '-' . dechex($size) . '"';

		// 304 Not Modified
		if (isset($reqHeaders['if-none-match']) && trim($reqHeaders['if-none-match']) === $etag) {
			self::sendNotModified($client, $etag, $mtime);
			return;
		}
		if (isset($reqHeaders['if-modified-since'])) {
			$since = strtotime($reqHeaders['if-modified-since']);
			if ($since !== false && $mtime <= $since) {
				self::sendNotModified($client, $etag, $mtime);
				return;
			}
		}

		$contentType = self::mimeType($ext);
		$headers = array(
			'Content-Type'   => $contentType,
			'ETag'           => $etag,
			'Last-Modified'  => gmdate('D, d M Y H:i:s', $mtime) . ' GMT',
			'Cache-Control'  => 'public, max-age=0, must-revalidate'
		);

		// Companion .headers file
		$hf = $fsPath . '.headers';
		if (file_exists($hf)) {
			foreach (file($hf, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
				if ($line[0] === '#' || strpos($line, ':') === false) continue;
				list($k, $v) = explode(':', $line, 2);
				$headers[trim($k)] = trim($v);
			}
		}

		// Pre-compressed .gz / .br siblings (like nginx gzip_static)
		$preComp = Q_WebServer_Headers::findPreCompressed($fsPath, $reqHeaders);
		if ($preComp) {
			$headers['Content-Encoding'] = $preComp['encoding'];
			$headers['Content-Length'] = $preComp['size'];
			$headers['Vary'] = 'Accept-Encoding';
			$headers['Connection'] = 'close';
			$out = "HTTP/1.1 200 OK\r\n";
			foreach ($headers as $k => $v) $out .= "$k: $v\r\n";
			fwrite($client, $out . "\r\n");
			self::$lastStatus = 200;
			if ($method !== 'HEAD') {
				$fp = fopen($preComp['path'], 'rb');
				while (!feof($fp)) {
					$data = fread($fp, 65536);
					if ($data === false || @fwrite($client, $data) === false) break;
				}
				fclose($fp);
			}
			return;
		}

		// On-the-fly gzip for compressible text types under 5MB
		if ($size < 5242880
			&& Q_WebServer_Headers::shouldCompress($contentType, $size, $reqHeaders)
		) {
			$body = file_get_contents($fsPath);
			$body = Q_WebServer_Headers::maybeCompress($body, $contentType, $reqHeaders, $headers);
			$headers['Content-Length'] = strlen($body);
			$headers['Connection'] = 'close';
			$out = "HTTP/1.1 200 OK\r\n";
			foreach ($headers as $k => $v) $out .= "$k: $v\r\n";
			@fwrite($client, $out . "\r\n");
			self::$lastStatus = 200;
			if ($method !== 'HEAD') @fwrite($client, $body);
			return;
		}

		// Uncompressed — stream directly
		$headers['Content-Length'] = $size;
		$headers['Connection'] = 'close';
		$out = "HTTP/1.1 200 OK\r\n";
		foreach ($headers as $k => $v) $out .= "$k: $v\r\n";
		fwrite($client, $out . "\r\n");
		self::$lastStatus = 200;

		if ($method !== 'HEAD') {
			$fp = fopen($fsPath, 'rb');
			while (!feof($fp)) {
				$data = fread($fp, 65536);
				if ($data === false || @fwrite($client, $data) === false) break;
			}
			fclose($fp);
		}
	}

	// ── Privacy / access control ─────────────────────────

	/**
	 * Check if a URL path is blocked entirely (403 Forbidden).
	 *
	 * These paths cannot be accessed by any URL. They contain
	 * server-side code, config, and internal data.
	 *
	 * Blocked: /config/, /classes/, /handlers/, /scripts/
	 * Also: dotfiles/dotdirs (except /.well-known/)
	 * Also: paths in Q.web.blocked.paths config
	 *
	 * For true access control on files, use X-Accel-Redirect
	 * (PHP checks permissions, server does file I/O).
	 *
	 * @method isBlocked
	 * @static
	 * @param {string} $urlPath
	 * @return {boolean}
	 */
	static function isBlocked($urlPath)
	{
		// Core blocked directories (server internals)
		$blocked = array('/config/', '/classes/', '/handlers/', '/scripts/');
		foreach ($blocked as $prefix) {
			if (strpos($urlPath, $prefix) === 0) return true;
		}

		// Dotfiles/dotdirs (except /.well-known/)
		if (preg_match('#/\.(?!well-known)#', $urlPath)) return true;

		// Config-based blocked paths
		$blockedPaths = Q_Config::get('Q', 'web', 'blocked', 'paths', array());
		foreach ($blockedPaths as $pp => $v) {
			if ($v && strpos($urlPath, '/' . ltrim($pp, '/')) === 0) return true;
		}

		return false;
	}

	/**
	 * Check if a URL path allows directory listing.
	 *
	 * Directory listings are OFF by default (more secure).
	 * Only paths matching regexes in
	 * Q.web.indexed.paths get listings. Default: /img/.
	 *
	 * Config:
	 *   "Q": { "web": { "indexed": { "paths": {
	 *     "#^/img/#": true,
	 *     "#^/downloads/#": true
	 *   }}}}
	 *
	 * For actual access control, use X-Accel-Redirect.
	 *
	 * @method isIndexed
	 * @static
	 * @param {string} $urlPath
	 * @return {boolean}
	 */
	static function isIndexed($urlPath)
	{
		$patterns = Q_Config::get('Q', 'web', 'indexed', 'paths', array(
			'#^/img/#' => true
		));
		foreach ($patterns as $regex => $enabled) {
			if ($enabled && preg_match($regex, $urlPath)) return true;
		}
		return false; // not indexed by default
	}

	// ── Directory listing ────────────────────────────────

	/**
	 * Render a responsive directory listing with media previews.
	 * Only called for paths that pass isIndexed().
	 * Dotfiles are always hidden from listings.
	 *
	 * @method renderDirectoryListing
	 * @static
	 * @param {string} $dir Filesystem path
	 * @param {string} $urlPath URL path
	 * @return {string} HTML
	 */
	static function renderDirectoryListing($dir, $urlPath)
	{
		$maxImages = (int) Q_Config::get('Q', 'webserver', 'listing', 'images', 'max', 100);
		$items = scandir($dir);
		$dirs = array();
		$files = array();
		$media = array();

		$imageExts = array('png','jpg','jpeg','gif','webp','svg');
		$videoExts = array('mp4','webm','ogg');
		$audioExts = array('mp3','wav','ogg');

		foreach ($items as $name) {
			if ($name === '.' || $name === '..') continue;
			if ($name[0] === '.') continue; // dotfiles always hidden

			$full = $dir . DS . $name;
			$href = htmlspecialchars($urlPath . $name, ENT_QUOTES);
			$safe = htmlspecialchars($name, ENT_QUOTES);

			if (is_dir($full)) {
				$dirs[] = "<a href=\"{$href}/\" class=\"item dir\"><span class=\"icon\">📁</span><span class=\"name\">{$safe}/</span></a>";
				continue;
			}

			$ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
			if (!in_array($ext, self::$allowedExtensions)) continue;

			$size = filesize($full);
			$sizeStr = $size < 1024 ? "${size} B"
				: ($size < 1048576 ? round($size/1024,1).' KB'
				: round($size/1048576,1).' MB');

			$files[] = "<a href=\"{$href}\" class=\"item file\"><span class=\"icon\">📄</span><span class=\"name\">{$safe}</span><span class=\"size\">{$sizeStr}</span></a>";

			// Collect media for preview grid
			if (count($media) < $maxImages) {
				if (in_array($ext, $imageExts)) {
					$media[] = "<div class=\"media-item\"><a href=\"{$href}\"><img src=\"{$href}\" loading=\"lazy\" alt=\"{$safe}\"></a><div class=\"caption\">{$safe}</div></div>";
				} elseif (in_array($ext, $videoExts)) {
					$media[] = "<div class=\"media-item\"><video src=\"{$href}\" controls preload=\"metadata\"></video><div class=\"caption\">{$safe}</div></div>";
				} elseif (in_array($ext, $audioExts)) {
					$media[] = "<div class=\"media-item\"><audio src=\"{$href}\" controls preload=\"metadata\"></audio><div class=\"caption\">{$safe}</div></div>";
				}
			}
		}

		$safePath = htmlspecialchars($urlPath, ENT_QUOTES);
		$upLink = ($urlPath !== '/')
			? '<a href="../" class="item dir up"><span class="icon">⬆</span><span class="name">Parent Directory</span></a>'
			: '';

		$mediaSection = '';
		if ($media) {
			$mediaSection = '<div class="divider">Media Preview</div><div class="media-grid">'
				. implode("\n", $media) . '</div>';
		}

		return <<<HTML
<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Index of {$safePath}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,system-ui,BlinkMacSystemFont,'Segoe UI',sans-serif;
  background:#f8f9fa;color:#333;padding:20px;max-width:960px;margin:0 auto}
h1{font-size:20px;font-weight:600;padding:16px 0;border-bottom:2px solid #e9ecef;margin-bottom:12px;
  word-break:break-all}
.listing{display:flex;flex-direction:column;gap:2px}
.item{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:6px;
  text-decoration:none;color:#333;transition:background .15s}
.item:hover{background:#e9ecef}
.icon{font-size:18px;flex-shrink:0;width:24px;text-align:center}
.name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}
.size{color:#868e96;font-size:12px;flex-shrink:0}
.dir .name{color:#1971c2;font-weight:500}
.file .name{color:#333}
.up{border-bottom:1px solid #e9ecef;margin-bottom:4px;padding-bottom:10px}
.divider{font-size:12px;color:#868e96;text-transform:uppercase;letter-spacing:.5px;
  padding:20px 0 8px;border-top:1px solid #e9ecef;margin-top:16px}
.media-grid{display:flex;flex-wrap:wrap;gap:12px;padding:8px 0}
.media-item{max-width:200px;text-align:center}
.media-item img{max-width:200px;max-height:200px;height:auto;border-radius:6px;
  display:block;margin:0 auto 4px;object-fit:cover}
.media-item video{max-width:200px;max-height:200px;border-radius:6px;display:block;margin:0 auto 4px}
.media-item audio{max-width:200px;display:block;margin:0 auto 4px}
.caption{font-size:11px;color:#868e96;word-break:break-all;max-width:200px}
@media(max-width:600px){
  body{padding:12px}
  .item{padding:10px 8px}
  .media-item{max-width:calc(50vw - 24px)}
  .media-item img,.media-item video{max-width:100%}
}
</style>
</head><body>
<h1>Index of {$safePath}</h1>
<div class="listing">
{$upLink}
HTML
		. implode("\n", $dirs) . "\n"
		. implode("\n", $files)
		. "\n</div>\n"
		. $mediaSection
		. "\n</body></html>";
	}

	// ── MIME types ────────────────────────────────────────

	static function mimeType($ext)
	{
		static $types = array(
			'html'=>'text/html; charset=utf-8', 'htm'=>'text/html; charset=utf-8',
			'css'=>'text/css; charset=utf-8', 'js'=>'application/javascript; charset=utf-8',
			'mjs'=>'application/javascript; charset=utf-8', 'json'=>'application/json; charset=utf-8',
			'xml'=>'application/xml', 'txt'=>'text/plain; charset=utf-8',
			'md'=>'text/plain; charset=utf-8', 'csv'=>'text/csv; charset=utf-8',
			'yaml'=>'text/yaml', 'yml'=>'text/yaml', 'log'=>'text/plain; charset=utf-8',
			'map'=>'application/json',
			'png'=>'image/png', 'jpg'=>'image/jpeg', 'jpeg'=>'image/jpeg',
			'gif'=>'image/gif', 'webp'=>'image/webp', 'svg'=>'image/svg+xml',
			'bmp'=>'image/bmp', 'ico'=>'image/x-icon', 'avif'=>'image/avif',
			'woff'=>'font/woff', 'woff2'=>'font/woff2',
			'ttf'=>'font/ttf', 'otf'=>'font/otf',
			'mp3'=>'audio/mpeg', 'wav'=>'audio/wav', 'ogg'=>'audio/ogg',
			'mp4'=>'video/mp4', 'webm'=>'video/webm',
			'pdf'=>'application/pdf', 'zip'=>'application/zip',
			'wasm'=>'application/wasm',
		);
		return $types[$ext] ?? 'application/octet-stream';
	}

	// ── Q_Dispatcher bridge ──────────────────────────────

	static function dispatchToQ($parsed)
	{
		$saved = array($_SERVER, $_GET, $_POST, $_REQUEST);
		$_SERVER['REQUEST_METHOD'] = $parsed['method'];
		$_SERVER['REQUEST_URI'] = $parsed['uri'];
		$_SERVER['QUERY_STRING'] = $parsed['query'];
		$_SERVER['SCRIPT_NAME'] = '/index.php';
		$_SERVER['SCRIPT_FILENAME'] = self::$rootDir . 'index.php';
		$host = $parsed['headers']['host'] ?? 'localhost';
		$_SERVER['SERVER_NAME'] = explode(':', $host)[0]; // strip port from Host header
		$_SERVER['SERVER_PORT'] = self::$port;
		foreach ($parsed['headers'] as $k => $v) {
			$_SERVER['HTTP_' . strtoupper(str_replace('-', '_', $k))] = $v;
		}
		if (isset($parsed['headers']['content-type']))
			$_SERVER['CONTENT_TYPE'] = $parsed['headers']['content-type'];
		if (isset($parsed['headers']['content-length']))
			$_SERVER['CONTENT_LENGTH'] = $parsed['headers']['content-length'];

		$_GET = $_POST = $_REQUEST = array();
		if ($parsed['query']) parse_str($parsed['query'], $_GET);
		$ct = strtolower($_SERVER['CONTENT_TYPE'] ?? '');
		if (strpos($ct, 'application/x-www-form-urlencoded') !== false) {
			parse_str($parsed['body'], $_POST);
		} elseif (strpos($ct, 'application/json') !== false) {
			$_POST = json_decode($parsed['body'], true) ?: array();
		}
		$_REQUEST = array_merge($_GET, $_POST);

		ob_start();
		$status = 200;
		$headers = array();
		try {
			Q_Dispatcher::dispatch();
			foreach (headers_list() as $h) {
				if (strpos($h, ':') !== false) {
					list($k, $v) = explode(':', $h, 2);
					$headers[trim($k)] = trim($v);
				}
			}
			$code = http_response_code();
			if ($code) $status = $code;
		} catch (Exception $e) {
			$status = 500;
			ob_clean();
			echo json_encode(array('error' => $e->getMessage()));
			$headers['Content-Type'] = 'application/json';
		}
		$body = ob_get_clean();
		header_remove();
		list($_SERVER, $_GET, $_POST, $_REQUEST) = $saved;

		// Process Merkle cache headers (strips Q-Cache-* from response)
		if (Q_WebServer_Cache_Components::enabled()) {
			$pageKey = $parsed['path'] . '?' . ($parsed['query'] ?? '');
			Q_WebServer_Cache_Components::processResponseHeaders($pageKey, $headers);
		}

		return compact('status', 'body', 'headers');
	}

	// ── Request parsing ──────────────────────────────────

	static function parseRequest($raw)
	{
		$headerEnd = strpos($raw, "\r\n\r\n");
		$headerBlock = substr($raw, 0, $headerEnd);
		$body = substr($raw, $headerEnd + 4);
		$lines = explode("\r\n", $headerBlock);
		$requestLine = array_shift($lines);
		preg_match('#^(\w+)\s+([^\s]+)\s+HTTP/(\d\.\d)#', $requestLine, $m);
		$method = strtoupper($m[1] ?? 'GET');
		$uri = $m[2] ?? '/';
		$httpVersion = $m[3] ?? '1.0';
		$p = parse_url($uri);
		$path = urldecode($p['path'] ?? '/');
		$path = preg_replace('#/+#', '/', $path); // collapse //
		$query = $p['query'] ?? '';
		$headers = array();
		foreach ($lines as $line) {
			if (strpos($line, ':') === false) continue;
			list($k, $v) = explode(':', $line, 2);
			$headers[strtolower(trim($k))] = trim($v);
		}
		// HTTP/1.0 defaults to Connection: close
		if ($httpVersion === '1.0' && !isset($headers['connection'])) {
			$headers['connection'] = 'close';
		}
		return compact('method', 'uri', 'path', 'query', 'headers', 'body', 'httpVersion');
	}

	// ── Response helpers ─────────────────────────────────

	static function sendResponse($client, $status, $body, $type = 'text/plain; charset=utf-8', $extra = array())
	{
		static $reasons = array(
			200=>'OK', 301=>'Moved Permanently', 304=>'Not Modified',
			400=>'Bad Request', 403=>'Forbidden', 404=>'Not Found',
			413=>'Payload Too Large', 500=>'Internal Server Error', 502=>'Bad Gateway'
		);
		self::$lastStatus = $status;
		self::$lastBody = $body;
		$body = (string) $body;
		$conn = $extra['Connection'] ?? 'keep-alive';
		unset($extra['Connection']);
		$out = "HTTP/1.1 $status " . ($reasons[$status] ?? 'OK')
			. "\r\nContent-Type: $type\r\nContent-Length: " . strlen($body)
			. "\r\nConnection: $conn\r\n";
		foreach ($extra as $k => $v) $out .= "$k: $v\r\n";
		@fwrite($client, $out . "\r\n" . $body);
	}

	private static function sendRedirect($client, $loc) {
		@fwrite($client, "HTTP/1.1 301 Moved Permanently\r\nLocation: $loc\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
		self::$lastStatus = 301;
	}

	private static function sendNotModified($client, $etag, $mtime) {
		@fwrite($client, "HTTP/1.1 304 Not Modified\r\nETag: $etag\r\n"
			. "Last-Modified: " . gmdate('D, d M Y H:i:s', $mtime) . " GMT\r\n"
			. "Cache-Control: public, max-age=0, must-revalidate\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
		self::$lastStatus = 304;
	}

	private static function render404($path)
	{
		$safe = htmlspecialchars($path, ENT_QUOTES);
		return "<!DOCTYPE html><html><head><title>404</title>"
			. "<style>body{font-family:sans-serif;padding:40px;text-align:center;color:#666}"
			. "h1{font-size:72px;color:#ddd}p{margin-top:12px}</style></head>"
			. "<body><h1>404</h1><p>{$safe} not found</p></body></html>";
	}

	// ── Path resolution ──────────────────────────────────

	/**
	 * Parse a Cookie header string into an associative array
	 * @method parseCookieHeader
	 * @static
	 * @param {string} $header The raw Cookie header value
	 * @return {array} name => value pairs
	 */
	static function parseCookieHeader($header)
	{
		$cookies = array();
		if (empty($header)) return $cookies;
		$pairs = explode(';', $header);
		foreach ($pairs as $pair) {
			$pair = trim($pair);
			if ($pair === '') continue;
			$eq = strpos($pair, '=');
			if ($eq === false) {
				$cookies[$pair] = '';
			} else {
				$name = trim(substr($pair, 0, $eq));
				$value = trim(substr($pair, $eq + 1));
				$cookies[$name] = urldecode($value);
			}
		}
		return $cookies;
	}

	/**
	 * Check rate limit for a client IP. Returns true if allowed, false if over limit.
	 * Configured via Q.webserver.rateLimit:
	 *   { "enabled": true, "requests": 100, "window": 60, "burstRequests": 20, "burstWindow": 1 }
	 * @method checkRateLimit
	 * @static
	 * @param {string} $ip Client IP address
	 * @return {boolean} true if request is allowed
	 */
	static function checkRateLimit($ip)
	{
		if (!Q_Config::get('Q', 'webserver', 'rateLimit', 'enabled', false)) {
			return true;
		}
		$now = time();
		$maxReqs = Q_Config::get('Q', 'webserver', 'rateLimit', 'requests', 100);
		$window = Q_Config::get('Q', 'webserver', 'rateLimit', 'window', 60);
		$burstReqs = Q_Config::get('Q', 'webserver', 'rateLimit', 'burstRequests', 20);
		$burstWindow = Q_Config::get('Q', 'webserver', 'rateLimit', 'burstWindow', 1);

		// Clean old entries
		if (!isset(self::$rateLimitData[$ip])) {
			self::$rateLimitData[$ip] = array();
		}
		$hits = &self::$rateLimitData[$ip];
		$cutoff = $now - $window;
		$hits = array_filter($hits, function ($t) use ($cutoff) {
			return $t >= $cutoff;
		});

		// Check window limit
		if (count($hits) >= $maxReqs) {
			return false;
		}

		// Check burst limit
		$burstCutoff = $now - $burstWindow;
		$recent = array_filter($hits, function ($t) use ($burstCutoff) {
			return $t >= $burstCutoff;
		});
		if (count($recent) >= $burstReqs) {
			return false;
		}

		$hits[] = $now;

		// Periodic cleanup: remove IPs not seen in the last window
		if (mt_rand(0, 99) < 5) { // 5% chance per request
			foreach (self::$rateLimitData as $k => $v) {
				if (empty($v) || max($v) < $cutoff) {
					unset(self::$rateLimitData[$k]);
				}
			}
		}

		return true;
	}

	private static function resolveStatic($urlPath)
	{
		$rel = str_replace('/', DS, ltrim($urlPath, '/'));
		$fsPath = realpath(self::$rootDir . $rel);
		if (!$fsPath) return null;
		$fsPath = str_replace(array('/','\\'), DS, $fsPath);
		$root = rtrim(self::$rootDir, DS);
		if ($fsPath !== $root && strncmp($fsPath, self::$rootDir, strlen(self::$rootDir)) !== 0) {
			return null; // path traversal
		}
		return (is_dir($fsPath) || is_file($fsPath)) ? $fsPath : null;
	}

	private static function closeClient($key)
	{
		if (isset(self::$clientWatchers[$key])) {
			Q_Evented::cancel(self::$clientWatchers[$key]);
			unset(self::$clientWatchers[$key]);
		}
		if (isset(self::$timeoutWatchers[$key])) {
			Q_Evented::cancel(self::$timeoutWatchers[$key]);
			unset(self::$timeoutWatchers[$key]);
		}
		if (isset(self::$clients[$key])) {
			@fclose(self::$clients[$key]);
			unset(self::$clients[$key]);
		}
		unset(self::$buffers[$key], self::$clientInfo[$key],
			self::$keepAliveCount[$key]);
	}

	// ── State ────────────────────────────────────────────

	private static $socket = null;
	private static $tlsSocket = null;
	private static $tlsWatcher = null;
	private static $tlsPending = array();
	private static $httpsPort = 0;
	static $clients = array();
	static $clientWatchers = array();
	private static $buffers = array();
	private static $clientInfo = array();      // key => [ip, connectTime]
	private static $keepAliveCount = array();   // key => int
	private static $timeoutWatchers = array();  // key => evented timer id
	private static $acceptWatcher = null;
	private static $running = false;
	private static $lastStatus = 200;
	private static $lastBody = '';

	static $allowedExtensions = array(
		'html','htm','txt','md','json','xml','yaml','yml','csv','tsv','log',
		'css','js','mjs','map','wasm',
		'png','gif','webp','jpg','jpeg','svg','bmp','ico','avif',
		'woff','woff2','ttf','otf',
		'mp3','wav','ogg','mp4','webm',
		'pdf','zip'
	);
	private static $rateLimitData = array(); // ip => [timestamps]
}
