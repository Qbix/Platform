<?php

/**
 * @module Db
 */

class Db_Mysql implements Db_Interface
{
	/**
	 * This class lets you create and use PDO database connections.
	 * @class Db_Mysql
	 * @extends Db_Interface
	 * @constructor
	 *
	 * @param {string} $connectionName The name of the connection out of the connections added with Db::setConnection()
	 * This is required for actually connecting to the database.
	 * @param {PDO} [$pdo=null] Existing PDO connection. Only accepts connections to MySQL.
	 */
	function __construct ($connectionName, $pdo = null)
	{
		$this->connectionName = $connectionName;
		if ($pdo) {
			// The following statement may throw an exception, which is fine.
			$driver_name = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
			if (strtolower($driver_name) != 'mysql')
				throw new Exception("the PDO object is not for mysql", -1);

			$this->pdo = $pdo;
		}
	}

	/**
	 * The PDO connection that this object uses
	 * @property $pdo
	 * @type PDO
	 */
	public $pdo;

	/**
	 * The shard info after calling reallyConnect
	 * @property $shardInfo
	 * @type array
	 */
	public $shardInfo;
	
	/**
	 * The name of the connection
	 * @property $connectionName
	 * @type string
	 * @protected
	 */
	protected $connectionName;
	
	/**
	 * The name of the shard currently selected with reallyConnect, if any
	 * @property $shardName
	 * @type string
	 * @protected
	 */
	protected $shardName;

	/**
	 * The database name of the shard currently selected with reallyConnect, if any
	 * @property $dbname
	 * @type string
	 */
	public $dbname;

	/**
	 * The prefix of the shard currently selected with reallyConnect, if any
	 * @property $prefix
	 * @type string
	 */
	public $prefix;

	/**
	 * The cutoff after which strlen gets too expensive to check automatically
	 * @property $maxCheckStrlen
	 * @type string
	 */
	public $maxCheckStrlen = 1000000;

	/**
	 * Actually makes a connection to the database (by creating a PDO instance)
	 * @method reallyConnect
	 * @param {array} [$shardName=null] A shard name that was added using Db::setShard.
	 * This modifies how we connect to the database.
	 * @return {PDO} The PDO object for connection
	 */
	function reallyConnect($shardName = null, &$shardInfo = null)
	{
		if ($this->pdo) {
			$shardInfo = $this->shardInfo;
			return $this->pdo;
		}
		$connectionName = $this->connectionName;
		$connectionInfo = Db::getConnection($connectionName);
		if (empty($connectionInfo)) {
			throw new Exception("database connection \"$connectionName\" wasn't registered with Db.", -1);
		}
		
		if (empty($shardName)) {
			$shardName = '';
		}
		$modifications = Db::getShard($connectionName, $shardName);
		if (!isset($modifications)) {
			$modifications = array();
		}
		if (class_exists('Q')) {
			/**
			 * Occurs before a real connection to the database is made
			 * @event Db/reallyConnect {before}
			 * @param {Db_Mysql} db
			 * @param {string} shardName
			 * @param {array} modifications
			 * @return {array}
			 *	Extra modifications
			 */
			$more = Q::event('Db/reallyConnect', array(
				'db' => $this,
				'shardName' => $shardName,
				'modifications' => $modifications
			), 'before');
			if ($more) {
				$modifications = array_merge($modifications, $more);
			}
		}
		
		$dsn = isset($modifications['dsn']) ? $modifications['dsn'] : $connectionInfo['dsn'];
		$prefix = isset($modifications['prefix']) ? $modifications['prefix'] : $connectionInfo['prefix'];
		$username = isset($modifications['username']) ? $modifications['username'] : $connectionInfo['username'];
		$password = isset($modifications['password']) ? $modifications['password'] : $connectionInfo['password'];
		$driver_options = isset($modifications['driver_options']) 
			? $modifications['driver_options'] 
			: (isset($connectionInfo['driver_options']) ? $connectionInfo['driver_options'] : null);

		$this->shardInfo = $shardInfo = compact('dsn', 'prefix', 'username', 'password', 'driver_options');

		// More dsn changes
		$dsn_fields = array();
		foreach (array('host', 'port', 'dbname', 'unix_socket', 'charset') as $f) {
			if (isset($modifications[$f])) {
				$dsn_fields[$f] = $modifications[$f];
			}
		}
		if ($dsn_fields) {
			$dsn_array = array_merge(Db::parseDsnString($dsn), $dsn_fields);
			$dsn = 'mysql:'.http_build_query($dsn_array, '', ';');
		} else {
			$dsn_array = Db::parseDsnString($dsn);
		}

		// The connection may have already been made with these parameters,
		// in which case we will just retrieve the existing connection.
		$this->pdo = Db::pdo($dsn, $username, $password, $driver_options, $connectionName, $shardName);
		$this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
		$this->shardName = $shardName;
		$this->dbname = $dsn_array['dbname'];
		$this->prefix = $prefix;

		if (class_exists('Q')) {
			/**
			 * Occurs when a real connection to the database has been made
			 * @event Db/reallyConnect {after}
			 * @param {Db_Mysql} db
			 * @param {string} shardName
			 * @param {array} modifications
			 */
			Q::event('Db/reallyConnect', array(
				'db' => $this,
				'shardName' => $shardName,
				'modifications' => $modifications
			), 'after');
		}
		$this->pdo->setAttribute(PDO::ATTR_EMULATE_PREPARES, false);
		$this->pdo->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, true);
		return $this->pdo;
	}
	
	/**
	 * Sets the timezone in the database to match the one in PHP
	 * @param {integer} [$offset=0] in seconds
	 * @method setTimezone
	 */
	function setTimezone($offset = null)
	{
		if (!isset($offset)) {
			$offset = (int)date('Z');
		}
		if (!$offset) {
			$offset = 0;
		}
		$abs = abs($offset);
		$hours = sprintf("%02d", floor($abs / 3600));
		$minutes = sprintf("%02d", floor(($abs % 3600) / 60));
		$sign = ($offset > 0) ? '+' : '-';
		$this->pdo->exec("SET time_zone = '$sign$hours:$minutes';");
	}
	
	/**
	 * Returns the lowercase name of the dbms (e.g. "mysql")
	 * @method dbms
	 * @return {string}
	 */
	function dbms()
	{
		return 'mysql';
	}
	
	/**
	 * Returns the name of the shard currently selected with reallyConnect, if any
	 * @return {string}
	 */
	function shardName()
	{
		return $this->shardName;
	}

	/**
	 * Forwards all other calls to the PDO object
	 * @method __call
	 * @param {string} $name The function name
	 * @param {array} $arguments The arguments
	 * @return {mixed} The result of method call
	 */
	function __call ($name, array $arguments)
	{
		$this->reallyConnect();
		if (!is_callable(array($this->pdo, $name))) {
			throw new Exception("neither Db_Mysql nor PDO supports the $name function");
		}
		return call_user_func_array(array($this->pdo, $name), $arguments);
	}

	/**
	 * Returns the name of the connection with which this Db object was created.
	 * @method connectionName
	 * @return {string}
	 */
	function connectionName ()
	{
		return isset($this->connectionName) ?  $this->connectionName : null;
	}
	
	/**
	 * Returns the connection info with which this Db object was created.
	 * @method connection
	 * @return {string}
	 */
	function connection()
	{
		if (isset($this->connectionName)) {
			return Db::getConnection($this->connectionName);
		}
		return null;
	}
	
	/**
	 * Returns an associative array representing the dsn
	 * @method dsn
	 * @return {array}
	 */
	function dsn()
	{
		$connectionInfo = Db::getConnection($this->connectionName);
		if (empty($connectionInfo['dsn'])) {
			throw new Exception(
				'No dsn string found for the connection ' 
				. $this->connectionName
			);
		}
		return Db::parseDsnString($connectionInfo['dsn']);
	}
	
	/**
	 * Returns the lowercase name of the dbms (e.g. "mysql")
	 * @method dbms
	/**
	 * Returns the name of the database used
	 * @method dbName
	 * @return {string}
	 */
	function dbName()
	{
		$dsn = $this->dsn();
		if (empty($dsn))
			return null;
		return $dsn['dbname'];
	}

	/**
	 * Creates a query to select fields from a table. Needs to be used with Db_Query::from().
	 * @method select
	 * @param {string|array} [$fields='*'] The fields as strings, or "*", or array of alias=>field
	 * @param {string|array} [$tables=''] The tables as strings, or array of alias=>table
	 * @return {Db_Query_Mysql} The resulting Db_Query object
	 */
	function select ($fields = '*', $tables = '')
	{
		if (!isset($fields))
			throw new Exception("fields not specified in call to 'select'.");
		if (!isset($tables))
			throw new Exception("tables not specified in call to 'select'.");
		$query = new Db_Query_Mysql($this, Db_Query::TYPE_SELECT);
		return $query->select($fields, $tables);
	}

	/**
	 * Creates a query to insert a row into a table
	 * @method insert
	 * @param {string} $table_into The name of the table to insert into
	 * @param {array} $fields=array()
	 *   The fields as an array of column=>value pairs.
	 *   Or you can pass an array of column names here,
	 *   if doing insert()->select() queries.
	 * @return {Db_Query_Mysql} The resulting Db_Query_Mysql object
	 */
	function insert ($table_into, array $fields = array())
	{
		if (empty($table_into))
			throw new Exception("table not specified in call to 'insert'.");
		
		// $fields might be an empty array,
		// but the insert will still be attempted.
		
		$columnsList = array();
		$valuesList = array();
		if (Q::isAssociative($fields)) {
			foreach ($fields as $column => $value) {
				$columnsList[] = Db_Query_Mysql::column($column);
				if ($value instanceof Db_Expression) {
					$valuesList[] = "$value";
				} else {
					$valuesList[] = ":$column";
				}
			}
			$columnsString = implode(', ', $columnsList);
			$valuesString = implode(', ', $valuesList);
		} else {
			foreach ($fields as $column) {
				$columnsList[] = Db_Query_Mysql::column($column);
			}
			$columnsString = implode(', ', $columnsList);
			$valuesString = ''; // won't be used
		}
		
		$clauses = array(
			'INTO' => "$table_into ($columnsString)",
			'VALUES' => $valuesString
		);
		
		return new Db_Query_Mysql($this, Db_Query::TYPE_INSERT, $clauses, $fields, $table_into);
	}

	/**
	 * Inserts multiple rows into a single table, preparing the statement only once,
	 * and executes all the queries. It triggers beforeSave and afterSaveExecute
	 * on the rows, unless it finds beforeInsertManyAndExecute and/or afterInsertManyAndExecute respectively.
	 * @method insertManyAndExecute
	 * @param {string} $table_into The name of the table to insert into
	 * @param {array} [$rows=array()] The array of rows to insert. 
	 *    Each row should be an array of ($field => $value) pairs, with the exact
	 *    same set of keys (field names) in each array. This results in bulk insertion.
	 *    Some or all rows can also be Db_Row instead of an array. 
	 *    In this case, hooks will be triggered for events, such as
	 *    "before" hook for "Db/Row/{{className}}/save" -- which may cause other queries to run.
	 * @param {array} [$options=array()] An associative array of options, including:
	 * @param {array} [$options.columns] Pass an array of column names, otherwise
	 *    they are automatically taken from the first row being inserted.
	 * @param {string} [$options.className]
	 *    If you provide the class name, the system will be able to use any sharding
	 *    indexes under that class name in the config.
	 * @param {integer} [$options.chunkSize]
	 *    The number of rows to insert at a time. Defaults to 20.
	 *    You can also put 0 here, which means unlimited chunks, but it's not recommended.
	 * @param {array} [$options.onDuplicateKeyUpdate]
	 *    You can put an array of fieldname => value pairs here,
	 *    which will add an ON DUPLICATE KEY UPDATE clause to the query.
	 *    Consider using new Db_Expression("VALUES(fieldName)") for the values of fields
	 *    that you'd want to update on existing rows, and Db_Expression("CURRENT_TIMESTAMP")
	 *    for magic time fields.
	 *    Or you can just pass true instead of an array, and the system will do it for you.
	 */
	function insertManyAndExecute ($table_into, array $rows = array(), $options = array())
	{
		// Validate and get options
		if (empty($table_into)) {
			throw new Exception("table not specified in call to 'insertManyAndExecute'.");
		}
		if (empty($rows)) {
			return false;
		}
		$chunkSize = isset($options['chunkSize']) ? $options['chunkSize'] : 20;
		if ($chunkSize < 0) {
			return false;
		}
		$possibleMagicInsertFields = array('insertedTime', 'created_time');
		$possibleMagicUpdateFields = array('updatedTime', 'updated_time');
		$onDuplicateKeyUpdate = isset($options['onDuplicateKeyUpdate'])
				? $options['onDuplicateKeyUpdate'] : null;
		$className = isset($options['className']) ? $options['className'] : null;
		
		// Get the columns list
		$rawColumns = array();
		if (isset($options['columns'])) {
			$columnsList = $options['columns'];
			foreach ($columnsList as $c) {
				$rawColumns[$c] = $c;
			}
		} else {
			$row = reset($rows);
			$record = ($row instanceof Db_Row) ? $row->fields : $row;
			foreach ($record as $column => $value) {
				$columnsList[] = $c = Db_Query_Mysql::column($column);
				$rawColumns[$c] = $column;
			}
		}
		$columnsString = implode(', ', $columnsList);
		$into = "$table_into ($columnsString)";
		
		// On duplicate key update clause (optional)
		$update_fields = array();
		$odku_clause = '';
		if (isset($onDuplicateKeyUpdate)) {
			$odku_clause = "\n\t ON DUPLICATE KEY UPDATE ";
			$parts = array();
			if ($onDuplicateKeyUpdate === true) {
				if (empty($options['className'])) {
					throw new Exception("Db_Mysql::insertManyAndExecute: need options['className'] when onDuplicateKeyUpdate === true");
				}
				$row = new $options['className'];
				$primaryKey = $row->getPrimaryKey();
				$onDuplicateKeyUpdate = array();
				foreach ($columnsList as $c) {
					$column = isset($rawColumns[$c]) ? $rawColumns[$c] : $c;
					if (in_array($column, $primaryKey)) {
						continue;
					}
					$onDuplicateKeyUpdate[$column] = in_array($column, $possibleMagicUpdateFields)
						? new Db_Expression("CURRENT_TIMESTAMP")
						: new Db_Expression("VALUES($column)");
					break; // need only one
				}
				$fieldNames = call_user_func(array($options['className'], 'fieldNames'));
				foreach ($possibleMagicUpdateFields as $column) {
					if (in_array($column, $fieldNames)) {
						$onDuplicateKeyUpdate[$column] = new Db_Expression("CURRENT_TIMESTAMP");
					}
				}
			}
			foreach ($onDuplicateKeyUpdate as $k => $v) {
				if ($v instanceof Db_Expression) {
					$part = "= $v";
				} else {
					$part = " = :__update_$k";
					$update_fields["__update_$k"] = $v;
				}
				$parts[] .= Db_Query_Mysql::column($k) . $part;
			}
			$odku_clause .= implode(",\n\t", $parts);
		}

		// Process in outer chunks
		foreach (array_chunk($rows, $chunkSize) as $rowsChunk) {
			$rowObjects = array();
			if ($className) {
				$isCallable = is_callable(array($className, 'beforeInsertManyAndExecute'));
				foreach ($rowsChunk as $k => $row) {
					if (is_array($row)) {
						$rowObject = new $className($row);
					} else {
						$rowObject = $row;
						$row = $row->fields;
					}
					$rowObjects[] = $rowObject;
					if (!$isCallable) {
						$rowObject->beforeSave($row);
					}
					$rowsChunk[$k] = $rowObject->fields;
				}
				if ($isCallable) {
					call_user_func(array($className, 'beforeInsertManyAndExecute'), $rowObjects);
					$rowsChunk = array();
					foreach ($rowObjects as $rowObject) {
						$rowsChunk[] = $rowObject->fields;
					}
				}
			}
			
			// Start filling
			$queries = array();
			$queryCounts = array();
			$bindings = array();
			$last_q = array();
			$last_queries = array();
			foreach ($rowsChunk as $row) {
				if ($row instanceof Db_Row) {
					if (class_exists('Q') and class_exists($className)) {
						Q::event("Db/Row/$className/save", array(
							'row' => $row
						), 'before'); 
					}
					$fieldNames = method_exists($row, 'fieldNames')
						? $row->fieldNames()
						: null;
					$record = array();
					if (is_array($fieldNames)) {
						foreach ($fieldNames as $name) {
							if (array_key_exists($name, $row->fields)) {
								$record[$name] = $row->fields[$name];
							} else if (in_array($name, $possibleMagicInsertFields)) {
								$record[$name] = new Db_Expression('CURRENT_TIMESTAMP');
							}
						}
					} else {
						foreach ($row->fields as $name => $value) {
							$record[$name] = $value;
						}
					}
				} else {
					$record = $row;
					if ($className) {
						$fieldNames = call_user_func(array($className, 'fieldNames'));
						foreach ($fieldNames as $fn) {
							if (in_array($fn, $possibleMagicInsertFields)) {
								$record[$fn] = new Db_Expression('CURRENT_TIMESTAMP');
								break;
							}
						}
					}
				}
				$query = new Db_Query_Mysql($this, Db_Query::TYPE_INSERT);
				// get shard, if any
				$shard = '';
				if (isset($className)) {
					$query->className = $className;
					$sharded = $query->shard(null, $record);
					if (count($sharded) > 1 or $shard === '*') { // should be only one shard
						throw new Exception("Db_Mysql::insertManyAndExecute row should be stored on exactly one shard: " . json_encode($record));
					}
					$shard = key($sharded);
				}
				
				// start filling out the query data
				$qc = empty($queryCounts[$shard]) ? 1 : $queryCounts[$shard] + 1;
				if (!isset($bindings[$shard])) {
					$bindings[$shard] = array();
				}
				$valuesList = array();
				$index = 0;
				foreach ($columnsList as $column) {
					++$index;
					$raw = $rawColumns[$column];
					$value = isset($record[$raw]) ? $record[$raw] : null;
					if ($value instanceof Db_Expression) {
						$valuesList[] = "$value";
					} else {
						$valuesList[] = ':_'.$qc.'_'.$index;
						$bindings[$shard]['_'.$qc.'_'.$index] = $value;
					}
				}
				$valuesString = implode(', ', $valuesList);
				if (empty($queryCounts[$shard])) {
					$q = $queries[$shard] = "INSERT INTO $into\nVALUES ($valuesString) ";
					$queryCounts[$shard] = 1;
				} else {
					$q = $queries[$shard] .= ",\n       ($valuesString) ";
					++$queryCounts[$shard];
				}

				// if chunk filled up for this shard, execute it
				if ($qc === $chunkSize) {
					if ($onDuplicateKeyUpdate) {
						$q .= $odku_clause;
					}
					$query = $this->rawQuery($q)->bind($bindings[$shard]);
					if ($onDuplicateKeyUpdate) {
						$query = $query->bind($update_fields);
					}
					if (isset($last_q[$shard]) and $last_q[$shard] === $q) {
						// re-use the prepared statement, save round-trips to the db
						$query->reuseStatement($last_queries[$shard]);
					}
					$query->execute(true, $shard);
					$last_q[$shard] = $q;
					$last_queries[$shard] = $query; // save for re-use
					$bindings[$shard] = $queries[$shard] = array();
					$queryCounts[$shard] = 0;
				}
			}
			
			// Now execute the remaining queries, if any
			foreach ($queries as $shard => $q) {
				if (!$q) continue;
				if ($onDuplicateKeyUpdate) {
					$q .= $odku_clause;
				}
				$query = $this->rawQuery($q)->bind($bindings[$shard]);
				if ($onDuplicateKeyUpdate) {
					$query = $query->bind($update_fields);
				}
				if (isset($last_q[$shard]) and $last_q[$shard] === $q) {
					// re-use the prepared statement, save round-trips to the db
					$query->reuseStatement($last_queries[$shard]);
				}
				$query->execute(true, $shard);
			}
			
			foreach ($rowsChunk as $row) {
				if ($row instanceof Db_Row) {
					$row->wasInserted(true);
					$row->wasRetrieved(true);
				}
			}

			// simulate afterSaveExecute on all rows in this chunk
			if ($className) {
				if (is_callable(array($className, 'afterInsertManyAndExecute'))) {
					call_user_func(array($className, 'afterInsertManyAndExecute'), $rowObjects);
				} else {
					foreach ($rowObjects as $rowObject) {
						try {
							$rowObject->wasModified(false);
							$query = self::insert($table_into, $rowObject->fields);
							$q = $query->build();
							$stmt = null;
							$result = new Db_Result($stmt, $query);
							$rowObject->afterSaveExecute(
								$result, $query, $rowObject->fields,
								$rowObject->calculatePKValue(true),
								'insertManyAndExecute'
							);
						} catch (Exception $e) {
							// swallow errors and continue the simulation
						}
					}
				}
				Q::event("Db/Row/$className/insertManyAndExecute", array(
					'rows' => $rowObjects,
				), 'after');
			}
		} // end outer chunk
	}

	/**
	 * Drain rows from a table into a CSV file and delete them in batches.
	 * Entire process (select + delete) runs in a single transaction,
	 * guaranteeing no new rows slip between phases.
	 *
	 * Uses Db_Query helpers (`isIndexed`, `selectBatch`, `deleteRange`)
	 * to remain DBMS-agnostic at the higher level.
	 *
	 * @method archive
	 * @param {string} $table Table name
	 * @param {string} $field Indexed field to order by (e.g. "id", "insertedTime")
	 * @param {array} [$options=array()] Optional parameters:
	 *   @param {int}    [$options.limit=10000] Number of rows per batch
	 *   @param {string} [$options.outdir="/var/www/dumps"] Directory to write dump files
	 *   @param {bool}   [$options.desc=false] If true, order by DESC (default ASC)
	 *   @param {string} [$options.prefix=""] Optional prefix for filename
	 *   @param {bool}   [$options.dontZip=false] If true, leave CSV uncompressed
	 * @return {string|false} Path to the created file (.zip or .csv), or false if no rows drained
	 * @throws {Exception} If directory creation fails, field is not indexed, or write fails
	 */
	public function archive($table, $field, $limit = 10000, $options = array())
	{
		$options = array_merge(array(
			'outdir'  => APP_FILES_DIR.DS.'archives',
			'desc'    => false,
			'prefix'  => $table,
			'dontZip' => false,
			'dryRun'  => false
		), $options);

		// ensure outdir exists
		if (!is_dir($options['outdir'])) {
			if (!mkdir($options['outdir'], 0770, true)) {
				throw new Exception("Failed to create directory: {$options['outdir']}");
			}
		}

		$order = $options['desc'] ? 'DESC' : 'ASC';
		$txnKey = "archive_{$table}_{$field}";

		// build query adapter
		$query = $this->newQuery(Db_Query::TYPE_SELECT);
		if (!$query->isIndexed($table, $field)) {
			throw new Exception("Field $field is not indexed in $table");
		}

		// Begin transaction before any read
		$this->newQuery(Db_Query::TYPE_BEGIN)
			->begin(false, $txnKey)
			->execute();

		try {
			// Fetch rows within transaction (snapshot isolation)
			$rows = $query
				->select('*', $table)
				->orderBy($field, $order === 'ASC')
				->limit($limit)
				->fetchAll();
			if (!$rows || !count($rows)) {
				// nothing to archive
				$this->newQuery(Db_Query::TYPE_COMMIT)
					->commit($txnKey)
					->execute();
				return false;
			}

			// Determine cutoff boundary
			$cutoff = $rows[count($rows) - 1][$field];
			$cutIndex = count($rows) - 1;
			for (; $cutIndex >= 0; $cutIndex--) {
				if ($rows[$cutIndex][$field] !== $cutoff) break;
			}
			if ($cutIndex === count($rows) - 1) {
				throw new Exception("Archive aborted: all rows share `$field` = $cutoff");
			}

			$exportRows = array_slice($rows, 0, $cutIndex + 1);
			unset($rows);

			// Create sanitized filename
			$sanitize = function ($val) {
				$str = preg_replace('/[^A-Za-z0-9._-]+/', '_', (string)$val);
				return trim($str, '_');
			};
			$firstSafe = $sanitize($exportRows[0][$field]);
			$lastSafe  = $sanitize($exportRows[$cutIndex][$field]);
			$basename  = "{$options['prefix']}---{$firstSafe}---{$lastSafe}.csv";
			$csvPath   = rtrim($options['outdir'], '/').'/'.$basename;

			// Stream CSV with UTF-8 normalization
			$fh = fopen($csvPath, 'w');
			if (!$fh) throw new Exception("Cannot write to $csvPath");
			fputcsv($fh, array_keys($exportRows[0]));
			foreach ($exportRows as $row) {
				foreach ($row as $col => $val) {
					// ensure proper UTF-8 encoding
					if (!mb_check_encoding($val, 'UTF-8')) {
						$row[$col] = mb_convert_encoding($val, 'UTF-8', 'auto');
					}
				}
				fputcsv($fh, $row);
			}
			fclose($fh);
			unset($exportRows);

			$outPath = $csvPath;

			// Compress if requested, using Q_Zip or ZipArchive fallback
			if (!$options['dontZip']) {
				if (class_exists('Q_Zip')) {
					$zipPath = preg_replace('/\.csv$/', '.zip', $csvPath);
					$zip = new Q_Zip();
					$zip->zip_files($csvPath, $zipPath);
					unlink($csvPath);
					$outPath = $zipPath;
				} else if (class_exists('ZipArchive')) {
					$zipPath = preg_replace('/\.csv$/', '.zip', $csvPath);
					$zip = new ZipArchive();
					if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
						throw new Exception("Cannot create zip: $zipPath");
					}
					$zip->addFile($csvPath, basename($csvPath));
					$zip->close();
					unlink($csvPath);
					$outPath = $zipPath;
				}
			}

			// Delete exported rows (still in same transaction)
			if (!$options['dryRun']) {
				$delete = $this->newQuery(Db_Query::TYPE_DELETE)
					->delete($table);

				if ($options['desc']) {
					// DESC: delete rows with field >= cutoff
					$delete->where(array("$field >=" => $cutoff));
				} else {
					// ASC: delete rows with field <= cutoff
					$delete->where(array("$field <=" => $cutoff));
				}

				$delete->execute();

			}

			// Commit transaction
			$this->newQuery(Db_Query::TYPE_COMMIT)
				->commit($txnKey)
				->execute();

			return $outPath;

		} catch (Exception $e) {
			// Rollback on failure
			$this->newQuery(Db_Query::TYPE_ROLLBACK)
				->rollback()
				->execute();
			throw new Exception("Archive failed, rolled back: ".$e->getMessage(), 0, $e);
		}
	}

	/**
	 * Creates a query to update rows. Needs to be used with {@link Db_Query::set}
	 * @method update
	 * @param {string} $table The table to update
	 * @return {Db_Query_Mysql} The resulting Db_Query object
	 */
	function update ($table)
	{		
		if (empty($table))
			throw new Exception("table not specified in call to 'update'.");
		
		$clauses = array('UPDATE' => "$table");
		return new Db_Query_Mysql($this, Db_Query::TYPE_UPDATE, $clauses, array(), $table);
	}

	/**
	 * Creates a query to delete rows.
	 * @method delete
	 * @param {string} $table_from The table to delete from
	 * @param {string} [$table_using=null] If set, adds a USING clause with this table. You can then use ->join() with the resulting Db_Query.
	 * @return {Db_Query_Mysql}
	 */
	function delete ($table_from, $table_using = null)
	{	
		if (empty($table_from))
			throw new Exception("table not specified in call to 'delete'.");

		if (isset($table_using) and !is_string($table_using)) {
			throw new Exception("table_using field must be a string");
		}

		if (isset($table_using))
			$clauses = array('FROM' => "$table_from USING $table_using");
		else
			$clauses = array('FROM' => "$table_from");
		return new Db_Query_Mysql($this, Db_Query::TYPE_DELETE, $clauses, array(), $table_from);
	}

	/**
	 * Creates a query from raw SQL
	 * @method rawQuery
	 * @param {string|null} $sql May contain one or more SQL statements.
	 *  Pass null here for an empty query that you can add other clauses to, e.g. ->commit().
	 * @param {array} [$bind=array()] An array of parameters to bind to the query, using
	 * the Db_Query_Mysql->bind method. They are used to replace foo=:foo and bar=?
	 * @return {Db_Query_Mysql}
	 */
	function rawQuery ($sql = null, $bind = array())
	{
		$clauses = array('RAW' => $sql);
		$query = new Db_Query_Mysql($this, Db_Query::TYPE_RAW, $clauses);
		if ($bind) {
			$query->bind($bind);
		}
		return $query;
	}
	
	/**
	 * Creates a query to rollback a previously started transaction.
	 * @method update
	 * @param {array} $criteria The criteria to use, for sharding
	 * @return {Db_Query_Mysql} The resulting Db_Query object
	 */
	function rollback ($criteria = null)
	{
		$query = new Db_Query_Mysql($this, Db_Query::TYPE_ROLLBACK, array('ROLLBACK' => true));
		$query->rollback($criteria);
		return $query;
	}
    /**
     * Sorts a table in chunks
     * @method rank
     * @param {string} $table The name of the table in the database
     * @param {string} $pts_field The name of the field to rank by.
     * @param {string} $rank_field The rank field to update in all the rows
     * @param {integer} [$start=1] The value of the first rank
     * @param {integer} [$chunk_size=1000] The number of rows to process at a time. Default is 1000.
     * This is so the queries don't tie up the database server for very long,
     * letting it service website requests and other things.
     * @param {integer} [$rank_level2=0] Since the ranking is done in chunks, the function must know
     *  which rows have not been processed yet. If this field is empty (default)
     *  then the function sets the rank_field to 0 in all the rows, before
     *  starting the ranking process.
     *  (That might be a time consuming operation.)
     *  Otherwise, if $rank is a nonzero integer, then the function alternates
     *  between the ranges
     *  $start to $rank_level2, and $rank_level2 + $start to $rank_level2 * 2.
     *  That is, after it is finished, all the ratings will be in one of these
     *  two ranges.
     *  If not empty, this should be a very large number, like a billion.
     * @param {array} [$order_by] The order clause to use when calculating ranks.
     *  Default is array($pts_field, false)
     * @param {array} [$where=null] Any additional criteria to filter the table by.
	 *  The ranking algorithm will do its work within the results that match this criteria.
	 *  If your table is sharded, then all the work must be done within one shard.
     */
    function rank(
        $table,
        $pts_field, 
        $rank_field, 
		$start = 1,
        $chunk_size = 1000, 
        $rank_level2 = 0,
        $order_by = null,
		$where = array())
    {	
		if (!isset($order_by)) {
			$order_by = array($pts_field, false);
		}		
		if (!isset($where)) {
			$where = '1';
		}
        
        // Count all the rows
        $query = $this->select('COUNT(1) _count', $table)->where($where);
        $sharded = $query->shard();
	    $shard = key($sharded);
        if (count($sharded) > 1 or $shard === '*') { // should be only one shard
        	throw new Exception("Db_Mysql::rank can work within at most one shard");
        }
        $row = $query->execute()->fetch(PDO::FETCH_ASSOC);
        $count = $row['_count'];
		
        if (empty($rank_level2)) {
            $this->update($table)
                ->set(array($rank_field => 0))
				->where($where)
                ->execute();
            $rank_base = 0;
            $condition = "$rank_field = 0 OR $rank_field IS NULL";
        } else {
            $rows = $this->select($pts_field, $table)
                ->where("$rank_field < $rank_level2")
				->andWhere($where)
                ->limit(1)
                ->fetchAll();
            if (!empty($rows)) {
        		// There are no ranks above $rank_level2. Create ranks on level 2.
        		$rank_base = $rank_level2;
        		$condition = "$rank_field < $rank_level2";
        	} else {
        		// The ranks are all above $rank_level2. Create ranks on level 1.
        		$rank_base = 0;
        		$condition = "$rank_field >= $rank_level2";
        	}
        }
    	
        // Here comes the magic:
		$offset = 0;
		$rank_base += $start;
		$this->rawQuery("set @rank = $offset - 1")->execute(false, $shard);
        do {
			$query = $this->update($table)->set(array(
				$rank_field => new Db_Expression("$rank_base + (@rank := @rank + 1)")
			))->where($condition);
			if ($where) {
				$query = $query->andWhere($where);
			}
			if ($order_by) {
				$query = call_user_func_array(array($query, 'orderBy'), $order_by);
			}
			$query->limit($chunk_size)->execute();
			$offset += $chunk_size;
        } while ($count-$offset > 0);
    }
	/**
	 * Generate an ID that is unique in a table
	 * @method uniqueId
	 * @param {string} $table The name of the table
	 * @param {string} $field The name of the field to check for uniqueness.
	 *  You should probably have an index starting with this field.
	 * @param {array} [$where=array()] You can indicate conditions here to limit the search for
	 *  an existing value. The result is an id that is unique within a certain partition.
	 * @param {array} [$options=array()] Optional array used to override default options:
	 * @param {integer} [$options.length=8] The length of the ID to generate, after the prefix.
	 * @param {string} [$options.characters='abcdefghijklmnopqrstuvwxyz']  All the characters from which to construct the id
	 * @param {string} [$options.prefix=''] The prefix to prepend to the unique id.
	 * @param {callable} [$options.filter]
	 *     The name of a function that will take the generated string and
	 *     check it. The filter function can modify the string by returning another string,
	 *     or simply reject the string by returning false, in which case another string
	 *     will be generated and run through the filter. Make sure the filter doesn't always return false.
	 */
	function uniqueId(
		$table, 
		$field, 
		$where = array(),
		$options = array())
	{
		$length = 8;
		$characters = 'abcdefghijklmnopqrstuvwxyz';
		$prefix = '';
		extract($options);
		$count = strlen($characters);
		$attempts = 0;
		do {
			$id = $prefix;
			for ($i=0; $i<$length; ++$i) {
				$id .= $characters[mt_rand(0, $count-1)];
			}
			if (!empty($options['filter'])) {
				$p = array(@compact('id', 'table', 'field', 'where', 'options'));
				$ret = class_exists('Q')
					? Q::call($options['filter'], $p)
					: call_user_func_array($options['filter'], $p);
				if ($ret === false) {
					if (++$attempts > 100) {
						throw new Q_Exception_BadValue(array(
							'internal' => "uniqueId options[filter]",
							'problem' => "it always returns false"
						));
					}
					continue;
				} else if ($ret) {
					$id = $ret;
				}
			}
			$q = $this->select($field, $table)
				->where(array($field => $id));
			if ($where) {
				$q->andWhere($where);
			}
			$rows = $q->limit(1)->fetchAll();
		} while ($rows);
		return $id;
	}

	/**
	 * Returns a timestamp from a Date string
	 * @method fromDate
	 * @param {string} $datetime The Date string that comes from the db
	 * @return {integer} The timestamp
	 */
	function fromDate ($date)
	{
		$year = (int)substr($date, 0, 4);
		$month = (int)substr($date, 5, 2);
		$day = (int)substr($date, 8, 2);

		return mktime(0, 0, 0, $month, $day, $year);
	}
    
	/**
	 * Returns a timestamp from a DateTime string
	 * @method fromDateTime
	 * @param {string} $datetime The DateTime string that comes from the db
	 * @return {integer} The timestamp
	 */
	function fromDateTime ($datetime)
	{
		if (is_numeric($datetime)) {
			return $datetime;
		}
		$year = (int)substr($datetime, 0, 4);
		$month = (int)substr($datetime, 5, 2);
		$day = (int)substr($datetime, 8, 2);
		$hour = (int)substr($datetime, 11, 2);
		$min = (int)substr($datetime, 14, 2);
		$sec = (int)substr($datetime, 17, 2);

		return mktime($hour, $min, $sec, $month, $day, $year);
	}

	/**
	 * Converts a UNIX timestamp or date string to a 'Y-m-d' string
	 * for storing in the database.
	 * @method toDate
	 * @param {string|int} $timestamp UNIX timestamp or parseable date string
	 * @return {string} Formatted as 'Y-m-d'
	 */
	function toDate ($timestamp)
	{
		if (!is_numeric($timestamp)) {
			$timestamp = strtotime($timestamp);
		}
		if ($timestamp > 10000000000) {
			$timestamp = $timestamp / 1000;
		}
		return date('Y-m-d', $timestamp);
	}

	/**
	 * Converts a UNIX timestamp or date string to a full datetime string
	 * for storing in the database.
	 * @method toDateTime
	 * @param {string|int} $timestamp UNIX timestamp or parseable date string
	 * @return {string} Formatted as 'Y-m-d H:i:s'
	 */
	function toDateTime ($timestamp)
	{
		if (!is_numeric($timestamp)) {
			$timestamp = strtotime($timestamp);
		}
		if ($timestamp > 10000000000) {
			$timestamp = $timestamp / 1000;
		}
		return date('Y-m-d H:i:s', $timestamp);
	}
	
	/**
	 * Returns the timestamp the db server would have, based on synchronization
	 * @method timestamp
	 * @return {integer}
	 */
	function getCurrentTimestamp()
	{
		static $dbtime = null, $phptime = null;
		if (!isset($dbtime)) {
			$phptime1 = time();
			$row = $this->select('CURRENT_TIMESTAMP', '')
				->execute()
				->fetch(PDO::FETCH_NUM);
			$dbtime = $this->fromDateTime($row[0]);
			$phptime2 = time();
			$phptime = round(($phptime1 + $phptime2) / 2);
		}
		return $dbtime + (time() - $phptime);
	}
	
	/**
	 * Takes a MySQL script and returns an array of queries.
	 * When DELIMITER is changed, respects that too.
	 * @method scriptToQueries
	 * @param {string} $script The text of the script
	 * @param {callable} [$callback=null] Optional callback to call for each query.
	 * @return {array} An array of the SQL queries.
	 */
	function scriptToQueries($script, $callback = null)
	{
		$this->reallyConnect();
		$version_string = $this->pdo->getAttribute(PDO::ATTR_SERVER_VERSION);
		$version_parts = explode('.', $version_string);
		sprintf("%1d%02d%02d", $version_parts[0], $version_parts[1], $version_parts[2]);
		
		$script_stripped = $script;
		return $this->scriptToQueries_internal($script_stripped, $callback);
	}
	/**
	 * Takes stripped MySQL script and returns an array of queries.
	 * When DELIMITER is changed, respects that too.
	 * @method scriptToQueries_internal
	 * @protected
	 * @param {string} $script The text of the script
	 * @param {callable} [$callback=null] Optional callback to call for each query.
	 * @return {array} An array of the SQL queries.
	 */	
	protected function scriptToQueries_internal($script, $callback = null)
	{
		$queries = array();
		
		$script_len = strlen($script);
	
		$this->reallyConnect();
		$version_string = $this->pdo->getAttribute(PDO::ATTR_SERVER_VERSION);
		$version_parts = explode('.', $version_string);
		$version = sprintf("%1d%02d%02d", $version_parts[0], $version_parts[1], $version_parts[2]);
		
		//$mode_n = 0;  // normal 
		$mode_c = 1;  // comments
		$mode_sq = 2; // single quotes
		$mode_dq = 3; // double quotes
		$mode_bt = 4; // backticks
		$mode_lc = 5; // line comment (hash or double-dash)
		$mode_ds = 6; // delimiter statement
		
		$cur_pos = 0;
		$d = ';'; // delimiter
		$d_len = strlen($d);
		$query_start_pos = 0;
		
		$del_start_pos_array = array();
		$del_end_pos_array = array();
		
		if (class_exists('Q_Config')) {
			$separator = Q_Config::expect('Db', 'sql', 'querySeparator');
		} else {
			$separator = "# -------- NEXT QUERY STARTS HERE --------";
		}
		$found = strpos($script, $separator);
		if ($found !== false) {
			// This script was specially crafted for quick parsing
			$queries = explode($separator, $script);
			foreach ($queries as $i => $query) {
				if (!trim($query)) {
					unset($queries[$i]);
				}
			}
			return $queries;
		}
		
		while (1) {
			
			$c_pos = strpos($script, "/*", $cur_pos);
			$sq_pos = strpos($script, "'", $cur_pos);
			$dq_pos = strpos($script, "\"", $cur_pos);
			$bt_pos = strpos($script, "`", $cur_pos);
			$c2_pos = strpos($script, "--", $cur_pos);
			$c3_pos = strpos($script, "#", $cur_pos);
			$ds_pos = stripos($script, "\nDELIMITER ", $cur_pos);
			if ($cur_pos === 0 and substr($script, 0, 9) === 'DELIMITER') {
				$ds_pos = 0;
			}

			$next_pos = false;
			if ($c_pos !== false) {
				$next_mode = $mode_c;
				$next_pos = $c_pos;
				$next_end_str = "*/";
				$next_end_str_len = 2;
			}
			if ($sq_pos !== false and ($next_pos === false or $sq_pos < $next_pos)) {
				$next_mode = $mode_sq;
				$next_pos = $sq_pos;
				$next_end_str = "'";
				$next_end_str_len = 1;
			}
			if ($dq_pos !== false and ($next_pos === false or $dq_pos < $next_pos)) {
				$next_mode = $mode_dq;
				$next_pos = $dq_pos;
				$next_end_str = "\"";
				$next_end_str_len = 1;
			}
			if ($bt_pos !== false and ($next_pos === false or $bt_pos < $next_pos)) {
				$next_mode = $mode_bt;
				$next_pos = $bt_pos;
				$next_end_str = "`";
				$next_end_str_len = 1;
			}
			if ($c2_pos !== false and ($next_pos === false or $c2_pos < $next_pos)
			and ($script[$c2_pos+2] == " " or $script[$c2_pos+2] == "\t")) {
				$next_mode = $mode_lc;
				$next_pos = $c2_pos;
				$next_end_str = "\n";
				$next_end_str_len = 1;
			}
			if ($c3_pos !== false and ($next_pos === false or $c3_pos < $next_pos)) {
				$next_mode = $mode_lc;
				$next_pos = $c3_pos;
				$next_end_str = "\n";
				$next_end_str_len = 1;
			}
			if ($ds_pos !== false and ($next_pos === false or $ds_pos < $next_pos)) {
				$next_mode = $mode_ds;
				$next_pos = $ds_pos;
				$next_end_str = "\n";
				$next_end_str_len = 1;
			}
			
			// If at this point, $next_pos === false, then
			// we are in the final stretch.
			// Until the end of the string, we have normal mode.
			
			// Right now, we are in normal mode.
			$d_pos = strpos($script, $d, $cur_pos);
			while ($d_pos !== false and ($next_pos === false or $d_pos < $next_pos)) {
				$query = substr($script, $query_start_pos, $d_pos - $query_start_pos);
	
				// remove parts of the query string based on the "del_" arrays
				$del_pos_count = count($del_start_pos_array);
				if ($del_pos_count == 0) {
					$query2 = $query;
				} else {
					$query2 = substr($query, 0, $del_start_pos_array[0] - $query_start_pos);
					for ($i=1; $i < $del_pos_count; ++$i) {
						$query2 .= substr($query, $del_end_pos_array[$i-1]  - $query_start_pos, 
							$del_start_pos_array[$i] - $del_end_pos_array[$i-1]);
					}
					$query2 .= substr($query, 
						$del_end_pos_array[$del_pos_count - 1] - $query_start_pos);
				}
	
				$del_start_pos_array = array(); // reset these arrays
				$del_end_pos_array = array(); // reset these arrays
	
				$query_start_pos = $d_pos + $d_len;
				$cur_pos = $query_start_pos;
	
				$query2 = trim($query2);
				if ($query2)
					$queries[] = $query2; // <----- here is where we add to the main array
					if ($callback) {
						call_user_func($callback, $query2);
					}
				
				$d_pos = strpos($script, $d, $cur_pos);
			};
			
			if ($next_pos === false) {
				// Add the last query and get out of here:
				$query = substr($script, $query_start_pos);

				// remove parts of the query string based on the "del_" arrays
				$del_pos_count = count($del_start_pos_array);
				if ($del_pos_count == 0) {
					$query2 = $query;
				} else {
					$query2 = substr($query, 0, $del_start_pos_array[0] - $query_start_pos);
					for ($i=1; $i < $del_pos_count; ++$i) {
						$query2 .= substr($query, $del_end_pos_array[$i-1]  - $query_start_pos, 
							$del_start_pos_array[$i] - $del_end_pos_array[$i-1]);
					}
					if ($del_end_pos_array[$del_pos_count - 1] !== false) {
						$query2 .= substr($query, 
							$del_end_pos_array[$del_pos_count - 1] - $query_start_pos);
					}
				}
				
				$query2 = trim($query2);
				if ($query2) {
					$queries[] = $query2;
					if ($callback) {
						call_user_func($callback, $query2);
					}
				}
				break;
			}
			
			if ($next_mode == $mode_c) {
				// We are inside a comment
				$end_pos = strpos($script, $next_end_str, $next_pos + 1);
				if ($end_pos === false) {
					throw new Exception("unterminated comment -- missing terminating */ characters.");
				}
				
				$version_comment = false;
				if ($script[$next_pos + 2] == '!') {
					$ver = substr($script, $next_pos + 3, 5);
					if ($version >= $ver) {
						// we are in a version comment
						$version_comment = true;
					}
				}
				
				// Add to list of areas to ignore
				if ($version_comment) {
					$del_start_pos_array[] = $next_pos;
					$del_end_pos_array[] = $next_pos + 3 + 5;
					$del_start_pos_array[] = $end_pos;
					$del_end_pos_array[] = $end_pos + $next_end_str_len;
				} else {
					$del_start_pos_array[] = $next_pos;
					$del_end_pos_array[] = $end_pos + $next_end_str_len;
				}
			} else if ($next_mode == $mode_lc) {
				// We are inside a line comment
				$end_pos = strpos($script, $next_end_str, $next_pos + 1);
				$del_start_pos_array[] = $next_pos;
				if ($end_pos !== false) {
					$del_end_pos_array[] = $end_pos + $next_end_str_len;
				} else {
					$del_end_pos_array[] = false;
				}
			} else if ($next_mode == $mode_ds) {
				// We are inside a DELIMITER statement
				$start_pos = $next_pos;
				$end_pos = strpos($script, $next_end_str, $next_pos + 11);
				$del_start_pos_array[] = $next_pos;
				if ($end_pos !== false) {
					$del_end_pos_array[] = $end_pos + $next_end_str_len;
				} else {
					// this is the last statement in the script, it seems.
					// Might look funny, like:
					// DELIMITER aa sfghjkhsgkjlfhdsgjkfdglhdfsgkjfhgjdlk
					$del_end_pos_array[] = false;
				}
				// set a new delimiter!
				$try_d = trim(substr($script, $ds_pos + 11, $end_pos - ($ds_pos + 11)));
				if (!empty($try_d)) {
					$d = $try_d;
					$d_len = strlen($d);
				} // otherwise malformed delimiter statement or end of file
			} else {
				// We are inside a string
				$start_pos = $next_pos;
				$try_end_pos = $next_pos;
				do {
					$end_pos = false;
					$try_end_pos = strpos($script, $next_end_str, $try_end_pos + 1);
					if ($try_end_pos === false) {
						throw new Exception("unterminated string -- missing terminating $next_end_str character.");
					}
					if ($try_end_pos+1 >= $script_len) {
						$end_pos = $try_end_pos;
						break;
					}
					if ($script[$try_end_pos+1] == $next_end_str) {
						++$try_end_pos;
						continue;
					}
					$bs_count = 0;
					for ($i = $try_end_pos - 1; $i > $next_pos; --$i) {
						if ($script[$i] == "\\") {
							++$bs_count;
						} else {
							break;
						}
					}
					if ($bs_count % 2 == 0) {
						$end_pos = $try_end_pos;
					}
				} while ($end_pos === false);
				// If we are here, we have found the end of the string,
				// and are back in normal mode.
			}
	
			// We have exited the previous mode and set end_pos.
			if ($end_pos === false)
				break;
			$cur_pos = $end_pos + $next_end_str_len;
		}
		
		foreach ($queries as $i => $query) {
			if ($query === false) {
				unset($queries[$i]);
			}
		}

		return $queries;
	}
	
	/**
	 * Generates base classes of the models, and if they don't exist,
	 * skeleton code for the models themselves. 
	 * Use it only after you have made changes to the database schema.
	 * You shouldn't be using it on every request.
	 * @method generateModels
	 * @param {string} $directory The directory in which to generate the files.
	 *  If the files already exist, they are not overwritten,
	 *  unless they are inside the "Base" subdirectory.
	 *  If the "Base" subdirectory does not exist, it is created.
	 * @param {string} [$classname_prefix=null] The prefix to prepend to the Base class names.
	 *  If not specified, prefix becomes "connectionName_",  where connectionName is the name of the connection.
	 * @return {array} $filenames The array of filenames for files that were saved.
	 * @throws {Exception} If the $connection is not registered, or the $directory
	 *  does not exist, this function throws an exception.
	 */
	/**
	 * Generates base classes of the models, and if they don't exist,
	 * skeleton code for the models themselves.
	 * @method generateModels
	 * @param {string} $directory The directory in which to generate the files.
	 * @param {string} [$classname_prefix=null] The prefix to prepend to the Base class names.
	 * @return {array} $filenames The array of filenames for files that were saved.
	 */
	function generateModels ($directory, $classname_prefix = null)
	{
		return Db_Utils::generateModels($this, $directory, $classname_prefix);
	}

	/**
	 * Generates code for a model base class from the database schema.
	 * @method codeForModelBaseClass
	 */
	function codeForModelBaseClass (
		$table_name,
		$directory,
		$classname_prefix = '',
		&$class_name_base = null,
		$prefix = null,
		&$js_code = null,
		&$table_comment = '')
	{
		return Db_Utils::codeForModelBaseClass(
			$this, $table_name, $directory, $classname_prefix,
			$class_name_base, $prefix, $js_code, $table_comment
		);
	}

	public function _listTables() {
		return $this->rawQuery('SHOW TABLES')->execute()->fetchAll(PDO::FETCH_COLUMN, 0);
	}

	public function _introspectColumns($table_name) {
		return $this->rawQuery("SHOW FULL COLUMNS FROM $table_name")->execute()->fetchAll(PDO::FETCH_ASSOC);
	}

	public function _introspectTableComment($table_name) {
		$table_status = $this->rawQuery("SHOW TABLE STATUS WHERE Name = '$table_name'")
			->execute()->fetchAll(PDO::FETCH_COLUMN, 17);
		return (!empty($table_status[0])) ? " * <br>{$table_status[0]}\n" : '';
	}

	public function _introspectTableIndexes($table_name)
	{
		$rows = $this->rawQuery("SHOW INDEX FROM $table_name")
			->execute()
			->fetchAll(PDO::FETCH_ASSOC);

		$indexes = [];

		foreach ($rows as $r) {
			$name = $r['Key_name'];

			if (!isset($indexes[$name])) {
				$indexes[$name] = [
					'unique'  => !$r['Non_unique'],
					'type'    => 'btree', // MySQL default
					'columns' => [],
					'partial' => false
				];
			}

			$indexes[$name]['columns'][(int)$r['Seq_in_index']] = $r['Column_name'];
		}

		foreach ($indexes as &$idx) {
			ksort($idx['columns']);
			$idx['columns'] = array_values($idx['columns']);
		}

		return $indexes;
	}


	public function _normalizeDefault($d) {
		if ($d === null || $d === '') {
			return null;
		}
		if (strtolower($d) === 'current_timestamp'
		or strtolower($d) === 'current_timestamp()') {
			return 'CURRENT_TIMESTAMP';
		}
		return $d;
	}

	public function _introspectModelComment($prefix) {
		$sql = "
			SELECT table_comment
			FROM INFORMATION_SCHEMA.TABLES
			WHERE table_schema = '{$this->dbname}'
			AND table_name LIKE '{$prefix}Q_%'
			LIMIT 1
		";
		$res = $this->rawQuery($sql)->execute()->fetchAll(PDO::FETCH_ASSOC);
		if (!empty($res[0]['table_comment'])) {
			return " * <br>{$res[0]['table_comment']}\n";
		}
		return '';
	}


}

include_once(dirname(__FILE__).'/Query/Mysql.php');
