<?php

/**
 * @module Q
 */
/**
 * Used to maintain arbitrary data in persistent cache storage
 * @class Q_Cache
 */
class Q_Cache
{
	/**
	 * @method init
	 * @static
	 */
	static function init() {
		self::$namespace = defined('APP_DIR') ? APP_DIR : '';
		self::$apc = extension_loaded('apc');
		self::$apcu = is_callable('apcu_enabled')
			? apcu_enabled()
			: extension_loaded('apcu');
		self::$stores[self::$namespace] = array();
		self::$durations[self::$namespace] = array();
		self::$expires[self::$namespace] = array();
		self::$changed[self::$namespace] = array();
	}

	/**
	 * Check if Q_Cache is connected to some PHP cache engine (currently APC)
	 * @method connected
	 * @static
	 * @return {boolean} Whether cache is currently connected
	 */
	static function connected() {
		return self::$apc or self::$apcu;
	}

	/**
	 * Can be used to ignore the cache for a while, to re-populate it
	 * @method ignore
	 * @static
	 * @param {boolean} $setting Whether to start or to stop ignoring the cache during Q_Cache::get
	 * @return {boolean} Returns the old setting
	 */
	static function ignore($setting)
	{
		$old_setting = self::$ignore;
		self::$ignore = $setting;
		return $old_setting;
	}

	/**
	 * Schedules a Q_Cache entry to be stored, but doesn't save it right away.
	 * You have to call Q_Cache::save() or wait until the script ends.
	 * @method set
	 * @static
	 * @param {string} $key The key of cache entry
	 * @param {mixed} $value The value to set in cache
	 * @param {integer} [$duration] How many seconds to store it for.
	 *   Defaults to duration from config "Q"/"cache"/"durations"
	 * @return {boolean} Whether cache was fetched (if not, it will attempt to be saved at script shutdown)
	 */
	static function set($key, $value, $duration = null)
	{
		if (!isset($duration)) {
			$duration = Q_Config::get('Q', 'cache', 'duration', 600);
		}
		$store = &self::fetchStore($fetched);
		$store[$key] = $value;
		self::$durations[self::$namespace][$key] = $duration;
		self::$expires[self::$namespace][$key] = time() + $duration;
		self::$changed[self::$namespace][$key] = true; // it will be saved at shutdown
		return $fetched;
	}

	/**
	 * Check if a Q_Cache entry exists
	 * @method exists
	 * @static
	 * @param {string} $key The key of cache entry
	 * @param {boolean} [&$fetched] Filled with whether the cache store itself was fetched
	 * @return {boolean} Whether it exists
	 */
	static function exists($key, &$fetched = null)
	{
		if (self::$ignore) {
			$fetched = false;
			return false;
		}

		$store = &self::fetchStore($fetched);

		// In-process hit (respect TTL)
		if (array_key_exists($key, $store)) {
			if (isset(self::$expires[self::$namespace][$key])
			and self::$expires[self::$namespace][$key] < time()) {
				unset($store[$key]);
				unset(self::$expires[self::$namespace][$key]);
				return false;
			}
			return true;
		}

		// The key isn't in the store, but this process changed it,
		// which means it was cleared. Don't resurrect it from the engine.
		if (!empty(self::$changed[self::$namespace][$key])) {
			return false;
		}

		self::engineFetch(self::engineName($key), $found);
		return (boolean)$found;
	}

	/**
	 * Get Q_Cache entry
	 * @method get
	 * @static
	 * @param {string} $key The key of cache entry
	 * @param {mixed} [$default=null] In case the entry isn't there
	 * @param {boolean} [&$found] Whether the key was found in the cache
	 * @return {mixed} The value of Q_Cache entry, or null on failure
	 */
	static function get($key, $default = null, &$found = null)
	{
		if (self::$ignore) {
			$found = false;
			return $default;
		}
		$store = &self::fetchStore();
		if (array_key_exists($key, $store)) {
			// TTL eviction for in-process cache
			if (isset(self::$expires[self::$namespace][$key])
			and self::$expires[self::$namespace][$key] < time()) {
				unset($store[$key]);
				unset(self::$expires[self::$namespace][$key]);
				$found = false;
				return $default;
			}
			$found = true;
			return $store[$key];
		}

		// The key isn't in the store, but this process changed it,
		// which means it was cleared. Don't resurrect it from the engine.
		if (!empty(self::$changed[self::$namespace][$key])) {
			$found = false;
			return $default;
		}

		$name = self::engineName($key);
		$value = self::engineFetch($name, $found);
		if ($found) {
			$store[$key] = $value;
			// Track in-process expiration, but never past the engine's own TTL
			$duration = Q::ifset(
				self::$durations,
				self::$namespace,
				$key,
				Q_Config::get('Q', 'cache', 'duration', 600)
			);
			self::$expires[self::$namespace][$key]
				= time() + self::engineTTL($name, $duration);
			return $value;
		}
		return $default;
	}

	/**
	 * Clear Q_Cache entry
	 * @method clear
	 * @static
	 * @param {string|true} [$key=null] The key of cache entry. Skip this to clear all the keys
	 *   in the current namespace. Pass true to also clear the entire cache,
	 *   for all namespaces / apps, and reset the opcode cache.
	 * @param {boolean} [$prefix=false] Whether to clear all keys for which $key is a prefix
	 * @return {boolean} Whether an apc cache was fetched.
	 */
	static function clear($key = null, $prefix = false)
	{
		$namespace = self::$namespace;
		$store = &self::fetchStore($fetched);

		if (!isset($key) or $key === true) {
			if ($key === true) {
				if (is_callable('apcu_clear_cache')) {
					apcu_clear_cache();
				} else if (is_callable('apc_clear_cache')) {
					apc_clear_cache('user');
				}
				self::$stores = array($namespace => array());
				self::$expires = array($namespace => array());
				self::$durations = array($namespace => array());
				self::$changed = array($namespace => array());
				if (is_callable('opcache_reset')) {
					opcache_reset(); // also reset all the PHP cached files
				}
			} else {
				// clear this namespace only, in the engine as well as in memory
				foreach ($store as $k => $v) {
					self::$changed[$namespace][$k] = true;
				}
				self::clearEngineByPrefix(self::engineName('', $namespace));
				$store = array();
				self::$expires[$namespace] = array();
			}
			return $fetched;
		}

		$keys = array();
		if ($prefix) {
			$len = strlen($key);
			foreach ($store as $k => $v) {
				if (substr($k, 0, $len) === $key) {
					$keys[] = $k;
				}
			}
			// keys living only in the engine can't be seen from the store,
			// so enumerate them directly when that's possible
			self::clearEngineByPrefix(self::engineName($key));
		} else {
			$keys[] = $key;
		}

		foreach ($keys as $k) {
			unset($store[$k]);
			unset(self::$expires[$namespace][$k]);
			self::$changed[$namespace][$k] = true; // it will be deleted at shutdown
		}

		return $fetched;
	}

	/**
	 * Fetches the cache store from APC.
	 * In either case, prepares self::$stores[$namespace] to be used as an array.
	 * @method fetchStore
	 * @protected
	 * @static
	 * @param {boolean} [$fetched] If passed, this is filled with whether the store was fetched
	 * @return {array} A reference to the cache store, or to an empty array if nothing was fetched
	 */
	protected static function &fetchStore(&$fetched = null)
	{
		static $gcCounter = 0;
		$namespace = self::$namespace;
		if ((++$gcCounter % 100) === 0 and isset(self::$expires[$namespace])) {
			$now = time();
			foreach (self::$expires[$namespace] as $k => $exp) {
				if ($exp < $now) {
					unset(self::$stores[$namespace][$k]);
					unset(self::$expires[$namespace][$k]);
				}
			}
		}
		if (!isset(self::$stores[$namespace])) {
			self::$stores[$namespace] = array();
			self::$expires[$namespace] = array();
			self::$durations[$namespace] = array();
			self::$changed[$namespace] = array();
			$fetched = false;
			return self::$stores[$namespace];
		}
		$fetched = true;
		return self::$stores[$namespace];
	}

	/**
	 * Deletes every entry in the cache engine whose name starts with the given
	 * prefix. Entries that were never read during this request don't appear in
	 * the in-process store, so they can only be found by enumerating the engine.
	 * Best effort: does nothing if the engine can't be enumerated.
	 * @method clearEngineByPrefix
	 * @protected
	 * @static
	 * @param {string} $namePrefix An engine name prefix, as built by engineName()
	 */
	protected static function clearEngineByPrefix($namePrefix)
	{
		if (!self::$apcu or !class_exists('APCUIterator')) {
			return;
		}
		$pattern = '/^' . preg_quote($namePrefix, '/') . '/';
		foreach (new APCUIterator($pattern) as $item) {
			self::engineDelete($item['key']);
		}
	}

	/**
	 * The name under which a key is stored in the cache engine
	 * @method engineName
	 * @protected
	 * @static
	 * @param {string} $key
	 * @param {string} [$namespace=null] Defaults to the current namespace
	 * @return {string}
	 */
	protected static function engineName($key, $namespace = null)
	{
		if (!isset($namespace)) {
			$namespace = self::$namespace;
		}
		return "Q_Cache\t$namespace\t$key";
	}

	/**
	 * @method engineFetch
	 * @protected
	 * @static
	 * @param {string} $name
	 * @param {boolean} [&$found]
	 * @return {mixed}
	 */
	protected static function engineFetch($name, &$found = null)
	{
		if (is_callable('apcu_fetch')) {
			return apcu_fetch($name, $found);
		}
		if (is_callable('apc_fetch')) {
			return apc_fetch($name, $found);
		}
		$found = false;
		return null;
	}

	/**
	 * @method engineStore
	 * @protected
	 * @static
	 * @param {string} $name
	 * @param {mixed} $value
	 * @param {integer} $duration
	 * @return {boolean}
	 */
	protected static function engineStore($name, $value, $duration)
	{
		if (is_callable('apcu_store')) {
			return apcu_store($name, $value, $duration);
		}
		if (is_callable('apc_store')) {
			return apc_store($name, $value, $duration);
		}
		return false;
	}

	/**
	 * @method engineDelete
	 * @protected
	 * @static
	 * @param {string} $name
	 * @return {boolean}
	 */
	protected static function engineDelete($name)
	{
		if (is_callable('apcu_delete')) {
			return apcu_delete($name);
		}
		if (is_callable('apc_delete')) {
			return apc_delete($name);
		}
		return false;
	}

	/**
	 * How many seconds an entry has left in the cache engine, if we can find out.
	 * @method engineTTL
	 * @protected
	 * @static
	 * @param {string} $name
	 * @param {integer} $default Returned when the engine can't tell us
	 * @return {integer}
	 */
	protected static function engineTTL($name, $default)
	{
		if (!is_callable('apcu_key_info')) {
			return $default;
		}
		$info = @apcu_key_info($name);
		if (!is_array($info) or empty($info['ttl'])) {
			return $default; // unknown, or stored without expiration
		}
		$since = null;
		if (isset($info['creation_time'])) {
			$since = $info['creation_time'];
		} else if (isset($info['mtime'])) {
			$since = $info['mtime'];
		}
		if (!isset($since)) {
			return $default;
		}
		$remaining = $since + $info['ttl'] - time();
		return $remaining > 0 ? $remaining : 0;
	}

	/**
	 * This is called automatically during PHP shutdown,
	 * but you might choose to call it earlier, to flush any changes
	 * to the cache's storage.
	 * @method save
	 * @static
	 */
	static function save()
	{
		if (!self::$apc and !self::$apcu) {
			self::$changed = array();
			return;
		}
		$d = Q_Config::get('Q', 'cache', 'duration', 0);
		foreach (self::$changed as $namespace => $changed) {
			$store = isset(self::$stores[$namespace])
				? self::$stores[$namespace]
				: array();
			foreach ($changed as $key => $value) {
				$name = self::engineName($key, $namespace);
				if (array_key_exists($key, $store)) {
					$duration = Q::ifset(self::$durations, $namespace, $key, $d);
					self::engineStore($name, $store[$key], $duration);
				} else {
					self::engineDelete($name);
				}
			}
		}
		self::$changed = array();
	}

	/**
	 * @method shutdownFunction
	 * @static
	 */
	static function shutdownFunction()
	{
		self::save();
	}

	/**
	 * @property $ignore
	 * @protected
	 * @type boolean
	 */
	protected static $ignore = false;
	/**
	 * @property $stores
	 * @protected
	 * @type array
	 */
	protected static $stores = array();
	/**
	 * @property $durations
	 * @protected
	 * @type array
	 */
	protected static $durations = array();
	/**
	 * @property $expires
	 * @protected
	 * @type array
	 */
	protected static $expires = array();
	/**
	 * @property $changed
	 * @protected
	 * @type array
	 */
	protected static $changed = array();
	/**
	 * @property $namespace
	 * @protected
	 * @type string
	 */
	protected static $namespace;
	/**
	 * @property $apc
	 * @protected
	 * @type boolean
	 */
	protected static $apc;
	/**
	 * @property $apcu
	 * @protected
	 * @type boolean
	 */
	protected static $apcu;
}

Q_Cache::init();