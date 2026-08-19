<?php

/**
 * @module Db
 */

class Db_Sqlite implements Db_Interface
{
	/**
	 * This class lets you create and use PDO database connections.
	 * @class Db_Sqlite
	 * @extends Db_Interface
	 * @constructor
	 *
	 * @param {string} $connectionName The name of the connection out of the connections added with Db::setConnection()
	 * @param {PDO} [$pdo=null] Existing PDO connection. Only accepts connections to Sqlite.
	 */
	function __construct ($connectionName, $pdo = null)
	{
		$this->connectionName = $connectionName;
		$this->dbname = 'main'; // SQLite default schema qualifier
		if ($pdo) {
			$driver_name = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
			if (strtolower($driver_name) !== 'sqlite') {
				throw new Exception("the PDO object is not for sqlite", -1);
			}
			$this->pdo = $pdo;
		}
		// Set prefix early so queries can resolve {{prefix}}
		// before reallyConnect() is called (lazy connection pattern).
		$conn = Db::getConnection($connectionName);
		if ($conn) {
			$this->prefix = isset($conn['prefix']) ? $conn['prefix'] : '';
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
	 * The database name (file path for SQLite)
	 * @property $dbname
	 * @type string
	 */
	public $dbname;

	/**
	 * The prefix for tables
	 * @property $prefix
	 * @type string
	 */
	public $prefix;

	/**
	 * Actually makes a connection to the database (by creating a PDO instance)
	 * @method reallyConnect
	 * @param {string} [$shardName=null] A shard name that was added using Db::setShard.
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
		$driver_options = isset($modifications['driver_options'])
			? $modifications['driver_options']
			: (isset($connectionInfo['driver_options']) ? $connectionInfo['driver_options'] : null);

		$this->shardInfo = $shardInfo = compact('dsn', 'prefix', 'driver_options');

		$this->pdo = Db::pdo($dsn, null, null, $driver_options, $connectionName, $shardName);
		$this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
		$this->shardName = $shardName;
		$dsn_array = Db::parseDsnString($dsn);
		$this->dbname = 'main'; // SQLite: "main" is the default schema qualifier
		$this->prefix = $prefix;

		// SQLite pragmas
		$this->pdo->exec('PRAGMA journal_mode = WAL');
		$this->pdo->exec('PRAGMA foreign_keys = ON');

		if (class_exists('Q')) {
			Q::event('Db/reallyConnect', array(
				'db' => $this,
				'shardName' => $shardName,
				'modifications' => $modifications
			), 'after');
		}

		return $this->pdo;
	}

	/**
	 * Override lastInsertId for SQLite.
	 * PDO::lastInsertId() on SQLite always returns the internal rowid,
	 * even for TEXT PRIMARY KEY tables. This confuses Db_Row::save() which
	 * overwrites the PK with the rowid (e.g. 'myStringId' → '1').
	 * Only return a value for tables with INTEGER PRIMARY KEY (auto-increment).
	 * @method lastInsertId
	 * @return {string} The last insert id, or '0' if not auto-increment
	 */
	function lastInsertId()
	{
		// The platform's tables use string PKs, not INTEGER PRIMARY KEY.
		// Returning '0' matches MySQL's behavior for non-auto-increment tables.
		return '0';
	}

	/**
	 * Sets the timezone — no-op for SQLite (uses UTC by default)
	 * @method setTimezone
	 * @param {integer} [$offset=null]
	 */
	function setTimezone($offset = null)
	{
		// SQLite does not support SET timezone; times are UTC by default
	}

	/**
	 * Returns the lowercase name of the dbms
	 * @method dbms
	 * @return {string}
	 */
	function dbms()
	{
		return 'sqlite';
	}

	/**
	 * Returns the shard name
	 * @method shardName
	 * @return {string}
	 */
	function shardName()
	{
		return $this->shardName;
	}

	/**
	 * Forwards all other calls to the PDO object
	 * @method __call
	 */
	function __call ($name, array $arguments)
	{
		$this->reallyConnect();
		if (!is_callable(array($this->pdo, $name))) {
			throw new Exception("neither Db_Sqlite nor PDO supports the $name function");
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
		return isset($this->connectionName) ? $this->connectionName : null;
	}

	/**
	 * Returns the connection info with which this Db object was created.
	 * @method connection
	 * @return {array}
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
	 * Returns the name of the database used
	 * @method dbName
	 * @return {string}
	 */
	function dbName()
	{
		return $this->dbname;
	}

	/**
	 * Creates a query to select fields from a table.
	 * @method select
	 */
	function select ($fields = '*', $tables = '')
	{
		if (!isset($fields))
			throw new Exception("fields not specified in call to 'select'.");
		if (!isset($tables))
			throw new Exception("tables not specified in call to 'select'.");
		$queryClass = Db_Query::adapterClass($this);
		$query = new $queryClass($this, Db_Query::TYPE_SELECT);
		return $query->select($fields, $tables);
	}

	/**
	 * Creates a query to insert a row into a table
	 * @method insert
	 */
	function insert ($table_into, array $fields = array())
	{
		if (empty($table_into))
			throw new Exception("table not specified in call to 'insert'.");
		$queryClass = Db_Query::adapterClass($this);
		$columnsList = array();
		$valuesList = array();
		if (Q::isAssociative($fields)) {
			foreach ($fields as $column => $value) {
				$columnsList[] = call_user_func(array($queryClass, 'column'), $column);
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
				$columnsList[] = call_user_func(array($queryClass, 'column'), $column);
			}
			$columnsString = implode(', ', $columnsList);
			$valuesString = '';
		}
		$clauses = array(
			'INTO' => "$table_into ($columnsString)",
			'VALUES' => $valuesString
		);
		return new $queryClass($this, Db_Query::TYPE_INSERT, $clauses, $fields, $table_into);
	}

	/**
	 * Creates a query to update rows.
	 * @method update
	 */
	function update ($table)
	{
		if (empty($table))
			throw new Exception("table not specified in call to 'update'.");
		$queryClass = Db_Query::adapterClass($this);
		$clauses = array('UPDATE' => "$table");
		return new $queryClass($this, Db_Query::TYPE_UPDATE, $clauses, array(), $table);
	}

	/**
	 * Creates a query to delete rows.
	 * @method delete
	 */
	function delete ($table_from, $table_using = null)
	{
		if (empty($table_from))
			throw new Exception("table not specified in call to 'delete'.");
		if (isset($table_using) and !is_string($table_using)) {
			throw new Exception("table_using field must be a string");
		}
		$queryClass = Db_Query::adapterClass($this);
		if (isset($table_using))
			$clauses = array('FROM' => "$table_from USING $table_using");
		else
			$clauses = array('FROM' => "$table_from");
		return new $queryClass($this, Db_Query::TYPE_DELETE, $clauses, array(), $table_from);
	}

	/**
	 * Creates a query from raw SQL
	 * @method rawQuery
	 */
	function rawQuery ($sql = null, $bind = array())
	{
		$queryClass = Db_Query::adapterClass($this);
		$clauses = array('RAW' => $sql);
		$query = new $queryClass($this, Db_Query::TYPE_RAW, $clauses);
		if ($bind) {
			$query->bind($bind);
		}
		return $query;
	}

	/**
	 * Creates a query to rollback a previously started transaction.
	 * @method rollback
	 */
	function rollback ($criteria = null)
	{
		$queryClass = Db_Query::adapterClass($this);
		$query = new $queryClass($this, Db_Query::TYPE_ROLLBACK, array('ROLLBACK' => true));
		$query->rollback($criteria);
		return $query;
	}


	/**
	 * Generates base classes of the models from the database schema.
	 * @method generateModels
	 * @param {string} $directory The directory in which to generate the files.
	 * @param {string} [$classname_prefix=null]
	 * @return {array}
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

	/**
	 * List all tables in the current SQLite database.
	 * @method _listTables
	 * @protected
	 * @return {array}
	 */
	public function _listTables()
	{
		$sql = "
			SELECT name
			FROM sqlite_master
			WHERE type='table'
			  AND name NOT LIKE 'sqlite_%'
			ORDER BY name
		";
		return $this->rawQuery($sql)->execute()->fetchAll(PDO::FETCH_COLUMN, 0);
	}

	/**
	 * Introspect table columns for SQLite.
	 * @method _introspectColumns
	 * @protected
	 * @param {string} $table_name
	 * @return {array}
	 */
	public function _introspectColumns($table_name)
	{
		$sql = "PRAGMA table_info(" . Db_Query_Sqlite::quoted($table_name) . ")";
		$rows = $this->rawQuery($sql)->execute()->fetchAll(PDO::FETCH_ASSOC);

		$cols = array();
		foreach ($rows as $r) {
			$type = strtolower(trim($r['type']));
			// Detect INTEGER PRIMARY KEY auto-increment
			$extra = '';
			if ($r['pk'] && strtolower($r['type']) === 'integer') {
				$extra = 'auto_increment';
			}
			// Normalize SQLite types to MySQL-compatible format
			// SQLite DDL often already uses MySQL type names, so most pass through.
			// Handle the few differences:
			if ($type === 'boolean' || $type === 'bool') {
				$type = 'tinyint(1)';
			} elseif ($type === 'integer') {
				$type = 'int';
			} elseif ($type === 'real') {
				$type = 'double';
			}
			$cols[] = array(
				'Field'   => $r['name'],
				'Type'    => $type ?: 'text',
				'Null'    => $r['notnull'] ? 'NO' : 'YES',
				'Key'     => $r['pk'] ? 'PRI' : '',
				'Default' => $r['dflt_value'],
				'Extra'   => $extra,
				'Comment' => ''
			);
		}

		return $cols;
	}

	/**
	 * SQLite doesn't support table comments
	 * @method _introspectTableComment
	 * @protected
	 */
	public function _introspectTableComment($table_name)
	{
		return '';
	}

	/**
	 * Introspect indexes for SQLite.
	 * @method _introspectTableIndexes
	 * @protected
	 */
	public function _introspectTableIndexes($table_name)
	{
		$list = $this->rawQuery(
			"PRAGMA index_list(" . Db_Query_Sqlite::quoted($table_name) . ")"
		)->execute()->fetchAll(PDO::FETCH_ASSOC);

		$indexes = [];

		foreach ($list as $idx) {
			$name = $idx['name'];
			$cols = $this->rawQuery(
				"PRAGMA index_info(" . Db_Query_Sqlite::quoted($name) . ")"
			)->execute()->fetchAll(PDO::FETCH_ASSOC);

			$columns = [];
			foreach ($cols as $c) {
				$columns[(int)$c['seqno']] = $c['name'];
			}
			ksort($columns);

			$indexes[$name] = [
				'unique'  => (bool)$idx['unique'],
				'type'    => 'btree',
				'columns' => array_values($columns),
				'partial' => (bool)$idx['partial']
			];
		}

		return $indexes;
	}

	/**
	 * SQLite doesn't support model comments
	 * @method _introspectModelComment
	 * @protected
	 */
	public function _introspectModelComment($prefix)
	{
		return '';
	}

	/**
	 * Normalize default value from SQLite.
	 * @method _normalizeDefault
	 * @protected
	 */
	public function _normalizeDefault($d)
	{
		if ($d === null || $d === '') {
			return null;
		}

		$dt = trim($d);
		$du = strtoupper(trim($dt, "'\""));

		if ($du === 'CURRENT_TIMESTAMP'
		||  $du === 'CURRENT_DATE'
		||  $du === 'CURRENT_TIME') {
			return $du;
		}

		return $dt;
	}

	// ── Interface methods required for SQLite support ──────────────

	function insertManyAndExecute($table_into, array $rows = array(), $options = array())
	{
		if (empty($rows)) return 0;
		$first = reset($rows);

		// Handle Db_Row objects — convert to associative arrays
		if ($first instanceof Db_Row) {
			$columns = $first->fieldNames();
			$arrayRows = array();
			foreach ($rows as $row) {
				$arrayRows[] = $row->toArray();
			}
			$rows = $arrayRows;
		} else {
			$columns = array_keys($first);
		}

		// Resolve table name
		$table = ($table_into instanceof Db_Expression) ? (string)$table_into : $table_into;
		$table = str_replace('{{prefix}}', $this->prefix, $table);
		$table = preg_replace('/^main\./', '', $table);

		$colList = implode(', ', array_map(function($c) { return '"' . $c . '"'; }, $columns));

		// Each row may have Db_Expression values that need inlining,
		// so build per-row SQL when expressions are present.
		$count = 0;
		foreach ($rows as $row) {
			$placeholders = array();
			$values = array();
			foreach ($columns as $col) {
				$v = isset($row[$col]) ? $row[$col] : null;
				if ($v instanceof Db_Expression) {
					$placeholders[] = (string)$v; // inline the expression
				} else {
					$placeholders[] = '?';
					$values[] = $v;
				}
			}
			$valStr = implode(', ', $placeholders);
			$sql = "INSERT OR REPLACE INTO \"$table\" ($colList) VALUES ($valStr)";
			$stmt = $this->pdo->prepare($sql);
			$stmt->execute($values);
			$count++;
		}
		return $count;
	}

	function rank(
		$table, $pts_field, $rank_field,
		$criteria = null, $rank = true,
		$order_by_clause = null,
		$chunk_size = 1000, $offset = null
	) {
		throw new Exception("Db_Sqlite::rank() is not yet implemented");
	}

	function fromDateTime($datetime)
	{
		if ($datetime instanceof \DateTime) {
			return $datetime->getTimestamp();
		}
		return strtotime($datetime);
	}

	function toDateTime($timestamp)
	{
		if (!is_numeric($timestamp)) {
			// Handle SQL expression keywords that aren't real datetime strings
			$upper = strtoupper(trim($timestamp));
			if ($upper === 'CURRENT_TIMESTAMP' || $upper === 'NOW()') {
				return date('Y-m-d H:i:s');
			}
			if ($upper === 'CURRENT_DATE') {
				return date('Y-m-d');
			}
			$timestamp = strtotime($timestamp);
			if ($timestamp === false) {
				return date('Y-m-d H:i:s'); // fallback to now
			}
		}
		if ($timestamp > 10000000000) {
			$timestamp = $timestamp / 1000;
		}
		return date('Y-m-d H:i:s', $timestamp);
	}

	function getCurrentTimestamp()
	{
		return date('Y-m-d H:i:s');
	}

	function scriptToQueries($script)
	{
		$script = str_replace("\r", "", $script);
		$queries = preg_split('/;\s*$/m', $script);
		$result = array();
		foreach ($queries as $q) {
			$q = trim($q);
			if ($q !== '') $result[] = $q;
		}
		return $result;
	}

	function uniqueId(
		$table, $field, $where = null, $options = array()
	) {
		$length = 8;
		$characters = 'abcdefghijklmnopqrstuvwxyz';
		$prefix = '';
		extract($options);
		$count = strlen($characters);
		$id = $prefix;
		for ($i = 0; $i < $length; ++$i) {
			$id .= $characters[mt_rand(0, $count - 1)];
		}
		if (!empty($options['filter'])) {
			$p = array(@compact('id', 'table', 'field', 'where', 'options'));
			$ret = class_exists('Q')
				? Q::event($options['filter'], $p)
				: call_user_func($options['filter'], $p);
			if (isset($ret)) $id = $ret;
		}
		return $id;
	}
}

include_once(dirname(__FILE__).'/Query/Sqlite.php');
