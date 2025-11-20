<?php

/**
 * @module Q
 */
/**
 * Session-related functionality
 * @class Q_Session
 */
class Q_Session
{
	/**
	 * @property $session_save_path
	 * @type string
	 * @static
	 * @protected
	 */
	static protected $session_save_path;
	/**
	 * @property $session_db_connection
	 * @type Db
	 * @static
	 * @protected
	 */
	static protected $session_db_connection;
	/**
	 * @property $session_db_table
	 * @type string
	 * @static
	 * @protected
	 */
	static protected $session_db_table;
	/**
	 * @property $session_db_data_field
	 * @type string
	 * @static
	 * @protected
	 */
	static protected $session_db_data_field;
	/**
	 * @property $session_db_content_field
	 * @type string
	 * @static
	 * @protected
	 */
	static protected $session_db_content_field;
	/**
	 * @property $session_db_id_field
	 * @type string
	 * @static
	 * @protected
	 */
	static protected $session_db_id_field;
	/**
	 * @property $session_db_updated_field
	 * @type string
	 * @static
	 * @protected
	 */
	static protected $session_db_updated_field;
	/**
	 * @property $session_db_duration_field
	 * @type string
	 * @static
	 * @protected
	 */
	static protected $session_db_duration_field;
	/**
	 * @property $session_db_platform_field
	 * @type string
	 * @static
	 * @protected
	 */
	static protected $session_db_platform_field;
	/**
	 * @property $session_db
	 * @type boolean
	 * @static
	 * @protected
	 */
	static protected $session_db;
	/**
	 * @property $session_db_row
	 * @type Db_Row
	 * @static
	 * @protected
	 */
	static protected $session_db_row;
	/**
	 * @property $session_db_row_class
	 * @type string
	 * @static
	 * @protected
	 */
	static protected $session_db_row_class;
	/**
	 * @property $sess_data
	 * @type boolean
	 * @static
	 */
	static protected $sess_data;

	/**
	 * @method name
	 * @static
	 * @param {string} [$name=null]
	 * @return {string}
	 */
	static function name($name = null)
	{
		/**
		 * @event Q/session/name {before}
		 * @param {string} name
		 * @return {string}
		 */
		if ($name2 = Q::event('Q/session/name', @compact('name'), 'before')) {
			return $name2;
		}
		if (isset($name)) {
			return session_name($name);
		}
		return session_name();
	}

	/**
	 * The ID of the session that came with the request in $_COOKIE.
	 * @param {boolean} [$fallbackToGet]
	 * @param {boolean} [$fallbackToServerId]
	 */
	static function requestedId($fallbackToGet = false, $fallbackToServerId = false)
	{
		$name = Q_Config::get('Q', 'session', 'name', 'Q_sessionId');
		return (!empty($_COOKIE[$name])
			? $_COOKIE[$name] // cookie that client sent
			: ($fallbackToGet and !empty($_GET[$name])
				? $_GET[$name]
				: ($fallbackToServerId ? Q_Response::cookie($name) : null)
			) // cookie that server set
		);
	}

	/**
	 * Get or set the session id
	 * @method id
	 * @static
	 * @param {string} [$id=null] Pass a new session id, if you want to change it
	 * @return {string} The current session id
	 */
	static function id ($id = null)
	{
		/**
		 * @event Q/session/id {before}
		 * @param {string} id
		 * @return {string}
		 */
		$id = Q::event('Q/session/id', array(), 'before', false, $id);
		if (isset($id)) {
			return session_id($id);
		}
		return session_id();
	}

	/**
	 * @method savePath
	 * @static
	 * @param {string} [$savePath=null]
	 * @return {string}
	 */
	static function savePath ($savePath = null)
	{
		$sp = session_save_path();

		if (session_status() === PHP_SESSION_ACTIVE) {
			return $sp;
		}

		/**
		 * @event Q/session/savePath {before}
		 * @param {string} savePath
		 * @return {string}
		 */
		if ($savePath2 = Q::event('Q/session/savePath', @compact('savePath'), 'before')) {
			return $savePath2;
		}
		if (isset($savePath)) {
			return session_save_path($savePath);
		}

		// A workaround for some systems:
		if (empty($sp)) {
			$sp = Q_FILES_DIR.DS.'Q'.DS.'sessions';
			session_save_path($sp);
		}
		return $sp;
	}

	/**
	 * @method init
	 * @static
	 */
	static function init()
	{
		if (self::$inited) {
			return false;
		}

		ini_set("session.entropy_file", "/dev/urandom");
		ini_set("session.entropy_length", "512");
		ini_set("session.hash_function", "1");
		$name = Q_Config::get('Q', 'session', 'name', 'Q_sessionId');
		$durationName = self::durationName();
		$duration = Q_Config::get('Q', 'session', 'durations', $durationName, 0);
		$baseUrl = Q_Request::baseUrl();
		$parts = parse_url($baseUrl);
		$path = !empty($parts['path']) ? $parts['path'] : '/';
		$domain = '';

		Q::event('Q/session/init', array(
			'name' => &$name,
			'duration' => &$duration,
			'path' => &$path,
			'domain' => &$domain
		), 'before');

		Q_Session::name($name);
		session_set_cookie_params($duration, $path, $domain, false, false);

		if (Q_Config::get('Q', 'session', 'appendSuffix', false)
		or isset($_GET[$name])) {
			if (self::id()) {
				$s = "?$name=".self::id();
				$suffix = Q_Uri::suffix();
				$suffix[$baseUrl] = isset($suffix[$baseUrl])
					? $suffix[$baseUrl].$s
					: $s;
				Q_Uri::suffix($suffix);
			}
		}

		self::$inited = true;
		return true;
	}

	/**
	 * Find the session ID from the cookie and load it from the file or database.
	 * If a session has already started, i.e. if Q_Session::id() returns something,
	 * then this method returns false early.
	 * @method start
	 * @static
	 * @param {boolean} [$throwIfMissingOrInvalid=false]
	 *   Throw an exception if session ID is invalid or session info is missing,
	 *   which will probably cancel whatever state changes the request was
	 *   going to make, and return the exception to the client.
	 *   The session may be missing, for example, if we had recently deleted it.
	 *   Sessions
	 * @param {string} [$setId] 
	 *   If left is empty, the sessionId will be read from the $_COOKIE superglobal,
	 *   or if it's not there then the $_GET superglobal (which is checked after cookies
	 *   to avoid malicious GET changing an existing session surreptitiously).
	 *   If neither is there then we check whether a cookie with the Q_Session::name()
	 *   was set by the currently executing script, and use that. If none of these
	 *   contain a valid ID, then we call generateId(true, prefixType) and start a new session,
	 *   or use the publicKey from Q_Users_sig, if any, to generate a session ID.
	 *   You can specify a valid session ID string in this parameter,
	 *   to access an existing session. But be careful, because this can allow malicious
	 *   actors specify an existing sessionId! If you're trying to set a
	 *   deterministically-generated sessionId, you MUST use prefixType = 'internal',
	 *   both when generating it with Q_Session::generateId(), and also in Q_Session::start()!
	 * @param {string} [$prefixType=""]
	 *   Specify a different key from Q/session/id/prefixes config such as "authenticated",
	 *   to be used if a session ID has to be generated.
	 *   If you are specifying setId for an internal sessionId, you must set this to "internal",
	 *   otherwise the function would throw Q_Exception_SessionHijacked
	 * @param {array} [$options] 
	 * @param {boolean} [$options.temporary] Don't set the cookie, this is just to access another session temporarily
	 * @return {boolean} Whether a new session was started or not.
	 * @throws {Q_Exception_SessionHijacked}
	 * @throws {Q_Exception_FailedValidation}
	 */
	static function start($throwIfMissingOrInvalid = false, $setId = null, $prefixType = '', $options = array())
	{
		if (self::id() and !$setId) {
			// Session has already started
			return false;
		}
		/**
		 * @event Q/session/start {before}
		 * @return {false}
		 *	Return false to cancel session start
		 */
		if (false === Q::event('Q/session/start', array(), 'before')) {
			return false;
		}
		if (Q_Config::get('Q', 'session', 'custom', true)) {
			self::setSessionHandlers();
		}
		if (!empty($_SESSION)) {
			$pre_SESSION = $_SESSION;
		}
		self::init();
		$name = Q_Session::name();
		if ($setId) {
			$internalSessionIdPrefix = Q_Config::get(
				'Q', 'session', 'id', 'prefixes', 'internal', 'sessionId_internal_'
			);
			if (Q::startsWith($setId, $internalSessionIdPrefix)
			and $prefixType !== 'internal') {
				throw new Q_Exception_SessionHijacked();
			}
			$id = $setId;
		} else {
			$id = self::requestedId(true, true);
		}

		$isNew = false;
		if (!self::isValidId($id)) {
			if ($throwIfMissingOrInvalid) {
				throw new Q_Exception_FailedValidation(array(
					'message' => "Session id in $name"
				));
			}

			// The session id was probably not generated by us, generate a new one
			/**
			 * This hook is called before a new session id is generated.
			 * You can return false to cancel starting the session.
			 * @event Q/session/generate {before}
			 * @param {string} id An invalid id, if any, that was passed by the client
			 * @return {boolean}
			 */
			if (false === Q::event('Q/session/generate', @compact('id'), 'before')) {
				return false;
			}
			
			// Pass true to generateId in order to get the session ID
			// be based on the public key in Q_Users_sig, if any.
			// This is in environments where cookies are not being sent, such
			// as iframes embedded inside webpages on third-party domains.
			// The user-agent wishing to regenerate a session ID can just
			// change the public key. In many browsers this happens anyway due to
			// the 7-day cap on script-writable storage, such as IndexedDB:
			// https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/
			$id = self::generateId(true, $prefixType);
			$isNew = true;
		}

		try {
			$started = false;
			if ($id) {
				self::processDbInfo();
				self::id($id);
				self::savePath();
				session_start();
				if (!Q_Request::isInternal()) {
					header_remove("Set-Cookie"); // we will set it ourselves, thank you
				}
				$started = true;
				if (!self::$sessionExisted) {
					if ($throwIfMissingOrInvalid) {
						self::throwInvalidSession();
					}
					self::writeHandler($id, '');
				}
				if (!empty($_SERVER['HTTP_HOST']) and empty($options['temporary'])) {
					$durationName = self::durationName();
					$duration = Q_Config::get('Q', 'session', 'durations', $durationName, 0);
					$secure = Q_Config::get('Q', 'session', 'cookie', 'secure', true);
					$sessionCookieParams = session_get_cookie_params();
					$sessionName = self::name();
					if (!Q_Response::cookie($sessionName) || !Q_Dispatcher::$startedResponse) {
						// the following might throw an error if response already started, that's good:
						Q_Response::setCookie(
							$sessionName, $id, $duration ? time()+$duration : 0, 
							null, Q::ifset($sessionCookieParams, "domain", null), $secure, true, 'Lax'
						);
					}
				}
			}
			if (empty($_SERVER['HTTP_HOST']) and empty($_SESSION)) {
				$_SESSION = array();
			}
			if (!$started) {
				ini_set('session.use_cookies', 0); // we are gonna handle the cookies, thanks
				session_cache_limiter(''); // don't send the cache limiter headers either
				session_start();
				header_remove("Set-Cookie"); // we will set it ourselves, thank you
			}
		} catch (Q_Exception_MissingRow $e) {
			throw $e;
		} catch (Q_Exception_FailedValidation $e) {
			throw $e;
		} catch (Q_Exception_HeadersDuringResponse $e) {
			throw $e;
		} catch (Exception $e) {
			$app = Q_Config::get('Q', 'app', null);
			$prefix = $app ? APP_FILES_DIR.'/' : '';
			if (Q::startsWith($prefix, APP_WEB_DIR)) {
				$prefix = basename(DOCROOT_DIR) . '/' .substr($prefix, strlen(APP_WEB_DIR)+1);
			}
			if (empty($_SERVER['HTTP_HOST'])) {
				echo "Warning: Ignoring Q_Session::start() called before running {{prefix}}scripts/Q/install.php --all".PHP_EOL;
				$message = $e->getMessage();
				$file = $e->getFile();
				$line = $e->getLine();
				if (is_callable(array($e, 'getTraceAsStringEx'))) {
					$trace_string = $e->getTraceAsStringEx();
				} else {
					$trace_string = $e->getTraceAsString();
				}
				echo "$message\n(in $file line $line)\n$trace_string".PHP_EOL;
			} else {
				Q_Cache::clear(true);
				Q::log($e);
				$app_dir = APP_DIR;
				$scripts_dir = APP_SCRIPTS_DIR . DS . 'Q';
				throw new Q_Exception_PleaseRunInstall(compact('prefix'));
			}
		}
		// merge in all the stuff that was added to $_SESSION
		// before we started it.
		if (isset($pre_SESSION)) {
			foreach ($pre_SESSION as $k => $v) {
				$_SESSION[$k] = $v;
			}
		}
		if (isset($_SESSION['Q']['notices'])) {
			foreach ($_SESSION['Q']['notices'] as $k => $v) {
				Q_Response::setNotice($k, $v['notice'], $v['options']);
			}
		}
		if (!empty($_SESSION['Q']['terminated'])) {
			throw new Q_Exception_SessionTerminated(array(
				'id' => Q_Session::id()
			));
		}
		$original = null;
		$changed = array();
		if (Q_Config::get('Q', 'session', 'userAgentInfo', null)) {
			$arr = isset($_SESSION['Q']) ? $_SESSION['Q'] : array();
			$userAgentInfo = Q_Request::userAgentInfo();
			foreach ($userAgentInfo as $k => $v) {
				if (isset($arr[$k])) {
					$original[$k] = $arr[$k];
					if ($arr[$k] !== $v) {
						$changed[$k] = $v;
					}
				}
			}
			$_SESSION['Q'] = array_merge($arr, $userAgentInfo);
		}
		/**
		 * This is a hook for after the session starts.
		 * You may want to do extra security checks here.
		 * @event Q/session/start {after}
		 * @param {array} $original The userAgentInfo values that were in the session originally
		 * @param {array} $changed Whether any of the userAgentInfo values changed.
		 * @param {boolean} $isNew Whether a new session has just been started
		 * @param {string} $id The id of the session
		 */
		Q::event('Q/session/start', @compact('original', 'changed', 'isNew', 'id'), 'after');
		return true;
	}

	/**
	 * You can call this function to clear out the contents of
	 * a session, but keep its ID.
	 * @method clear
	 * @static
	 */
	static function clear()
	{
		session_unset();
		$_SESSION = array();
	}

	/**
	 * Destroy the session and remove the session and nonce cookies
	 * @method destroy
	 * @static
	 */
	static function destroy()
	{
		if (is_callable('session_status') and session_status() === PHP_SESSION_ACTIVE) {
			session_destroy();
			self::clear();
		}
		if (ini_get("session.use_cookies")) {
		    // note - we no use session_get_cookie_params();
		    Q_Response::clearCookie(self::name());
			Q_Response::clearCookie('Q_nonce');
		}
	}

	/**
	 * You should use this instead of simply calling session_regenerate_id().
	 * Generates a new session id signed with "Q"/"external"/"secret", and
	 * clones the current session data into it.
	 * @method regenerateId
	 * @static
	 * @param {boolean} [$destroy_old_session=false] Set to true if you want to get rid
	 *  of the old session (to save space or for security purposes).
	 * @param {integer|string} [$duration=null] Set the duration of the regenerated session,
	 *  otherwise it will use the default duration for Q_Session::durationName().
	 *  See Q/session/durations config field. Pass 0 to expire at the end of browser session.
	 * @param {string} [$prefixType=""]
	 *   specify a different key from Q/session/id/prefixes config such as "authenticated"
	 * @return {string} The new session id.
	 */
	static function regenerateId($destroy_old_session = false, $duration = null, $prefixType = '')
	{
		if (session_status() === PHP_SESSION_ACTIVE) {
			session_abort(); // abort current session, don't save it here
		}
		
		$old_SESSION = $_SESSION;
		if ($destroy_old_session) {
			self::destroy();
		}

		// we have to re-set all the handlers, due to a bug in PHP 5.2
		if (Q_Config::get('Q', 'session', 'custom', true)) {
			self::setSessionHandlers();
		}
		session_id($sid = self::generateId(null, $prefixType)); // generate a new session id
		session_start(); // start a new session
		header_remove("Set-Cookie"); // we will set it ourselves, thank you
		if (!empty($_SERVER['HTTP_HOST'])) {
			// set the new cookie
			if (!isset($duration)) {
				$duration = self::durationName();
			}
			if (is_string($duration)) {
				$duration = Q_Config::get('Q', 'session', 'durations', $duration, 0);
			};
			$secure = Q_Config::get('Q', 'session', 'cookie', 'secure', true);
			$sessionCookieParams = session_get_cookie_params();
			Q_Response::setCookie(
				self::name(), $sid, $duration ? time()+$duration : 0,
				null, Q::ifset($sessionCookieParams, "domain", null), $secure, true
			);
		}
		$_SESSION = $old_SESSION; // restore $_SESSION, which will be saved when session closes

		return $sid;
	}

	//
	// Session handling functions
	//

	/**
	 * @method openHandler
	 * @static
	 * @param {string} $save_path
	 * @param {string} $session_name
	 * @return {boolean}
	 * @throws {Q_Exception_WrongType}
	 */
	static function openHandler ($save_path, $session_name)
	{
		$db_info = self::processDbInfo();

		/**
		 * @event Q/session/open {before}
		 * @param {string} save_path
		 * @param {string} session_name
		 * @param {Db_Interface} session_db_connection
		 */
		Q::event('Q/session/open',
			@compact('save_path', 'session_name', 'db_info'),
			'before'
		);

		self::$session_save_path = $save_path;

		/**
		 * @event Q/session/open {after}
		 * @param {string} save_path
		 * @param {string} session_name
		 * @param {Db_Interface} session_db_connection
		 */
		Q::event('Q/session/open',
			@compact('save_path', 'session_name', 'session_db_connection'),
			'after'
		);
		return true;
	}

	/**
	 * @method closeHandler
	 * @static
	 */
	static function closeHandler ()
	{
		/**
		 * @event Q/session/close {before}
		 */
		if (false === Q::event('Q/session/close', array(), 'before')) {
			return false;
		}
		return true;
	}

	/**
	 * Serialize a session array according to the active session.serialize_handler.
	 * - php           => "key|serialize(value)" concatenation
	 * - php_serialize => serialize($array)
	 * - others        => use session_encode() via a safe temporary swap of $_SESSION
	 * Preserves references to the original $_SESSION by restoring in a finally block.
	 */
	protected static function serializeSessionArray(array $sessionArray)
	{
		$handler = ini_get('session.serialize_handler');
		$handler = $handler ? $handler : 'php';

		if ($handler === 'php') {
			$out = '';
			foreach ($sessionArray as $k => $v) {
				$out .= (string)$k . '|' . serialize($v);
			}
			return $out;
		}

		if ($handler === 'php_serialize') {
			return serialize($sessionArray);
		}

		if (session_status() === PHP_SESSION_ACTIVE) {
			// Preserve the original zval; no deep copy.
			$backup =& $_SESSION;
			$tmp    = $sessionArray;      // independent zval
			$_SESSION =& $tmp;            // temporarily point $_SESSION at our data
			try {
				return session_encode();  // encoded by the current handler/extension
			} finally {
				$_SESSION =& $backup;     // restore original zval (references intact)
			}
		}

		// Last resort if no active session under a non-php handler.
		return serialize($sessionArray);
	}

	/**
	 * Decode JSON (column `content`) into an assoc array.
	 */
	protected static function decodeSessionJSON($json)
	{
		if (!$json) return array();
		$arr = json_decode($json, true);
		return is_array($arr) ? $arr : array();
	}

	/**
	 * @method readHandler
	 * @static
	 * @param {string} $id
	 * @param {boolean} &$sessionExisted Reference to a variable to fill with a boolean
	 * @return {string}
	 */
	static function readHandler ($id, &$sessionExisted = null)
	{
		/**
		 * @event Q/session/read {before}
		 * @param {string} 'save_path'
		 * @param {Db_Interface} 'session_db_connection'
		 * @return {string}
		 */
		$result = Q::event('Q/session/read',
			array(
				'save_path' => self::$session_save_path,
				'session_db_connection' => self::$session_db_connection
			),
			'before'
		);
		if (isset($result)) {
			return $result;
		}
		if (empty(self::$session_save_path)) {
			self::$session_save_path = self::savePath();
		}
		self::$sessionExisted = $sessionExisted = false;
		if (! empty(self::$session_db_connection)) {
			$id_field = self::$session_db_id_field;
			$data_field = self::$session_db_data_field;
			$content_field = self::$session_db_content_field;
			if (!self::$session_db_row
			or self::$session_db_row->$id_field != $id) {
				$class = self::$session_db_row_class;
				$row = new $class();
				$row->$id_field = $id;
				if ($row->retrieve()) {
					self::$sessionExisted = $sessionExisted = true;
				}
				self::$session_db_row = $row;
			} else {
				self::$sessionExisted = $sessionExisted = true;
			}
			if (self::$session_db_row) {
				$row = self::$session_db_row;
				list($ip, $protocol, $isPublic, $packed) = Q_Request::ip();
				$field = "ip$protocol";
				if (empty($row->$field) or $row->$field !== $packed) {
					$row->$field = $packed;
					$row->set('ipWasJustSet', compact('ip', 'protocol', 'isPublic'));
				}
			}
			$arr = self::decodeSessionJSON(Q::ifset(self::$session_db_row, 'content', ''));
			$result = self::serializeSessionArray($arr);
		} else {
			$duration_name = self::durationName();
			$id1 = substr($id, 0, 4);
			$id2 = substr($id, 4);
			$sess_file = self::$session_save_path . DS . "$duration_name/$id1/$id2";
			if (!file_exists($sess_file)) {
				$result = '';
			} else {
				$result = (string) file_get_contents($sess_file);
				self::$sessionExisted = $sessionExisted = true;
			}
		}
		self::$sess_data = $result;
		/**
		 * @event Q/session/read {after}
		 * @param {string} 'save_path'
		 * @param {Db_Interface} 'session_db_connection'
		 * @return {string}
		 */
		$result = Q::event('Q/session/read',
			array(
				'save_path' => self::$session_save_path,
				'session_db_connection' => self::$session_db_connection,
				'sess_data' => $result
			),
			'after',
			false,
			$result
		);
		return $result ? $result : '';
	}

	/**
	 * @method writeHandler
	 * @static
	 * @param {string} $id
	 * @param {string} $sess_data
	 * @return {boolean}
	 */
	static function writeHandler ($id, $sess_data)
	{
		try {
			// if the request is AJAX request that came without session cookie
			// and no session cookie is being set, then do not write session, ignore it
			if (Q_Request::isAjax() && Q_Response::cookie(self::name() !== null)) {
				return true; // TODO: debate whether this optimization should be removed
			}

			// don't save sessions when running from command-line (cli)
			if(php_sapi_name() == 'cli') {
				return true;
			}

			if (self::$preventWrite) {
				return true;
			}

			$our_SESSION = isset($_SESSION) ? $_SESSION : null;
			$old_data = self::$sess_data;
			$changed = ($sess_data !== $old_data);
			$result = false;

			/**
			 * @event Q/session/write {before}
			 * @param {string} id
			 * @param {string} sess_data
			 * @param {string} old_data
			 * @param {boolean} changed
			 * @return {boolean}
			 */
			if (false === Q::event(
				'Q/session/write',
				@compact('id', 'sess_data', 'old_data', 'changed'),
				'before'
			)) {
				return true;
			}
			if (empty(self::$session_save_path)) {
				self::$session_save_path = self::savePath();
			}
			if (!empty(self::$session_db_connection)) {
				// Create a new row to be saved in the session table
				$db_row_class = self::$session_db_row_class;
				$id_field = self::$session_db_id_field;
				$data_field = self::$session_db_data_field;
				$content_field = self::$session_db_content_field;
				$updated_field = self::$session_db_updated_field;
				$duration_field = self::$session_db_duration_field;
				$platform_field = self::$session_db_platform_field;
				if (!self::$session_db_row) {
					self::$session_db_row = new $db_row_class();
				}
				// Make sure it has a primary key!
				if (count(self::$session_db_row->getPrimaryKey()) != 1) {
					throw new Q_Exception(
						"The primary key of " . self::$session_db_row_class
						. " has to consist of exactly 1 field!"
					);
				}
				$row = self::$session_db_row;
				$row->$id_field = $id;
				$sess_file = null;
			} else {
				$duration_name = self::durationName();
				$id1 = substr($id, 0, 4);
				$id2 = substr($id, 4);
				$ssp = self::$session_save_path;
				$sess_file = $ssp . DS . "$duration_name/$id1/$id2";
				$dir = $ssp . DS . "$duration_name/$id1/";
				$row = null;
			}
			$new = false;
			if ($changed or ($row and $row->get('ipWasJustSet'))) {
				$params = array(
					'changed' => $changed,
					'sess_data' => $sess_data,
					'old_data' => $old_data
				);
				if (!empty(self::$session_db_connection)) {
					$row->retrieve(null, true, array(
						'begin' => true,
						'ignoreCache' => true
					));
					$jsonArr = self::decodeSessionJSON(Q::ifset($row, 'content', ''));
					$t = new Q_Tree($jsonArr);
					$t->merge($our_SESSION);
					$_SESSION = $t->getAll();

					// don't compare php serializations anymore
					// $merged_data = self::serializeSessionArray($_SESSION);

					// compare using json
					$merged_data = json_encode($_SESSION, JSON_UNESCAPED_UNICODE);
					$params['existing_data'] = Q::ifset($row, $content_field, '');
					$params['merged_data'] = $merged_data;

					$params = array_merge($params, array(
						'id_field' => $id_field,
						'data_field' => $data_field,
						'duration_field' => $duration_field,
						'platform_field' => $platform_field,
						'updated_field' => $updated_field,
						'row' => $row
						// removed incorrect existing_data/merged_data override
					));
				} else {
					if (!is_dir($dir)) {
						mkdir($dir, fileperms($ssp), true);
					}
					if (!is_writable($dir)) {
						Q::log("$sess_file is not writable", 'fatal');
						die("$sess_file is not writable");
					}
					if (file_exists($sess_file)) {
						$file = fopen($sess_file, "r+");
						flock($file, LOCK_EX);
						$maxlength = Q_Config::get('Q', 'session', 'maxlength', 4095);
						$existing_data = fread($file, $maxlength);
					} else {
						$file = fopen($sess_file, "w");
						flock($file, LOCK_EX);
						$existing_data = '';
					}
					if (!$file) {
						throw new Q_Exception_MissingFile(array(
							'filename' => $sess_file
						));
					}
					$t = new Q_Tree($_SESSION);
					$t->merge($our_SESSION);
					$_SESSION = $t->getAll();
					$merged_data = session_id() ? session_encode() : '';
					$params['existing_data'] = $existing_data;
					$params['merged_data'] = $merged_data;
				}

				if ($params['existing_data'] === $params['merged_data']
				and (!$row or !$row->get('ipWasJustSet'))) {
					if (! empty(self::$session_db_connection)) {
						$row->executeCommit();
					} else {
						flock($file, LOCK_UN);
						fclose($file);
					}
					$result = true;
				} else {
					$new = $params['new'] = !self::$sessionExisted;
					Q::event('Q/session/save', $params, 'before');
					if (! empty(self::$session_db_connection)) {
						// no longer storing php-serialized data, we have the JSON in "content" field
						$row->$data_field = ''; // $merged_data ? $merged_data : '';

						// write JSON
						$row->content = $merged_data;   // <-- ADDED

						$row->$duration_field = Q_Config::get(
							'Q', 'session', 'durations', Q_Request::formFactor(),
							Q_Config::expect('Q', 'session', 'durations', 'session')
						);
						if ($platform_field) {
							$platform = Q_Request::platform();
							$row->$platform_field = $platform ? $platform : null;
						}
						$row->save(false, true);
						$result = true;
					} else {
						ftruncate($file, 0);
						rewind($file);
						$result = fwrite($file, $merged_data);
						flock($file, LOCK_UN);
						fclose($file);
					}
				}
			} else {
				$result = true;
			}
			$result = Q::event(
				'Q/session/write',
				@compact(
					'id', 'content_field', 'data_field', 'updated_field', 'duration_field', 'platform_field',
					'sess_file', 'row', 'new',
					'changed', 'sess_data', 'old_data', 'existing_data', 'merged_data'
				),
				'after',
				false,
				$result
			);
			if ($row) {
				$row->clear('ipWasJustSet');
			}
			return $result;
		} catch (Exception $e) {
			if ($row) {
				$row->clear('ipWasJustSet');
			}
			Q::log("Exception when writing session $id: " . $e->getMessage());
			throw $e;
		}
	}

	/**
	 * Removes the session information from database or file system
	 * @method destroyHandler
	 * @static
	 * @param {string} $id
	 * @return {boolean}
	 */
	static function destroyHandler ($id)
	{
		/**
		* @event Q/session/destroy {before}
		* @param {string} id
		* @return {false}
		*/
		if (false === Q::event(
			'Q/session/destroy',
			@compact('id'),
			'before'
		)) {
			return false;
		}
		if (! empty(self::$session_db_connection)) {
			self::$session_db
				->delete(self::$session_db_table)
				->where(array(self::$session_db_id_field => $id))
				->execute();
			$result = true;
		} else {
			$sess_file = self::$session_save_path . DS . "$id";
			if (!file_exists($sess_file)) {
				return false;
			}
			$result = unlink($sess_file);
		}
		/**
		 * @event Q/session/destroy {after}
		 * @param {string} id
		 * @return {mixed}
		 */
		$result = Q::event(
			'Q/session/destroy',
			@compact('id'),
			'after',
			false,
			$result
		);
		return $result;
	}

	/**
	 * @method gcHandler
	 * @static
	 * @param {integer} $max_duration
	 */
	static function gcHandler ($max_duration)
	{
		$proceed = Q_Config::get('Q', 'session', 'gc', true);
		if ($proceed) {
			self::gc($max_duration);
		}
		return true;
	}

	/**
	 * @method gc
	 * @static
	 * @param {integer} $max_duration
	 */
	static function gc($max_duration)
	{
		$id = self::id();
		/**
		 * @event Q/session/gc {before}
		 * @param {string} id
		 * @param {integer} max_duration
		 * @return {false}
		 */
		if (false === Q::event(
			'Q/session/gc',
			@compact('id', 'max_duration'),
			'before'
		)) {
			return false;
		}
		$durations = Q_Config::get('Q', 'session', 'durations', array());
		foreach ($durations as $k => $v) {
			if ($v === null) {
				$v = $max_duration;
			}
			if (!$v) {
				continue;
			}
			$since_time = time() - $v;
			if (! empty(self::$session_db_connection)) {
				$datetime = date('Y-m-d H:i:s', $since_time);
				self::$session_db
					->delete(self::$session_db_table)
					->where(array(
						self::$session_db_updated_field . '<' => $datetime,
						self::$session_db_duration_field => $v
					))->execute();
			} else {
				foreach (glob(self::$session_save_path . "/$k/*/*") as $filename) {
					$mtime = filemtime($filename);
					if ($mtime < $since_time) {
						unlink($filename);
					}
				}
			}
		}
		/**
		 * @event Q/session/gc {after}
		 * @param {string} id
		 * @param {integer} max_duration
		 * @param {integer} since_time
		 */
		Q::event(
			'Q/session/gc',
			@compact('id', 'max_duration', 'since_time'),
			'after'
		);
		return true;
	}
	
	/**
	 * Calculates a nonce from a session id.
	 * @method calculateNonce
	 * @param {string} [$sessionId] By default, uses current session id, if any
	 * @return {string|null} the nonce, or null if no session is active
	 */
	static function calculateNonce($sessionId = null)
	{
		if (!isset($sessionId)) {
			$sessionId = Q_Session::id();
		}
		if (!$sessionId) {
			return null;
		}
		$prefixes = Q_Config::get('Q', 'session', 'id', 'prefixes', array());
		$longestPrefix = "";
		$longestPrefixLen = 0;
		$id = $sessionId;
		foreach ($prefixes as $prefix) {
			if (Q::startsWith($sessionId, $prefix)) {
				$strlen = strlen($prefix);
				if ($strlen > $longestPrefixLen) {
					$longestPrefix = $prefix;
					$longestPrefixLen = $strlen;
					$id = substr($sessionId, $strlen);
				}
			}
		}
		$secret = Q_Config::get('Q', 'internal', 'secret', null);
		if (!isset($secret)) {
			$secret = Q::app();
		}
		return $longestPrefix . hash_hmac('sha256', $id, $secret);
	}

	/**
	 * Sets a nonce in cookie 'Q_nonce'. Safe to call this function multiple times if startNewSession = false
	 * The session data may not actually be saved, if there is nothing besides this nonce.
	 * That's because the nonce can be verified deterministically from the session id.
	 * @method setNonce
	 * @static
	 */
	static function setNonce()
	{
		self::start(false);
		$nonce = self::calculateNonce();
		if (!empty($_SERVER['HTTP_HOST'])) {
			$durationName = self::durationName();
			$duration = Q_Config::get('Q', 'session', 'durations', $durationName, 0);
			$secure = Q_Config::get('Q', 'session', 'cookie', 'secure', true);
			$sessionCookieParams = session_get_cookie_params();
			$domain = Q::ifset($sessionCookieParams, "domain", null);
			Q_Response::setCookie(
				'Q_nonce', $nonce, $duration ? time()+$duration : 0,
				null, $domain, $secure, false, 'Lax'
			);
		}
		Q_Session::$nonceWasSet = true;
	}

	static function durationName()
	{
		$ff = Q_Request::formFactor();
		$duration = Q_Config::get('Q', 'session', 'durations', $ff, null);
		return isset($duration) ? $ff : 'session';
	}

	static function throwInvalidSession()
	{
		$baseUrl = Q_Request::baseUrl();
		$text = Q_Text::get('Q/content');
		$message = Q::ifset($text, 'nonce', 'sameDomain', null);
		if (!empty($_SERVER['HTTP_REFERER'])) {
			$host1 = parse_url($_SERVER['HTTP_REFERER'], PHP_URL_HOST);
			$host2 = parse_url($baseUrl, PHP_URL_HOST);
			if ($host1 !== $host2) {
				$message = Q::ifset($text, 'nonce', 'otherDomain', null);
			}
		}
		Q_Response::clearAllCookies();
		$message = Q::interpolate($message, @compact('baseUrl'));
		$field = 'nonce';
		throw new Q_Exception_FailedValidation(@compact('message', 'field'), 'Q.nonce');
	}

	static function processDbInfo()
	{
		static $db_info = null;

		if ($db_info) {
			return $db_info;
		}
		if (!$db_info) {
			$db_info = Q_Config::get('Q', 'session', 'db', null);
		}
		if (!$db_info) {
			return null;
		}

		$session_db_connection = isset($db_info['connection']) ? $db_info['connection'] : null;

		// use the DB for session
		$session_db_data_field = isset($db_info['dataField']) ? $db_info['dataField'] : null;
		if (empty($session_db_data_field)) {
			throw new Q_Exception_WrongType(array(
				'field' => 'session_db_data_field',
				'type' => 'string'
			));
		}
		$session_db_content_field = isset($db_info['contentField']) ? $db_info['contentField'] : null;
		if (empty($session_db_content_field)) {
			throw new Q_Exception_WrongType(array(
				'field' => 'session_db_content_field',
				'type' => 'string'
			));
		}
		$session_db_id_field = isset($db_info['idField']) ? $db_info['idField'] : null;
		if (empty($session_db_id_field)) {
			throw new Q_Exception_WrongType(array(
				'field' => 'session_db_id_field',
				'type' => 'string'
			));
		}
		$session_db_updated_field = isset($db_info['updatedField']) ? $db_info['updatedField'] : null;
		if (empty($session_db_updated_field)) {
			throw new Q_Exception_WrongType(array(
				'field' => 'session_db_updated_field',
				'type' => 'string'
			));
		}
		$session_db_duration_field = isset($db_info['durationField']) ? $db_info['durationField'] : null;
		if (empty($session_db_duration_field)) {
			throw new Q_Exception_WrongType(array(
				'field' => 'session_db_duration_field',
				'type' => 'string'
			));
		}
		$session_db_platform_field = isset($db_info['platformField']) ? $db_info['platformField'] : null;
		$session_db_row_class = isset($db_info['rowClass']) ? $db_info['rowClass'] : null;
		if (empty($session_db_row_class)
		or ! class_exists($session_db_row_class)) {
			throw new Q_Exception_WrongType(array(
				'field' => 'session_db_row_class',
				'type' => 'a class name'
			));
		}
		$session_db_table = call_user_func(array($session_db_row_class, 'table'));
		$class = $session_db_row_class;
		$ancestors = array($class);
		while ($class = get_parent_class($class)) {
			$ancestors[] = $class;
		}
		if (! in_array('Db_Row', $ancestors)) {
			throw new Q_Exception_WrongType(array(
				'field' => 'session_db_row_class',
				'type' => 'name of a class that extends Db_Row'
			));
		}

		self::$session_db_connection = $session_db_connection;
		self::$session_db_table = $session_db_table;
		self::$session_db_data_field = $session_db_data_field;
		self::$session_db_content_field = $session_db_content_field;
		self::$session_db_id_field = $session_db_id_field;
		self::$session_db_updated_field = $session_db_updated_field;
		self::$session_db_duration_field = $session_db_duration_field;
		self::$session_db_platform_field = $session_db_platform_field;
		self::$session_db_row_class = $session_db_row_class;
		self::$session_db = Db::connect(self::$session_db_connection);

		return $db_info;
	}

	/**
	 * Get the session Db_Row, if it has been retrieved, otherwise null
	 * @method row
	 * @static
	 * @return {Db_Row|null}
	 */
	static function row()
	{
		return self::$session_db_row;
	}

	/**
	 * Generates a session id, signed with "Q"/"external"/"secret"
	 * so that the web server won't have to deal with session ids we haven't issued.
	 * @param {string} [$seed] Pass true here to try to obtain the seed from a hash
	 *   of the publicKey found in the Q_Users_sig, if it is provided.
	 *   Or pass a string here, to set your own deterministic seed for the session ID.
	 *   Otherwise, the seed will be a string of 32 random bytes.
	 * @param {string} [$prefixType=""]
	 *   specify a different key from Q/session/id/prefixes config such as "authenticated"
	 * @return {string}
	 */
	static function generateId($seed = null, $prefixType = '')
	{
		if ($seed === true) {
			$seed = null;
			try {
				$seed = Q::event('Q/session/generateId', compact('seed', 'prefixType'), 'before', false, $seed);
			} catch (Q_Exception_MissingPHPVersion $e) {
				// we can't check the signature because PHP is too old,
				// so we can silently exit, or write to the log
				// SECURITY: inform the admins to update their PHP
			}
		}
		$id = $seed
			? hash('sha256', $seed) // length 64
			: Q_Utils::randomHexString(64);
		$secret = Q_Config::get('Q', 'internal', 'secret', null);
		if (isset($secret)) {
			$id = substr($id, 0, 32);
			$sig = Q_Utils::signature($id, "$secret");
			$id .= substr($sig, 0, 32);
		}
		$prefix = Q_Config::expect('Q', 'session', 'id', 'prefixes', $prefixType);
		return $prefix . Q_Utils::toBase64($id);
	}
	
	/**
	 * @param string $id
	 *
	 * @return array of (boolean $validId, string $firstPart, string $secondPart)
	 * @throws Q_Exception
	 * @throws TypeError
	*/
	protected static function decodeId($id)
	{
		$data = Q_Utils::fromBase64($id);
		$result = bin2hex($data);
		$a = substr($result, 0, 32);
		$b = substr($result, 32, 32);
		$b = $b ? $b : ''; // for older PHP
		$secret = Q_Config::get('Q', 'internal', 'secret', null);
		$c = isset($secret)
			? Q_Utils::hashEquals($b, substr(Q_Utils::signature($a, $secret), 0, 32))
			: true;
		return array($c, $a, $b);
	}

	/**
	 * Verifies a session id, that it was correctly signed with "Q"/"external"/"secret"
	 * so that the web server won't have to deal with session ids we haven't issued.
	 * This verification can also be done at the edge (e.g. CDN) without bothering our network.
	 * Now this function strips prefixes separated by "_" or specified in Q/session/id/prefix config,
	 * for example for a session ID like "sessionId_authenticated_abc123" it can strip "sessionId_authenticated_"
	 * @param {string} $id
	 * @return {boolean}
	 */
	static function isValidId($id)
	{
		if (!$id) {
			return false;
		}
		$parts = explode('_', $id);
		if (count($parts) > 1) {
			$id = end($parts);
		} else {
			$prefixes = Q_Config::get('Q', 'session', 'id', 'prefixes', array());
			foreach ($prefixes as $prefix) {
				if (Q::startsWith($id, $prefix)) {
					$id = substr($id, strlen($prefix));
					break;
				}
			}
		}
		$results = self::decodeId($id);
		return $results[0];
	}

	/**
	 * Returns whether the session is authenticated, based on the name
	 * of the session cookie and Q/session/id/prefixes/authencated config
	 * @method isAuthenticated
	 * @static
	 * @return {boolean}
	 */
	static function isAuthenticated()
	{
		$sessionId = self::id();
		return self::isInternal() or ($prefix = Q_Config::get(
			'Q', 'session', 'id', 'prefixes', 'authenticated', 'sessionId_authenticated_'
		) and Q::startsWith($sessionId, $prefix));
	}

	/**
	 * Returns whether the session is internal, based on the name
	 * of the session cookie and Q/session/id/prefixes/authencated config
	 * @method isInternal
	 * @static
	 * @return {boolean}
	 */
	static function isInternal()
	{
		$sessionId = Q_Session::id();
		return ($prefix = Q_Config::get(
			'Q', 'session', 'id', 'prefixes', 'internal', 'sessionId_internal_'
		) and Q::startsWith($sessionId, $prefix));
	}

	/**
	 * Unserialize a session string stored by PHP using the same
	 * session.serialize_handler as the current one.
	 * @param {string} $session_data
	 * @return {array} The session data
	 */
    static function unserialize($session_data) {
        $method = ini_get("session.serialize_handler");
        switch ($method) {
            case "php":
                return self::unserialize_php($session_data);
                break;
            case "php_binary":
                return self::unserialize_phpbinary($session_data);
                break;
            default:
                throw new Exception("Unsupported session.serialize_handler: " . $method . ". Supported: php, php_binary");
        }
    }

	static function setSessionHandlers()
	{
		if (session_status() === PHP_SESSION_ACTIVE) {
			session_abort(); // abort active session to reset handlers
		}
		if (version_compare(PHP_VERSION, '7.0.0', '<')) {
			session_set_save_handler(
				array(__CLASS__, 'openHandler'),
				array(__CLASS__, 'closeHandler'),
				array(__CLASS__, 'readHandler'),
				array(__CLASS__, 'writeHandler'),
				array(__CLASS__, 'destroyHandler'),
				array(__CLASS__, 'gcHandler')
			);
		} else if (version_compare(PHP_VERSION, '8.0.0', '<')) {
			session_set_save_handler(new Q_Session_Handlers());
		} else {
			session_set_save_handler(new Q_Session_Handlers8());
		}
	}

    protected static function unserialize_php($session_data) {
        $return_data = array();
        $offset = 0;
        while ($offset < strlen($session_data)) {
            if (!strstr(substr($session_data, $offset), "|")) {
                throw new Exception("invalid data, remaining: " . substr($session_data, $offset));
            }
            $pos = strpos($session_data, "|", $offset);
            $num = $pos - $offset;
            $varname = substr($session_data, $offset, $num);
            $offset += $num + 1;
            $data = unserialize(substr($session_data, $offset));
            $return_data[$varname] = $data;
            $offset += strlen(serialize($data));
        }
        return $return_data;
    }

    protected static function unserialize_phpbinary($session_data) {
        $return_data = array();
        $offset = 0;
        while ($offset < strlen($session_data)) {
            $num = ord($session_data[$offset]);
            $offset += 1;
            $varname = substr($session_data, $offset, $num);
            $offset += $num;
            $data = unserialize(substr($session_data, $offset));
            $return_data[$varname] = $data;
            $offset += strlen(serialize($data));
        }
        return $return_data;
    }

	/**
	 * @property $inited
	 * @type boolean
	 * @static
	 * @protected
	 */
	protected static $inited = false;

	/**
	 * @property $nonceWasSet
	 * @type boolean
	 * @static
	 * @public
	 */
	public static $nonceWasSet = false;

	/**
	 * Set this to true to prevent writing the session to disk
	 * @property $preventWrite
	 * @type boolean
	 * @static
	 * @public
	 */
	public static $preventWrite = false;
	
	protected static $sessionExisted = null;
}