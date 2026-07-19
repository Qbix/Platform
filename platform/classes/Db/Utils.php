<?php

/**
 * @module Db
 */

/**
 * This class lets you do things related to databases and db results
 * @class Db_Utils
 * @static
 */

class Db_Utils
{

	/**
	 * Sort array by given field
	 * @method sort
	 * @static
	 * @param {&array} $dbRows
	 * @param {string} $field_name
	 */
	static function sort (array & $dbRows, $field_name)
	{
		if (empty($field_name))
			throw new Exception('Must supply field name to compare by');
		self::$compare_field_name = $field_name;
		usort($dbRows, array('Db_Utils', 'compare_dbRows'));
	}

	/**
	 * Compare database rows
	 * @method compare_dbRows
	 * @static
	 * @private
	 * @param {array} $dbRow1
	 * @param {array} $dbRow2
	 * @return {integer}
	 */
	static private function compare_dbRows ($dbRow1, $dbRow2)
	{
		$compare_field_name = self::$compare_field_name;
		if ($dbRow1->$compare_field_name > $dbRow2->$compare_field_name)
			return 1; else if ($dbRow1->$compare_field_name == $dbRow2->$compare_field_name)
			return 0; else
			return - 1;
	}

	/**
	 * A very useful function for stripping off only the 
	 * parameters you need from an array. 
	 * Use it for passing parameters to functions in a flexible way.
	 * @method take
	 * @static
	 * @param {array} $from The associative array from which to take the parameters from, 
	 *  consisting of param => value. For example the $_REQUEST array.
	 * @param {array} $parameters An associative array of paramName => defaultValue pairs.
	 *  If the parameter was not found in the $from array, 
	 *  the default value is used.
	 * @param {string} [$prefix=''] If non-empty, then parameter names are
	 * prepended with this prefix before searching in $from is done.
	 * The prefix is stripped out in the resulting array.
	 * Typically used for database rows. 
	 * If $parameters is empty, ALL items in $from with 
	 * keys starting with $prefix are returned.
	 * @return {array} The parameters are stripped off from the $from array, 
	 * according to the above rules, and returned as an array.
	 */
	static function take (array $from, array $parameters, $prefix = '')
	{
		$result = array();
		if (count($parameters) > 0) {
			// There are parameters to strip off. Observe the prefix, too, if any.
			foreach ($parameters as $key => $value) {
				if (array_key_exists($prefix . $key, $from))
					$result[$key] = $from[$prefix . $key]; else {
					$default = $parameters[$key];
					if ($default instanceof Exception)
						throw $default;
					$result[$key] = $default;
				}
			}
		} else if ($prefix > '') {
			// Parameters aren't specified, but a prefix is.
			$prefixlen = strlen($prefix);
			foreach ($from as $key => $value)
				if (strncmp($key, $prefix, $prefixlen) == 0)
					$result[substr($key, $prefixlen)] = $from[$key];
		} else {
			$result = $from;
		}
		return $result;
	}

	/**
	 * Append a message to the system log. Consider using Q::log() instead
	 * @method log
	 * @static
	 * @param {string} $message the message to append
	 * @param {integer} [$level=LOG_NOTICE] see E_NOTICE in the php manual, etc.
	 * @param {boolean} [$timestamp=true] whether to prepend the current timestamp
	 * @param {string} [$ident=''] the ident string to prepend to the message
	 */
	static function log ($message, $level = LOG_NOTICE, $timestamp = true, $ident = '')
	{
		static $logOpen = false;
		if (! $logOpen)
			openlog($ident, LOG_NDELAY | LOG_PID | LOG_PERROR, LOG_USER);
		$logOpen = true;
		syslog($level, 
			($timestamp ? date('Y-m-d H:i:s') . ' ' : '') . $message);
	}

	/**
	 * Combines a dirname and a basename, using a slash if needed.
	 * Use this function to build up paths with the correct DIRECTORY_SEPARATOR.
	 * @method filename
	 * @static
	 * @param {string} $dirname The part of the the filename to append to.
	 *  May or may not include a slash at the end.
	 * @param {string} [$basename=null] The part of the filename that comes after the slash
	 *  You can continue to pass more tools as the 3rd, 4th etc.
	 *  parameters to this function, and they will all be
	 *  concatenated into one filename.
	 * @return {string} The combined absolute filename. If it does not exist,
	 *  but the filename appended to the current working directory
	 *  exists, then the latter is returned.
	 */
	static function filename (
		$dirname, $basename = null, $basename2 = null)
	{
		$args = func_get_args();
		$pieces = array();
		$count = count($args);
		for ($i = 0; $i < $count - 1; ++ $i) {
			$pieces[] = (substr($args[$i], - 1) == '/' 
			or substr($args[$i], -1) == "\\"
			or substr($args[$i], -1) == DS) 
				? substr($args[$i], 0, - 1) 
				: $args[$i];
		}
		$pieces[] = $args[$count - 1];
		$filename = implode(DS, $pieces);
		if (!file_exists($filename)) {
			// In this case, try the current working directory
			$cwd = getcwd();
			if ($filename[0] != DS and substr($cwd, -1) != DS)
				$filename_try = $cwd . DS . $filename;
			else
				$filename_try = $cwd . $filename;
			$filename_realpath = realpath($filename_try);
			if ($filename_realpath)
				return $filename_realpath;
		}
		return $filename;
	}

	/**
	 * Exports a simple variable into something that looks nice, nothing fancy (for now)
	 * Does not preserve order of array keys.
	 * @method var_export
	 * @static
	 * @param {mixed&} $var the variable to export
	 */
	static function var_export (&$var)
	{
		if (is_string($var)) {
			$var_2 = addslashes($var);
			return "'$var_2'";
		} elseif (is_array($var)) {
			$indexed_values_quoted = array();
			$keyed_values_quoted = array();
			foreach ($var as $key => $value) {
				$value = self::var_export($value);
				if (is_string($key))
					$keyed_values_quoted[] = "'" . addslashes($key) . "' => $value"; else
					$indexed_values_quoted[] = $value;
			}
			$parts = array();
			if (! empty($indexed_values_quoted))
				$parts['indexed'] = implode(', ', $indexed_values_quoted);
			if (! empty($keyed_values_quoted))
				$parts['keyed'] = implode(', ', $keyed_values_quoted);
			$exported = 'array(' . implode(", \n", $parts) . ')';
			return $exported;
		} else {
			return var_export($var, true);
		}
	}

	/**
	 * Saves a text file. Need to enable UTF-8 support here.
	 * @method saveTextFile
	 * @static
	 * @param {string} $filename The name of the file to save to. Can be relative to this file, or full.
	 * @param {string} $contents  The text string to save
	 * @return {integer} The number of bytes saved, or false if not saved
	 */
	static function saveTextFile ($filename, $contents)
	{
		$dir = dirname($filename);
		if (!file_exists($dir)) {
			mkdir($dir, 0755, true);
		}
		if (!is_dir($dir)) {
			return false;
		}
		// TODO: implement semaphore based on filename to eliminate race conditions
		$result = @file_put_contents($filename, $contents, LOCK_EX); 
		// TODO: use FILE_TEXT for UTF-8 in PHP6
		return $result;
	}
	
	/**
	 * Dumps as a table
	 * @method dump_table
	 * @static
	 * @param {array} $rows
	 */
	static function dump_table ($rows)
	{
		$first_row = true;
		$keys = array();
		$lengths = array();
		foreach ($rows as $row) {
			foreach ($row as $key => $value) {
				if ($first_row) {
					$keys[] = $key;
					$lengths[$key] = strlen($key);
				}
				$val_len = strlen((string)$value);
				if ($val_len > $lengths[$key])
					$lengths[$key] = $val_len;
			}
			$first_row = false;
		}
		foreach ($keys as $i => $key) {
			$key_len = strlen($key);
			if ($key_len < $lengths[$key]) {
				$keys[$i] .= str_repeat(' ', $lengths[$key] - $key_len);
			}
		}
		echo PHP_EOL;
		echo implode("\t", $keys);
		echo PHP_EOL;
		foreach ($rows as $i => $row) {
			foreach ($row as $key => $value) {
				$val_len = strlen((string)$value);
				if ($val_len < $lengths[$key]) {
					$row[$key] .= str_repeat(' ', $lengths[$key] - $val_len);
				}
			}
			echo implode("\t", $row);
			echo PHP_EOL;
		}
	}

	/**
	 * Split shard partitin to new shards. It takes the full table or single partition
	 * and split it to multiple partitions according to the number of provided 'parts'.
	 * When doing initioa split 'shard' may be ommited however 'fields' shall be provided
	 * @method split
	 * @static
	 * @param {Q_Tree} $config Contains all necessary information for split procedure in the following format:
	 * @example
	 *	{
	 *		"plugin": "PLUGINNAME", // the name of plugin - shall be used by app
	 *		"connection": "CONNECTIONNAME", // connection - shall be registered with plugin
	 *		"table": "TABLENAME", // the table to shard
	 *		"class": "CLASSNAME", // the class which is stored in the table
	 *		"fields": {"FIELDNAME": "HASH", "FIELDNAME": "HASH", ...}, // Optional. Used only when starting sharding
	 *			"shard": "SHARDNAME" // Optionsl. The shard to split. If no shards defined or SHARDNAME does not exist the script will fail
	 *			// "parts" can be either array of connections or object {"SHARDNAME": connection, ...}
	 *		"parts": {
	 *			"SHARDNAME": {
	 *				"prefix": "PREFIX",
	 *				"dsn": "DSN",
	 *					...
	 *			},
	 *			"SHARDNAME": {
	 *				"prefix": "PREFIX",
	 *				"dsn": "DSN",
	 *					"username": "USERNAME",
	 *					"password": "PASSWORD",
	 *					"driver_options": {
	 *						"3": 2
	 *					}
	 *			},
	 *			...
	 *		}
	 *	}
	 *
	 * @return {boolean} Weather php part of the process completed successfuly
	 */

	static function split ($config) {
		// all input data shall be provided
		// for future extension plugin/connection/table/class are considered unrelated
		if (!($plugin = $config->get('plugin', false))) {
			echo "Plugin name is not defined\n";
			return false;
		}
		// plugin shall be registered!
		if (!Q_Config::get('Q', 'pluginInfo', $plugin, false)) {
			echo "Plugin '$plugin' is not registered in the platform\n";
			return false;
		}
		if (!($connection = $config->get('connection', false))) {
			echo "Connection '$connection' is not defined\n";
			return false;
		}
		// connection shall exist and be registered with plugin!
		if (!Q_Config::get('Db', 'connections', $connection, false)) {
			echo "Connection '$connection' does not exist\n";
			return false;
		}
		if (!in_array($connection, Q_Config::get('Q', 'pluginInfo', $plugin, 'connections', array()))) {
			echo "Connection '$connection' is not registered for plugin '$plugin'\n";
			return false;
		}
		if (!($class = $config->get('class', false))) {
			echo "Class name is not defined\n";
			return false;
		}
		if (!($table = $config->get('table', false))) {
			echo "Table name is not defined\n";
			return false;
		}
		if (!($shard = $config->get('shard', false)) && Q_Config::get('Db', 'connections', $connection, 'shards', false)) {
			echo "Shard to partition is not defined\n";
			return false;
		}
		if (!($parts = $config->get('parts', false))) {
			echo "New parts are not defined\n";
			return false;
		}
		if ($node = $config->get('node', null)) {
			$nodeInternal = Q_Config::expect('Q', 'nodeInternal');
			$node = array("http://{$nodeInternal['host']}:{$nodeInternal['port']}/Q_Utils/query", $node);
		}

		// now we shall distinguish if table is already sharded or not
		if ($shard === false) {
			if (!($fields = $config->get('fields', false))) {
				echo "To start sharding you shall define 'fields' parameter\n";
				return false;
			}
		}

		// weather provided split config is mapped or not
		$split_mapped = (array_keys($parts) !== range(0, count($parts) - 1));

		// set up config for shards if it does not exist yet
		if ($shard === false) {
			$partition = array();
			foreach ($fields as $name => $hash) {
				if (empty($hash)) $hash = 'md5';
				$part = explode('%', $hash);
				$hash = $part[0];
				$len = isset($part[1]) ? $part[1] : Db_Query::HASH_LEN;
				// "0" has the lowest ascii code for both md5 and normalize
				//	$partition[] = $hash === 'md5' ? str_pad('', $len, "0", STR_PAD_LEFT) : str_pad('', $len, " ", STR_PAD_LEFT);
				$partition[] = str_pad('', $len, "0", STR_PAD_LEFT);
				
			}
			$shard = join('.', $partition);
			if (Q_Config::get('Db', 'connections', $connection, 'indexes', $table, false)) {
				echo "Shards are not defined but indexes for table '$table' are defined in local config\n";
				return false;
			}
			// Let's merge in dummy shards section - shard with name '' is handled as single table
			Q_Config::merge(array(
				'Db' => array(
					'connections' => array(
						$connection => array(
							"shards" => array(),
							"indexes" => array(
								$table => array(
									"fields" => $fields,
									"partition" => $split_mapped 
										? array($shard => '')
										: array($shard)
								)
							)
						)
					)
				)
			));
			$shard_name = '';
		}

		// get partition information
		if (!($partition = Q_Config::get('Db', 'connections', $connection, 'indexes', $table, 'partition', false))) {
			echo "Upps, cannot get shards partitioning\n";
			return false;
		}

		// weather main config is mapped or not
		// also $points contains the partitioning array without mapping
		$points = ($mapped = (array_keys($partition) !== range(0, count($partition) - 1))) 
			? array_keys($partition) 
			: $partition;

		$i = array_search($shard, $points);
		$next = isset($points[++$i]) ? $points[$i] : null;
		$fields = Q_Config::expect('Db', 'connections', $connection, 'indexes', $table, 'fields');
		// now $shard and $next contain boundaries for data to split
		// $points contain partitioning array without mapping - array
		// $parts contains split parts (shards) definition - array or object ($split_mapped)
		// $partition contains current partitioning - array or object ($mapped)
		// $fields contains field names and hashes

		// time to calculate new split point(s)
		if (!isset($shard_name))
			$shard_name = $mapped ? $partition[$shard] : $shard;
		$shard_db = $class::db();
		$pdo = $shard_db->reallyConnect($shard_name);
		$shard_table = $class::table();
		$shard_table = str_replace('{{dbname}}', $shard_db->dbname, $shard_table);
		$shard_table = str_replace('{{prefix}}', $shard_db->prefix, $shard_table);

		// verify if current shard is updated to latest version
		$current_version = $shard_db->select('version', "{$shard_db->prefix}Q_plugin")
								->where(array("plugin" => $plugin))
								->fetchAll(PDO::FETCH_ASSOC);
		if (!empty($current_version)) {
			$current_version = $current_version[0]['version'];
			$version = Q_Config::get('Q', "pluginInfo", $plugin, 'version', null);
			if (Q::compareVersion($current_version, $version) < 0) {
				echo "Please, update plugin '$plugin' to version '$version' (currently $current_version)\n";
				return false;
			}
		} else {
			echo "Cannot get installed version of plugin '$plugin'\n";
			return false;
		}

		// We'll limit search with shard boundaries using latin1 string comparison
		$lower = join(explode('.', $shard));
		$upper = isset($next) ? join(explode('.', $next)) : null;
		$normalize = false;

		$where = $group = $order = array();
		foreach(array_keys($fields) as $i => $field) {
			$hash = !empty($fields[$field]) ? $fields[$field] : 'md5';
			$part = explode('%', $hash);
			$normalize = ($normalize || ($hash = strtoupper($part[0])) === 'NORMALIZE');
			$len = isset($part[1]) ? $part[1] : Db_Query::HASH_LEN;
			$group[] = $field;
			$order[] = "CAST($hash($field) AS CHAR($len))";
		}

		// if any field uses 'normalize' hash
		// the original shard shall have MySQL NORMALIZE() function defined
		// MySQL version of NORMALIZE handles only 255 chars and does not add md5 hash
		// (see Db_Utils::normalize)
		if ($normalize) {
			try {
				$pdo->exec("DROP FUNCTION IF EXISTS NORMALIZE;");
				$pdo->exec("CREATE FUNCTION NORMALIZE(s CHAR(255))
						RETURNS CHAR(255) DETERMINISTIC
						BEGIN
					    	DECLARE res CHAR(255) DEFAULT '';
					  		DECLARE t CHAR(1);
					    	WHILE LENGTH(s) > 0 DO
					        	SET t = LOWER(LEFT(s, 1));
					    	    SET s = SUBSTRING(s FROM 2);
					        	IF t REGEXP '[^A-Za-z0-9]' THEN
					            	SET t = '_';
					        	END IF;
					        	SET res = CONCAT(res, t);
					    	END WHILE;
					    	RETURN res;
						END"
					);
			} catch (Exception $e) {
				//echo "ERROR: {$e->getMessage()}\n";
				echo "Please, make sure that db user for shard '$shard_name' has 'CREATE ROUTINE' permission\n";
				return false;
			}
		}

		$order = join(', ', $order);
		$group = join(', ', $group);
		$where = "(STRCMP(CONCAT($order), '$lower') >= 0)"
			.(isset($upper) ? " AND (STRCMP(CONCAT($order), '$upper') < 0)" : "");

		$count = reset($pdo
						->query("SELECT COUNT(*) FROM $shard_table WHERE $where")
						->fetchAll(PDO::FETCH_NUM));

		if (empty($count)) {
			echo "Failed to connect to shard '$shard_name'\n";
			return false;
		}

		$count = reset($count);

		if ($count == 0) {
			echo "Cannot split empty shard!\n";
			return false;
		}

		// if only one new shard provided script will copy data and cnange config
		if (($num_shards = count($parts)) < 1) {
			echo "Please, provide at least one new shard";
			return false;
		}

		$break = round($count/$num_shards);
		// if split config is not mapped and current config is mapped we shall convert split
		//  config to mapped
		$new_partition = ($mapped  || $split_mapped
			? array($shard => ($split_mapped
						? reset(array_keys($parts))
						: $shard))
			: array($shard));
		$new_shards = array($split_mapped ? reset(array_keys($parts)) : $shard => reset($parts));

		$i = 0;
		foreach (array_slice($parts, 1) as $name => $dsn) {
			$offset = $break*(++$i);
			$split = reset($pdo->query("SELECT $group FROM $shard_table WHERE $where ORDER BY $order LIMIT $offset, 1")->fetchAll(PDO::FETCH_ASSOC));
			foreach ($fields as $field => $hash)
				$split[$field] = Db_Query::hashed($split[$field], $hash);
			$split = join('.', $split);
			if ($mapped || $split_mapped) $new_partition[$split] = ($split_mapped ? $name : $split);
			else $new_partition[] = $split;
			$new_shards[$new_name = ($split_mapped ? $name : $split)] = $dsn;
			if (Q_Config::get('Db', 'connections', $connection, 'shards', $new_name, false))
				echo "WARNING!!! Shard already exists: '$new_name'\n";
		}

		Q_Config::merge(array(
			'Db' => array(
				'connections' => array(
					$connection => array(
						"shards" => $new_shards
					)
				)
			)
		));

		// if split config is mapped and current config is not we shall convert app config to mapped
		if ($split_mapped && !$mapped) {
			$partition = array();
			foreach ($points as $point) {
				$partition[$point] = $point;
			}
			Q_Config::set('Db', 'connections', $connection, 'indexes', $table, 'partition', $partition);
			$mapped = true;
		};

		// TODO: verify if new shards sizes are approx. equal

		// Verify versions of existing shards and
		// Install pligin schema to new shards
		Q_Plugin::installSchema(Q_PLUGINS_DIR.DS.$plugin, $plugin, 'plugin', $connection, array('sql' => array($connection => array('enabled' => true))));

		// make sure 'upcoming' config is loaded
		$configFiles = Q_Config::get('Q', 'configFiles', array());

		// 'local/Q/bootstrap.json' should be loaded already but we'll better check
		if (!in_array('Q/config/bootstrap.json', $configFiles)) {
			echo "Config file 'Q/config/bootstrap.json' shall be loaded via 'Q/configFiles key'\non every shard - check 'platform/config/Q.json'\n";
			return false;
		}

		$upcoming_file = Q_Config::get('Q', 'internal', 'sharding', 'upcoming', 'Db/config/upcoming.json');
		//if (!unlink ($upcoming_file)) {
		//	echo "Please, manually remove file '$upcoming_file' and start this script again.\n";
		//	return false;
		//}

		if (!in_array($upcoming_file, $configFiles)) {
			// add upcoming.json to config
			if (!Q_Config::setOnServer(
				'Q/config/bootstrap.json',
				array(
					'Q' => array(
						'configFiles' => array(
							$upcoming_file
						)
					)
				))) {
				echo "Failed to update 'local/Q/bootstrap.json'\n";
				return false;
			}
		}

		// Now after some short time all workers (php and node) will be ready for splitting
		// We'll let node server to wait necessary amount of time.
		$res = Q_Utils::queryInternal('Db/Shards', array(
				'Q/method' => 'split',
				'shard' => $shard_name,
				'shards' => Q::json_encode($new_shards),
				'part' => $shard,
				'table' => $table,
				'dbTable' => $shard_table,
				'class' => $class,
				'plugin' => $plugin,
				'connection' => $connection,
				'where' => $where,
				'parts' => Q::json_encode(array('partition' => $new_partition, 'fields' => $fields))
			), $node);
		if ($res) {
			echo "Split process for shard '$shard_name' ($shard) has started\nPlease, monitor node.js console for important messages and process status\n";
			return true;
		};
		echo "Failed to start split process at node server\n";
		return false;
	}
	
	/**
	 * Attempts to recover interrupted shards split process
	 * @method splitRecover
	 * @static
	 */
	static function splitRecover () {
		if (Q_Config::get('Db', 'upcoming', false) && ($node = Q_Config::get('Db', 'internal', 'sharding', 'logServer', false))) {
			if (Q_Utils::queryInternal('Db/Shards', array('Q/method' => 'reset'), $node)) {
				echo "Split process was reset successfuly\n";
				return true;
			}
		}
		echo "Please, remove 'Db/config/upcoming.json', verify config, drop new shards and start split process again\n";
		return false;
	}

	/**
	 * Logs queries executed on shards
	 * @method logShardQuery
	 * @static
	 * @param {array} $params
	 */
	static function logShardQuery($params)
	{
		if (!is_array($params) || empty($params['queries'])) {
			return;
		}

		foreach ($params['queries'] as $shard => $query) {
			if (!is_object($query) || $query->className === 'Users_Session') {
				continue;
			}

			if (!is_callable(array($query, 'getClause'))) {
				continue;
			}

			$connection = $query->db->connectionName();

			if ($begin = $query->getClause('BEGIN')
			and $query->nestedTransactionCount == 1) {
				Q::log($begin);
			}

			$duration = ceil($query->endedTime - $query->startedTime);
			Q::log(
				"Query $connection on shard \"$shard\":\n$params[sql]\n(duration: $duration ms)\n\n",
				null,
				array('maxLength' => 10000)
			);

			if ($commit = $query->getClause('COMMIT')
			and $query->nestedTransactionCount == 0) {
				Q::log($commit);
			}

			if (!empty($params['exception'])) {
				Q::log("ROLLBACK (due to exception)");
				Q::log("query was: " . $params['sql']);
				Q::log($params['exception'], null, true, array(
					'maxLength' => 2000
				));
			} else if ($rollback = $query->getClause('ROLLBACK')) {
				Q::log($rollback);
			}
		}
	}

	/**
	 * Logs missing indexes information
	 * @method logMissingIndexes
	 * @static
	 * @param {array} $params
	 */
	static function logMissingIndexes($params)
	{
		if (!is_array($params)
		|| empty($params['query'])
		|| empty($params['sql'])) {
			return;
		}

		$query = $params['query'];

		// Only if the query annotated itself
		if (!isset($query->missingIndexInfo)) {
			return;
		}

		// Only if Q::backtrace exists
		if (!is_callable(array('Q', 'backtrace'))) {
			return;
		}

		$logDir  = APP_FILES_DIR . DS . 'Q' . DS . 'logs';
		$logFile = $logDir . DS . 'Db-analytics.json';

		if (!is_dir($logDir)) {
			@mkdir($logDir, 0775, true);
		}

		$data = array();

		if (is_readable($logFile)) {
			try {
				$json = file_get_contents($logFile);
				$data = json_decode($json, true);
				if (!is_array($data)) {
					$data = array();
				}
			} catch (Exception $e) {
				$data = array();
			}
		}

		if (empty($data['missingIndex'])) {
			$data['missingIndex'] = array();
		}

		$trace = Q::backtrace('{{class}}::{{function}}', 3);
		$key   = $trace ? $trace[0] : 'unknown';

		if (empty($data['missingIndex'][$key])) {
			$data['missingIndex'][$key] = array(
				'count'     => 1,
				'backtrace' => $trace
			);
		} else {
			$data['missingIndex'][$key]['count']++;
		}

		file_put_contents(
			$logFile,
			json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)
		);
	}
	
	static $compare_field_name;

	// ============================================================
	// Model generation (adapter-agnostic)
	// ============================================================

	static function generateModels (
		Db_Interface $db,
		$directory, 
		$classname_prefix = null)
	{
		$dc = '/**';
		if (!file_exists($directory))
			throw new Exception("directory $directory does not exist.");
		
		$connectionName = $db->connectionName();
		$conn = Db::getConnection($connectionName);
		
		$prefix = empty($conn['prefix']) ? '' : $conn['prefix'];
		$prefix_len = strlen($prefix);
		
		if (!isset($classname_prefix)) {
			$classname_prefix = isset($connectionName) ? $connectionName . '_' : '';
		}
		
		$rows = $db->_listTables();
		
		if (class_exists('Q_Config')) {
			$ext = Q_Config::get('Q', 'extensions', 'class', 'php');
		} else {
			$ext = 'php';
		}
			
		$table_classnames = array();
		$js_table_classes_string = '';
		$class_name_prefix = rtrim(ucfirst($classname_prefix), "._");
		
		$class_extras = $js_class_extras = '';
		
		$filenames = array();
		foreach ($rows as $row) {
			$table_name = $row;
			$table_name_base = substr($table_name, $prefix_len);
			$table_name_prefix = substr($table_name, 0, $prefix_len);
			if (empty($table_name_base) or $table_name_prefix != $prefix
			or stristr($table_name, '_Q_') !== false) {
				continue; // no class generated
			}
			
			$class_name_base = null;
			$js_base_class_string = '';
			$base_class_string = self::codeForModelBaseClass($db,
				$table_name, 
				$directory, 
				$classname_prefix, 
				$class_name_base, 
				null,
				$js_base_class_string,
				$table_comment
			); // sets the $class_name variable
			$class_name = ucfirst($classname_prefix) . $class_name_base;
			if (empty($class_name)) {
				continue; // no class generated
			}
	
			$class_name_parts = explode('_', $class_name);
			$class_filename = $directory.DS.implode(DS, $class_name_parts).'.php';
			$base_class_filename = $directory.DS.'Base'.DS.implode(DS, $class_name_parts).'.php';
			$js_class_filename = $directory.DS.implode(DS, $class_name_parts).'.js';
			$js_base_class_filename = $directory.DS.'Base'.DS.implode(DS, $class_name_parts).'.js';
			$js_base_class_require = 'Base/'.implode('/', $class_name_parts);
			$js_class_name = implode('.', $class_name_parts);
			$js_base_class_name = implode('.Base.', $class_name_parts);

			$class_extras = is_readable($class_filename.'.inc') ? file_get_contents($class_filename.'.inc') : '';
			$js_class_extras = is_readable($js_class_filename.'.inc') ? file_get_contents($js_class_filename.'.inc') : '';
			
			if ($class_extras) {
				$class_extras = <<<EOT
					
	/* * * *
	 * Including content of '$class_name_base.php.inc' below
	 * * * */
$class_extras
	/* * * */
	
EOT;
			}
			if ($js_class_extras) {
				$js_class_extras = <<<EOT
					
	/* * * *
	 * Including content of '$class_name_base.js.inc' below
	 * * * */
$class_extras
	/* * * */
	
EOT;
			}

			$class_string = <<<EOT
<?php
$dc
 * @module $connectionName
 */
$dc
 * Class representing '$class_name_base' rows in the '$connectionName' database
 * You can create an object of this class either to
 * access its non-static methods, or to actually
 * represent a $table_name_base row in the $connectionName database.
 *
 * @class $class_name
 * @extends Base_$class_name
 */
class $class_name extends Base_$class_name
{
	$dc
	 * The setUp() method is called the first time
	 * an object of this class is constructed.
	 * @method setUp
	 */
	function setUp()
	{
		parent::setUp();
		// INSERT YOUR CODE HERE
		// e.g. \$db->hasMany(...) and stuff like that.
	}

	/*
	 * Add any $class_name methods here, whether public or not
	 */
	 
	$dc
	 * Implements the __set_state method, so it can work with
	 * with var_export and be re-imported successfully.
	 * @method __set_state
	 * @static
	 * @param {array} \$array
	 * @return {{$class_name}} Class instance
	 */
	static function __set_state(array \$array) {
		\$result = new $class_name();
		foreach(\$array as \$k => \$v)
			\$result->\$k = \$v;
		return \$result;
	}
};
EOT;

			$js_class_string = <<<EOT
$dc
 * Class representing $table_name_base rows.
 *
 * This description should be revised and expanded.
 *
 * @module $connectionName
 */
var Q = require('Q');
var Db = Q.require('Db');
var $class_name_base = Q.require('$js_base_class_require');

$dc
 * Class representing '$class_name_base' rows in the '$connectionName' database
$table_comment * @namespace $class_name_prefix
 * @class $class_name_base
 * @extends Base.$js_class_name
 * @constructor
 * @param {Object} fields The fields values to initialize table row as
 * an associative array of {column: value} pairs
 */
function $class_name (fields) {

	// Run mixed-in constructors
	$class_name.constructors.apply(this, arguments);
	
	/*
 	 * Add any privileged methods to the model class here.
	 * Public methods should probably be added further below.
	 */
}

Q.mixin($class_name, $class_name_base);

/*
 * Add any public methods here by assigning them to $class_name.prototype
 */

$dc
 * The setUp() method is called the first time
 * an object of this class is constructed.
 * @method setUp
 */
$class_name.prototype.setUp = function () {
	// put any code here
	// overrides the Base class
};

module.exports = $class_name;
EOT;

			// overwrite base class file if necessary, but not the class file
			Db_Utils::saveTextFile($base_class_filename, $base_class_string);
			$filenames[] = $base_class_filename;
			Db_Utils::saveTextFile($js_base_class_filename, $js_base_class_string);
			$filenames[] = $js_base_class_filename;
			if (! file_exists($class_filename)) {
				Db_Utils::saveTextFile($class_filename, $class_string);
				$filenames[] = $class_filename;
			}
			if (! file_exists($js_class_filename)) {
				Db_Utils::saveTextFile($js_class_filename, $js_class_string);
				$filenames[] = $js_class_filename;
			}
			
			$table_classnames[] = $class_name;
			$js_table_classes_string .= <<<EOT

$dc
 * Link to $connectionName.$class_name_base model
 * @property $class_name_base
 * @type $connectionName.$class_name_base
 */
Base.$class_name_base = Q.require('$connectionName/$class_name_base');

EOT;
		}
		
		// Generate the "module model" base class file
		$table_classnames_exported = var_export($table_classnames, true);
		$table_classnames_json = $pk_json_indented = str_replace(
			array("[", ",", "]"),
			array("[\n\t", ",\n\t", "\n]"),
			json_encode($table_classnames)
		);
		if (!empty($connectionName)) {
			$class_name = Db::generateTableClassName($connectionName);
			$class_name_parts = explode('_', $class_name);
			$class_filename = $directory.DS.implode(DS, $class_name_parts).'.php';
			$base_class_filename = $directory.DS.'Base'.DS.implode(DS, $class_name_parts).'.php';
			$js_class_filename = $directory.DS.implode(DS, $class_name_parts).'.js';
			$js_base_class_filename = $directory.DS.'Base'.DS.implode(DS, $class_name_parts).'.js';
			$js_base_class_require = 'Base'.'/'.implode('/', $class_name_parts);
			$dbname =
			// because table name can be {{prefix}}_Q_plugin or {{prefix}}_Q_app we need to know correct table name
			$tables = $db->rawQuery(
				"SELECT table_comment"
				." FROM INFORMATION_SCHEMA.TABLES"
				." WHERE table_schema = '{$db->dbname}' and table_name LIKE '{$prefix}Q_%'"
			)->execute()->fetchAll(PDO::FETCH_NUM);
			$model_comment = (!empty($tables[0]['table_comment']))
				 ? " * <br>{".$tables[0]['table_comment']."}\n"
				 : '';
			$model_extras = is_readable($class_filename.'.inc') ? file_get_contents($class_filename.'.inc') : '';
			$js_model_extras = is_readable($js_class_filename.'.inc') ? file_get_contents($js_class_filename.'.inc') : '';

			$base_class_string = <<<EOT
<?php

$dc
 * Autogenerated base class for the $connectionName model.
 * 
 * Don't change this file, since it can be overwritten.
 * Instead, change the $class_name.php file.
 *
 * @module $connectionName
 */
$dc
 * Base class for the $class_name model
 * @class Base_$class_name
 */
abstract class Base_$class_name
{
	$dc
	 * The list of model classes
	 * @property \$table_classnames
	 * @type array
	 */
	static \$table_classnames = $table_classnames_exported;
$class_extras
	$dc
     * This method calls Db.connect() using information stored in the configuration.
     * If this has already been called, then the same db object is returned.
	 * @method db
	 * @return {Db_Interface} The database object
	 */
	static function db()
	{
		return Db::connect('$connectionName');
	}

	$dc
	 * The connection name for the class
	 * @method connectionName
	 * @return {string} The name of the connection
	 */
	static function connectionName()
	{
		return '$connectionName';
	}
};
EOT;

			$js_base_class_string = <<<EOT
$dc
 * Autogenerated base class for the $connectionName model.
 * 
 * Don't change this file, since it can be overwritten.
 * Instead, change the $class_name.js file.
 *
 * @module $connectionName
 */
var Q = require('Q');
var Db = Q.require('Db');
$js_class_extras
$dc
 * Base class for the $class_name model
 * @namespace Base
 * @class $class_name
 * @static
 */
function Base () {
	return this;
}
 
module.exports = Base;

$dc
 * The list of model classes
 * @property tableClasses
 * @type array
 */
Base.tableClasses = $table_classnames_json;

$dc
 * This method calls Db.connect() using information stored in the configuration.
 * If this has already been called, then the same db object is returned.
 * @method db
 * @return {Db} The database connection
 */
Base.db = function () {
	return Db.connect('$connectionName');
};

$dc
 * The connection name for the class
 * @method connectionName
 * @return {string} The name of the connection
 */
Base.connectionName = function() {
	return '$connectionName';
};
$js_table_classes_string
EOT;

		$class_string = <<<EOT
<?php
$dc
 * $class_name_prefix model
$model_comment * @module $connectionName
 * @main $connectionName
 */
$dc
 * Static methods for the $connectionName models.
 * @class $class_name
 * @extends Base_$class_name
 */
abstract class $class_name extends Base_$class_name
{
	/*
	 * This is where you would place all the static methods for the models,
	 * the ones that don't strongly pertain to a particular row or table.
	 * If file '$class_name.php.inc' exists, its content is included
	 * * * */
$model_extras
	/* * * */
};
EOT;

		$js_class_string = <<<EOT
$dc
 * $class_name_prefix model
$model_comment * @module $connectionName
 * @main $connectionName
 */
var Q = require('Q');

$dc
 * Static methods for the $class_name_prefix model
 * @class $class_name_prefix
 * @extends Base.$class_name_prefix
 * @static
 */
function $connectionName() { };
module.exports = $connectionName;

var Base_$connectionName = Q.require('$js_base_class_require');
Q.mixin($connectionName, Base_$connectionName);

/*
 * This is where you would place all the static methods for the models,
 * the ones that don't strongly pertain to a particular row or table.
 * Just assign them as methods of the $connectionName object.
 * If file '$class_name.js.inc' exists, its content is included
 * * * */
$js_model_extras
/* * * */
EOT;

			// overwrite base class file if necessary, but not the class file
			Db_Utils::saveTextFile($base_class_filename, $base_class_string);
			$filenames[] = $base_class_filename;
			Db_Utils::saveTextFile($js_base_class_filename, $js_base_class_string);
			$filenames[] = $js_base_class_filename;
			if (! file_exists($class_filename)) {
				$filenames[] = $class_filename;
				Db_Utils::saveTextFile($class_filename, $class_string);
			}
			if (! file_exists($js_class_filename)) {
				$filenames[] = $js_class_filename;
				Db_Utils::saveTextFile($js_class_filename, $js_class_string);
			}
		}
		$directoryLen = strlen($directory.DS);
		foreach ($filenames as $i => $filename) {
			$filenames[$i] = substr($filename, $directoryLen);
		}
		return $filenames;
	}

	/**
	 * Generates code for a base class for the model
	 * @method codeForModelBaseClass
	 * @param {string} $table The name of the table to generate the code for.
	 * @param {string} $directory The path of the directory in which to place the model code.
	 * @param {string} [$classname_prefix=''] The prefix to prepend to the generated class names
	 * @param {&string} [$class_name_base=null] If set, this is the class name that is used.
	 *  If an unset variable is passed, it is filled with the
	 *  class name that is ultimately chosen, without the $classname_prefix
	 * @param {string} [$prefix=null] Defaults to the prefix of the tables, as specified in the connection.
	 *  Pass null here to use the default, or a string to override it.
	 * @param {&string} [$js_code=null] The javascript code for the base class
	 * @param {&string} [$table_comment=''] The comment from the MySQL table if any
	 * @return {string} The generated code for the class.
	 */
	static function codeForModelBaseClass (
		Db_Interface $db,
		$table_name, 
		$directory,
		$classname_prefix = '',
		&$class_name_base = null,
		$prefix = null,
		&$js_code = null,
		&$table_comment = '')
	{
		$dc = '/**';
		if (empty($table_name))
			throw new Exception('table_name parameter is empty', - 2);
		if (empty($directory))
			throw new Exception('directory parameter is empty', - 3);
	
		$connectionName = $db->connectionName();
		$conn = Db::getConnection($connectionName);
		
		if (!isset($prefix)) {
			$prefix = empty($conn['prefix']) ? '' : $conn['prefix'];
		}
		if (!empty($prefix)) {
			$prefix_len = strlen($prefix);
			$table_name_base = substr($table_name, $prefix_len);
			$table_name_prefix = substr($table_name, 0, $prefix_len);
			if (empty($table_name_base) or $table_name_prefix != $prefix)
				return ''; // no class generated
		} else {
			$table_name_base = $table_name;
		}

		if (empty($classname_prefix))
			$classname_prefix = '';
		if (!isset($class_name_base)) {
			$class_name_base = Db::generateTableClassName($table_name_base);
		}
		$class_name = ucfirst($classname_prefix) . $class_name_base;
		$table_cols = $db->_introspectColumns($table_name);
		$table_comment = $db->_introspectTableComment($table_name);
		
		// Calculate primary key
		$pk = array();
		foreach ($table_cols as $k => $table_col) {
			if ($table_col['Key'] == 'PRI') {
				$pk[] = $table_col['Field'];
			}
			$table_cols[$k]['Default'] = $db->_normalizeDefault($table_col['Default']);
		}
		$pk_exported = var_export($pk, true);
		$pk_json = json_encode($pk);

		// Fetch index information
		$indexes = $db->_introspectTableIndexes($table_name);

		$indexes_exported = var_export($indexes, true);
		$indexes_json = json_encode($indexes);


		// Magic field name arrays
		$possibleMagicFields = array('insertedTime', 'updatedTime', 'created_time', 'updated_time');
		$possibleMagicInsertFields = array('insertedTime', 'created_time');
		
		// Calculate validation functions
		$functions = array();
		$js_functions = array();
		$field_names = array();
		$field_nulls = array();
		$properties = array();
		$js_properties = array();
		$required_field_names = array();
		$magic_field_names = array();
		$defaults = array();
		$comments = array();
		$defaultsAlreadyInDB = array();
		foreach ($table_cols as $table_col) {
			$is_magic_field = null;
			$field_name = $table_col['Field'];
			$field_names[] = $field_name;
			$field_null = $table_col['Null'] == 'YES' ? true : false;
			$field_nulls[] = $field_null;
			$field_default = $table_col['Default'];
			$comments[] = $table_col['Comment'];
			$field_name_safe = preg_replace('/[^0-9a-zA-Z\_]/', '_', $field_name);
			$auto_inc = (strpos($table_col['Extra'], 'auto_increment') !== false);
			$type = $table_col['Type'];
			$pieces = explode('(', $type);
			$pieces2 = $type_display_range = $type_modifiers = $type_unsigned = null;
			if (isset($pieces[1])) {
				$pieces2 = explode(')', $pieces[1]);
				$pieces2_count = count($pieces2);
				if ($pieces2_count > 2) { // could happen if enum's values have ")"
					$pieces2 = array(
						implode(')', array_slice($pieces2, 0, -1)), 
						end($pieces2)
					);
				}
			}
			$type_name = $pieces[0];
			if (isset($pieces2)) {
				$type_display_range = $pieces2[0];
				$type_modifiers = $pieces2[1];
				$type_unsigned = (strpos($type_modifiers, 'unsigned') !== false);
			}
			
			$isTextLike = false;
			$isNumberLike = false;
			$isTimeLike = false;
			
			switch ($type_name) {
				case 'tinyint':
					$type_range_min = $type_unsigned ? 0 : - 128;
					$type_range_max = $type_unsigned ? 255 : 127;
					break;
				case 'smallint':
					$type_range_min = $type_unsigned ? 0 : - 32768;
					$type_range_max = $type_unsigned ? 65535 : 32767;
					break;
				case 'mediumint':
					$type_range_min = $type_unsigned ? 0 : - 8388608;
					$type_range_max = $type_unsigned ? 16777215 : 8388607;
					break;
				case 'int':
					$type_range_min = $type_unsigned ? 0 : - 2147483648;
					$type_range_max = $type_unsigned ? 4294967295 : 2147483647;
					break;
				case 'bigint':
					$type_range_min = $type_unsigned ? 0 : - 9223372036854775808;
					$type_range_max = $type_unsigned ? 18446744073709551615 : 9223372036854775807;
					break;
				case 'tinytext':
				case 'tinyblob':
					$type_display_range = 255;
					break;
				case 'text':
				case 'blob':
					$type_display_range = 65535;
					break;
				case 'mediumtext':
				case 'mediumblob':
					$type_display_range = 16777216;
					break;
				case 'longtext':
				case 'longblob':
					$type_display_range = 4294967296;
					break;
			}
			$field_name_exported = var_export($field_name, true);
			
			$null_check = $field_null ? "if (!isset(\$value)) {\n\t\t\treturn array($field_name_exported, \$value);\n\t\t}\n\t\t" : '';
			$null_fix = $field_null ? '' : "if (!isset(\$value)) {\n\t\t\t\$value='';\n\t\t}\n\t\t";
			$dbe_check = "if (\$value instanceof Db_Expression\n               or \$value instanceof Db_Range) {\n\t\t\treturn array($field_name_exported, \$value);\n\t\t}\n\t\t";
			$js_null_check = $field_null ? "if (value == undefined) return value;\n\t\t" : '';
			$js_null_fix = $field_null ? '' : "if (value == null) {\n\t\t\tvalue='';\n\t\t}\n\t\t";
			$js_dbe_check = "if (value instanceof Db.Expression) return value;\n\t\t";
			if (! isset($functions["beforeSet_$field_name_safe"]))
				$functions["beforeSet_$field_name_safe"] = array();
			if (! isset($js_functions["beforeSet_$field_name_safe"]))
				$js_functions["beforeSet_$field_name_safe"] = array();
			$type_name_lower = strtolower($type_name);
			switch ($type_name_lower) {
				case 'tinyint':
				case 'smallint':
				case 'int':
				case 'mediumint':
				case 'bigint':
					$isNumberLike = true;
					$properties[]="integer $field_name";
					$js_properties[] = "Integer $field_name";
					$functions["maxSize_$field_name_safe"]['comment'] = <<<EOT
	$dc
	 * @method maxSize_$field_name_safe
	 * Returns the maximum integer that can be assigned to the $field_name field
	 * @return {integer}
	 */
EOT;
					$functions["maxSize_$field_name_safe"]['args'] = '';
					$functions["maxSize_$field_name_safe"]['return_statement'] = <<<EOT
		return $type_range_max;
EOT;
					$functions["beforeSet_$field_name_safe"][] = <<<EOT
		{$null_check}{$dbe_check}if (!is_numeric(\$value) or floor(\$value) != \$value)
			throw new Exception('Non-integer value being assigned to '.\$db->getTable().".$field_name");
		\$value = intval(\$value);
		if (\$value < $type_range_min or \$value > $type_range_max) {
			\$json = json_encode(\$value);
			throw new Exception("Out-of-range value \$json being assigned to ".\$db->getTable().".$field_name");
		}
EOT;
					$functions["beforeSet_$field_name_safe"]['comment'] = <<<EOT
	$dc
	 * Method is called before setting the field and verifies if integer value falls within allowed limits
	 * @method beforeSet_$field_name_safe
	 * @param {integer} \$value
	 * @return {array} An array of field name and value
	 * @throws {Exception} An exception is thrown if \$value is not integer or does not fit in allowed range
	 */
EOT;
					$js_functions["maxSize_$field_name_safe"]['comment'] = <<<EOT
$dc
 * Returns the maximum integer that can be assigned to the $field_name field
 * @return {integer}
 */
EOT;
					$js_functions["maxSize_$field_name_safe"]['args'] = '';
					$js_functions["maxSize_$field_name_safe"]['return_statement'] = <<<EOT
		return $type_range_max;
EOT;
					$js_functions["beforeSet_$field_name_safe"][] = <<<EOT
		{$js_null_check}{$js_dbe_check}value = Number(value);
		if (isNaN(value) || Math.floor(value) != value) 
			throw new Error('Non-integer value being assigned to '+this.table()+".$field_name");
		if (value < $type_range_min || value > $type_range_max)
			throw new Error("Out-of-range value "+JSON.stringify(value)+" being assigned to "+this.table()+".$field_name");
EOT;
					$js_functions["beforeSet_$field_name_safe"]['comment'] = <<<EOT
$dc
 * Method is called before setting the field and verifies if integer value falls within allowed limits
 * @method beforeSet_$field_name_safe
 * @param {integer} value
 * @return {integer} The value
 * @throws {Error} An exception is thrown if 'value' is not integer or does not fit in allowed range
 */
EOT;
					$default = isset($table_col['Default'])
						? $table_col['Default']
						: ($field_null ? null : 0);
					$js_defaults[] = $defaults[] = json_encode((int)$default);
					$defaultsAlreadyInDB[] = isset($table_col['Default']);
					break;

				case 'enum':
					$properties[]="string $field_name";
					$js_properties[] = "String $field_name";
					$functions["beforeSet_$field_name_safe"][] = <<<EOT
		{$null_check}{$dbe_check}if (!in_array(\$value, array($type_display_range)))
			throw new Exception("Out-of-range value '\$value' being assigned to ".\$db->getTable().".$field_name");
EOT;
					$functions["beforeSet_$field_name_safe"]['comment'] = <<<EOT
	$dc
	 * Method is called before setting the field and verifies if value belongs to enum values list
	 * @method beforeSet_$field_name_safe
	 * @param {string} \$value
	 * @return {array} An array of field name and value
	 * @throws {Exception} An exception is thrown if \$value does not belong to enum values list
	 */
EOT;
					$js_functions["beforeSet_$field_name_safe"][] = <<<EOT
		{$js_null_check}{$js_dbe_check}if ([$type_display_range].indexOf(value) < 0)
			throw new Error("Out-of-range value "+JSON.stringify(value)+" being assigned to "+this.table()+".$field_name");
EOT;
					$js_functions["beforeSet_$field_name_safe"]['comment'] = <<<EOT
$dc
 * Method is called before setting the field and verifies if value belongs to enum values list
 * @method beforeSet_$field_name_safe
 * @param {string} value
 * @return {string} The value
 * @throws {Error} An exception is thrown if 'value' does not belong to enum values list
 */
EOT;
					$default = isset($table_col['Default'])
						? $table_col['Default']
						: null;
					$js_defaults[] = $defaults[] = json_encode($default);
					$defaultsAlreadyInDB[] = isset($table_col['Default']);
					break;
				
				case 'char':
				case 'varchar':
				case 'binary':
				case 'varbinary':
				case 'tinytext':
				case 'text':
				case 'mediumtext':
				case 'longtext':
				case 'tinyblob':
				case 'blob':
				case 'mediumblob':
				case 'longblob':
					$isTextLike = true;
					$isBinary = in_array($type_name_lower, array(
						'binary', 'varbinary',
						'tinyblob', 'blob', 'mediumblob', 'longblob'
					));
					$orBuffer1 = $isBinary ? "|Buffer" : "";
					$properties[]="string $field_name";
					$js_properties[] = "String$orBuffer1 $field_name";
					$functions["maxSize_$field_name_safe"]['comment'] = <<<EOT
	$dc
	 * Returns the maximum string length that can be assigned to the $field_name field
	 * @return {integer}
	 */
EOT;
					$functions["maxSize_$field_name_safe"]['args'] = '';
					$functions["maxSize_$field_name_safe"]['return_statement'] = <<<EOT
		return $type_display_range;
EOT;
					$functions["beforeSet_$field_name_safe"][] = <<<EOT
		{$null_check}{$null_fix}{$dbe_check}if (!is_string(\$value) and !is_numeric(\$value))
			throw new Exception('Must pass a string to '.\$db->getTable().".$field_name");

EOT;
					if ($type_display_range and $type_display_range < $db->maxCheckStrlen) {
						$functions["beforeSet_$field_name_safe"][] = <<<EOT
		if (mb_strlen(\$value) > $type_display_range)
			throw new Exception('Exceedingly long value being assigned to '.\$db->getTable().".$field_name");
EOT;
					}
					$functions["beforeSet_$field_name_safe"]['comment'] = <<<EOT
	$dc
	 * Method is called before setting the field and verifies if value is string of length within acceptable limit.
	 * Optionally accept numeric value which is converted to string
	 * @method beforeSet_$field_name
	 * @param {string} \$value
	 * @return {array} An array of field name and value
	 * @throws {Exception} An exception is thrown if \$value is not string or is exceedingly long
	 */
EOT;
					$js_functions["maxSize_$field_name_safe"]['comment'] = <<<EOT
	$dc
	 * Returns the maximum string length that can be assigned to the $field_name field
	 * @return {integer}
	 */
EOT;
					$js_functions["maxSize_$field_name_safe"]['args'] = '';
					$js_functions["maxSize_$field_name_safe"]['return_statement'] = <<<EOT
		return $type_display_range;
EOT;
					$bufferCheck = $isBinary ? " && !(value instanceof Buffer)" : "";
					$orBuffer2 = $isBinary ? " or Buffer" : "";
					$js_functions["beforeSet_$field_name_safe"][] = <<<EOT
		{$js_null_check}{$js_null_fix}{$js_dbe_check}if (typeof value !== "string" && typeof value !== "number"$bufferCheck)
			throw new Error('Must pass a String$orBuffer2 to '+this.table()+".$field_name");
		if (typeof value === "string" && value.length > $type_display_range)
			throw new Error('Exceedingly long value being assigned to '+this.table()+".$field_name");
EOT;
					$js_functions["beforeSet_$field_name_safe"]['comment'] = <<<EOT
$dc
 * Method is called before setting the field and verifies if value is string of length within acceptable limit.
 * Optionally accept numeric value which is converted to string
 * @method beforeSet_$field_name_safe
 * @param {string} value
 * @return {string} The value
 * @throws {Error} An exception is thrown if 'value' is not string or is exceedingly long
 */
EOT;
					$default = isset($table_col['Default'])
						? $table_col['Default']
						: ($field_null ? null : '');
					$js_defaults[] = $defaults[] = json_encode($default);
					$defaultsAlreadyInDB[] = isset($table_col['Default']);
					break;
				
				case 'date':
					$isTimeLike = true;
					$properties[]="string|Db_Expression $field_name";
					$js_properties[] = "String|Db.Expression $field_name";
					$functions["beforeSet_$field_name_safe"][] = <<<EOT
		{$null_check}{$dbe_check}\$date = date_parse(\$value);
		if (!empty(\$date['errors'])) {
			\$json = json_encode(\$value);
			throw new Exception("Date \$json in incorrect format being assigned to ".\$db->getTable().".$field_name");
		}
		\$value = date("Y-m-d H:i:s", strtotime(\$value));
		\$date = date_parse(\$value);
		foreach (array('year', 'month', 'day', 'hour', 'minute', 'second') as \$v) {
			\$\$v = \$date[\$v];
		}
		\$value = sprintf("%04d-%02d-%02d", \$year, \$month, \$day);
EOT;
					$functions["beforeSet_$field_name_safe"]['comment'] = <<<EOT
	$dc
	 * Method is called before setting the field and normalize the date string
	 * @method beforeSet_$field_name_safe
	 * @param {string} \$value
	 * @return {array} An array of field name and value
	 * @throws {Exception} An exception is thrown if \$value does not represent valid date
	 */
EOT;
					$js_functions["beforeSet_$field_name_safe"][] = <<<EOT
		{$js_null_check}{$js_dbe_check}value = (value instanceof Date) ? Base.db().toDateTime(value) : value;
EOT;
					$js_functions["beforeSet_$field_name_safe"]['comment'] = <<<EOT
$dc
 * Method is called before setting the field
 * @method beforeSet_$field_name_safe
 * @param {String} value
 * @return {Date|Db.Expression} If 'value' is not Db.Expression the current date is returned
 */
EOT;
					$default = isset($table_col['Default'])
						? $table_col['Default']
						: ($field_null ? null : '');
					$isExpression = (
						$default === 'CURRENT_TIMESTAMP'
						or ($default && strpos($default, '(') !== false)
					);
					$defaults[] = $isExpression
						? 'new Db_Expression(' . json_encode($default) . ')'
						: json_encode($default);
					$js_defaults[] = $isExpression
						? 'new Db.Expression(' . json_encode($default) . ')'
						: json_encode($default);
					$defaultsAlreadyInDB[] = isset($table_col['Default']);
					break;
				case 'datetime':
				case 'timestamp':
					$isTimeLike = true;
					$properties[]="string|Db_Expression $field_name";
					$js_properties[] = "String|Db.Expression $field_name";
					if (in_array($field_name, $possibleMagicFields) and !isset($field_default)) {
						$magic_field_names[] = $field_name;
						$is_magic_field = true;
					}
					$functions["beforeSet_$field_name_safe"][] = <<<EOT
		{$null_check}{$dbe_check}if (\$value instanceof DateTime) {
			\$value = \$value->getTimestamp();
		}
		if (is_numeric(\$value)) {
			\$newDateTime = new DateTime();
			\$datetime = \$newDateTime->setTimestamp(\$value);
		} else {
			\$datetime = new DateTime(\$value);
		}
		\$value = \$datetime->format("Y-m-d H:i:s");
EOT;
					$functions["beforeSet_$field_name_safe"]['comment'] = <<<EOT
	$dc
	 * Method is called before setting the field and normalize the DateTime string
	 * @method beforeSet_$field_name_safe
	 * @param {string} \$value
	 * @return {array} An array of field name and value
	 * @throws {Exception} An exception is thrown if \$value does not represent valid DateTime
	 */
EOT;
					$js_functions["beforeSet_$field_name_safe"][] = <<<EOT
		{$js_null_check}{$js_dbe_check}if (typeof value !== 'object' && !isNaN(value)) {
			value = parseInt(value);
			value = new Date(value < 10000000000 ? value * 1000 : value);
		}
		value = (value instanceof Date) ? Base.db().toDateTime(value) : value;
EOT;
					$js_functions["beforeSet_$field_name_safe"]['comment'] = <<<EOT
$dc
 * Method is called before setting the field
 * @method beforeSet_$field_name_safe
 * @param {String} value
 * @return {Date|Db.Expression} If 'value' is not Db.Expression the current date is returned
 */
EOT;
					$default = isset($table_col['Default'])
						? $table_col['Default']
						: ($field_null ? null : '');
					$isExpression = (
						$default === 'CURRENT_TIMESTAMP'
						or ($default and strpos($default, '(') !== false)
					);
					$defaults[] = $isExpression
						? 'new Db_Expression(' . json_encode($default) . ')'
						: json_encode($default);
					$js_defaults[] = $isExpression
						? 'new Db.Expression(' . json_encode($default) . ')'
						: json_encode($default);
					$defaultsAlreadyInDB[] = isset($table_col['Default']);
					break;

				case 'numeric':
				case 'decimal':
				case 'float':
				case 'double':
					$isNumberLike = true;
					$properties[]="float $field_name";
					$js_properties[] = "Number $field_name";
					$functions["beforeSet_$field_name_safe"][] = <<<EOT
		{$null_check}{$dbe_check}if (!is_numeric(\$value))
			throw new Exception('Non-numeric value being assigned to '.\$db->getTable().".$field_name");
		\$value = floatval(\$value);
EOT;
					$js_functions["beforeSet_$field_name_safe"][] = <<<EOT
		{$js_null_check}{$js_dbe_check}value = Number(value);
		if (isNaN(value))
			throw new Error('Non-number value being assigned to '+this.table()+".$field_name");
EOT;
					$js_functions["beforeSet_$field_name_safe"]['comment'] = <<<EOT
$dc
 * Method is called before setting the field to verify if value is a number
 * @method beforeSet_$field_name_safe
 * @param {number} value
 * @return {number} The value
 * @throws {Error} If 'value' is not number
 */
EOT;
					$default = isset($table_col['Default'])
						? $table_col['Default']
						: ($field_null ? null : 0);
					$js_defaults[] = $defaults[] = json_encode((double)$default);
					$defaultsAlreadyInDB[] = isset($table_col['Default']);
					break;

				default:
					$properties[]="mixed $field_name";
					$js_properties[] = "mixed $field_name";
					$default = isset($table_col['Default'])
						? $table_col['Default']
						: ($field_null ? null : '');
					$js_defaults[] = $defaults[] = json_encode($default);
					$defaultsAlreadyInDB[] = isset($table_col['Default']);
					break;
			}
			if (! empty($functions["beforeSet_$field_name_safe"])) {
				$functions["beforeSet_$field_name_safe"]['return_statement'] = <<<EOT
		return array('$field_name', \$value);
EOT;
			}
			if (! empty($js_functions["beforeSet_$field_name_safe"])) {
				$js_functions["beforeSet_$field_name_safe"]['return_statement'] = <<<EOT
		return value;
EOT;
			}
			if (! $field_null and ! $is_magic_field
			and ((!$isNumberLike and !$isTextLike) or in_array($field_name, $pk))
			and ! $auto_inc and !isset($field_default)) {
				$required_field_names[] = $field_name_exported;
			}
			
			$columnInfo = array(
				array($type_name, $type_display_range, $type_modifiers, $type_unsigned),
				$field_null,
				$table_col['Key'],
				$table_col['Default']
			);
			$columnInfo_php = var_export($columnInfo, true);
			$columnInfo_js = json_encode($columnInfo);
			$functions["column_$field_name_safe"]['comment'] = <<<EOT
	$dc
	 * Returns schema information for $field_name column
	 * @return {array} [[typeName, displayRange, modifiers, unsigned], isNull, key, default]
	 */
EOT;
			$functions["column_$field_name_safe"]['static'] = true;
			$functions["column_$field_name_safe"]['args'] = '';
			$functions["column_$field_name_safe"]['return_statement'] = <<<EOT
return $columnInfo_php;
EOT;
			$js_functions["column_$field_name_safe"]['static'] = true;
			$js_functions["column_$field_name_safe"]['comment'] = <<<EOT
	$dc
	 * Returns schema information for $field_name column
	 * @return {array} [[typeName, displayRange, modifiers, unsigned], isNull, key, default]
	 */
EOT;
			$js_functions["column_$field_name_safe"]['args'] = '';
			$js_functions["column_$field_name_safe"]['return_statement'] = <<<EOT
return $columnInfo_js;
EOT;
		
		}
		
		$field_names_json = json_encode($field_names);
		$field_names_json_indented = str_replace(
			array("[", ",", "]"),
			array("[\n\t\t", ",\n\t\t", "\n\t]"),
			$field_names_json
		);
		
		
		$field_names_exported = "\$db->fieldNames()";
		
		$functions['beforeSave'] = array();
		$js_functions['beforeSave'] = array();
		if ($required_field_names) {
			$required_fields_string = implode(',', $required_field_names);
			$beforeSave_code = <<<EOT
		if (!\$db->retrieved) {
			\$table = \$db->getTable();
			foreach (array($required_fields_string) as \$name) {
				if (!isset(\$value[\$name])) {
					throw new Exception("the field \$table.\$name needs a value, because it is NOT NULL, not auto_increment, and lacks a default value.");
				}
			}
		}
EOT;
			$js_beforeSave_code = <<<EOT
	var fields = [$required_fields_string], i;
	if (!this._retrieved) {
		var table = this.table();
		for (i=0; i<fields.length; i++) {
			if (this.fields[fields[i]] === undefined) {
				throw new Error("the field "+table+"."+fields[i]+" needs a value, because it is NOT NULL, not auto_increment, and lacks a default value.");
			}
		}
	}
EOT;
			$functions["beforeSave"][] = $beforeSave_code;
			$js_functions["beforeSave"][] = $js_beforeSave_code;
		}

		//$functions['beforeSave'] = array();
		if (count($magic_field_names) > 0) {
			$beforeSave_code = '';
			$js_beforeSave_code = '';
			foreach (array('created_time', 'insertedTime') as $cmf) {
				if (in_array($cmf, $magic_field_names)) {
					$beforeSave_code .= <<<EOT

		if (!\$db->retrieved and !isset(\$value['$cmf'])) {
			\$db->$cmf = \$value['$cmf'] = new Db_Expression('CURRENT_TIMESTAMP');
		}

EOT;
					$js_beforeSave_code .= <<<EOT

	if (!this._retrieved && !value['$cmf']) {
		this['$cmf'] = value['$cmf'] = new Db.Expression('CURRENT_TIMESTAMP');
	}
EOT;
					break;
				}
			}
			foreach (array('updated_time', 'updatedTime') as $umf) {
				if (in_array($umf, $magic_field_names)) {
					$beforeSave_code .= <<<EOT
						
		// convention: we'll have $umf = $cmf if just created.
		\$db->$umf = \$value['$umf'] = new Db_Expression('CURRENT_TIMESTAMP');
EOT;
					$js_beforeSave_code .= <<<EOT

	// convention: we'll have $umf = $cmf if just created.
	this['$umf'] = value['$umf'] = new Db.Expression('CURRENT_TIMESTAMP');
EOT;
					break;
				}
			}
			$functions['beforeSave'][] = $beforeSave_code;
			$js_functions['beforeSave'][] = $js_beforeSave_code;
		}

		foreach ($field_nulls as $i => $isNull) {
			if ($isNull) {
				continue;
			}
			$fn = $field_names[$i];
			if (in_array($fn, $possibleMagicFields)) {
				continue;
			}
			if ($defaultsAlreadyInDB[$i]) {
				continue;
			}
			$fn_json = json_encode($fn);
			$fd = $defaults[$i];
			$js_fd = $js_defaults[$i];
			if ($fd !== 'null') {
				$functions["beforeSave"][] = <<<EOT

		if (!isset(\$db->fields[$fn_json]) and !isset(\$value[$fn_json])) {
			\$db->$fn = \$value[$fn_json] = $fd;
		}
EOT;
				$js_functions["beforeSave"][] = <<<EOT

	if (this.fields[$fn_json] == undefined && value[$fn_json] == undefined) {
		this.fields[$fn_json] = value[$fn_json] = $js_fd;
	}
EOT;
			}
		}

		if (!empty($functions['beforeSave'])) {
			$functions['beforeSave']['return_statement'] = <<<EOT
		return \$value;
EOT;
			$functions['beforeSave']['comment'] = <<<EOT
	$dc
	 * Check if mandatory fields are set and updates 'magic fields' with appropriate values
	 * @method beforeSave
	 * @param {array} \$value The array of fields
	 * @return {array}
	 * @throws {Exception} If mandatory field is not set
	 */
EOT;
			$js_functions['beforeSave']['return_statement'] = <<<EOT
	return value;
EOT;
			$js_functions['beforeSave']['comment'] = <<<EOT
$dc
 * Check if mandatory fields are set and updates 'magic fields' with appropriate values
 * @method beforeSave
 * @param {Object} value The object of fields
 * @param {Function} callback Call this callback if you return null
 * @return {Object|null} Return the fields, modified if necessary. If you return null, then you should call the callback(err, modifiedFields)
 * @throws {Error} If e.g. mandatory field is not set or a bad values are supplied
 */
EOT;
		}
		
		$functions['fieldNames'] = array();
		$fieldNames_exported = Db_Utils::var_export($field_names);
		$fieldNames_code = <<<EOT
		\$field_names = $fieldNames_exported;
		\$result = \$field_names;
		if (!empty(\$table_alias)) {
			\$temp = array();
			foreach (\$result as \$field_name)
				\$temp[] = \$table_alias . '.' . \$field_name;
			\$result = \$temp;
		} 
		if (!empty(\$field_alias_prefix)) {
			\$temp = array();
			reset(\$field_names);
			foreach (\$result as \$field_name) {
				\$temp[\$field_alias_prefix . current(\$field_names)] = \$field_name;
				next(\$field_names);
			}
			\$result = \$temp;
		}
EOT;
		$return_statement = <<<EOT
		return \$result;
EOT;
		$functions['fieldNames'][] = $fieldNames_code;
		$functions['fieldNames']['return_statement'] = $return_statement;
		$functions['fieldNames']['args'] = '$table_alias = null, $field_alias_prefix = null';
		$functions['fieldNames']['static'] = true;
		$functions['fieldNames']['comment'] = <<<EOT
	$dc
	 * Retrieves field names for class table
	 * @method fieldNames
	 * @static
	 * @param {string} [\$table_alias=null] If set, the alieas is added to each field
	 * @param {string} [\$field_alias_prefix=null] If set, the method returns associative array of ('prefixed field' => 'field') pairs
	 * @return {array} An array of field names
	 */
EOT;
		$functions_code = array();
		foreach ($functions as $func_name => $func_code) {
			$func_args = isset($func_code['args']) ? $func_code['args'] : '$value';
			$func_modifiers = !empty($func_code['static']) ? 'static ' : '';
			$func_code_string = isset($func_code['comment']) ? $func_code['comment']."\n" : '';
			$func_code_string .= <<<EOT
	{$func_modifiers}function $func_name($func_args)
	{

EOT;
			if (is_array($func_code) and ! empty($func_code)) {
				foreach ($func_code as $key => $code_tool) {
					if (is_string($key))
						continue;
					$func_code_string .= $code_tool;
				}
				$func_code_string .= "\n" . $func_code['return_statement'];
			}
			$func_code_string .= <<<EOT
			
	}
EOT;
			if (! empty($func_code))
				$functions_code[] = $func_code_string;
		}
		$functions_string = implode("\n\n", $functions_code);
	
		foreach ($js_functions as $func_name => $func_code) {
			$func_args = isset($func_code['args']) ? $func_code['args'] : 'value';
			$instance = isset($func_code['instance']) ? '.prototype' : '';
			$func_code_string = isset($func_code['comment']) ? $func_code['comment']."\n" : '';
			$prototype = empty($func_code['static']) ? 'prototype.' : '';
			$func_code_string .= <<<EOT
Base.$prototype$func_name = function ($func_args) {

EOT;
			if (is_array($func_code) and ! empty($func_code)) {
				foreach ($func_code as $key => $code_tool) {
					if (is_string($key))
						continue;
					$func_code_string .= $code_tool;
				}
				$func_code_string .= "\n" . $func_code['return_statement'];
			}
			$func_code_string .= <<<EOT

};
EOT;
			if (! empty($func_code))
				$js_functions_code[] = $func_code_string;
		}
		$js_functions_string = implode("\n\n", $js_functions_code);

		$pk_exported_indented = str_replace("\n", "\n\t\t\t", $pk_exported);
		$pk_json_indented = str_replace(
			array("[", ",", "]"),
			array("[\n\t\t", ",\n\t\t", "\n\t]"),
			$pk_json
		);
		$connectionName_var = var_export($connectionName, true);
		$class_name_var = var_export($class_name, true);

		$class_name_prefix = rtrim(ucfirst($classname_prefix), "._");

		$properties2 = array();
		$js_properties2 = array();
		foreach ($properties as $k => $v) {
			$tmp = explode(' ', $v);
			$default = $defaults[$k];
			$comment = str_replace('*/', '**', $comments[$k]);
			$properties[$k] = <<<EOT
	$dc
	 * @property \${$tmp[1]}
	 * @type $tmp[0]
	 * @default $default
	 * $comment
	 */
EOT;
			$required = !$field_nulls[$k] && !isset($default);
			$properties2[$k] = $required
				? " * @param {".$tmp[0]."} \$fields.".$tmp[1]
				: " * @param {".$tmp[0]."} [\$fields.".$tmp[1]."] defaults to $default";
		}
		foreach ($js_properties as $k => $v) {
			$tmp = explode(' ', $v);
			$default = $js_defaults[$k];
			$comment = str_replace('*/', '**', $comments[$k]);
			$js_properties[$k] = <<<EOT
$dc
 * @property $tmp[1]
 * @type $tmp[0]
 * @default $default
 * $comment
 */
EOT;
			$required = !$field_nulls[$k] && !isset($default);
			$js_properties2[$k] = !empty($required)
				? " * @param {".$tmp[0]."} fields.".$tmp[1]
				: " * @param {".$tmp[0]."} [fields.".$tmp[1]."] defaults to $default";
		}
		$field_hints = implode("\n", $properties);
		$field_hints2 = implode("\n", $properties2);
		$js_field_hints = implode("\n", $js_properties);
		$js_field_hints2 = implode("\n", $js_properties2);
		
		// Here is the base class:
		$base_class_string = <<<EOT
<?php

$dc
 * Autogenerated base class representing $table_name_base rows
 * in the $connectionName database.
 *
 * Don't change this file, since it can be overwritten.
 * Instead, change the $class_name.php file.
 *
 * @module $connectionName
 */
$dc
 * Base class representing '$class_name_base' rows in the '$connectionName' database
 * @class Base_$class_name
 * @extends Db_Row
 *
 * @param {array} [\$fields=array()] The fields values to initialize table row as 
 * an associative array of \$column => \$value pairs
$field_hints2
 */
abstract class Base_$class_name extends Db_Row
{
$field_hints
	$dc
	 * The setUp() method is called the first time
	 * an object of this class is constructed.
	 * @method setUp
	 */
	function setUp()
	{
		\$db->setDb(self::db());
		\$db->setTable(self::table());
		\$db->setPrimaryKey(
			$pk_exported_indented
		);
	}

	$dc
	 * Connects to database
	 * @method db
	 * @static
	 * @return {Db_Interface} The database object
	 */
	static function db()
	{
		return Db::connect($connectionName_var);
	}

	$dc
	 * Retrieve the table name to use in SQL statement
	 * @method table
	 * @static
	 * @param {boolean} [\$with_db_name=true] Indicates wheather table name should contain the database name
	 * @param {string} [\$alias=null] You can optionally provide an alias for the table to be used in queries
 	 * @return {string|Db_Expression} The table name as string optionally without database name if no table sharding
	 * was started or Db_Expression class with prefix and database name templates is table was sharded
	 */
	static function table(\$with_db_name = true, \$alias = null)
	{
		if (class_exists('Q_Config') and Q_Config::get('Db', 'connections', '$connectionName', 'indexes', '$class_name_base', false)) {
			return new Db_Expression((\$with_db_name ? '{{dbname}}.' : '').'{{prefix}}'.'$table_name_base');
		} else {
			\$conn = Db::getConnection($connectionName_var);
  			\$prefix = empty(\$conn['prefix']) ? '' : \$conn['prefix'];
  			\$table_name = \$prefix . '$table_name_base';
  			if (!\$with_db_name)
  				return \$table_name;
  			\$db = Db::connect($connectionName_var);
			\$alias = isset(\$alias) ? ' '.\$alias : '';
  			return \$db->dbName().'.'.\$table_name.\$alias;
		}
	}
	$dc
	 * The connection name for the class
	 * @method connectionName
	 * @static
	 * @return {string} The name of the connection
	 */
	static function connectionName()
	{
		return $connectionName_var;
	}

	$dc
	 * Returns index metadata for the table
	 * @method indexes
	 * @static
	 * @return {array}
	 */
	static function indexes()
	{
		return $indexes_exported;
	}

	$dc
	 * Returns true if a left-prefix index exists for the given columns
	 * @method hasIndexOn
	 * @static
	 * @param {array} \$columns
	 * @return {boolean}
	 */
	static function hasIndexOn(array \$columns)
	{
		foreach (self::indexes() as \$idx) {
			if (array_slice(\$idx['columns'], 0, count(\$columns)) === \$columns) {
				return true;
			}
		}
		return false;
	}

	$dc
	 * Create SELECT query to the class table
	 * @method select
	 * @static
	 * @param {string|array} [\$fields=null] The fields as strings, or array of alias=>field.
	 *   The default is to return all fields of the table.
	 * @param {string} [\$alias=null] Table alias.
	 * @return {Db_Query} The generated query
	 */
	static function select(\$fields=null, \$alias = null)
	{
		if (!isset(\$fields)) {
			\$fieldNames = array();
			\$a = isset(\$alias) ? \$alias.'.' : '';
			foreach (self::fieldNames() as \$fn) {
				\$fieldNames[] = \$a .  \$fn;
			}
			\$fields = implode(',', \$fieldNames);
		}
		\$q = self::db()->select(\$fields, self::table(true, \$alias));
		\$q->className = $class_name_var;
		return \$q;
	}

	$dc
	 * Create UPDATE query to the class table
	 * @method update
	 * @static
	 * @param {string} [\$alias=null] Table alias
	 * @return {Db_Query} The generated query
	 */
	static function update(\$alias = null)
	{
		\$alias = isset(\$alias) ? ' '.\$alias : '';
		\$q = self::db()->update(self::table(true, \$alias));
		\$q->className = $class_name_var;
		return \$q;
	}

	$dc
	 * Create DELETE query to the class table
	 * @method delete
	 * @static
	 * @param {string} [\$table_using=null] If set, adds a USING clause with this table
	 * @param {string} [\$alias=null] Table alias
	 * @return {Db_Query} The generated query
	 */
	static function delete(\$table_using = null, \$alias = null)
	{
		\$alias = isset(\$alias) ? ' '.\$alias : '';
		\$q = self::db()->delete(self::table(true, \$alias), \$table_using);
		\$q->className = $class_name_var;
		return \$q;
	}

	$dc
	 * Create INSERT query to the class table
	 * @method insert
	 * @static
	 * @param {array} [\$fields=array()] The fields as an associative array of column => value pairs
	 * @param {string} [\$alias=null] Table alias
	 * @return {Db_Query} The generated query
	 */
	static function insert(\$fields = array(), \$alias = null)
	{
		\$alias = isset(\$alias) ? ' '.\$alias : '';
		\$q = self::db()->insert(self::table(true, \$alias), \$fields);
		\$q->className = $class_name_var;
		return \$q;
	}
	
	$dc
	 * Inserts multiple rows into a single table, preparing the statement only once,
	 * and executes all the queries.
	 * @method insertManyAndExecute
	 * @static
	 * @param {array} [\$rows=array()] The array of rows to insert. 
	 * (The field names for the prepared statement are taken from the first row.)
	 * You cannot use Db_Expression objects here, because the function binds all parameters with PDO.
	 * @param {array} [\$options=array()]
	 *   An associative array of options, including:
	 *
	 * * "chunkSize" {integer} The number of rows to insert at a time. defaults to 20.<br>
	 * * "onDuplicateKeyUpdate" {array} You can put an array of fieldname => value pairs here,
	 * 		which will add an ON DUPLICATE KEY UPDATE clause to the query.
	 *
	 */
	static function insertManyAndExecute(\$rows = array(), \$options = array())
	{
		self::db()->insertManyAndExecute(
			self::table(), \$rows,
			array_merge(\$options, array('className' => $class_name_var))
		);
	}
	
	$dc
	 * Create raw query with begin clause
	 * You'll have to specify shards yourself when calling execute().
	 * @method begin
	 * @static
	 * @param {string} [\$lockType=null] First parameter to pass to query->begin() function
	 * @param {string} [\$transactionKey=null] Pass a transactionKey here to "resolve" a previously
	 *  executed that began a transaction with ->begin(). This is to guard against forgetting
	 *  to "resolve" a begin() query with a corresponding commit() or rollback() query
	 *  from code that knows about this transactionKey. Passing a transactionKey that doesn't
	 *  match the latest one on the transaction "stack" also generates an error.
	 *  Passing "*" here matches any transaction key that may have been on the top of the stack.
	 * @return {Db_Query} The generated query
	 */
	static function begin(\$lockType = null, \$transactionKey = null)
	{
		\$q = self::db()->rawQuery('')->begin(\$lockType, \$transactionKey);
		\$q->className = $class_name_var;
		return \$q;
	}
	
	$dc
	 * Create raw query with commit clause
	 * You'll have to specify shards yourself when calling execute().
	 * @method commit
	 * @static
	 * @param {string} [\$transactionKey=null] Pass a transactionKey here to "resolve" a previously
	 *  executed that began a transaction with ->begin(). This is to guard against forgetting
	 *  to "resolve" a begin() query with a corresponding commit() or rollback() query
	 *  from code that knows about this transactionKey. Passing a transactionKey that doesn't
	 *  match the latest one on the transaction "stack" also generates an error.
	 *  Passing "*" here matches any transaction key that may have been on the top of the stack.
	 * @return {Db_Query} The generated query
	 */
	static function commit(\$transactionKey = null)
	{
		\$q = self::db()->rawQuery('')->commit(\$transactionKey);
		\$q->className = $class_name_var;
		return \$q;
	}
	
	$dc
	 * Create raw query with rollback clause
	 * @method rollback
	 * @static
	 * @param {array} \$criteria Can be used to target the rollback to some shards.
	 *  Otherwise you'll have to specify shards yourself when calling execute().
	 * @return {Db_Query} The generated query
	 */
	static function rollback()
	{
		\$q = self::db()->rawQuery('')->rollback();
		\$q->className = $class_name_var;
		return \$q;
	}
	
$functions_string
};
EOT;

		// Set the JS code
		$js_code = <<<EOT
$dc
 * Autogenerated base class representing $table_name_base rows
 * in the $connectionName database.
 *
 * Don't change this file, since it can be overwritten.
 * Instead, change the $class_name_prefix/$class_name_base.js file.
 *
 * @module $connectionName
 */

var Q = require('Q');
var Db = Q.require('Db');
var $connectionName = Q.require('$connectionName');
var Row = Q.require('Db/Row');

$dc
 * Base class representing '$class_name_base' rows in the '$connectionName' database
 * @namespace Base.$class_name_prefix
 * @class $class_name_base
 * @extends Db.Row
 * @constructor
 * @param {Object} [fields={}] The fields values to initialize table row as 
 * an associative array of {column: value} pairs
$js_field_hints2
 */
function Base (fields) {
	Base.constructors.apply(this, arguments);
}

Q.mixin(Base, Row);

$js_field_hints

$dc
 * This method calls Db.connect() using information stored in the configuration.
 * If this has already been called, then the same db object is returned.
 * @method db
 * @return {Db} The database connection
 */
Base.db = function () {
	return $connectionName.db();
};

$dc
 * Retrieve the table name to use in SQL statements
 * @method table
 * @param {boolean} [withoutDbName=false] Indicates wheather table name should contain the database name
 * @return {String|Db.Expression} The table name as string optionally without database name if no table sharding was started
 * or Db.Expression object with prefix and database name templates is table was sharded
 */
Base.table = function (withoutDbName) {
	if (Q.Config.get(['Db', 'connections', '$connectionName', 'indexes', '$class_name_base'], false)) {
		return new Db.Expression((withoutDbName ? '' : '{{dbname}}.')+'{{prefix}}$table_name_base');
	} else {
		var conn = Db.getConnection('$connectionName');
		var prefix = conn.prefix || '';
		var tableName = prefix + '$table_name_base';
		var dbname = Base.table.dbname;
		if (!dbname) {
			var dsn = Db.parseDsnString(conn['dsn']);
			dbname = Base.table.dbname = dsn.dbname;
		}
		return withoutDbName ? tableName : dbname + '.' + tableName;
	}
};

$dc
 * The connection name for the class
 * @method connectionName
 * @return {String} The name of the connection
 */
Base.connectionName = function() {
	return '$connectionName';
};

$dc
 * Create SELECT query to the class table
 * @method SELECT
 * @param {String|Object} [fields=null] The fields as strings, or object of {alias:field} pairs.
 *   The default is to return all fields of the table.
 * @param {String|Object} [alias=null] The tables as strings, or object of {alias:table} pairs.
 * @return {Db.Query.Mysql} The generated query
 */
Base.SELECT = function(fields, alias) {
	if (!fields) {
		fields = Base.fieldNames().map(function (fn) {
			return fn;
		}).join(',');
	}
	var q = Base.db().SELECT(fields, Base.table()+(alias ? ' '+alias : ''));
	q.className = '$class_name';
	return q;
};

$dc
 * Create UPDATE query to the class table. Use Db.Query.Mysql.set() method to define SET clause
 * @method UPDATE
 * @param {String} [alias=null] Table alias
 * @return {Db.Query.Mysql} The generated query
 */
Base.UPDATE = function(alias) {
	var q = Base.db().UPDATE(Base.table()+(alias ? ' '+alias : ''));
	q.className = '$class_name';
	return q;
};

$dc
 * Create DELETE query to the class table
 * @method DELETE
 * @param {Object}[table_using=null] If set, adds a USING clause with this table
 * @param {String} [alias=null] Table alias
 * @return {Db.Query.Mysql} The generated query
 */
Base.DELETE = function(table_using, alias) {
	var q = Base.db().DELETE(Base.table()+(alias ? ' '+alias : ''), table_using);
	q.className = '$class_name';
	return q;
};

$dc
 * Create INSERT query to the class table
 * @method INSERT
 * @param {Object} [fields={}] The fields as an associative array of {column: value} pairs
 * @param {String} [alias=null] Table alias
 * @return {Db.Query.Mysql} The generated query
 */
Base.INSERT = function(fields, alias) {
	var q = Base.db().INSERT(Base.table()+(alias ? ' '+alias : ''), fields || {});
	q.className = '$class_name';
	return q;
};

$dc
 * Create raw query with BEGIN clause.
 * You'll have to specify shards yourself when calling execute().
 * @method BEGIN
 * @param {string} [\$lockType] First parameter to pass to query.begin() function
 * @return {Db.Query.Mysql} The generated query
 */
Base.BEGIN = function(\$lockType) {
	var q = Base.db().rawQuery('').begin(\$lockType);
	q.className = '$class_name';
	return q;
};

$dc
 * Create raw query with COMMIT clause
 * You'll have to specify shards yourself when calling execute().
 * @method COMMIT
 * @return {Db.Query.Mysql} The generated query
 */
Base.COMMIT = function() {
	var q = Base.db().rawQuery('').commit();
	q.className = '$class_name';
	return q;
};

$dc
 * Create raw query with ROLLBACK clause
 * @method ROLLBACK
 * @param {Object} criteria can be used to target the query to some shards.
 *   Otherwise you'll have to specify shards yourself when calling execute().
 * @return {Db.Query.Mysql} The generated query
 */
Base.ROLLBACK = function(criteria) {
	var q = Base.db().rawQuery('').rollback(crieria);
	q.className = '$class_name';
	return q;
};

$dc
 * The name of the class
 * @property className
 * @type string
 */
Base.prototype.className = "$class_name";

// Instance methods

$dc
 * Create INSERT query to the class table
 * @method INSERT
 * @param {object} [fields={}] The fields as an associative array of {column: value} pairs
 * @param {string} [alias=null] Table alias
 * @return {Db.Query.Mysql} The generated query
 */
Base.prototype.setUp = function() {
	// does nothing for now
};

$dc
 * Create INSERT query to the class table
 * @method INSERT
 * @param {object} [fields={}] The fields as an associative array of {column: value} pairs
 * @param {string} [alias=null] Table alias
 * @return {Db.Query.Mysql} The generated query
 */
Base.prototype.db = function () {
	return Base.db();
};

$dc
 * Retrieve the table name to use in SQL statements
 * @method table
 * @param {boolean} [withoutDbName=false] Indicates wheather table name should contain the database name
 * @return {String|Db.Expression} The table name as string optionally without database name if no table sharding was started
 * or Db.Expression object with prefix and database name templates is table was sharded
 */
Base.prototype.table = function () {
	return Base.table();
};

$dc
 * Retrieves primary key fields names for class table
 * @method primaryKey
 * @return {string[]} An array of field names
 */
Base.prototype.primaryKey = function () {
	return $pk_json_indented;
};

$dc
 * Retrieves field names for class table
 * @method fieldNames
 * @return {array} An array of field names
 */
Base.prototype.fieldNames = function () {
	return Base.fieldNames();
};

$dc
 * Retrieves field names for class table
 * @method fieldNames
 * @static
 * @return {array} An array of field names
 */
Base.fieldNames = function () {
	return $field_names_json_indented;
};

$js_functions_string

module.exports = Base;
EOT;

		// Return the base class	
		return $base_class_string; // unless the above line threw an exception
	}
}
