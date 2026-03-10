<?php

/**
 * @module Q
 */

/**
 * Methods for working with links
 * @class Q_Uri
 * @constructor
 */
class Q_Links
{
	protected function __construct()
	{
		
	}

	/**
	 * Generates a link for sending an sms message
	 * @static
	 * @method sms
	 * @param {string} [$body]
	 *   SMS message body.
	 * @param {string|Array} [$mobileNumbers]
	 *   Recipient number or array of numbers.
	 * @return {string}
	 *   An `sms:` URI.
	 */
	static function sms ($body, $mobileNumbers = null)
	{
		$ios = (Q_Request::platform() === 'ios');
		if ($mobileNumbers && is_array($mobileNumbers)) {
			$temp = array();
			foreach ($mobileNumbers as $m) {
				$temp[] = rawurlencode($m);
			}
			$mobileNumbers = ($ios ? '/open?addresses=' : '') . implode(',', $temp);
		}
		$url = "sms:" . ($mobileNumbers ? $mobileNumbers : ($ios ? '%20' : ''));
		$char = $ios ? '&' : '?';
		return $url . $char . http_build_query(@compact('body'), '', '&', PHP_QUERY_RFC3986);
	}

	/**
	 * Generates a link for sending an email message
	 * @static
	 * @method email
	 * @param {string} [$subject]
	 *   Email subject.
	 * @param {string} [$body]
	 *   Email body text.
	 * @param {string|Array} [$to]
	 *   Recipient email address or array of addresses.
	 * @param {string|Array} [$cc]
	 *   CC email address or array of addresses.
	 * @param {string|Array} [$bcc]
	 *   BCC email address or array of addresses.
	 * @return {string}
	 *   A `mailto:` URI.
	 */
	static function email ($subject, $body, $to = null, $cc = null, $bcc = null)
	{
		$ios = (Q_Request::platform() === 'ios');
		$to = $to && is_array($to) ? implode(',', $to) : $to;
		$cc = $cc && is_array($cc) ? implode(',', $cc) : $cc;
		$bcc = $bcc && is_array($bcc) ? implode(',', $bcc) : $bcc;
		$names = array('cc', 'bcc', 'subject', 'body');
		$parts = array($cc, $bcc, $subject, $body);
		$url = "mailto:" . ($to ? $to : '');
		$char = '?';
		foreach ($names as $i => $name) {
			if ($p = $parts[$i]) {
				$url .= $char . $name . '=' . ($i >= 2 ? rawurlencode($p) : $p);
				$char = '&';
			}
		}
		return $url;
	}

	/**
	 * Generates a link for opening a WhatsApp chat to a number
	 * with an optional pre-filled message.
	 *
	 * @static
	 * @method whatsApp
	 * @param {string} [$phoneNumber]
	 *   Phone number including country code, without "+".
	 * @param {string} [$text]
	 *   Text message to prefill.
	 * @return {string}
	 *   A `whatsapp://` deep link.
	 */
	static function whatsApp ($phoneNumber, $text = null)
	{
		return 'whatsapp://send/?phone=' . $phoneNumber
			. ($text ? '&' . http_build_query(@compact('text'), '', '&', PHP_QUERY_RFC3986) : '');
	}

	/**
	 * Generates Telegram deep links for messaging, bots, channels, and actions.
	 * See: https://core.telegram.org/api/links#group-channel-bot-links
	 *
	 * @method telegram
	 * @static
	 * @param {string} [$to]
	 *   Phone number with country code (e.g. "+1") or username beginning with "@".
	 *   If omitted, Telegram will open with share options.
	 * @param {string} [$text]
	 *   Text to send or share.
	 * @param {array} [$options]
	 *   Optional Telegram parameters.
	 * @param {string} [$options['action']]
	 *   Scheduled action such as `voicechat`, `videochat`, or `livestream`.
	 * @param {string} [$options['actionValue']]
	 *   Invite hash associated with the action.
	 * @param {string} [$options['url']]
	 *   URL to share alongside the text.
	 * @param {string} [$options['start']]
	 * @param {string} [$options['startgroup']]
	 * @param {string} [$options['startchannel']]
	 * @param {string} [$options['startapp']]
	 * @param {string} [$options['admin']]
	 * @param {string} [$options['appname']]
	 * @param {string} [$options['startattach']]
	 * @param {string|array} [$options['choose']]
	 *   One or more of `"users"`, `"bots"`, `"groups"`, `"channels"`.
	 * @param {string} [$options['attach']]
	 *   Bot to attach to a chat.
	 * @param {string} [$options['game']]
	 *   Telegram game short name.
	 * @return {string}
	 *   The generated `tg://` deep link.
	 */
	static function telegram ($to = null, $text = null, $options = array()) {

		$urlParams = array();

		if (!$to) {
			$command = 'msg';
			if (!empty($options['url'])) {
				array_unshift($urlParams, 'url=' . urlencode($options['url']));
				$command = 'msg_url';
			}
			if ($text) {
				$urlParams[] = 'text=' . urlencode($text);
			}
			return 'tg://' . $command . '?' . implode('&', $urlParams);
		}

		$where = ($to[0] === '@' ? 'domain=' . substr($to, 1) : 'phone=' . $to);

		if (!empty($options['action'])) {
			$v = !empty($options['actionValue']) ? ('=' . urlencode($options['actionValue'])) : '';
			return 'tg://resolve?' . $where . '&' . $options['action'] . $v;
		}

		$botcommands = false;
		$keys = ['start', 'startgroup', 'startchannel', 'admin', 'startapp', 'appname', 'startattach', 'game'];

		foreach ($keys as $k) {
			if (!empty($options[$k])) {
				$botcommands = true;
				$urlParams[] = $k . '=' . urlencode($options[$k]);
			}
		}

		if (!empty($options['choose'])) {
			$botcommands = true;
			if (is_array($options['choose'])) {
				$options['choose'] = implode('+', $options['choose']);
			}
			$urlParams[] = 'choose=' . $options['choose'];
		}

		if ($botcommands) {
			return 'tg://resolve?' . $where . '&' . implode('&', $urlParams);
		}

		$urlParams[] = 'to=' . $to;

		if ($text) {
			$urlParams[] = 'text=' . urlencode($text);
		}

		return 'tg://msg?' . implode('&', $urlParams);
	}

	/**
	 * Generates a link for sharing on X (Twitter) or composing a DM.
	 *
	 * If `$options['recipientId']` is provided, opens a DM compose window.
	 * Otherwise opens the tweet composer.
	 *
	 * @static
	 * @method twitter
	 * @param {string} [$text]
	 *   Tweet text or DM text.
	 * @param {string} [$url]
	 *   URL to include in the tweet.
	 * @param {array} [$options]
	 * @param {string|array} [$options['hashtags']]
	 *   One or more hashtags without "#".
	 * @param {string} [$options['via']]
	 *   Twitter username to attribute the tweet to.
	 * @param {string|int} [$options['recipientId']]
	 *   If provided, opens a DM compose window to this user ID.
	 * @return {string}
	 *   Twitter/X intent URL.
	 */
	static function twitter($text = null, $url = null, $options = array())
	{
		if (!empty($options['recipientId'])) {
			$urlDm = 'https://twitter.com/messages/compose?recipient_id=' . $options['recipientId'];
			if ($text) {
				$urlDm .= '&text=' . rawurlencode($text);
			}
			return $urlDm;
		}

		$params = array();

		if ($text) $params['text'] = $text;
		if ($url) $params['url'] = $url;

		if (!empty($options['hashtags'])) {
			$hashtags = $options['hashtags'];
			if (is_array($hashtags)) {
				$hashtags = implode(',', $hashtags);
			}
			$params['hashtags'] = $hashtags;
		}

		if (!empty($options['via'])) {
			$params['via'] = $options['via'];
		}

		return 'https://twitter.com/intent/tweet?' .
			http_build_query($params, '', '&', PHP_QUERY_RFC3986);
	}

	/**
	 * Generates a link for sharing content via Skype.
	 *
	 * @static
	 * @method skype
	 * @param {string} [$text]
	 *   Text to share.
	 * @param {string} [$url]
	 *   URL to share.
	 * @return {string}
	 *   Skype share URL.
	 */
	static function skype ($text, $url = null)
	{
		$params = array();

		if ($text) {
			$params['text'] = $text;
		}
		if ($url) {
			$params['url'] = $url;
		}

		return 'https://web.skype.com/share?' .
			http_build_query($params, '', '&', PHP_QUERY_RFC3986);
	}

	/**
	 * Generates a link for opening a URL in Android Chrome.
	 *
	 * @static
	 * @method androidChrome
	 * @param {string} [$url]
	 *   URL to open.
	 * @return {string}
	 *   `googlechrome://` URI.
	 */
	static function androidChrome ($url)
	{
		return 'googlechrome://navigate?url=' . $url;
	}

	/**
	 * Generates a link to open a dapp in MetaMask mobile.
	 *
	 * @static
	 * @method metamask
	 * @param {string} $dappUrl
	 *   URL of the decentralized application.
	 * @return {string}
	 *   MetaMask deep link.
	 */
	static function metamask($dappUrl)
	{
		$dappUrl = $dappUrl ?: '';
		$url = preg_replace('#^https?://#', '', $dappUrl);
		return 'https://metamask.app.link/dapp/' . $url;
	}

	/**
	 * Generates a link to open a dapp in Trust Wallet.
	 *
	 * @static
	 * @method trustWallet
	 * @param {string} $dappUrl
	 *   URL of the decentralized application.
	 * @return {string}
	 *   Trust Wallet deep link.
	 */
	static function trustWallet($dappUrl)
	{
		return 'trust://open_url?url=' . rawurlencode($dappUrl);
	}

	/**
	 * Generates a link to open a dapp in Coinbase Wallet.
	 *
	 * @static
	 * @method coinbaseWallet
	 * @param {string} $dappUrl
	 *   URL of the decentralized application.
	 * @return {string}
	 *   Coinbase Wallet deep link.
	 */
	static function coinbaseWallet($dappUrl)
	{
		return 'https://go.cb-w.com/dapp?cb_url=' . rawurlencode($dappUrl);
	}

	/**
	 * Generates a link to open a dapp in Rainbow wallet.
	 *
	 * @static
	 * @method rainbow
	 * @param {string} $dappUrl
	 *   URL of the decentralized application.
	 * @return {string}
	 *   Rainbow wallet deep link.
	 */
	static function rainbow($dappUrl)
	{
		return 'rainbow://open?url=' . rawurlencode($dappUrl);
	}

	/**
	 * Generates an Ethereum payment URI (EIP-681).
	 *
	 * @static
	 * @method ethereumPay
	 * @param {string} $address
	 *   Ethereum address or contract.
	 * @param {array} [$options]
	 * @param {string|int} [$options['value']]
	 *   Amount of ETH or token.
	 * @param {string|int} [$options['gas']]
	 *   Gas price.
	 * @param {string|int} [$options['gasLimit']]
	 *   Gas limit.
	 * @param {string|int} [$options['chainId']]
	 *   Chain ID.
	 * @return {string}
	 *   `ethereum:` payment URI.
	 */
	static function ethereumPay($address, $options = array())
	{
		$url = 'ethereum:' . $address;
		$params = array();

		foreach (array('value','gas','gasLimit','chainId') as $k) {
			if (isset($options[$k])) {
				$params[$k] = $options[$k];
			}
		}

		if ($params) {
			$url .= '?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986);
		}

		return $url;
	}

	/**
	 * Extends Q_Links with custom method names, e.g. named after an external platform or app
	 * @static
	 * @method __callStatic
	 * @param {string} $name Key found under Q/Links/ config.
	 *   The config under this could be either "method": ["MyClass", "myMethod"] or "pattern": "myapp://foo?{{bar}}=baz"
	 * @param {array} [$arguments] The first argument can be an array of named parameters,
	 *   to either pass to the method, or interpolate into the pattern
	 * @return {string}
	 */
	static function __callStatic ($name, $arguments)
	{
		$params = $arguments ? reset($arguments) : $arguments;
		$method = Q_Config::get('Q', 'Links', $name, 'method', null);
		if (!$method) {
			$template = Q_Config::expect('Q', 'Links', $name, 'pattern');
			return Q::interpolate($template, $params);
		}
		if (!is_callable($method)) {
			throw new Q_Exception_MissingFunction(array(
				'function_name' => $method
			));
			return call_user_func($method, $params);
		}
	}
}