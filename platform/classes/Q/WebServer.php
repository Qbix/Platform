<?php

class Q_WebServer
{
	/**
	 * Start the web server.
	 *
	 * @method start
	 * @static
	 * @param {string} $dir  Document root
	 * @param {string} $host e.g. "127.0.0.1"
	 * @param {int}    $port e.g. 8080
	 */
	static function start($dir, $host = '0.0.0.0', $port = 8080)
	{
		if (self::$running) {
			throw new Exception("Q_WebServer already running");
		}

		if ($extensions = Q_Config::get('Q', 'webserver', 'extensions', null)) {
			self::$allowedExtensions = $extensions;
		}

		$max = self::$maxListingImages = (int) Q_Config::get(
			'Q', 'webserver', 'listing', 'images', 'max'
		);
		if (!$max) {
			$max = self::$maxListingImages = 100;
		}

		$root = realpath($dir);
		if (!$root || !is_dir($root)) {
			throw new Exception("Invalid document root");
		}

		self::$rootDir = rtrim(self::normalizePath($root), DS) . DS;

		$errno = 0;
		$errstr = '';

		self::$socket = stream_socket_server(
			"tcp://{$host}:{$port}",
			$errno,
			$errstr,
			STREAM_SERVER_BIND | STREAM_SERVER_LISTEN
		);

		if (!self::$socket) {
			throw new Exception("WebServer error: $errstr");
		}

		stream_set_blocking(self::$socket, false);
		self::$running = true;
	}

	/**
	 * Stop the web server.
	 * @method stop
	 * @static
	 */
	static function stop()
	{
		self::$running = false;

		foreach (self::$clients as $c) {
			@fclose($c);
		}
		self::$clients = array();

		if (self::$socket) {
			@fclose(self::$socket);
			self::$socket = null;
		}
	}

	/**
	 * Run the server loop using stream_select (no busy waiting).
	 *
	 * @param {int|null} $timeoutSec  Seconds to wait (null = block forever)
	 * @param {int|null} $timeoutUsec Microseconds
	 */
	static function run($timeoutSec = null, $timeoutUsec = null)
	{
		if (!self::$running) return;

		while (self::$running) {
			self::tick($timeoutSec, $timeoutUsec);
		}
	}


	/**
	 * Process one event loop iteration.
	 * @method tick
	 * @static
	 */
	static function tick()
	{
		if (!self::$running) return;

		$read = array_merge(array(self::$socket), self::$clients);
		$write = null;
		$except = null;

		$n = @stream_select($read, $write, $except, null);
		if ($n === false) return;

		foreach ($read as $sock) {

			// New connection
			if ($sock === self::$socket) {
				$client = @stream_socket_accept(self::$socket, 0);
				if ($client) {
					stream_set_blocking($client, false);
					self::$clients[(int)$client] = $client;
				}
				continue;
			}

			// Existing client
			$raw = self::readRequest($sock);
			if ($raw === null) {
				@fclose($sock);
				unset(self::$clients[(int)$sock]);
				continue;
			}

			self::handleRequest($sock, $raw);

			@fclose($sock);
			unset(self::$clients[(int)$sock]);
		}
	}

	/**
	 * Read full HTTP request headers.
	 */
	private static function readRequest($sock)
	{
		$buf = '';
		while (true) {
			$chunk = @fread($sock, 8192);
			if ($chunk === false || $chunk === '') {
				return null;
			}
			$buf .= $chunk;
			if (strpos($buf, "\r\n\r\n") !== false) {
				return $buf;
			}
			if (strlen($buf) > 65536) {
				return null;
			}
		}
	}

	/**
	 * Handle a single HTTP request.
	 */
	private static function handleRequest($client, $raw)
	{
		if (!preg_match('#^(GET|HEAD)\s+([^\s]+)#', $raw, $m)) {
			self::send($client, 400, "Bad Request");
			return;
		}

		$method = $m[1];
		$url    = $m[2];

		$headers = self::parseHeaders($raw);

		$parsed = parse_url($url);
		$urlPath = isset($parsed['path']) ? urldecode($parsed['path']) : '/';
		$urlPath = '/' . ltrim($urlPath, '/');
		$urlPath = preg_replace('#/+#', '/', $urlPath);

		$fsPath = realpath(self::$rootDir . str_replace('/', DS, ltrim($urlPath, '/')));
		$fsPath = $fsPath ? self::normalizePath($fsPath) : null;

		if (
			!$fsPath ||
			strncmp($fsPath . DS, self::$rootDir, strlen(self::$rootDir)) !== 0
		) {
			self::send($client, 404, "Not Found");
			return;
		}

		// Directory handling
		if (is_dir($fsPath)) {

			if (substr($urlPath, -1) !== '/') {
				self::sendRedirect($client, $urlPath . '/');
				return;
			}

			$index = $fsPath . DS . 'index.html';
			if (is_file($index)) {
				clearstatcache(true, $index);
				self::send(
					$client,
					200,
					$method === 'HEAD' ? '' : file_get_contents($index),
					'text/html',
					['Cache-Control' => 'public, max-age=0, must-revalidate']
				);
				return;
			}

			self::send(
				$client,
				200,
				$method === 'HEAD' ? '' : self::renderDirectoryListing($fsPath, $urlPath),
				'text/html',
				['Cache-Control' => 'no-store']
			);
			return;
		}

		if (!is_file($fsPath)) {
			self::send($client, 404, "Not Found");
			return;
		}

		$ext = strtolower(pathinfo($fsPath, PATHINFO_EXTENSION));
		if (!in_array($ext, self::$allowedExtensions)) {
			self::send($client, 403, "Forbidden");
			return;
		}

		clearstatcache(true, $fsPath);

		$mtime = filemtime($fsPath);
		$size  = filesize($fsPath);
		$etag  = '"' . dechex($mtime) . '-' . dechex($size) . '"';

		if (
			isset($headers['if-none-match']) &&
			trim($headers['if-none-match']) === $etag
		) {
			self::sendNotModified($client, $etag, $mtime);
			return;
		}

		if (isset($headers['if-modified-since'])) {
			$since = strtotime($headers['if-modified-since']);
			if ($since !== false && $mtime <= $since) {
				self::sendNotModified($client, $etag, $mtime);
				return;
			}
		}

		self::sendFile(
			$client,
			$fsPath,
			$ext,
			$etag,
			$mtime,
			$method === 'HEAD'
		);
	}

	/**
	 * Stream a file response.
	 */
	private static function sendFile($client, $path, $ext, $etag, $mtime, $headOnly)
	{
		$size = filesize($path);

		fwrite($client,
			"HTTP/1.1 200 OK\r\n" .
			"Content-Type: " . Q_Utils::mimeType($ext) . "\r\n" .
			"Content-Length: $size\r\n" .
			"ETag: $etag\r\n" .
			"Last-Modified: " . gmdate('D, d M Y H:i:s', $mtime) . " GMT\r\n" .
			"Cache-Control: public, max-age=0, must-revalidate\r\n" .
			"Connection: close\r\n\r\n"
		);

		if ($headOnly) return;

		$fh = @fopen($path, 'rb');
		while (!feof($fh)) {
			fwrite($client, fread($fh, 8192));
		}
		fclose($fh);
	}

	/**
	 * Send a generic response.
	 */
	private static function send($client, $status, $body, $type = 'text/plain', $headers = array())
	{
		$map = array(
			200 => 'OK',
			301 => 'Moved Permanently',
			304 => 'Not Modified',
			400 => 'Bad Request',
			403 => 'Forbidden',
			404 => 'Not Found'
		);

		$reason = isset($map[$status]) ? $map[$status] : 'OK';
		$body   = (string)$body;

		$out =
			"HTTP/1.1 $status $reason\r\n" .
			"Content-Type: $type\r\n" .
			"Content-Length: " . strlen($body) . "\r\n" .
			"Connection: close\r\n";

		foreach ($headers as $k => $v) {
			$out .= "$k: $v\r\n";
		}

		$out .= "\r\n" . $body;
		fwrite($client, $out);
	}

	private static function sendRedirect($client, $location)
	{
		fwrite($client,
			"HTTP/1.1 301 Moved Permanently\r\n" .
			"Location: $location\r\n" .
			"Content-Length: 0\r\n" .
			"Connection: close\r\n\r\n"
		);
	}

	private static function sendNotModified($client, $etag, $mtime)
	{
		fwrite($client,
			"HTTP/1.1 304 Not Modified\r\n" .
			"ETag: $etag\r\n" .
			"Last-Modified: " . gmdate('D, d M Y H:i:s', $mtime) . " GMT\r\n" .
			"Cache-Control: public, max-age=0, must-revalidate\r\n" .
			"Content-Length: 0\r\n" .
			"Connection: close\r\n\r\n"
		);
	}

	/**
	 * Render a directory listing with image preview section.
	 */
	static function renderDirectoryListing($dir, $urlPath)
	{
		$items = scandir($dir);
		$rows = array();
		$images = array();

		if ($urlPath !== '/') {
			$rows[] =
				'<li><a href="../">&lt; One Level Up</a></li>';
		}

		// Previewable media extensions
		$imageExts = array('png', 'jpg', 'jpeg', 'gif', 'webp', 'svg');
		$videoExts = array('mp4', 'webm', 'ogg');
		$audioExts = array('mp3', 'wav', 'ogg');

		foreach ($items as $name) {
			if ($name === '.' || $name === '..') continue;

			$full = $dir . DS . $name;

			if (is_dir($full)) {
				$rows[] =
					'<li>&#128193; <a href="' . htmlspecialchars($urlPath . $name . '/') . '">' .
					htmlspecialchars($name) . '/</a></li>';
				continue;
			}

			$ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
			if (!in_array($ext, self::$allowedExtensions)) continue;

			$rows[] =
				'<li>&#128196; <a href="' . htmlspecialchars($urlPath . $name) . '">' .
				htmlspecialchars($name) . '</a></li>';

			if (
				in_array($ext, $imageExts) ||
				in_array($ext, $videoExts) ||
				in_array($ext, $audioExts)
			) {
				if (count($images) < self::$maxListingImages) {
					$href = htmlspecialchars($urlPath . $name);
					$caption = htmlspecialchars($name);

					if (in_array($ext, $imageExts)) {
						$media =
							'<a href="' . $href . '">' .
								'<img src="' . $href . '" loading="lazy">' .
							'</a>';
					} elseif (in_array($ext, $videoExts)) {
						$media =
							'<video src="' . $href . '" controls preload="metadata">' .
								'<a href="' . $href . '">' . $caption . '</a>' .
							'</video>';
					} else { // audio
						$media =
							'<audio src="' . $href . '" controls preload="metadata">' .
								'<a href="' . $href . '">' . $caption . '</a>' .
							'</audio>';
					}

					$images[] =
						'<div class="image-item">' .
							$media .
							'<div class="caption">' . $caption . '</div>' .
						'</div>';
				}
			}

		}

		sort($rows);

		$html =
			"<!doctype html>\n<html><head>\n<meta charset=\"utf-8\">\n" .
			"<title>Index of " . htmlspecialchars($urlPath) . "</title>\n" .
			"<style>
				body { font-family: sans-serif; padding: 1em; }
				ul { list-style: none; padding-left: 0; }
				li { margin: 0.25em 0; }
			</style>\n</head><body>\n" .
			"<h1>Index of " . htmlspecialchars($urlPath) . "</h1>\n" .
			"<ul>\n" . implode("\n", $rows) . "\n</ul>\n";

		if ($images) {
			$html .= <<<HTML
	<hr>
	<style>
		.image-grid {
			display: flex;
			flex-wrap: wrap;
			align-items: end;
			gap: 12px;
		}

		.image-item {
			text-align: center;
			max-width: 200px;
		}

		.image-item img {
			max-width: 200px;
			height: auto;
			display: block;
			margin: 0 auto 6px;
		}

		.image-item video,
		.image-item audio {
			max-width: 200px;
			display: block;
			margin: 0 auto 6px;
		}

		.image-item video {
			max-height: 200px;
		}

		.image-item .caption {
			font-size: 12px;
			word-break: break-all;
		}
	</style>
	<div class="image-grid">
HTML;
			$html .= implode("\n", $images);
			$html .= "\n</div>\n";
		}


		return $html . "</body></html>";
	}

	private static function parseHeaders($raw)
	{
		$headers = array();
		$lines = explode("\r\n", $raw);
		array_shift($lines); // request line

		foreach ($lines as $line) {
			if ($line === '') break;
			if (strpos($line, ':') === false) continue;
			list($k, $v) = explode(':', $line, 2);
			$headers[strtolower(trim($k))] = trim($v);
		}
		return $headers;
	}

	private static function normalizePath($path)
	{
		$path = str_replace(['/', '\\'], DS, $path);
		return rtrim($path, DS);
	}

	private static $socket = null;
	private static $clients = array();
	private static $running = false;
	private static $rootDir;
	private static $maxListingImages = 100;

	static $allowedExtensions = array(
		// Markup / text
		'html', 'htm',
		'txt', 'md', 'markdown',
		'json', 'xml', 'yaml', 'yml',
		'csv', 'tsv',
		'log',

		// Styles / scripts
		'css',
		'js', 'mjs',
		'map',

		// Images
		'png',
		'gif',
		'webp',
		'jpg', 'jpeg',
		'svg',
		'bmp',
		'ico',

		// Fonts (often useful to eyeball)
		'woff', 'woff2',
		'ttf', 'otf',

		// Media (safe for inspection)
		'mp3', 'wav', 'ogg',
		'mp4', 'webm',

		// Data / misc
		'pdf'
	);

}