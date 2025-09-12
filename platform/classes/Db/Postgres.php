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
     * List all tables in the current database/schema (Postgres).
     *
     * @method _listTables
     * @protected
     * @return {array} Array of table names
     */
    protected function _listTables() {
        $sql = "
            SELECT tablename
            FROM pg_tables
            WHERE schemaname = 'public'
            ORDER BY tablename
        ";
        $stmt = $this->rawQuery($sql)->execute();
        $rows = $stmt->fetchAll(PDO::FETCH_COLUMN, 0);
        return $rows;
    }

    /**
     * Introspect table columns for Postgres.
     * Must return same shape as MySQL version:
     * [ 'Field' => ..., 'Type' => ..., 'Null' => YES/NO, 'Key' => PRI, 'Default' => ..., 'Extra' => ..., 'Comment' => ... ]
     *
     * @method _introspectColumns
     * @protected
     * @param {string} $table_name
     * @return {array} Array of column definitions
     */
    protected function _introspectColumns($table_name) {
        $sql = "
            SELECT 
                a.attname AS Field,
                pg_catalog.format_type(a.atttypid, a.atttypmod) AS Type,
                CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS Null,
                CASE WHEN (
                    SELECT EXISTS (
                        SELECT 1 FROM pg_index i
                        WHERE i.indrelid = a.attrelid
                        AND i.indisprimary
                        AND a.attnum = ANY(i.indkey)
                    )
                ) THEN 'PRI' ELSE '' END AS Key,
                COALESCE(pg_get_expr(ad.adbin, ad.adrelid), '') AS Default,
                '' AS Extra,
                COALESCE(col_description(a.attrelid, a.attnum), '') AS Comment
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
        return $this->rawQuery($sql, array(':table' => $table_name))->execute()->fetchAll(PDO::FETCH_ASSOC);
    }

    /**
     * Introspect table comment for Postgres.
     *
     * @method _introspectTableComment
     * @protected
     * @param {string} $table_name
     * @return {string} Table comment, formatted for YUIDoc
     */
    protected function _introspectTableComment($table_name) {
        $sql = "
            SELECT obj_description(c.oid) AS comment
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relname = :table AND n.nspname = 'public'
        ";
        $res = $this->rawQuery($sql, array(':table' => $table_name))->execute()->fetchAll(PDO::FETCH_ASSOC);
        $comment = (!empty($res[0]['comment'])) ? " * <br>{$res[0]['comment']}\n" : '';
        return $comment;
    }

    /**
     * Normalize default value from Postgres.
     *
     * @method _normalizeDefault
     * @protected
     * @param {string} $d Default expression from pg_get_expr
     * @return {string|null} Normalized default
     */
    protected function _normalizeDefault($d) {
        if ($d === null || $d === '') {
            return null;
        }
        // Handle CURRENT_TIMESTAMP / now() / timezone() expressions
        $dl = strtolower($d);
        if ($dl === 'now()' || strpos($dl, 'current_timestamp') !== false) {
            return 'CURRENT_TIMESTAMP';
        }
        // Strip surrounding quotes if it looks like a literal
        if (preg_match("/^'(.*)'::[a-z0-9_]+$/", $d, $m)) {
            return $m[1];
        }
        return $d;
    }

    protected function _introspectModelComment($prefix) {
        $sql = "
            SELECT obj_description(c.oid) AS comment
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
            AND c.relname LIKE :pattern
            LIMIT 1
        ";
        $stmt = $this->rawQuery($sql, array(':pattern' => $prefix.'Q_%'))->execute();
        $res = $stmt->fetchAll(PDO::FETCH_ASSOC);
        if (!empty($res[0]['comment'])) {
            return " * <br>{$res[0]['comment']}\n";
        }
        return '';
    }
}

include_once(dirname(__FILE__).'/Query/Postgres.php');
