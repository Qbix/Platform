<?php

/**
 * The database interface module. Contains basic properties and methods and serves as namespace
 * for more specific sub-classes
 * @module Db
 * @main Db
 */

/**
 * Interface that an adapter must support to extend the Db class.
 * @class Db_Interface
 * @static
 */

if (!defined('DS')) define('DS', DIRECTORY_SEPARATOR);
if (!defined('PS')) define('PS', PATH_SEPARATOR);
include_once(dirname(__FILE__).DS.'Db'.DS.'Expression.php');
include_once(dirname(__FILE__).DS.'Db'.DS.'Result.php');
include_once(dirname(__FILE__).DS.'Db'.DS.'Query.php');
include_once(dirname(__FILE__).DS.'Db'.DS.'Row.php');
include_once(dirname(__FILE__).DS.'Db'.DS.'Utils.php');
Db::milliseconds();

interface Db_Interface
{
	/**
	 * Interface class for database connection.
	 * An adapter must support it
	 * to implement the Db class.
	 * @class Db_Interface
	 * @constructor
	 * @param {string} $conn_name
	 *  The name of the connection
	 * @param {PDO} [$pdo]
	 */
	//function __construct ($conn_name, PDO $pdo = null);

	/**
	 * Forwards all other calls to the PDO object
	 * @method __call
	 * @param {string} $name 
	 *  The function name
	 * @param {array} $arguments 
	 *  The arguments
	 */
	//function __call ($name, array $arguments);
	
	/**
	 * Actually makes a connection to the database (by creating a PDO instance)
	 * @method reallyConnect
	 * @param {array} [$shardName=null] A shard name that was added using Db::setShard.
	 * This modifies how we connect to the database.
	 * @return {PDO} The PDO object for connection
	 */
	function reallyConnect($shardName = null, &$shardInfo = null);
	
	/**
	 * If connected, sets the timezone in the database to match the one in PHP.
	 * @param {integer} [$offset=timezone_offset_get()] in seconds
	 * @method setTimezone
	 */
	function setTimezone($offset = null);

	/**
	 * Returns the name of the connection with which this Db object was created.
	 * @method connectionName
	 * @return {string}
	 */
	function connectionName ();
	
	/**
	 * Returns the name of the shard with which this Db object was created.
	 * @method shardName
	 * @return {string}
	 */
	function shardName ();
	
	/**
	 * Returns the connection with which this Db object was created.
	 * @method connection
	 * @return {string}
	 */
	function connection();
	
	/**
	 * Returns an associative array representing the dsn
	 * @method dsn
	 * @return {array}
	 */
	function dsn ();
	
	/**
	 * Returns the lowercase name of the dbms (e.g. "mysql")
	 * @method dbms
	 * @return {string}
	 */
	function dbms ();
	
	/**
	 * Returns the name of the database used
	 * @method dbName
	 * @return {string}
	 */
	function dbName();

	/**
	 * Creates a query to select fields from a table. Needs to be used with Db_Query::from().
	 * @method select
	 * @param {string|array} [$fields='*'] The fields as strings, or array of alias=>field
	 * @param {string|array} [$tables=''] The tables as strings, or array of alias=>table
	 * @return {Db_Query_Mysql} The resulting Db_Query object
	 */
	function select ($fields = '*', $tables = '');

	/**
	 * Creates a query to insert a row into a table
	 * @method insert
	 * @param {string} $table_into
	 *  The name of the table to insert into
	 * @param {array} $fields=array()
	 *  The fields as an array of column=>value pairs
	 * @default array()
	 * @return {Db_Query}
	 *  The resulting Db_Query object
	 */
	function insert ($table_into, array $fields = array());

	/**
	 * Inserts multiple rows into a single table, preparing the statement only once,
	 * and executes all the queries.
	 * @method insertManyAndExecute
	 * @param {string} $table_into The name of the table to insert into
	 * @param {array} [$rows=array()] The array of rows to insert. 
	 * Each row should be an array of ($field => $value) pairs, with the exact
	 * same set of keys (field names) in each array. It can also be a Db_Row.
	 * @param {array} [$options=array()] An associative array of options, including:
	 * @param {string} [$options.className]
	 *    If you provide the class name, the system will be able to use any sharding
	 *    indexes under that class name in the config.
	 * @param {integer} [$options.chunkSize]
	 *    The number of rows to insert at a time. Defaults to 20.
	 *    You can also put 0 here, which means unlimited chunks, but it's not recommended.
	 * @param {array} [$options.onDuplicateKeyUpdate]
	 *    You can put an array of fieldname => value pairs here,
	 *    which will add an ON DUPLICATE KEY UPDATE clause to the query.
	 */
	function insertManyAndExecute ($table_into, array $rows = array(), $options = array());

	/**
	 * Creates a query to update rows. Needs to be used with Db_Query::set()
	 * @method update
	 * @param {string} $table
	 *  The table to update
	 * @return {Db_Query} 
	 *  The resulting Db_Query object
	 */
	function update ($table);

	/**
	 * Creates a query to delete rows.
	 * @method delete
	 * @param {string} $table_from
	 *  The table to delete from
	 * @param {string} $table_using=null
	 * @return {Db_Query}
	 */
	function delete ($table_from, $table_using = null);

	/**
	 * Creates a query from raw SQL
	 * @method rawQuery
	 * @param {string} $sql
	 *  May contain more than one SQL statement
	 * @param {array} $bind=array()
	 *  Optional. An array of parameters to bind to the query, using
	 *  the Db_Query->bind method.
	 * @default array()
	 * @return {Db_Query}
	 */
	function rawQuery ($sql, $bind = array());

    /**
     * Sorts a table in chunks
     * @method rank
     * @param {string} $table
     *  The name of the table in the database
     * @param {string} $pts_field
     *  The name of the field to rank by.
     * @param {string} $rank_field
     *  The rank field to update in all the rows
     * @param {integer} $chunk_size=1000
     *  The number of rows to process at a time.
     *  This is so the queries don't tie up the database server for very long,
     *  letting it service website requests and other things. Defaults to 1000
     * @param {integer} $rank_level2=0
     *  Since the ranking is done in chunks, the function must know
     *  which rows have not been processed yet. If this field is empty (default)
     *  then the function first sets the rank_field to 0 in all the rows.
     *  (That might be a time consuming operation.)
     *  Otherwise, if $rank is a nonzero integer, then the function alternates
     *  between the ranges
     *  0 to $rank_level2, and $rank_level2 to $rank_level2 * 2.
     *  That is, after it is finished, all the ratings will be in one of these
     *  two ranges.
     *  If not empty, this should be a very large number, like a billion.
     * @param {string} $order_by_clause=null
     *  The order clause to use when calculating ranks.
	 *  Default "ORDER BY $pts_field DESC"
     */
    function rank(
        $table,
        $pts_field, 
        $rank_field, 
        $chunk_size = 1000, 
        $rank_level2 = 0,
        $order_by_clause = null);
    
	/**
	 * Returns a timestamp from a DateTime string
	 * @method fromDateTime
	 * @param {string} $syntax
	 *  The format of the date string, see date() function.
	 * @param {string} $datetime
	 *  The DateTime string that comes from the db
	 * @return {string}
	 *  The timestamp
	 */
	function fromDateTime ($datetime);

	/**
	 * Returns a DateTime string to store in the database
	 * @method toDateTime
	 * @param {string} $timestamp
	 *  The UNIX timestamp, e.g. from strtotime function
	 * @return {string}
	 */
	function toDateTime ($timestamp);
	
	/**
	 * Returns the timestamp the db server would have, based on synchronization
	 * @method timestamp
	 * @return {integer}
	 */
	function getCurrentTimestamp();
	
	/**
	 * Takes a SQL script and returns an array of queries.
	 * When DELIMITER is changed, respects that too.
	 * @method scriptToQueries
	 * @param {string} $script
	 *  The text of the script
	 * @return {array}
	 *  An array of the SQL queries.
	 */
	 function scriptToQueries($script);
	
	/**
	 * Generates base classes of the models, and if they don't exist,
	 * skeleton code for the models themselves. 
	 * Use it only after you have made changes to the database schema.
	 * You shouldn't be using it on every request.
	 * @method generateModels
	 * @param {string} $conn_name
	 *  The name of a previously registered connection.
	 * @param {string} $directory
	 *  The directory in which to generate the files.
	 *  If the files already exist, they are not overwritten,
	 *  unless they are inside the "generated" subdirectory.
	 *  If the "generated" subdirectory does not exist, it is created.
	 * @param {string} $classname_prefix=null
	 *  The prefix to prepend to the generated class names.
	 *  If not specified, prefix becomes "Conn_Name_", 
	 *  where conn_name is the name of the connection.
	 * @default null
	 * @throws {Exception}
	 *  If the $connection is not registered, or the $directory
	 *  does not exist, this function throws an exception.
	 */
	function generateModels (
		$directory, 
		$classname_prefix = null);
	
	/**
	 * Generates a base class for the model
	 * @method codeForModelBaseClass
	 * @param {string} $table
	 *  The name of the table to generate the code for.
	 * @param {string} $directory
	 *  The path of the directory in which to place the model code.
	 * @param {string} $classname_prefix=''
	 *	Prefix for class name
	 * @param {string} &$class_name=null
	 *  If set, this is the class name that is used.
	 *  If an unset variable is passed, it is filled with the
	 *  class name that is ultimately chosen from the $classname_prefix
	 *  and $table_name.
	 * @param {string} $prefix=null
	 * @return {string}
	 *  The generated code for the class.
	 */
	function codeForModelBaseClass ( 
		$table_name, 
		$directory,
		$classname_prefix = '',
		&$class_name = null,
		$prefix = null);
		
	/**
	 * Generate an ID that is unique in a table
	 * @method uniqueId
	 * @param {string} $table
	 *  The name of the table
	 * @param {string} $field
	 *  The name of the field to check for uniqueness.
	 *  You should probably have an index starting with this field.
	 * @param {array} $where=array()
	 *  You can indicate conditions here to limit the search for
	 *  an existing value. The result is an id that is unique within
	 *  a certain partition.
	 * @param {array} [$options=array()] Optional array used to override default options:
	 * @param {integer} [$options.length=8] The length of the ID to generate, after the prefix.
	 * @param {string} [$options.characters='abcdefghijklmnopqrstuvwxyz']  All the characters from which to construct the id
	 * @param {string} [$options.prefix=''] The prefix to prepend to the unique id.
	 * @param {callable} [$options.filter]
	 *     The name of a function that will take the generated string and
	 *     check it. The filter function can modify the string by returning another string,
	 *     or simply reject the string by returning false, in which another string will be
	 */
	function uniqueId(
		$table, 
		$field, 
		$where = array(),
		$options = array());
		
}

/**
 * Class for database connection
 * @class Db
 * @static
 */

class Db
{	
	/**
	 * The array of Db objects that have been constructed
	 * @property $dbs
	 * @type array
	 */
 	public static $dbs = array();
	
	/**
	 * Info about the database connections that have been added
	 * @property $connections
	 * @type array
	 */
 	public static $connections;

	/**
	 * The array of all pdo objects that have been constructed,
	 * representing actual connections made to the databases.
	 * @property $pdo_array
	 * @type array
	 * @protected
	 * @default array()
	 */
	protected static $pdo_array = array();

	/**
	 * Info about the database connections that have been added
	 * @property $connections
	 * @type array
	 */
	protected static $timezoneSet = array();

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
			throw new Exception("PDO doesn't support the $name function");
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
	 * @return {Db_Query} The resulting Db_Query object
	 */
	function select($fields = '*', $tables = '')
	{
		if (empty($fields)) {
			throw new Exception("fields not specified in call to 'select'.");
		}
		if (!isset($tables)) {
			throw new Exception("tables not specified in call to 'select'.");
		}

		$adapter = Db_Query::adapterClass($this);
		$query = new $adapter($this, Db_Query::TYPE_SELECT);
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
	 * @return {Db_Query} The resulting query object
	 */
	function insert($table_into, array $fields = array())
	{
		if (empty($table_into)) {
			throw new Exception("table not specified in call to 'insert'.");
		}

		$adapter = Db_Query::adapterClass($this);

		$columnsList = array();
		$valuesList = array();
		if (Q::isAssociative($fields)) {
			foreach ($fields as $column => $value) {
				$columnsList[] = $adapter::column($column);
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
				$columnsList[] = $adapter::column($column);
			}
			$columnsString = implode(', ', $columnsList);
			$valuesString = ''; // won't be used
		}

		$clauses = array(
			'INTO' => "$table_into ($columnsString)",
			'VALUES' => $valuesString
		);

		return Db_Query::adapter($this, Db_Query::TYPE_INSERT, $clauses, $fields, $table_into);
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
	function insertManyAndExecute($table_into, array $rows = array(), $options = array())
	{
		if (empty($table_into)) {
			throw new Exception("table not specified in call to 'insertManyAndExecute'.");
		}
		if (empty($rows)) {
			return false;
		}

		$adapter = Db_Query::adapterClass($this);
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
				$columnsList[] = $c = $adapter::column($column);
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
					throw new Exception("Db::insertManyAndExecute: need options['className'] when onDuplicateKeyUpdate === true");
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
				$parts[] .= static::column($k) . $part;
			}
			$odku_clause .= implode(",\n\t", $parts);
		}

		// simulate beforeSave on all rows
		$className = isset($options['className']) ? $options['className'] : null;
		$rowObjects = array();
		if ($className) {
			$isCallable = is_callable(array($className, 'beforeInsertManyAndExecute'));
			foreach ($rows as $k => $row) {
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
				$rows[$k] = $rowObject->fields;
			}
			if ($isCallable) {
				call_user_func(array($className, 'beforeInsertManyAndExecute'), $rowObjects);
				$rows = array();
				foreach ($rowObjects as $k => $rowObject) {
					$rows[$k] = $rowObject->fields;
				}
			}
		}
		
		
		// Start filling
		$queries = array();
		$queryCounts = array();
		$bindings = array();
		$last_q = array();
		$last_queries = array();
		foreach ($rows as $row) {
			if ($row instanceof Db_Row) {
				if (class_exists('Q') and class_exists($className)) {
					Q::event("Db/Row/$className/save", array(
						'row' => $row
					), 'before'); 
				}
				$callback = array($row, "beforeSave");
				if (is_callable($callback)) {
					call_user_func(
						$callback, $row->fields, false, false
					);
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
		
		foreach ($rows as $row) {
			if ($row instanceof Db_Row) {
				$row->wasInserted(true);
				$row->wasRetrieved(true);
			}
		}

		// simulate afterSaveExecute on all rows
		if ($className) {
			$callAfterInsertManyAndExecute = false;
			$args = array();
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
			/**
			 * @event Db/Row/$class_name/insertManyAndExecute {after}
			 * @param {array} rows
			 */
			Q::event("Db/Row/$className/insertManyAndExecute", array(
				'rows' => $rowObjects,
			), 'after');
		}
	}

	/**
	 * Creates a query to update rows. Needs to be used with {@link Db_Query::set}
	 * @method update
	 * @param {string} $table The table to update
	 * @return {Db_Query} The resulting Db_Query object
	 */
	function update($table)
	{
		if (empty($table)) {
			throw new Exception("table not specified in call to 'update'.");
		}

		$adapter = Db_Query::adapterClass($this);
		$clauses = array('UPDATE' => "$table");
		return new $adapter($this, Db_Query::TYPE_UPDATE, $clauses, array(), $table);
	}

	/**
	 * Creates a query to delete rows.
	 * @method delete
	 * @param {string} $table_from The table to delete from
	 * @param {string} [$table_using=null] If set, adds a USING clause with this table.
	 *   You can then use ->join() with the resulting Db_Query.
	 * @return {Db_Query}
	 */
	function delete($table_from, $table_using = null)
	{
		if (empty($table_from)) {
			throw new Exception("table not specified in call to 'delete'.");
		}
		if (isset($table_using) && !is_string($table_using)) {
			throw new Exception("table_using field must be a string");
		}

		$adapter = Db_Query::adapterClass($this);
		if (isset($table_using)) {
			$clauses = array('FROM' => "$table_from USING $table_using");
		} else {
			$clauses = array('FROM' => "$table_from");
		}
		return new $adapter($this, Db_Query::TYPE_DELETE, $clauses, array(), $table_from);
	}

	/**
	 * Creates a query from raw SQL
	 * @method rawQuery
	 * @param {string|null} $sql May contain one or more SQL statements.
	 *   Pass null here for an empty query that you can add other clauses to, e.g. ->commit().
	 * @param {array} [$bind=array()] An array of parameters to bind to the query, using
	 *   the ->bind method. They are used to replace foo=:foo and bar=?.
	 * @return {Db_Query}
	 */
	function rawQuery($sql = null, $bind = array())
	{
		$adapter = Db_Query::adapterClass($this);
		$clauses = array('RAW' => $sql);
		$query   = new $adapter($this, Db_Query::TYPE_RAW, $clauses);
		if ($bind) {
			$query->bind($bind);
		}
		return $query;
	}

	/**
	 * Creates a query to rollback a previously started transaction.
	 * @method rollback
	 * @param {array|null} $criteria The criteria to use, for sharding
	 * @return {Db_Query} The resulting Db_Query object
	 */
	function rollback($criteria = null)
	{
		$adapter = Db_Query::adapterClass($this);
		$query   = new $adapter($this, Db_Query::TYPE_ROLLBACK, array('ROLLBACK' => true));
		$query->rollback($criteria);
		return $query;
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
	function uniqueId($table, $field, $where = array(), $options = array())
	{
		$length     = isset($options['length'])     ? $options['length']     : 8;
		$characters = isset($options['characters']) ? $options['characters'] : 'abcdefghijklmnopqrstuvwxyz';
		$prefix     = isset($options['prefix'])     ? $options['prefix']     : '';
		$count      = strlen($characters);
		$attempts   = 0;

		do {
			$id = $prefix;
			for ($i = 0; $i < $length; ++$i) {
				$id .= $characters[mt_rand(0, $count - 1)];
			}

			// Run through filter if provided
			if (!empty($options['filter'])) {
				$p   = array(@compact('id', 'table', 'field', 'where', 'options'));
				$ret = class_exists('Q')
					? Q::call($options['filter'], $p)
					: call_user_func_array($options['filter'], $p);
				if ($ret === false) {
					if (++$attempts > 100) {
						throw new Q_Exception_BadValue(array(
							'internal' => "uniqueId options[filter]",
							'problem'  => "it always returns false"
						));
					}
					continue;
				} elseif ($ret) {
					$id = $ret;
				}
			}

			$q = $this->select($field, $table)->where(array($field => $id));
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
	 * @param {string} $date The Date string that comes from the db
	 * @return {integer} The timestamp
	 */
	function fromDate($date)
	{
		$year  = (int)substr($date, 0, 4);
		$month = (int)substr($date, 5, 2);
		$day   = (int)substr($date, 8, 2);
		return mktime(0, 0, 0, $month, $day, $year);
	}
    
	/**
	 * Returns a timestamp from a DateTime string
	 * @method fromDateTime
	 * @param {string|integer} $datetime The DateTime string that comes from the db, or a numeric timestamp
	 * @return {integer} The timestamp
	 */
	function fromDateTime($datetime)
	{
		if (is_numeric($datetime)) {
			return (int)$datetime;
		}
		$year  = (int)substr($datetime, 0, 4);
		$month = (int)substr($datetime, 5, 2);
		$day   = (int)substr($datetime, 8, 2);
		$hour  = (int)substr($datetime, 11, 2);
		$min   = (int)substr($datetime, 14, 2);
		$sec   = (int)substr($datetime, 17, 2);

		return mktime($hour, $min, $sec, $month, $day, $year);
	}

	/**
	 * Returns a Date string to store in the database
	 * @method toDate
	 * @param {string|integer} $timestamp The UNIX timestamp, or a string parseable by strtotime()
	 * @return {string}
	 */
	function toDate($timestamp)
	{
		if (!is_numeric($timestamp)) {
			$timestamp = strtotime($timestamp);
		}
		if ($timestamp > 10000000000) {
			$timestamp = $timestamp / 1000; // convert ms → s
		}
		return date('Y-m-d', $timestamp);
	}

	/**
	 * Returns a DateTime string to store in the database
	 * @method toDateTime
	 * @param {string|integer} $timestamp The UNIX timestamp, or a string parseable by strtotime()
	 * @return {string}
	 */
	function toDateTime($timestamp)
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
	 * @method getCurrentTimestamp
	 * @return {integer}
	 */
	function getCurrentTimestamp()
	{
		static $dbtime = null, $phptime = null;

		if (!isset($dbtime)) {
			$phptime1 = time();
			$row      = $this->select('CURRENT_TIMESTAMP')->execute()->fetch(PDO::FETCH_NUM);
			$dbtime   = $this->fromDateTime($row[0]);
			$phptime2 = time();
			$phptime  = round(($phptime1 + $phptime2) / 2);
		}

		return $dbtime + (time() - $phptime);
	}


	/**
	 * Drain rows from a table into a CSV file (optionally zipped) and delete them.
	 *
	 * Uses Db_Query_Mysql helpers (`isIndexed`, `selectBatch`, `deleteRange`)
	 * to remain DBMS-agnostic at the higher level.
	 *
	 * @method drain
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
	public function drain($table, $field, array $options = array())
	{
		$limit   = isset($options['limit'])   ? $options['limit']   : 10000;
		$outdir  = isset($options['outdir'])  ? $options['outdir']  : '/var/www/dumps';
		$desc    = isset($options['desc'])    ? $options['desc']    : false;
		$prefix  = isset($options['prefix'])  ? $options['prefix']  : $table;
		$dontZip = isset($options['dontZip']) ? $options['dontZip'] : false;

		$adapter = Db_Query::adapterClass($this);
		$query   = new $adapter($this, Db_Query::TYPE_SELECT);

		if (!is_dir($outdir)) {
			if (!mkdir($outdir, 0770, true)) {
				throw new Exception("Failed to create directory: $outdir");
			}
		}

		if (!$query->isIndexed($table, $field)) {
			throw new Exception("Field $field is not indexed in $table");
		}

		$rows = $query->selectBatch($table, $field, $limit, $desc ? 'DESC' : 'ASC');
		if (!$rows) {
			return false;
		}

		// Compute min/max field values on the fly
		$minVal = null;
		$maxVal = null;
		foreach ($rows as $row) {
			$value = $row[$field];
			if ($minVal === null || $value < $minVal) $minVal = $value;
			if ($maxVal === null || $value > $maxVal) $maxVal = $value;
		}

		// Normalize for filenames
		$first = preg_replace('/[^A-Za-z0-9T:_-]/', '_', (string) ($desc ? $maxVal : $minVal));
		$last  = preg_replace('/[^A-Za-z0-9T:_-]/', '_', (string) ($desc ? $minVal : $maxVal));

		// Build file paths
		$csvPath = sprintf(
			"%s/%s---%s---%s---%s.csv",
			rtrim($outdir, '/'),
			$prefix,
			$field,
			$first,
			$last
		);

		// Write CSV
		$fh = fopen($csvPath, 'w');
		if (!$fh) {
			throw new Exception("Cannot write to file: $csvPath");
		}
		fputcsv($fh, array_keys($rows[0])); // headers
		foreach ($rows as $row) {
			fputcsv($fh, $row);
		}
		fclose($fh);

		// Delete exported rows
		$query->deleteRange($table, $field, $minVal, $maxVal);

		// Optionally zip
		if (!$dontZip && class_exists('Q_Zip')) {
			$zipPath = $csvPath . '.zip';
			$zipper = new Q_Zip();
			$zipper->zip_files($csvPath, $zipPath);
			unlink($csvPath);
			return $zipPath;
		}

		return $csvPath;
	}

	/**
	 * Add a database connection with a name
	 * @method setConnection
	 * @static
	 * @param {string} $name
	 *  The name under which to store the connection details
	 * @param {array} $details
	 *  The connection details. Should include the keys:
	 *  'dsn', 'username', 'password', 'driver_options'
	 */
	static function setConnection ($name, $details)
	{
		if (class_exists('Q_Config')) {
			Q_Config::set('Db', 'connections', $name, $details);
		} else {
			// Standalone, no Q
			self::$connections[$name] = $details;
		}
	}

	/**
	 * Returns all the connections added thus far
	 * @method getConnections
	 * @static
	 * @return {array}
	 */
	static function getConnections ()
	{
		if (class_exists('Q_Config')) {
			$results = Q_Config::get('Db', 'connections', array());
		} else { // standalone, no Q
			$results = self::$connections;
		}
		foreach ($results as $name => &$info) {
			if (!isset($info['prefix'])) {
				$info['prefix'] = strtolower($name) . '_';
			}
			if (!isset($info['shards'])) {
				$info['shards'] = array();
			}
		}
		if ($base = self::getConnection('*')) {
			foreach ($results as $k => $r) {
				$results[$k] = array_merge($base, $r);
			}
			unset($results['*']);
		}
		return $results;
	}

	/**
	 * Returns connection details for a connection
	 * @method getConnection
	 * @static
	 * @param {string} $name
	 * @return {array|null}
	 */
	static function getConnection ($name)
	{
		if (class_exists('Q_Config')) {
			$result = Q_Config::get('Db', 'connections', $name, array());
		} else { // standalone, no Q
			$result = isset(self::$connections[$name])
				? self::$connections[$name]
				: array();
		}
		if (!isset($result['prefix'])) {
			$result['prefix'] = strtolower($name) . '_';
		}
		if (!isset($info['shards'])) {
			$result['shards'] = array();
		}
		return ($name !== '*' and $base = self::getConnection('*'))
			? array_merge($base, $result)
			: $result;
	}
	
	/**
	 * Add a named shard under a database connection
	 *  Can contain the keys "dsn", "username", "password", "driver_options"
	 *  They are used in constructing the PDO object.
	 * @method setShard
	 * @static
	 * @deprecated Shards configuration is maintained via config
	 * @param {string} $conn_name
	 *  The name of the connection to which the shard pertains
	 * @param {string} $shard_name
	 *  The name under which to store the shard modifications
	 * @param {array} $modifications
	 *  The shard modifications. Can include the keys:
	 *  'dsn', 'host', 'port', 'dbname', 'unix_socket', 'charset',
	 *  'username', 'password', 'driver_options',
	 */
	static function setShard ($conn_name, $shard_name, $modifications)
	{
		if (class_exists('Q_Config')) {
			Q_Config::set('Db', 'connections', $conn_name, 'shards', $shard_name, $modifications);
		} else {
			// Standalone, no Q
			self::$shards[$conn_name][$shard_name] = $modifications;
		}
	}
	
	/**
	 * Returns all the shards added thus far for a connection
	 * @method getShards
	 * @static
	 * @deprecated Shards configuration is maintained via config
	 * @param {string} $conn_name
	 * @return {array}
	 */
	static function getShards ($conn_name)
	{
		if (class_exists('Q_Config')) {
			return Q_Config::get('Db', 'connections', $conn_name, 'shards', array());
		}
		// Else standalone, no Q
		return isset(self::$shards[$conn_name]) ? self::$shards[$conn_name] : array();
	}

	/**
	 * Returns modification details for a shard pertaining to a connection
	 * @method getShard
	 * @static
	 * @param {string} $conn_name
	 * @param {string} $shard_name
	 * @return {array|null}
	 */
	static function getShard ($conn_name, $shard_name)
	{
		if (class_exists('Q_Config')) {
			return Q_Config::get('Db', 'connections', $conn_name, 'shards', $shard_name, null);
		}
			
		// Else standalone, no Q
		if (! isset(self::$shards[$conn_name][$shard_name]))
			return null;
		return self::$shards[$conn_name][$shard_name];
	}

	/**
	 * Returns an associative array representing the dsn
	 * @method parseDsnString
	 * @static
	 * @param {string} $dsn_string
	 *  The dsn string passed to create the PDO object
	 * @return {array}
	 */
	static function parseDsnString($dsn_string)
	{
		$parts = explode(':', $dsn_string);
		$parts2 = explode(';', $parts[1]);
		$dsn_array = array();
		foreach ($parts2 as $part) {
			$parts3 = explode('=', $part);
			$dsn_array[$parts3[0]] = $parts3[1];
		}
		$dsn_array['dbms'] = strtolower($parts[0]);
		return $dsn_array;
	}

	/**
	 * This function uses Db to establish a connection
	 * with the information stored in the configuration.
	 * If the this Db object has already been made, 
	 * it returns this Db object.<br/>
	 * 
	 * Note: THIS FUNCTION NO LONGER CREATES A CONNECTION RIGHT OFF THE BAT.
	 * Instead, the real connection (PDO object) is only made when
	 * it is necessary (for example, when a query is executed).
	 *
	 * @method connect
	 * @static
	 * @param {string} $conn_name 
	 *  The name of the connection out of the connections added with Db::setConnection
	 * @return {Db_Interface}
	 */
	static function connect ($conn_name)
	{
		$conn_info = self::getConnection($conn_name);
		if (empty($conn_info))
			throw new Exception("Database connection \"$conn_name\" wasn't registered with Db.", -1);
		if (isset(self::$dbs[$conn_name]) and self::$dbs[$conn_name] instanceof Db_Interface) {
			return self::$dbs[$conn_name];
		}
		if (empty($conn_info['dsn'])) {
			if (class_exists('Q_Exception_MissingConfig')) {
				throw new Q_Exception_MissingConfig(array(
					'fieldpath' => "Db/connections/$conn_name/dsn"
				));
			} else {
				throw new Exception("Missing dsn for connection \"$conn_name\"");
			}
		}
		$dsn_array = Db::parseDsnString($conn_info['dsn']);
		$class_name = 'Db_' . ucfirst($dsn_array['dbms']);
		if (!class_exists($class_name)) {
			$filename_to_include = dirname(__FILE__) 
			. DS . 'Db' 
			. DS . ucfirst($dsn_array['dbms']) . '.php';
			if (file_exists($filename_to_include)) {
				include ($filename_to_include);
			}
		}
		// Don't instantiate the PDO object until we need it
		$db_adapted = new $class_name($conn_name);
		Db::$dbs[$conn_name] = $db_adapted;
		return $db_adapted;
	}

	/**
	 * Gets the key into the associative $pdo_array
	 * corresponding to some database credentials.
	 * @method pdo
	 * @protected
	 * @static
	 * @param {string} $dsn The dsn to create PDO
	 * @param {string} $username Username for connection
	 * @param {string} $password Passwork for connection
	 * @param {array} $driver_options Driver options
	 * @return {PDO}
	 */
	static function pdo (
		$dsn,
		$username,
		$password,
		$driver_options,
		$connection = null,
		$shard_name = null
	) {
		$key = $dsn . $username . $password . serialize($driver_options);
		if (isset(self::$pdo_array[$key])) {
			return self::$pdo_array[$key];
		}
		$dbname = $connection;
		$parts = explode(';', $dsn);
		foreach ($parts as $part) {
			$lr = explode('=', $part);
			if (strtolower(reset($lr)) === 'dbname') {
				$dbname = $lr[1];
			}
		}
		// Make a new connection to a database!
		try {
			self::$pdo_array[$key] = @new PDO($dsn, $username, $password, $driver_options);
			$alreadySetCharset = false;
			if (version_compare(PHP_VERSION, '5.3.6', '>=')) {
				$parts = Db::parseDsnString($dsn);
				if (isset($parts['charset'])) {
					$alreadySetCharset = true;
				}
			}
			if (!$alreadySetCharset && !isset($driver_options['exec'])) {
				$driver_options['exec'] = 'set names utf8mb4';
			}
			if (!empty($driver_options['exec'])) {
				self::$pdo_array[$key]->exec($driver_options['exec']);
			}
		} catch (Exception $e) {
			if (is_callable(array('Q', 'log'))
			and class_exists('Q_Config')
			and Q_Config::get('Db', 'exceptions', 'log', true)) {
				Q::log($e);
			}
			$exception = new Db_Exception_Connect(@compact('connection', 'dbname', 'shard_name'));
			throw $exception; // so we don't reveal connection details in some PHP instances
		}
		return self::$pdo_array[$key];
	}

	/**
	 * If connected, sets the timezone in the database to match the one in PHP.
	 * @param {integer} [$offset=timezone_offset_get()] in seconds
	 * @method setTimezones
	 */
	static function setTimezones($offset = null)
	{
		if (!isset($offset)) {
			$offset = (int)date('Z');
		}
		if (!$offset) {
			$offset = 0;
		}
		self::$timezoneSet = array();
		foreach (Db::$dbs as $db) {
			if ($db->pdo and !in_array($db->pdo, self::$timezoneSet)) {
				$db->setTimezone($offset);
				self::$timezoneSet[] = $db;
			}
		}
	}

	/**
	 * Returns a timestamp from a Date string
	 * For backward compatibility. Works with MySQL and hopefully
	 * lots of other databases.
	 * 
	 * @method fromDate
	 * @static
	 * @param {string} $syntax
	 *  The format of the date string, see {@link date()} function.
	 * @param {string} $datetime
	 *  The DateTime string that comes from the db
	 * @return {string}
	 *  The timestamp
	 */
	static function fromDate ($datetime)
	{
		$year = (int)substr($datetime, 0, 4);
		$month = (int)substr($datetime, 5, 2);
		$day = (int)substr($datetime, 8, 2);
		
		return mktime(0, 0, 0, $month, $day, $year);
	}

	/**
	 * Returns a Date string to store in the database
	 * For backward compatibility. Works with MySQL and hopefully
	 * lots of other databases.
	 *
	 * @method toDate
	 * @static
	 * @param {string} $timestamp
	 *  The UNIX timestamp, e.g. from strtotime function
	 * @return {string}
	 */
	static function toDate ($timestamp)
	{
		return date('Y-m-d', $timestamp);
	}
	
	/**
	 * Returns a timestamp from a DateTime string
	 * For backward compatibility. Works with MySQL and hopefully
	 * lots of other databases.
	 * 
	 * @method fromDateTime
	 * @static
	 * @param {string} $datetime
	 *  The DateTime string that comes from the db
	 * @param {string} [$timezone='GMT']
	 * @return {string}
	 *  The timestamp
	 */
	static function fromDateTime ($datetime, $timezone = 'GMT')
	{
		$date = new DateTime($datetime, new DateTimeZone($timezone));
		return $date->getTimestamp();
	}

	/**
	 * Returns a DateTime string to store in the database
	 * For backward compatibility. Works with MySQL and hopefully
	 * lots of other databases.
	 *
	 * @method toDateTime
	 * @static
	 * @param {string} $timestamp
	 *  The UNIX timestamp, e.g. from strtotime function
	 * @param {string} [$timezone='GMT']
	 * @return {string}
	 */
	static function toDateTime ($timestamp, $timezone = 'GMT')
	{
		$date = new DateTime();
		$date->setTimestamp($timestamp);
		$date->setTimezone(new DateTimeZone($timezone));
		return $date->format('Y-m-d H:i:s');
	}
	
	/**
	 * Returns an array for outputting to client.
	 *
	 * @method exportArray
	 * @static
	 * @param {mixed} $what Could be a (multidimensional) array of Db_Row objects or a Db_Row object
	 * @param {array} $options Options for row exportArray methods. Can also include the following:
	 * @param {boolean} [$options.numeric]: Makes a plain numerically indexed array, even if $what has keys
	 * @return {string}
	 */
	static function exportArray($what, $options = array())
	{
		$arr = is_array($what) ? $what : array($what);
		$result = array();
		foreach ($arr as $k => $row) {
			$r = is_array($row) ? self::exportArray($row, $options) : (
				$row ? (
					method_exists($row, 'exportArray')
					? $row->exportArray($options)
					: $row->fields
				) : $row
			);
			if (empty($options['numeric'])) {
				$result[$k] = $r;
			} else {
				$result[] = $r;
			}
		}
		return $result;
	}
	
	/**
	 * Calculates a hash code from a string, to match String.prototype.hashCode() in Q.js
	 * @static
	 * @param {string} $text
	 * @return {integer}
	 */
	static function hashCode($text)
	{
		$hash = 0;
		$len = strlen($text);
		if (!$len) {
			return $hash;
		}
		for ($i=0; $i<$len; ++$i) {
			$c = ord($text[$i]);
			$hash = $hash % 16777216;
			$hash = (($hash<<5)-$hash)+$c;
			$hash = $hash & $hash; // Convert to 32bit integer
		}
		return $hash;
	}
	
	/**
	 * Normalizes text by converting it to lower case, and
	 * replacing all non-accepted characters with underscores.
	 * @method normalize
	 * @static
	 * @param {string} $text
	 *  The text to normalize
	 * @param {string} $replacement='_'
	 *  Defaults to '_'. A string to replace one or more unacceptable characters.
	 *  You can also change this default using the config Db/normalize/replacement
	 * @param {string} $characters=null
	 *  Defaults to '/[^A-Za-z0-9]+/'. A regexp characters that are not acceptable.
	 *  You can also change this default using the config Db/normalize/characters
	 * @param {integer} $numChars=233
	 * @return {string} Returns null if $text was null, otherwise returns the normalized text
	 * @throws {null} if $text is null
	 */
	static function normalize(
		$text,
		$replacement = '_',
		$characters = null,
		$numChars = 233)
	{
		if (!isset($text)) {
			return null;
		}
		if (!isset($characters)) {
			$characters = '/[^A-Za-z0-9]+/';
			if (class_exists('Q_Config')) {
				$characters = Q_Config::get('Db', 'normalize', 'characters', $characters);
			}
		}
		if (!isset($replacement)) {
			$replacement = '_';
			if (class_exists('Q_Config')) {
				$replacement = Q_Config::get('Db', 'normalize', 'replacement', $replacement);
			}
		}
		$result = preg_replace($characters, $replacement, strtolower($text));
		if (strlen($text) > $numChars) {
			$result = substr($text, 0, $numChars - 33) . '_' . self::hashCode(substr($result, $numChars - 33));
		}
		return $result;
	}
	
	/**
	 * Hashes text in a standard way.
	 * @method hash
	 * @static
	 * @param {string} $text
	 * @return {string}
	 *	The hash string
	 */
	static function hash($text)
	{
		return md5(Db::normalize($text));
	}
	
	/**
	 * Generates a class name given a table name
	 * @method generateTableClassName
	 * @static
	 * @param {string} $table_name
	 * @param {string} $connection_name=null
	 * @return {string}
	 */
	static function generateTableClassName ($table_name, $connection_name = null)
	{
		$exploded = explode('.', $table_name);
		$table_name = end($exploded);
		if ($connection_name) {
			$conn = Db::getConnection($connection_name);
			$prefix = empty($conn['prefix']) ? '' : $conn['prefix'];
			if (!empty($prefix)) {
				$prefix_len = strlen($prefix);
				$table_name_prefix = substr($table_name, 0, $prefix_len);
				if ($table_name_prefix === $prefix) {
					$table_name = substr($table_name, $prefix_len);
				}
			}
		}
		$pieces = explode('_', $table_name);
		for ($i = 0, $count = count($pieces); $i < $count; ++ $i)
			$pieces[$i] = ucfirst($pieces[$i]);
		if ($connection_name) {
			return ucfirst($connection_name).'_'.implode($pieces, '');
		}
		return implode('', $pieces);
	}

	static function dump_table($rows)
	{
		$first_row = true;
		$keys = array();
		$lengths = array();
		foreach($rows as $row)
		{
			foreach($row as $key => $value)
			{
				if($first_row)
				{
					$keys[] = $key;
					$lengths[$key] = strlen($key);
				}
				$val_len = strlen((string) $value);
				if($val_len > $lengths[$key])
					$lengths[$key] = $val_len;
			}
			$first_row = false;
		}
		foreach($keys as $i => $key)
		{
			$key_len = strlen($key);
			if($key_len < $lengths[$key])
			{
				$keys[$i] .= str_repeat(' ', $lengths[$key] - $key_len);
			}
		}
		echo PHP_EOL;
		echo implode("\t", $keys);
		echo PHP_EOL;
		foreach($rows as $i => $row)
		{
			foreach($row as $key => $value)
			{
				$val_len = strlen((string) $value);
				if($val_len < $lengths[$key])
				{
					$row[$key] .= str_repeat(' ', $lengths[$key] - $val_len);
				}
			}
			echo implode("\t", $row);
			echo PHP_EOL;
		}
	}
	
	static function ageFromDateTime($date)
	{
		if (empty($date)) {
			return null;
		}
	    list($Y,$m,$d) = explode("-",$date);
	    return( date("md") < $m.$d ? date("Y")-$Y-1 : date("Y")-$Y );
	}

	/**
	 * Shorthand for when you want to use CURRENT_TIMESTAMP in the SQL
	 * @method now
	 * @static
	 * @return {Db_Expression} The expression CURRENT_TIMESTAMP
	 */
	static function now()
	{
		return new Db_Expression("CURRENT_TIMESTAMP");
	}
	
	/**
	 * Registers the autoloader bundled with Db on the autoload stack.
	 * Only call this if you are running Db without Pie.
	 * @method registerAutoloader
	 * @static
	 * @param {string} $class_dir=null
	 */
	public static function registerAutoloader($class_dir = null)
	{
		self::$class_dir = isset($class_dir) ? $class_dir : dirname(__FILE__);
		spl_autoload_register(array('Pie', 'autoload'));
	}
	
	/**
	 * If Db is used a standalone library, then this autoloader
	 * will be used after you call Db::registerAutoload()
	 * @method autoload
	 * @static
	 * @param {string} $class_name
	 */
	public static function autoload($class_name)
	{
		$class_name_parts = explode('_', $class_name);
		$filename = self::$class_dir . DIRECTORY_SEPARATOR
			. implode(DIRECTORY_SEPARATOR, $class_name_parts).'.php';
		if (file_exists($filename)) {
			include($filename);
		}
	}
	
	/**
	 * Turn off automatic caching on fetchAll and fetchDbRows.
	 * @method caching
	 * @param {boolean} $allow Pass false to suppress all caching.
	 *  Pass true to enable caching, for queries with $query->caching() as true.
	 * @return {Db_Query_Mysql}
	 */
	public static function allowCaching($allow = null)
	{
		if (!isset($allow)) {
			return self::$allowCaching;
		}
		$prevValue = self::$allowCaching;
		self::$allowCaching = $allow;
		return $prevValue;
	}

	/**
	 * Returns the number of milliseconds since the
	 * first call to this function (i.e. since script started).
	 * @method milliseconds
	 * @param {Boolean} $sinceEpoch
	 *  Defaults to false. If true, just returns the number of milliseconds in the UNIX timestamp.
	 * @return {float}
	 *  The number of milliseconds, with fractional part
	 */
	static function milliseconds ($sinceEpoch = false)
	{
		$result = microtime(true)*1000;
		if ($sinceEpoch) {
			return $result;
		}
		return $result - self::millisecondsStarted();
	}

	/**
	 * The microtime when the script first started executing
	 */
	static function millisecondsStarted()
	{
		static $microtime_start = null;
		if (!isset($microtime_start)) {
			$microtime_start = microtime(true)*1000;
		}
		return $microtime_start;
	}

	/**
	 * Determine whether a PHP array if associative or not
	 * Might be slow as it has to iterate through the array
	 * @param {array} $array
	 */
	static function isAssociative($array)
	{
		if (!is_array($array)) {
			return false;
		}
		
		// Keys of the array
		$keys = array_keys($array);

		// If the array keys of the keys match the keys, then the array must
		// not be associative (e.g. the keys array looked like {0:0, 1:1...}).
		return array_keys($keys) !== $keys;
	}
	
	/**
	 * Class dir cache
	 * @property $class_dir
	 * @type string
	 * @protected
	 */
	protected static $class_dir = null;
	
	protected static $allowCaching = true;

}
