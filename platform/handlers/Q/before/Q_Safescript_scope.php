<?php

/**
 * SafeScript scope hooks for Qbix plugins.
 *
 * Each plugin listens to Q/SafeScript/scope {before} and injects
 * its capabilities into the scope. SafeScript code running via
 * Q_SafeScript::run() or Q_SafeScript::runFile() gets these
 * automatically — no manual scope building required.
 *
 * Drop each handler into the plugin's handlers/ directory at the
 * conventional path: handlers/Q/SafeScript/scope.php
 *
 * Or register in the plugin's config:
 *   "Q/SafeScript/scope": {"handlers": ["Users_before_Q_SafeScript_scope"]}
 */


// ═══════════════════════════════════════════════════════════════════
// Q plugin — base platform capabilities
// File: platform/handlers/Q/before/Q/SafeScript/scope.php
// ═══════════════════════════════════════════════════════════════════

function Q_before_Q_SafeScript_scope($params)
{
	$scope = &$params['scope'];

	// Config access (read-only)
	$scope['Q_Config_get'] = function ($path, $default = null) {
		return Q_Config::get($path, $default);
	};

	// URL generation
	$scope['Q_url'] = function ($uri, $params = array()) {
		return Q_Uri::url($uri, $params);
	};

	// Text / i18n
	$scope['Q_text'] = function ($key, $params = array()) {
		return Q::interpolate(Q_Text::get($key), $params);
	};

	// Logging
	$scope['Q_log'] = function ($message, $key = null) {
		Q::log($message, $key);
	};

	// Time
	$scope['Q_time'] = function () {
		return time();
	};
	$scope['Q_microtime'] = function () {
		return microtime(true);
	};

	// Action context: request/response helpers
	if (Q::ifset($params, 'context', null) === 'action') {
		$scope['Q_Request_uri'] = function () {
			$uri = Q_Dispatcher::uri();
			return $uri ? $uri->toArray() : array();
		};
		$scope['Q_Request_special'] = function ($key, $default = null) {
			return Q_Request::special($key, $default);
		};
		$scope['Q_Request_method'] = function () {
			return Q_Request::method();
		};
		$scope['Q_Response_setSlot'] = function ($slotName, $html) {
			Q_Response::setSlot($slotName, $html);
		};
		$scope['Q_Response_addError'] = function ($message, $classname = 'Q_Exception') {
			Q_Response::addError(new $classname(array('message' => $message)));
		};
	}
}