<?php

/**
 * @module Q
 */
/**
 * Front controller for embeddable tools. Renders a single tool in an
 * iframe-friendly response, with optional origin validation against a
 * per-host registration. Designed to be hit from third-party domains
 * at /embed.php.
 *
 * If Q/embed/hosts config is empty, embeds are allowed from any origin
 * (open mode, useful for development). If config has entries, the host
 * key must match one of them, and the registered origin is enforced via
 * CSP and postMessage validation.
 *
 * @class Q_EmbedController
 */
class Q_EmbedController
{
	/**
	 * @method execute
	 * @static
	 */
	static function execute($url = null)
	{
		if (isset($_SERVER['HTTP_X_REWRITE_URL'])) {
			$_SERVER['REQUEST_URI'] = $_SERVER['HTTP_X_REWRITE_URL'];
		}

		if (!isset(Q::$controller)) {
			Q::$controller = 'Q_EmbedController';
		}

		try {
			// Validate the tool parameter against an allowlist.
			$tool = Q_Request::special('tool', null);
			if (!$tool) {
				throw new Q_Exception("Q_EmbedController: missing tool parameter");
			}
			$allowedTools = Q_Config::get('Q', 'embed', 'tools', array());
			if (!in_array($tool, $allowedTools)) {
				throw new Q_Exception("Q_EmbedController: tool not in allowlist: $tool");
			}

			// Optional host origin validation.
			$hosts = Q_Config::get('Q', 'embed', 'hosts', array());
			$expectedParentOrigin = null;
			if (!empty($hosts)) {
				// Allowlist configured: require host param to match
				$hostKey = Q_Request::special('host', null);
				if (!$hostKey) {
					throw new Q_Exception("Q_EmbedController: missing host parameter");
				}
				if (empty($hosts[$hostKey]) || empty($hosts[$hostKey]['origin'])) {
					throw new Q_Exception("Q_EmbedController: host not registered: $hostKey");
				}
				$expectedParentOrigin = $hosts[$hostKey]['origin'];
			}

			// If we have an expected origin, enforce it via CSP and stamp
			// it into Q.info for the client-side postMessage listener.
			if ($expectedParentOrigin) {
				Q_Response::setScriptData(
					'Q.info.expectedParentOrigin',
					$expectedParentOrigin
				);
				header("Content-Security-Policy: frame-ancestors $expectedParentOrigin");
			}

			// Map tool -> module/action. "Streams/chat" -> module=Streams, action=embed_chat
			$parts = explode('/', $tool, 2);
			if (count($parts) !== 2) {
				throw new Q_Exception("Q_EmbedController: malformed tool id: $tool");
			}
			$module = $parts[0];
			$action = 'embed_' . $parts[1];

			$uri = Q_Uri::from(compact('module', 'action'));
			Q_Dispatcher::dispatch($uri);

		} catch (Exception $exception) {
			Q::event('Q/exception', compact('exception'));
		}
	}
}