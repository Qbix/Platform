<?php

/**
 * @module Q
 */
/**
 * Qbix adapter for the SafeScript runtime (safescript-php).
 *
 * Thin wrapper — delegates compile/run to \SafeScript\SafeScript.
 * Adds Qbix-specific concerns:
 *
 *   1. Hook system: fires Q events so other plugins can inject
 *      scope capabilities and react to execution results
 *   2. File caching: compiled .safe files cached on disk
 *   3. Scope building: assembles the scope from plugin contributions
 *
 * Hook events (all plugins can listen):
 *
 *   Q/SafeScript/scope {before}
 *     Fired before every run. Plugins add to $params['scope']
 *     to inject their capabilities. For example, the Streams plugin
 *     could inject Streams.get, Streams.related, etc.
 *     Params: 'scope' (array, by reference), 'source', 'context', 'filename'
 *
 *   Q/SafeScript/run {after}
 *     Fired after every run. Plugins can inspect or transform the result.
 *     Params: 'result', 'source', 'scope', 'context', 'filename'
 *
 *   Q/SafeScript/compile {after}
 *     Fired after compilation. Plugins can inspect the compiled output.
 *     Params: 'compiled', 'source', 'filename'
 *
 * Usage:
 *   // Simple run — scope is assembled from plugin hooks
 *   $result = Q_SafeScript::run($source, ['userId' => $id]);
 *
 *   // Run a file with caching
 *   $result = Q_SafeScript::runFile($path, ['stream' => $data]);
 *
 *   // Handle a Q event from a .safe file
 *   Q_SafeScript::handle('Streams/related/post', $params);
 *
 * @class Q_SafeScript
 */
class Q_SafeScript
{
	/**
	 * Compile SafeScript source. Delegates to \SafeScript\SafeScript::compile().
	 *
	 * @method compile
	 * @static
	 * @param {string} $source SafeScript source code
	 * @return {array} { code, hash }
	 */
	static function compile($source)
	{
		self::_ensureLoaded();
		$compiled = \SafeScript\SafeScript::compile($source);
		Q::event('Q/SafeScript/compile', array(
			'compiled' => $compiled,
			'source' => $source,
			'filename' => null
		), 'after');
		return $compiled;
	}

	/**
	 * Run SafeScript source.
	 *
	 * Fires Q/SafeScript/scope {before} so plugins can inject capabilities,
	 * then runs, then fires Q/SafeScript/run {after} so plugins can react.
	 *
	 * @method run
	 * @static
	 * @param {string} $source SafeScript source code
	 * @param {array} [$scope] Initial scope — plugin hooks add to this
	 * @param {array} [$opts] Runtime options (timeout, maxOps, maxMemory, hooks)
	 * @param {string} [$context] Context hint: 'action', 'handler', 'tool', 'general'
	 * @return {mixed} The return value
	 */
	static function run($source, $scope = array(), $opts = array(), $context = 'general')
	{
		self::_ensureLoaded();

		// Let plugins inject capabilities into the scope
		$params = array(
			'scope' => &$scope,
			'source' => $source,
			'context' => $context,
			'filename' => null
		);
		Q::event('Q/SafeScript/scope', $params, 'before');

		// Run via safescript-php
		$result = \SafeScript\SafeScript::run($source, $scope, $opts);

		// Let plugins react to the result
		Q::event('Q/SafeScript/run', array(
			'result' => $result,
			'source' => $source,
			'scope' => $scope,
			'context' => $context,
			'filename' => null
		), 'after');

		return $result;
	}

	/**
	 * Load, compile (with disk caching), and run a .safe file.
	 *
	 * Compiled code is cached under APP_DIR/local/cache/safe/<hash>.php
	 * keyed by SHA-256 of the source. Stale cache entries are overwritten
	 * when the source changes.
	 *
	 * @method runFile
	 * @static
	 * @param {string} $filename Absolute path to the .safe file
	 * @param {array} [$scope] Initial scope
	 * @param {array} [$opts] Runtime options
	 * @param {string} [$context] Context hint
	 * @return {mixed} The return value
	 */
	static function runFile($filename, $scope = array(), $opts = array(), $context = 'general')
	{
		if (!file_exists($filename)) {
			throw new Q_Exception_MissingFile(compact('filename'));
		}
		$source = file_get_contents($filename);
		$hash = hash('sha256', $source);

		// Check disk cache
		$cacheDir = APP_DIR . DS . 'local' . DS . 'cache' . DS . 'safe';
		$cachePath = $cacheDir . DS . $hash . '.php';

		self::_ensureLoaded();

		if (file_exists($cachePath)) {
			$compiled = include($cachePath);
		} else {
			$compiled = \SafeScript\SafeScript::compile($source);
			if (!is_dir($cacheDir)) {
				mkdir($cacheDir, 0755, true);
			}
			file_put_contents($cachePath,
				'<?php return ' . var_export($compiled, true) . ';'
			);
			Q::event('Q/SafeScript/compile', array(
				'compiled' => $compiled,
				'source' => $source,
				'filename' => $filename
			), 'after');
		}

		// Let plugins inject capabilities
		$params = array(
			'scope' => &$scope,
			'source' => $source,
			'context' => $context,
			'filename' => $filename
		);
		Q::event('Q/SafeScript/scope', $params, 'before');

		// Run the compiled code
		$result = \SafeScript\SafeScript::run($source, $scope, $opts);

		Q::event('Q/SafeScript/run', array(
			'result' => $result,
			'source' => $source,
			'scope' => $scope,
			'context' => $context,
			'filename' => $filename
		), 'after');

		return $result;
	}

	/**
	 * Parse a .safe file's @needs/@uses/@env header.
	 * Delegates to \SafeScript\SafeScript::capabilities().
	 *
	 * @method capabilities
	 * @static
	 * @param {string} $source SafeScript source
	 * @return {array} Parsed header
	 */
	static function capabilities($source)
	{
		self::_ensureLoaded();
		return \SafeScript\SafeScript::capabilities($source);
	}

	/**
	 * Check whether a scope satisfies a source's @needs.
	 *
	 * @method checkScope
	 * @static
	 * @param {string} $source
	 * @param {array} $scope
	 * @return {array} { ok, missing }
	 */
	static function checkScope($source, $scope)
	{
		self::_ensureLoaded();
		return \SafeScript\SafeScript::checkScope($source, $scope);
	}

	/**
	 * Q::event() compatible handler for .safe files.
	 *
	 * Derives the .safe file path from the event name:
	 *   'Streams/related/post' → plugins/Streams/web/safe/handlers/related/post.safe
	 *
	 * Fires the scope hook so other plugins can inject their capabilities,
	 * then runs the .safe handler.
	 *
	 * @method handle
	 * @static
	 * @param {string} $eventName e.g. 'Streams/related/post'
	 * @param {array} [$params] Event parameters — merged into scope
	 * @return {mixed} The handler's return value, or null if no .safe file
	 */
	static function handle($eventName, $params = array())
	{
		$parts = explode('/', $eventName);
		if (count($parts) < 2) {
			return null;
		}
		$pluginName = array_shift($parts);
		$relPath = implode(DS, $parts) . '.safe';

		$pluginDir = Q::ifset(Q_Bootstrap::plugins(), $pluginName, null);
		if (!$pluginDir) {
			return null;
		}

		$filename = $pluginDir
			. DS . 'web' . DS . 'safe' . DS . 'handlers' . DS . $relPath;

		if (!file_exists($filename)) {
			return null; // no .safe handler — fall through
		}

		return self::runFile($filename, $params, array(), 'handler');
	}

	/**
	 * Register a named library with safescript-php.
	 * Delegates to \SafeScript\SafeScript::lib().
	 *
	 * @method lib
	 * @static
	 */
	static function lib($nameOrClass, $value = null, $config = null)
	{
		self::_ensureLoaded();
		if ($config !== null) {
			\SafeScript\SafeScript::lib($nameOrClass, $value, $config);
		} else {
			\SafeScript\SafeScript::lib($nameOrClass, $value);
		}
	}

	/**
	 * Ensure the safescript-php library is available.
	 *
	 * @method _ensureLoaded
	 * @static
	 * @private
	 */
	private static function _ensureLoaded()
	{
		if (self::$_loaded) {
			return;
		}
		if (class_exists('\SafeScript\SafeScript')) {
			self::$_loaded = true;
			return;
		}
		// Try configured path
		$path = Q_Config::get('Q', 'SafeScript', 'phpPath', null);
		if ($path) {
			$autoload = $path . DS . 'vendor' . DS . 'autoload.php';
			if (file_exists($autoload)) {
				require_once $autoload;
				self::$_loaded = true;
				return;
			}
			// Maybe it's the library root directly
			$autoload = $path . DS . 'autoload.php';
			if (file_exists($autoload)) {
				require_once $autoload;
				self::$_loaded = true;
				return;
			}
		}
		throw new Q_Exception(array(
			'message' => 'Q_SafeScript: safescript-php not found. '
				. 'Install via composer (require safescript/safescript-php) '
				. 'or set Q.SafeScript.phpPath in config.'
		));
	}

	/**
	 * @property $_loaded
	 * @static
	 * @type boolean
	 */
	private static $_loaded = false;
}
