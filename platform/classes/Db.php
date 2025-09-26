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
						break; // only need one
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
					if (count($sharded) > 1 or $shard === '*') {
						throw new Exception("Db::insertManyAndExecute row should be stored on exactly one shard: " . json_encode($record));
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
						$query->reuseStatement($last_queries[$shard]);
					}
					$query->execute(true, $shard);
					$last_q[$shard] = $q;
					$last_queries[$shard] = $query;
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
			$separator = "-------- NEXT QUERY STARTS HERE --------";
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
	function generateModels (
		$directory, 
		$classname_prefix = null)
	{
		$dc = '/**';
		if (!file_exists($directory))
			throw new Exception("directory $directory does not exist.");
		
		$connectionName = $this->connectionName();
		$conn = Db::getConnection($connectionName);
		
		$prefix = empty($conn['prefix']) ? '' : $conn['prefix'];
		$prefix_len = strlen($prefix);
		
		if (!isset($classname_prefix)) {
			$classname_prefix = isset($connectionName) ? $connectionName . '_' : '';
		}
		
		$rows = $this->_listTables();
		
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
			$table_name = $row[0];
			$table_name_base = substr($table_name, $prefix_len);
			$table_name_prefix = substr($table_name, 0, $prefix_len);
			if (empty($table_name_base) or $table_name_prefix != $prefix
			or stristr($table_name, '_Q_') !== false) {
				continue; // no class generated
			}
			
			$class_name_base = null;
			$js_base_class_string = '';
			$base_class_string = $this->codeForModelBaseClass(
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
		// e.g. \$this->hasMany(...) and stuff like that.
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
			$model_comment = $this->_introspectModelComment($prefix);
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
	function codeForModelBaseClass (
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
	
		$connectionName = $this->connectionName();
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
		$table_cols = $this->_introspectColumns($table_name);
		$table_comment = $this->_introspectTableComment($table_name);
		// Normalize defaults per adapter
		foreach ($table_cols as $k => $table_col) {
			$table_cols[$k]['Default'] = $this->_normalizeDefault($table_col['Default']);
		}
		$pk_exported = var_export($pk, true);
		$pk_json = json_encode($pk);

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
			throw new Exception('Non-integer value being assigned to '.\$this->getTable().".$field_name");
		\$value = intval(\$value);
		if (\$value < $type_range_min or \$value > $type_range_max) {
			\$json = json_encode(\$value);
			throw new Exception("Out-of-range value \$json being assigned to ".\$this->getTable().".$field_name");
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
			throw new Exception("Out-of-range value '\$value' being assigned to ".\$this->getTable().".$field_name");
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
			throw new Exception('Must pass a string to '.\$this->getTable().".$field_name");

EOT;
					if ($type_display_range and $type_display_range < $this->maxCheckStrlen) {
						$functions["beforeSet_$field_name_safe"][] = <<<EOT
		if (strlen(\$value) > $type_display_range)
			throw new Exception('Exceedingly long value being assigned to '.\$this->getTable().".$field_name");
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
			throw new Exception("Date \$json in incorrect format being assigned to ".\$this->getTable().".$field_name");
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
			throw new Exception('Non-numeric value being assigned to '.\$this->getTable().".$field_name");
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
		
		
		$field_names_exported = "\$this->fieldNames()";
		
		$functions['beforeSave'] = array();
		$js_functions['beforeSave'] = array();
		if ($required_field_names) {
			$required_fields_string = implode(',', $required_field_names);
			$beforeSave_code = <<<EOT
		if (!\$this->retrieved) {
			\$table = \$this->getTable();
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

		if (!\$this->retrieved and !isset(\$value['$cmf'])) {
			\$this->$cmf = \$value['$cmf'] = new Db_Expression('CURRENT_TIMESTAMP');
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
		\$this->$umf = \$value['$umf'] = new Db_Expression('CURRENT_TIMESTAMP');
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

		if (!isset(\$this->fields[$fn_json]) and !isset(\$value[$fn_json])) {
			\$this->$fn = \$value[$fn_json] = $fd;
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
EOT;;
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
		\$this->setDb(self::db());
		\$this->setTable(self::table());
		\$this->setPrimaryKey(
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
	 * Create SELECT query to the class table
	 * @method select
	 * @static
	 * @param {string|array} [\$fields=null] The fields as strings, or array of alias=>field.
	 *   The default is to return all fields of the table.
	 * @param {string} [\$alias=null] Table alias.
	 * @return {Db_Query_Mysql} The generated query
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
	 * @return {Db_Query_Mysql} The generated query
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
	 * @return {Db_Query_Mysql} The generated query
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
	 * @return {Db_Query_Mysql} The generated query
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
	 * @return {Db_Query_Mysql} The generated query
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
	 * @return {Db_Query_Mysql} The generated query
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
	 * @return {Db_Query_Mysql} The generated query
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
	var q = Base.db().rawQuery('').rollback(criteria);
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

	    /**
	 * Generates code for a base class for the model
	 * @method codeForModelBaseClass
	 * @param {string} $table The name of the table to generate the code for.
	 * @param {string} $directory The path of the directory in which to place the model code.
	 * @param {string} [$classname_prefix=''] The prefix to prepend to the generated class names
	 * @param {string} &$class_name_base If passed by reference and null, will be filled with the chosen class name (without prefix)
	 * @param {string} &$js_code Filled with the generated JavaScript code for the base class
	 * @param {string} &$table_comment Filled with the table comment (from MySQL, if any)
	 * @return {string} The generated code for the class.
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
		$dc = '/**';
		if (empty($table_name))
			throw new Exception('table_name parameter is empty', - 2);
		if (empty($directory))
			throw new Exception('directory parameter is empty', - 3);
	
		$connectionName = $this->connectionName();
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
        $table_cols = $this->_introspectColumns($table_name);
		$table_comment = $this->_introspectTableComment($table_name);
		// Calculate primary key
		$pk = array();
		foreach ($table_cols as $k => $table_col) {
			if ($table_col['Key'] == 'PRI') {
				$pk[] = $table_col['Field'];
			}
            $table_col = $this->normalizeDefault($table_col['Default']);
			$table_cols[$k] = $table_col;
        }
		$pk_exported = var_export($pk, true);
		$pk_json = json_encode($pk);

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
			throw new Exception('Non-integer value being assigned to '.\$this->getTable().".$field_name");
		\$value = intval(\$value);
		if (\$value < $type_range_min or \$value > $type_range_max) {
			\$json = json_encode(\$value);
			throw new Exception("Out-of-range value \$json being assigned to ".\$this->getTable().".$field_name");
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
			throw new Exception("Out-of-range value '\$value' being assigned to ".\$this->getTable().".$field_name");
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
			throw new Exception('Must pass a string to '.\$this->getTable().".$field_name");

EOT;
					if ($type_display_range and $type_display_range < $this->maxCheckStrlen) {
						$functions["beforeSet_$field_name_safe"][] = <<<EOT
		if (strlen(\$value) > $type_display_range)
			throw new Exception('Exceedingly long value being assigned to '.\$this->getTable().".$field_name");
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
			throw new Exception("Date \$json in incorrect format being assigned to ".\$this->getTable().".$field_name");
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
			throw new Exception('Non-numeric value being assigned to '.\$this->getTable().".$field_name");
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
		
		
		$field_names_exported = "\$this->fieldNames()";
		
		$functions['beforeSave'] = array();
		$js_functions['beforeSave'] = array();
		if ($required_field_names) {
			$required_fields_string = implode(',', $required_field_names);
			$beforeSave_code = <<<EOT
		if (!\$this->retrieved) {
			\$table = \$this->getTable();
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

		if (!\$this->retrieved and !isset(\$value['$cmf'])) {
			\$this->$cmf = \$value['$cmf'] = new Db_Expression('CURRENT_TIMESTAMP');
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
		\$this->$umf = \$value['$umf'] = new Db_Expression('CURRENT_TIMESTAMP');
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

		if (!isset(\$this->fields[$fn_json]) and !isset(\$value[$fn_json])) {
			\$this->$fn = \$value[$fn_json] = $fd;
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
EOT;;
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
		\$this->setDb(self::db());
		\$this->setTable(self::table());
		\$this->setPrimaryKey(
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
	 * Create SELECT query to the class table
	 * @method select
	 * @static
	 * @param {string|array} [\$fields=null] The fields as strings, or array of alias=>field.
	 *   The default is to return all fields of the table.
	 * @param {string} [\$alias=null] Table alias.
	 * @return {Db_Query_Mysql} The generated query
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
		\$alias = isset(\$alias) ? ' '.\$alias : '';
		\$q = self::db()->select(\$fields, self::table(true, \$alias));
		\$q->className = $class_name_var;
		return \$q;
	}

	$dc
	 * Create UPDATE query to the class table
	 * @method update
	 * @static
	 * @param {string} [\$alias=null] Table alias
	 * @return {Db_Query_Mysql} The generated query
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
	 * @return {Db_Query_Mysql} The generated query
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
	 * @return {Db_Query_Mysql} The generated query
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
	 * @return {Db_Query_Mysql} The generated query
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
	 * @return {Db_Query_Mysql} The generated query
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
	 * @return {Db_Query_Mysql} The generated query
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
	var q = Base.db().rawQuery('').rollback(criteria);
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
