<?php

/**
 * @module Q
 */

/**
 * Fetches URLs that a user supplied (link previews, scraping, icons, CSS)
 * without letting the server be used to reach its own network.
 * Shared by every plugin that fetches such a URL; Websites_Fetch extends it.
 *
 * - only http and https, on the first hop and on every redirect;
 * - the host is resolved here, and the request is refused if ANY address it
 *   resolves to is loopback, private (RFC 1918, ULA), link-local, CGNAT
 *   shared space, multicast, reserved or otherwise not globally routable,
 *   IPv4-mapped / NAT64 / 6to4 IPv6 forms included;
 * - the connection is pinned to the address that was checked
 *   (CURLOPT_RESOLVE), so a second DNS answer cannot swap in another target
 *   (DNS rebinding), and the address curl actually used is compared after;
 * - redirects are followed here, one hop at a time, re-checking each target;
 * - TLS certificates are verified, and no proxy from the environment is used
 *   (a proxy would resolve the name itself, defeating the pin).
 *
 * @class Q_Fetch
 * @static
 */
class Q_Fetch
{
	/**
	 * Fetch a URL with the checks above.
	 * @method get
	 * @static
	 * @param {string} $url absolute http(s) URL
	 * @param {array} [$options]
	 * @param {integer} [$options.timeout=10] seconds, for each hop
	 * @param {integer} [$options.maxBytes=2097152] body bytes kept; the rest is not downloaded
	 * @param {integer} [$options.maxRedirects=5]
	 * @param {array} [$options.headers] extra request header lines, e.g. "Accept: text/html"
	 * @return {array} with keys
	 *   "url" (final URL, after redirects), "status" (integer, never 3xx),
	 *   "headers" (lowercased name => last value), "body" (string),
	 *   "truncated" (boolean), "ip" (the address connected to)
	 * @throws {Q_Exception_UnsafeUrl} if a hop is not allowed
	 * @throws {Q_Exception} on a transport error or too many redirects
	 */
	static function get($url, $options = array())
	{
		$timeout = (int)Q::ifset($options, 'timeout', 10);
		$maxBytes = (int)Q::ifset($options, 'maxBytes', 2097152);
		$maxRedirects = (int)Q::ifset($options, 'maxRedirects', 5);
		$extraHeaders = Q::ifset($options, 'headers', array());
		for ($hop = 0; $hop <= $maxRedirects; ++$hop) {
			$target = static::check($url);
			$response = static::_request($url, $target, $timeout, $maxBytes, $extraHeaders);
			$status = $response['status'];
			if ($status < 300 || $status >= 400) {
				unset($response['redirect']);
				return $response;
			}
			// A 3xx is never the resource: with no usable Location (none,
			// or a scheme curl will not resolve) it is a failure, not a
			// body to hand back as the file.
			if (empty($response['redirect'])) {
				throw new Q_Exception("Q_Fetch: HTTP $status without a usable Location");
			}
			$url = $response['redirect'];
		}
		throw new Q_Exception("Q_Fetch: more than $maxRedirects redirects");
	}

	/**
	 * Fetch a URL (as in get()) into a temporary file whose name keeps the
	 * URL's extension, so it can be handed to code that takes a path, such as
	 * Users::importIcon() or Streams::importIcon(), instead of a URL those
	 * would fetch themselves without these checks. The caller unlinks it.
	 * @method toTempFile
	 * @static
	 * @param {string} $url
	 * @param {array} [$options] as for get(); maxBytes defaults to 5MB here
	 * @return {string} path of the temporary file
	 */
	static function toTempFile($url, $options = array())
	{
		$options = array_merge(array('maxBytes' => 5242880), $options);
		$response = static::get($url, $options);
		if ($response['status'] !== 200 || $response['truncated']) {
			throw new Q_Exception("Q_Fetch: could not fetch the whole file");
		}
		$ext = strtolower(pathinfo((string)parse_url($response['url'], PHP_URL_PATH), PATHINFO_EXTENSION));
		$ext = preg_match('/^[a-z0-9]{1,8}$/', $ext) ? ".$ext" : '';
		$tmp = tempnam(sys_get_temp_dir(), 'Q_Fetch_');
		$path = $tmp . $ext;
		if ($ext && !rename($tmp, $path)) {
			@unlink($tmp);
			throw new Q_Exception("Q_Fetch: could not create a temporary file");
		}
		file_put_contents($path, $response['body']);
		return $path;
	}

	/**
	 * Check that a URL may be fetched, and pick the address to connect to.
	 * Does not fetch anything.
	 * @method check
	 * @static
	 * @param {string} $url
	 * @return {array} with keys "scheme", "host" (as in the URL, IPv6 without
	 *   brackets), "port", "ip" (the checked address to connect to)
	 * @throws {Q_Exception_UnsafeUrl}
	 */
	static function check($url)
	{
		$parts = is_string($url) ? parse_url($url) : false;
		$scheme = strtolower((string)Q::ifset($parts, 'scheme', ''));
		if ($scheme !== 'http' && $scheme !== 'https') {
			static::refuse($url, 'only http and https URLs are fetched');
		}
		$host = strtolower((string)Q::ifset($parts, 'host', ''));
		if ($host === '') {
			static::refuse($url, 'no host');
		}
		$port = (int)Q::ifset($parts, 'port', $scheme === 'https' ? 443 : 80);
		if ($host[0] === '[' && substr($host, -1) === ']') {
			$host = substr($host, 1, -1);
		}
		if (filter_var($host, FILTER_VALIDATE_IP)) {
			$ips = array($host);
		} else {
			// Only plain DNS names: anything else (all-numeric or hex hosts
			// such as 2130706433, 0x7f.1, 127.1) is an address that resolvers
			// and curl may each parse their own way.
			if (!preg_match('/^(?=.{1,253}\.?$)([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9])?)(\.[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9])?)*\.?$/', $host)
			or !preg_match('/[a-z_-]/', (string)preg_replace('/^.*\.(?=[^.]+\.?$)/', '', $host))
			or preg_match('/^0x[0-9a-f]*\.?$/', (string)preg_replace('/^.*\.(?=[^.]+\.?$)/', '', $host))) {
				static::refuse($url, 'the host is not a DNS name or IP address');
			}
			$ips = static::resolveHost(rtrim($host, '.'));
			if (!$ips) {
				static::refuse($url, 'the host does not resolve');
			}
		}
		foreach ($ips as $ip) {
			if (!self::isPublicIp($ip)) {
				static::refuse($url, 'the host resolves to a non-public address');
			}
		}
		// Prefer IPv4, which every deployment can route.
		$chosen = null;
		foreach ($ips as $ip) {
			if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
				$chosen = $ip;
				break;
			}
		}
		if ($chosen === null) {
			$chosen = reset($ips);
		}
		return array('scheme' => $scheme, 'host' => $host, 'port' => $port, 'ip' => $chosen);
	}

	/**
	 * Whether an address is globally routable unicast, i.e. not loopback,
	 * private, link-local, CGNAT, multicast, documentation, benchmarking or
	 * reserved space. IPv6 forms that embed an IPv4 address (IPv4-mapped,
	 * NAT64 64:ff9b::/96, 6to4 2002::/16) are judged by that address.
	 * @method isPublicIp
	 * @static
	 * @param {string} $ip
	 * @return {boolean}
	 */
	static function isPublicIp($ip)
	{
		$bin = @inet_pton((string)$ip);
		if ($bin === false) {
			return false;
		}
		if (strlen($bin) === 4) {
			return self::_isPublicIpv4($bin);
		}
		// IPv4-mapped ::ffff:a.b.c.d and NAT64 64:ff9b::a.b.c.d
		if (substr($bin, 0, 12) === str_repeat("\0", 10) . "\xff\xff"
		or substr($bin, 0, 12) === "\x00\x64\xff\x9b" . str_repeat("\0", 8)) {
			return self::_isPublicIpv4(substr($bin, 12, 4));
		}
		// 6to4 2002:a.b.c.d::/48
		if (substr($bin, 0, 2) === "\x20\x02") {
			return self::_isPublicIpv4(substr($bin, 2, 4));
		}
		// Global unicast is 2000::/3; everything else (::/8 incl. :: and ::1,
		// IPv4-compatible, fc00::/7, fe80::/10, ff00::/8, 100::/64, ...) is not.
		if ((ord($bin[0]) & 0xe0) !== 0x20) {
			return false;
		}
		foreach (array(
			'2001::/23',      // IETF protocol assignments, incl. Teredo 2001::/32
			'2001:db8::/32',  // documentation
			'3fff::/20',      // documentation
		) as $cidr) {
			if (self::_inCidr($bin, $cidr)) {
				return false;
			}
		}
		return true;
	}

	/**
	 * The addresses a host name resolves to (A and AAAA). Overridden in tests.
	 * @method resolveHost
	 * @static
	 * @protected
	 * @param {string} $host
	 * @return {array} of address strings, empty if it does not resolve
	 */
	protected static function resolveHost($host)
	{
		$ips = array();
		$v4 = @gethostbynamel($host);
		if (is_array($v4)) {
			$ips = $v4;
		}
		$v6 = function_exists('dns_get_record') ? @dns_get_record($host, DNS_AAAA) : false;
		if (is_array($v6)) {
			foreach ($v6 as $record) {
				if (!empty($record['ipv6'])) {
					$ips[] = $record['ipv6'];
				}
			}
		}
		return array_values(array_unique($ips));
	}

	/**
	 * The address curl is told to connect to for a checked host. The checked
	 * address itself; overridden only in tests, to reach a local stub server
	 * standing in for a public host.
	 * @method connectIp
	 * @static
	 * @protected
	 * @param {string} $host
	 * @param {string} $ip the address check() approved
	 * @return {string}
	 */
	protected static function connectIp($host, $ip)
	{
		return $ip;
	}

	protected static function _request($url, $target, $timeout, $maxBytes, $extraHeaders)
	{
		$ip = static::connectIp($target['host'], $target['ip']);
		$ch = curl_init();
		$opts = array(
			CURLOPT_URL => $url,
			CURLOPT_FOLLOWLOCATION => false,
			CURLOPT_CONNECTTIMEOUT => $timeout,
			CURLOPT_TIMEOUT => $timeout,
			CURLOPT_SSL_VERIFYPEER => true,
			CURLOPT_SSL_VERIFYHOST => 2,
			CURLOPT_PROXY => '',
			CURLOPT_NOPROXY => '*',
			CURLOPT_ENCODING => '',
			CURLOPT_USERAGENT => static::userAgent(),
			CURLOPT_HTTPHEADER => array_values((array)$extraHeaders),
		);
		if (defined('CURLOPT_PROTOCOLS_STR')) {
			$opts[CURLOPT_PROTOCOLS_STR] = 'http,https';
		} else {
			$opts[CURLOPT_PROTOCOLS] = CURLPROTO_HTTP | CURLPROTO_HTTPS;
		}
		if (!filter_var($target['host'], FILTER_VALIDATE_IP)) {
			$pin = filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) ? "[$ip]" : $ip;
			$opts[CURLOPT_RESOLVE] = array($target['host'] . ':' . $target['port'] . ':' . $pin);
		}
		$headers = array();
		$body = '';
		$truncated = false;
		$opts[CURLOPT_HEADERFUNCTION] = function ($ch, $line) use (&$headers) {
			$trimmed = trim($line);
			if (preg_match('#^HTTP/\S+\s+\d{3}#', $trimmed)) {
				$headers = array(); // a new response (after 100 Continue)
			} else if (($pos = strpos($trimmed, ':')) !== false) {
				$headers[strtolower(trim(substr($trimmed, 0, $pos)))] = trim(substr($trimmed, $pos + 1));
			}
			return strlen($line);
		};
		$opts[CURLOPT_WRITEFUNCTION] = function ($ch, $chunk) use (&$body, &$truncated, $maxBytes) {
			$room = $maxBytes - strlen($body);
			if ($room <= 0) {
				$truncated = true;
				return 0; // abort: CURLE_WRITE_ERROR, handled below
			}
			$body .= substr($chunk, 0, $room);
			if (strlen($chunk) > $room) {
				$truncated = true;
				return 0;
			}
			return strlen($chunk);
		};
		curl_setopt_array($ch, $opts);
		curl_exec($ch);
		$errno = curl_errno($ch);
		$error = curl_error($ch);
		$status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
		$redirect = (string)curl_getinfo($ch, CURLINFO_REDIRECT_URL);
		$primaryIp = (string)curl_getinfo($ch, CURLINFO_PRIMARY_IP);
		curl_close($ch);
		if ($errno && !($truncated && $errno === CURLE_WRITE_ERROR)) {
			throw new Q_Exception("Q_Fetch: $error");
		}
		if ($primaryIp !== '' && @inet_pton($primaryIp) !== @inet_pton($ip)) {
			// belt and braces: the pin above should make this impossible
			static::refuse($url, 'connected to an address other than the one checked');
		}
		return array(
			'url' => $url,
			'status' => $status,
			'headers' => $headers,
			'body' => $body,
			'truncated' => $truncated,
			'ip' => $primaryIp !== '' ? $primaryIp : $ip,
			'redirect' => $redirect
		);
	}

	private static function _isPublicIpv4($bin)
	{
		foreach (array(
			'0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8',
			'169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24',
			'192.88.99.0/24', '192.168.0.0/16', '198.18.0.0/15',
			'198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4'
		) as $cidr) {
			if (self::_inCidr($bin, $cidr)) {
				return false;
			}
		}
		return true;
	}

	private static function _inCidr($bin, $cidr)
	{
		list($net, $bits) = explode('/', $cidr);
		$netBin = inet_pton($net);
		if (strlen($netBin) !== strlen($bin)) {
			return false;
		}
		$bits = (int)$bits;
		$bytes = intdiv($bits, 8);
		if (substr($bin, 0, $bytes) !== substr($netBin, 0, $bytes)) {
			return false;
		}
		$rest = $bits % 8;
		if ($rest === 0) {
			return true;
		}
		$mask = (0xff << (8 - $rest)) & 0xff;
		return (ord($bin[$bytes]) & $mask) === (ord($netBin[$bytes]) & $mask);
	}

	/**
	 * The User-Agent sent with each request.
	 * @method userAgent
	 * @static
	 * @protected
	 * @return {string}
	 */
	protected static function userAgent()
	{
		return Q_Config::get('Q', 'fetch', 'userAgent', 'Mozilla/5.0 (compatible; Qbix)');
	}

	/**
	 * Throw the exception that refuses a URL. The specific reason is logged
	 * and kept in the exception's $reason property, but left out of its
	 * message and params, which reach the client: "does not resolve" versus
	 * "non-public address" would tell a member which internal host names
	 * exist.
	 * @method refuse
	 * @static
	 * @protected
	 * @param {string} $url
	 * @param {string} $reason
	 * @throws {Q_Exception_UnsafeUrl}
	 */
	protected static function refuse($url, $reason)
	{
		$url = is_string($url) ? $url : gettype($url);
		try {
			Q::log(get_called_class() . " refused $url: $reason", 'Q_Fetch');
		} catch (Throwable $e) {
			// logging must not turn a refusal into a different error
		}
		$class = static::exceptionClass();
		$e = new $class(array('url' => $url));
		$e->reason = $reason;
		throw $e;
	}

	/**
	 * The class refuse() throws: Q_Exception_UnsafeUrl or a subclass of it.
	 * @method exceptionClass
	 * @static
	 * @protected
	 * @return {string}
	 */
	protected static function exceptionClass()
	{
		return 'Q_Exception_UnsafeUrl';
	}
}
