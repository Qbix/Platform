<?php

/**
 * @module Db
 */

class Db_Postgres implements Db_Interface
{
	/**
	 * This class lets you create and use PDO database connections.
	 * @class Db_Postgres
	 * @extends Db_Interface
	 * @constructor
	 *
	 * @param {string} $connectionName The name of the connection out of the connections added with Db::setConnection()
	 * @param {PDO} [$pdo=null] Existing PDO connection. Only accepts connections to PostgreSQL.
	 */
	function __construct ($connectionName, $pdo = null)
	{
		$this->connectionName = $connectionName;
		if ($pdo) {
			$driver_name = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
			if (strtolower($driver_name) != 'pgsql') {
				throw new Exception("the PDO object is not for postgres", -1);
			}
			$this->pdo = $pdo;
		}
	}

	/** @var PDO */
	public $pdo;

	/** @var array */
	public $shardInfo;

	/** @protected */
	protected $connectionName;

	/** @protected */
	protected $shardName;

	/** @var string */
	public $dbname;

	/** @var string */
	public $prefix;

	/** @var int */
	public $maxCheckStrlen = 1000000;

	/**
	 * Actually makes a connection to the database (by creating a PDO instance)
	 * @method reallyConnect
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
		$username = isset($modifications['username']) ? $modifications['username'] : $connectionInfo['username'];
		$password = isset($modifications['password']) ? $modifications['password'] : $connectionInfo['password'];
		$driver_options = isset($modifications['driver_options'])
			? $modifications['driver_options']
			: (isset($connectionInfo['driver_options']) ? $connectionInfo['driver_options'] : null);

		$this->shardInfo = $shardInfo = compact('dsn', 'prefix', 'username', 'password', 'driver_options');

		// Merge DSN fields
		$dsn_fields = array();
		foreach (array('host', 'port', 'dbname', 'user') as $f) {
			if (isset($modifications[$f])) {
				$dsn_fields[$f] = $modifications[$f];
			}
		}
		if ($dsn_fields) {
			$dsn_array = array_merge(Db::parseDsnString($dsn), $dsn_fields);
			$dsn = 'pgsql:'.http_build_query($dsn_array, '', ' ');
		} else {
			$dsn_array = Db::parseDsnString($dsn);
		}

		$this->pdo = Db::pdo($dsn, $username, $password, $driver_options, $connectionName, $shardName);
		$this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
		$this->shardName = $shardName;
		$this->dbname = isset($dsn_array['dbname']) ? $dsn_array['dbname'] : null;
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
	 * Sets the timezone in the database to match the one in PHP
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
		$hours = floor($offset / 3600);
		$minutes = floor(($offset % 3600) / 60);
		$sign = ($offset >= 0) ? '+' : '-';
		$tz = sprintf("%s%02d:%02d", $sign, abs($hours), abs($minutes));
		$this->pdo->exec("SET TIME ZONE '$tz';");
	}

	/** @method shardName */
	function shardName()
	{
		return $this->shardName;
	}

	/** @method dbms */
	function dbms()
	{
		return 'postgres';
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
			throw new Exception("neither " . get_class($this) . " nor PDO supports the $name function");
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
		$dsn = $this->dsn();
		if (empty($dsn))
			return null;
		return $dsn['dbname'];
	}

	/**
	 * Creates a query to select fields from a table.
	 * @method select
	 * @param {string|array} [$fields='*'] The fields as strings, or "*", or array of alias=>field
	 * @param {string|array} [$tables=''] The tables as strings, or array of alias=>table
	 * @return {Db_Query} The resulting Db_Query object
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
	 * @param {string} $table_into The name of the table to insert into
	 * @param {array} $fields=array() The fields as an array of column=>value pairs
	 * @return {Db_Query} The resulting Db_Query object
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
	 * @param {string} $table The table to update
	 * @return {Db_Query} The resulting Db_Query object
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
	 * @param {string} $table_from The table to delete from
	 * @param {string} [$table_using=null] If set, adds a USING clause
	 * @return {Db_Query}
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
	 * @param {string|null} $sql
	 * @param {array} [$bind=array()] Parameters to bind
	 * @return {Db_Query}
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
	 * @param {array} $criteria The criteria to use, for sharding
	 * @return {Db_Query} The resulting Db_Query object
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
	 * List all tables in the current database/schema (Postgres).
	 */
	protected function _listTables()
	{
		$sql = "
			SELECT tablename
			FROM pg_tables
			WHERE schemaname = 'public'
			ORDER BY tablename
		";
		return $this->rawQuery($sql)->execute()->fetchAll(PDO::FETCH_COLUMN, 0);
	}

	/**
	 * Introspect table columns for Postgres.
	 */
	protected function _introspectColumns($table_name)
	{
		$sql = "
			SELECT 
				a.attname AS \"Field\",
				pg_catalog.format_type(a.atttypid, a.atttypmod) AS pg_type,
				CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS \"Null\",
				CASE WHEN (
					SELECT EXISTS (
						SELECT 1 FROM pg_index i
						WHERE i.indrelid = a.attrelid
						  AND i.indisprimary
						  AND a.attnum = ANY(i.indkey)
					)
				) THEN 'PRI' ELSE '' END AS \"Key\",
				COALESCE(pg_get_expr(ad.adbin, ad.adrelid), '') AS \"Default\",
				COALESCE(col_description(a.attrelid, a.attnum), '') AS \"Comment\"
			FROM pg_attribute a
			JOIN pg_class c ON a.attrelid = c.oid
			JOIN pg_namespace n ON c.relnamespace = n.oid
			LEFT JOIN pg_attrdef ad ON a.attrelid = ad.adrelid AND a.attnum = ad.adnum
			WHERE c.relname = :table
			  AND n.nspname = 'public'
			  AND a.attnum > 0
			  AND NOT a.attisdropped
			ORDER BY a.attnum
		";
		$rows = $this->rawQuery($sql, array(':table' => $table_name))
			->execute()
			->fetchAll(PDO::FETCH_ASSOC);

		// Translate Postgres types to MySQL-compatible format
		// so generateModels produces identical output
		foreach ($rows as &$r) {
			$r['Type'] = self::_pgTypeToMysql($r['pg_type']);
			$r['Extra'] = '';
			// Detect auto-increment (serial/identity columns)
			if (strpos($r['Default'], 'nextval(') === 0) {
				$r['Extra'] = 'auto_increment';
				$r['Default'] = null;
			}
			unset($r['pg_type']);
		}
		return $rows;
	}

	/**
	 * Map a Postgres type string to MySQL-compatible format.
	 * This lets generateModels produce the same validation code
	 * regardless of which database adapter is used.
	 * @method _pgTypeToMysql
	 * @static
	 * @param {string} $pgType e.g. "character varying(255)", "integer", "timestamp without time zone"
	 * @return {string} MySQL-compatible type e.g. "varchar(255)", "int", "datetime"
	 */
	protected static function _pgTypeToMysql($pgType)
	{
		$t = strtolower(trim($pgType));

		// character varying(N) → varchar(N)
		if (preg_match('/^character varying\((\d+)\)$/', $t, $m)) {
			return "varchar({$m[1]})";
		}
		if ($t === 'character varying' || $t === 'text') return 'text';
		if (preg_match('/^character\((\d+)\)$/', $t, $m)) return "char({$m[1]})";

		// Integers
		if ($t === 'integer') return 'int';
		if ($t === 'bigint') return 'bigint';
		if ($t === 'smallint') return 'smallint';
		if ($t === 'boolean') return 'tinyint(1)';

		// Floats
		if ($t === 'real') return 'float';
		if ($t === 'double precision') return 'double';
		if (preg_match('/^numeric\((.+)\)$/', $t, $m)) return "decimal({$m[1]})";
		if ($t === 'numeric') return 'decimal';

		// Date/Time
		if (strpos($t, 'timestamp') === 0) return 'datetime';
		if ($t === 'date') return 'date';
		if (strpos($t, 'time') === 0) return 'time';

		// Binary
		if ($t === 'bytea') return 'blob';

		// JSON
		if ($t === 'json' || $t === 'jsonb') return 'text';

		// UUID
		if ($t === 'uuid') return 'char(36)';

		// User-defined (enums etc) — pass through, will hit default case in generateModels
		return $t;
	}

	/**
	 * Introspect table comment for Postgres.
	 */
	protected function _introspectTableComment($table_name)
	{
		$sql = "
			SELECT obj_description(c.oid) AS comment
			FROM pg_class c
			JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE c.relname = :table
			  AND n.nspname = 'public'
		";
		$res = $this->rawQuery($sql, array(':table' => $table_name))
			->execute()
			->fetchAll(PDO::FETCH_ASSOC);

		return (!empty($res[0]['comment']))
			? " * <br>{$res[0]['comment']}\n"
			: '';
	}

	/**
	 * Introspect indexes for Postgres.
	 */
	protected function _introspectTableIndexes($table_name)
	{
		$sql = "
			SELECT
				i.relname AS index_name,
				ix.indisunique AS is_unique,
				am.amname AS index_type,
				ix.indpred IS NOT NULL AS is_partial,
				array_agg(a.attname ORDER BY x.n) AS columns
			FROM pg_class t
			JOIN pg_namespace n ON n.oid = t.relnamespace
			JOIN pg_index ix ON t.oid = ix.indrelid
			JOIN pg_class i ON i.oid = ix.indexrelid
			JOIN pg_am am ON i.relam = am.oid
			JOIN unnest(ix.indkey) WITH ORDINALITY AS x(attnum, n) ON true
			JOIN pg_attribute a
				ON a.attrelid = t.oid
				AND a.attnum = x.attnum
			WHERE t.relname = :table
			  AND n.nspname = 'public'
			GROUP BY i.relname, ix.indisunique, am.amname, ix.indpred
		";

		$rows = $this->rawQuery($sql, array(':table' => $table_name))
			->execute()
			->fetchAll(PDO::FETCH_ASSOC);

		$indexes = [];

		foreach ($rows as $r) {
			$indexes[$r['index_name']] = [
				'unique'  => (bool)$r['is_unique'],
				'type'    => $r['index_type'],
				'columns' => array_map('trim', explode(',', trim($r['columns'], '{}'))),
				'partial' => (bool)$r['is_partial']
			];
		}

		return $indexes;
	}

	protected function _introspectModelComment($prefix)
	{
		$sql = "
			SELECT obj_description(c.oid) AS comment
			FROM pg_class c
			JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname = 'public'
			  AND c.relname LIKE :pattern
			LIMIT 1
		";
		$res = $this->rawQuery($sql, array(':pattern' => $prefix.'Q_%'))
			->execute()
			->fetchAll(PDO::FETCH_ASSOC);

		return (!empty($res[0]['comment']))
			? " * <br>{$res[0]['comment']}\n"
			: '';
	}

	/**
	 * Normalize default value from Postgres.
	 */
	protected function _normalizeDefault($d)
	{
		if ($d === null || $d === '') {
			return null;
		}

		$dl = strtolower($d);
		if ($dl === 'now()' || strpos($dl, 'current_timestamp') !== false) {
			return 'CURRENT_TIMESTAMP';
		}

		if (preg_match("/^'(.*)'::[a-z0-9_]+$/", $d, $m)) {
			return $m[1];
		}

		return $d;
	}
}

include_once(dirname(__FILE__).'/Query/Postgres.php');