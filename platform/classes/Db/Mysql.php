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

	protected function _listTables() {
		$rows = $this->rawQuery('SHOW TABLES')->fetchAll();
	}

	protected function _introspectColumns($table_name) {
		$table_cols = $this->rawQuery("SHOW FULL COLUMNS FROM $table_name")->execute()->fetchAll(PDO::FETCH_ASSOC);
	}

	protected function _introspectTableComment($able_name) {
		$table_status = $this->rawQuery("SHOW TABLE STATUS WHERE Name = '$table_name'")
			->execute()->fetchAll(PDO::FETCH_COLUMN, 17);
		$table_comment = (!empty($table_status[0])) ? " * <br>{$table_status[0]}\n" : '';
	}

	protected function _introspectTableIndexes($table_name)
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


	protected function _normalizeDefault($d) {
		if (!empty($directory)
			and strtolower($d) === 'current_timestamp()') {
			$table_cols[$k]['Default'] = 'CURRENT_TIMESTAMP';
		}
	}

	protected function _introspectModelComment($prefix) {
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