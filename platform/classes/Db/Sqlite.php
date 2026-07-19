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
		if ($pdo) {
			$driver_name = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
			if (strtolower($driver_name) !== 'sqlite') {
				throw new Exception("the PDO object is not for sqlite", -1);
			}
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
		$this->dbname = isset($dsn_array['dbname']) ? $dsn_array['dbname'] : $dsn;
		$this->prefix = $prefix;

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
	protected function _listTables()
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
	protected function _introspectColumns($table_name)
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
	protected function _introspectTableComment($table_name)
	{
		return '';
	}

	/**
	 * Introspect indexes for SQLite.
	 * @method _introspectTableIndexes
	 * @protected
	 */
	protected function _introspectTableIndexes($table_name)
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
	protected function _introspectModelComment($prefix)
	{
		return '';
	}

	/**
	 * Normalize default value from SQLite.
	 * @method _normalizeDefault
	 * @protected
	 */
	protected function _normalizeDefault($d)
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
}

include_once(dirname(__FILE__).'/Query/Sqlite.php');
