<?php

include_once(dirname(__FILE__).'/../Db.php');

/**
 * @module Db
 */

interface Db_Query_Interface
{
	/**
	 * Interface that an adapter must support
	 * to implement the Db class.
	 * @class Db_Query_Interface
	 * @constructor
	 * @param {Db_Interface} $db The database connection
	 * @param {integer} $type The type of the query. See class constants beginning with TYPE_ .
	 * @param {array} $clauses The clauses to add to the query right away
	 * @param {array} $parameters The parameters to add to the query right away (to be bound when executing)
	 */
	//function __construct (
	//	Db_Interface $db, 
	//	$type, 
	//	array $clauses = array(), 
	//	array $parameters = array())

	/**
	 * Builds the query from the clauses
	 * @method build
	 */
	function build ();
	
	/**
	 * Just builds the query and returns the string that would
	 * be sent to $pdo->prepare().
	 * If this results in an exception, the string will contain
	 * the exception instead.
	 * @method __toString
	 */
	function __toString ();

	/**
	 * Surrounds an identifier with quotes to be inserted into a statement
	 * @method quoted
	 * @param {string} $identifier
	 */
	static function quoted($identifier);

	/**
	 * Gets the SQL that would be executed with the execute() method.
	 * @method getSQL
	 * @param {callable} [$callback=null] If not set, this function returns the generated SQL string.
	 *  If it is set, this function calls $callback, passing it the SQL
	 *  string, and then returns $this, for chainable interface.
	 * @return {string|Db_Query} Depends on whether $callback is set or not.
	 */
	function getSQL ($callback = null);

	/**
	 * Gets a clause from the query
	 * @method getClause
	 * @param {string} $clauseName
	 * @param {boolean} [$withAfter=false]
	 * @return {mixed} If $withAfter is true, returns array($clause, $after) otherwise just returns $clause
	 */
	function getClause($clauseName, $withAfter = false);

	/**
	 * Merges additional replacements over the default replacement array,
	 * which is currently just
	 * @example
	 *       array ( 
	 *          '{{prefix}}' => $conn['prefix'] 
	 *       )
	 *
	 *  The replacements array is used to replace strings in the SQL
	 *  before using it. Watch out, because it may replace more than you want!
	 * @method replace
	 * @param {array} [$replacements=array()] This must be an array.
	 */
	function replace(array $replacements = array());

	/**
	 * You can bind more parameters to the query manually using this method.
	 * These parameters are bound in the order they are passed to the query.
	 * Here is an example:
	 * @example
	 * 	$result = $db->select('*', 'foo')
	 * 		->where(array('a' => $a))
	 * 		->andWhere('a = :moo')
	 * 		->bind(array('moo' => $moo))
	 * 		->execute();
	 *
	 * @method bind
	 * @param {array} [$parameters=array()] An associative array of parameters. The query should contain :name,
	 *  where :name is a placeholder for the parameter under the key "name".
	 *  The parameters will be properly escaped.
	 *  You can also have the query contain question marks (the binding is
	 *  done using PDO), but then the order of the parameters matters.
	 * @chainable
	 */
	function bind(array $parameters = array());
	
	/**
	 * Executes a query against the database and returns the result set.
	 * @method execute
	 * @param {boolean} [$prepare_statement=false] Defaults to false. If true, a PDO statement will be prepared
	 *  from the query before it is executed. It is also saved for
	 *  future invocations to use.
	 *  Do this only if the statement will be executed many times with
	 *  different parameters. Basically you would use "->bind(...)" between 
	 *  invocations of "->execute()".
	 * @param {array|string} [$shards] You can pass a shard name here, or an array
	 *  where the keys are shard names and the values are the query to execute.
	 *  This will bypass the usual sharding algorithm.
	 * @return {Db_Result}
	 *  The Db_Result object containing the PDO statement that resulted
	 *  from the query.
	 */
	function execute ($prepare_statement = false, $shards = null);
	
	/**
	 * Begins a transaction right before executing this query.
	 * The reason this method is part of the query class is because
	 * you often need the "where" clauses to figure out which database to send it to,
	 * if sharding is being used.
	 * @method begin
	 * @param {string} [$$lockType='FOR UPDATE'] Defaults to 'FOR UPDATE', but can also be 'LOCK IN SHARE MODE'
	 * or set it to null to avoid adding a "LOCK" clause
	 * @param {string} [$transactionKey=null] Passing a key here makes the system throw an
	 *  exception if the script exits without a corresponding commit by a query with the
	 *  same transactionKey or with "*" as the transactionKey to "resolve" this transaction.
	 * @chainable
	 */
	function begin($lockType = null, $transactionKey = null);
	
	/**
	 * Rolls back a transaction right before executing this query.
	 * The reason this method is part of the query class is because
	 * you often need the "where" clauses to figure out which database to send it to,
	 * if sharding is being used.
	 * @method rollback
	 * @chainable
	 */
	function rollback();
	
	/**
	 * Commits a transaction right after executing this query.
	 * The reason this method is part of the query class is because
	 * you often need the "where" clauses to figure out which database to send it to,
	 * if sharding is being used.
	 * @method commit
	 * @param {string} [$transactionKey=null] Pass a transactionKey here to "resolve" a previously
	 *  executed that began a transaction with ->begin(). This is to guard against forgetting
	 *  to "resolve" a begin() query with a corresponding commit() or rollback() query
	 *  from code that knows about this transactionKey. Passing a transactionKey that doesn't
	 *  match the latest one on the transaction "stack" also generates an error.
	 *  Passing "*" here matches any transaction key that may have been on the top of the stack.
	 * @chainable
	 */
	function commit($transactionKey = null);
	
	/**
	 * Creates a query to select fields from one or more tables.
	 * @method select
	 * @param {string|array} $fields The fields as strings, or array of alias=>field
	 * @param {string|array} [$tables=''] The tables as strings, or array of alias=>table
	 * @param {boolean} [$reuse=true] If $tables is an array, and select() has
	 *  already been called with the exact table name and alias
	 *  as one of the tables in that array, then
	 *  this table is not appended to the tables list if
	 *  $reuse is true. Otherwise it is. $reuse is true by default.
	 *  This is really just for using in your hooks.
	 * @chainable
	 */
	function select ($fields, $tables = '', $reuse = true);

	/**
	 * Joins another table to use in the query
	 * @method join
	 * @param {string} $table The name of the table. May also be "name AS alias".
	 * @param {Db_Expression|array|string} $condition The condition to join on. Thus, JOIN table ON ($condition)
	 * @param {string} [$join_type='INNER'] The string to prepend to JOIN, such as 'INNER', 'LEFT OUTER', etc.
	 * @chainable
	 */
	function join ($table, $condition, $join_type = 'INNER');

	/**
	 * Adds a WHERE clause to a query
	 * @method where
	 * @param {Db_Expression|array} $criteria An associative array of expression => value pairs. 
	 *  The values are automatically escaped using PDO placeholders.
	 *  Or, this could be a Db_Expression object.
	 * @chainable
	 */
	function where ($criteria);

	/**
	 * Adds to the WHERE clause, like this:   "... AND (x OR y OR z)",
	 * where x, y and z are the arguments to this function.
	 * @method andWhere
	 * @param {Db_Expression|string} $criteria
	 * @param {Db_Expression|string} [$or_criteria=null]
	 * @chainable
	 */
	function andWhere ($criteria, $or_criteria = null);

	/**
	 * Adds to the WHERE clause, like this:   "... OR (x AND y AND z)",
	 * where x, y and z are the arguments to this function.
	 * @method orWhere
	 * @param {Db_Expression|string} $criteria
	 * @param {Db_Expression|string} [$and_criteria=null]
	 * @chainable
	 */
	function orWhere ($criteria, $and_criteria = null);

	/**
	 * Adds a GROUP BY clause to a query
	 * @method groupBy
	 * @param {Db_Expression|string} $expression
	 * @chainable
	 */
	function groupBy ($expression);

	/**
	 * Adds a HAVING clause to a query
	 * @method having
	 * @param {Db_Expression|array} $criteria An associative array of expression => value pairs.
	 *  The values are automatically escaped using PDO placeholders.
	 *  Or, this could be a Db_Expression object.
	 * @chainable
	 */
	function having ($criteria);

	
	/**
	 * Adds an ORDER BY clause to the query
	 * @method orderBy
	 * @param {Db_Expression|string} $expression A string or Db_Expression with the expression to order the results by.
	 * @param {boolean} [$ascending=true] If false, sorts results as ascending, otherwise descending.
	 * @chainable
	 */
	function orderBy ($expression, $ascending = true);

	/**
	 * Adds optional LIMIT and OFFSET clauses to the query
	 * @method limit
	 * @param {integer} $limit A non-negative integer showing how many rows to return
	 * @param {integer} [$offset=null] Optional. A non-negative integer showing what row to start the result set with.
	 * @chainable
	 */
	function limit ($limit, $offset = null);

	
	/**
	 * Adds a SET clause to an UPDATE statement
	 * @method set
	 * @param {array} $updates An associative array of column => value pairs. 
	 *  The values are automatically escaped using PDO placeholders.
	 * @chainable
	 */
	function set (array $updates);

	/**
	 * Fetches an array of database rows matching the query.
	 * If this exact query has already been executed and
	 * fetchAll() has been called on the Db_Result, and
	 * the return value was cached by the Db_Result, then
	 * that cached value is returned, unless $this->ignoreCache is true.
	 * Otherwise, the query is executed and fetchAll() is called on the result.
	 * 
	 * See [PDO documentation](http://us2.php.net/manual/en/pdostatement.fetchall.php)
	 * @method fetchAll
	 * @param {enum} $fetch_style=PDO::FETCH_BOTH
	 * @param {enum} $column_index=null
	 * @param {array} $ctor_args=null
	 * @return {array}
	 */
	function fetchAll(
		$fetch_style = PDO::FETCH_BOTH, 
		$column_index = null,
		array $ctor_args = array());
		
	/**
	 * Fetches an array of Db_Row objects.
	 * If this exact query has already been executed and
	 * fetchAll() has been called on the Db_Result, and
	 * the return value was cached by the Db_Result, then
	 * that cached value is returned, unless $this->ignoreCache is true.
	 * Otherwise, the query is executed and fetchDbRows() is called on the result.
	 * @method fetchDbRows
	 * @param {string} [$class_name='Db_Row'] The name of the class to instantiate and fill objects from.
	 *  Must extend Db_Row.
	 * @param {string} [$fields_prefix=''] This is the prefix, if any, to strip out when fetching the rows.
	 * @param {string} [$by_field=null] A field name to index the array by.
	 *  If the field's value is NULL in a given row, that row is just appended
	 *  in the usual way to the array.
	 * @return {array}
	 */
	function fetchDbRows(
		$class_name = 'Db_Row', 
		$fields_prefix = '',
		$by_field = null
	);

	/**
	 * Adds an ON DUPLICATE KEY UPDATE clause to an INSERT statement.
	 * Different database adapters handle this differently
	 * @method onDuplicateKeyUpdate
	 * @param {array} $updates An associative array of column => value pairs. 
	 *  The values are automatically escaped using PDO placeholders.
	 * @chainable
	 */
	function onDuplicateKeyUpdate ($updates);

	/**
	 * This function provides an easy way to provide additional clauses to the query.
	 * @method options
	 * @param {array} $options An associative array of key => value pairs, where the key is 
	 *  the name of the method to call, and the value is the array of arguments. 
	 *  If the value is not an array, it is wrapped in one.
	 * @chainable
	 */
	function options ($options);

};

/**
 * This class lets you create and use Db queries.
 * @class Db_Query
 * @extends Db_Expression
 */

abstract class Db_Query extends Db_Expression
{	
	/*
	 * Types of queries available right now
	 */
	/**
	 * Raw query
	 * @property TYPE_RAW
	 * @type integer
	 * @final
	 */
	const TYPE_RAW = 1;
	/**
	 * Select query
	 * @property TYPE_SELECT
	 * @type integer
	 * @final
	 */
	const TYPE_SELECT = 2;
	/**
	 * Insert query
	 * @property TYPE_INSERT
	 * @type integer
	 * @final
	 */
	const TYPE_INSERT = 3;
	/**
	 * Update query
	 * @property TYPE_UPDATE
	 * @type integer
	 * @final
	 */
	const TYPE_UPDATE = 4;
	/**
	 * Delete query
	 * @property TYPE_DELETE
	 * @type integer
	 * @final
	 */
	const TYPE_DELETE = 5;
	/**
	 * Rollback query
	 * @property TYPE_ROLLBACK
	 * @type integer
	 * @final
	 */
	const TYPE_ROLLBACK = 6;
	
	/**
	 * Default length of the hash used for sharding
	 * @property HASH_LEN
	 * @type integer
	 * @final
	 * @default 7
	 */
	const HASH_LEN = 7;

	/**
	 * The object implementing Db_Interface that this query uses
	 * @property $db
	 * @type Db
	 */
	public $db;

	/**
	 * The type of query this is (select, insert, etc.)
	 * @property $type
	 * @type integer
	 */
	public $type;

	/**
	 * The tables operated with query
	 * @property $table
	 * @type string
	 */
	public $table;

	/**
	 * The name of the class to instantiate when fetching database rows.
	 * @property $className
	 * @type string
	 */
	public $className;

	/**
	 * Clauses that this query has (WHERE, ORDER BY, etc.)
	 * @property $clauses
	 * @type array
	 * @default array()
	 */
	protected $clauses = array();

	/**
	 * Any additional text that comes after a clause
	 * @property $after
	 * @type array
	 * @default array()
	 */
	protected $after = array();

	/**
	 * The parameters passed to this query
	 * @property $parameters
	 * @type array
	 * @default array()
	 */
	public $parameters = array();

	/**
	 * Sometimes tells the build() function not to quote the value,
	 * e.g. if it is numeric
	 * @property $dontQuote
	 * @type array
	 * @default array()
	 */
	public $dontQuote = array();

	/**
	 * Whether to gather backtraces on exceptions
	 * @property $backtracesOnExceptions
	 * @type boolean
	 */
	public static $backtracesOnExceptions = false;

	/**
	 * If this query is prepared, this would point to the
	 * PDOStatement object
	 * @property $statement
	 * @type PDOStatement
	 * @default null
	 */
	protected $statement = null;

	/**
	 * The context of the query. Contains the following keys:
	 *
	 * * 'callback' => the function or method to call back
	 * * 'args' => the arguments to pass to that function or method
	 *
	 * @property $context
	 * @type array
	 * @default null
	 */
	protected $context = null;

	/**
	 * Strings to replace in the query, if getSQL() or execute() is called
	 * @property $replacements
	 * @type array
	 * @default array()
	 */
	protected $replacements = array();

	/**
	 * Whether to use the cache or not
	 * @property $ignoreCache
	 * @type boolean
	 * @default false
	 */
	protected $ignoreCache = false;

	/**
	 * Criteria used for sharding the query
	 * @property $criteria
	 * @type array
	 * @default array()
	 */
	protected $criteria = array();

	/**
	 * Whether to cache or not
	 * @property $caching
	 * @type boolean
	 * @default false
	 */
	protected $caching = null;

	/**
	 * The time when execution of this query started.
	 * Useful for debugging and performance tracking.
	 * @property $startedTime
	 * @type float|null
	 * @default null
	 */
	public $startedTime = null;

	/**
	 * The time when execution of this query ended.
	 * Useful for debugging and performance tracking.
	 * @property $endedTime
	 * @type float|null
	 * @default null
	 */
	public $endedTime = null;

	/**
	 * Whether to use deferred join optimization during execution.
	 * Can be set to true to allow joins to be executed in a delayed fashion.
	 * @property $useDeferredJoin
	 * @type boolean
	 * @default false
	 */
	public $useDeferredJoin = false;

	/**
	 * Whether this query is an INSERT ... SELECT query.
	 * Used internally to adjust behavior during query building and execution.
	 * @property $isInsertSelectQuery
	 * @type boolean
	 * @default false
	 */
	protected $isInsertSelectQuery = false;

	/**
	 * The unique key associated with the transaction this query is part of.
	 * Used internally to track and manage nested or concurrent transactions.
	 * @property $transactionKey
	 * @type string|null
	 * @default null
	 */
	protected $transactionKey = null;

	/**
	 * Whether the timezone has already been set for the current process.
	 * Used internally to avoid repeated timezone configuration.
	 * @property static $setTimezoneDone
	 * @type boolean|null
	 * @default null
	 */
	protected static $setTimezoneDone;

	/**
	 * A map of active nested transactions per connection or context.
	 * Used to manage rollback/commit logic when multiple transactions are nested.
	 * @property static $nestedTransactions
	 * @type array
	 * @default array()
	 */
	protected static $nestedTransactions = array();

	/**
	 * The number of currently active nested transactions for this query.
	 * Used internally to determine commit/rollback behavior.
	 * @property $nestedTransactionCount
	 * @type integer
	 * @default 0
	 */
	public $nestedTransactionCount = 0;

	/**
	 * Symbolic constant for "do not change this field" during upsert
	 * @var object
	 */
	private static $DONT_CHANGE;

	/**
	 * Returns the unique sentinel object for DONT_CHANGE
	 * @return object
	 */
	public static function DONT_CHANGE() {
		if (!self::$DONT_CHANGE) {
			self::$DONT_CHANGE = new \stdClass();
		}
		return self::$DONT_CHANGE;
	}

	/**
	 * Computes the adapter class name for a given Db instance.
	 * Example: Db_Mysql → Db_Query_Mysql
	 *
	 * @method adapterClass
	 * @static
	 * @param {Db} $db The Db adapter instance
	 * @return {string} The resolved adapter class name
	 */
	public static function adapterClass(Db_Interface $db)
	{
		$parts = explode('_', get_class($db));

		if ($parts[0] === 'Db') {
			$parts[0] = 'Db_Query';
		}

		return implode('_', $parts);
	}

	/**
	 * Resolves the adapter class name for a given Db instance.
	 *
	 * @method adapter
	 * @static
	 * @param {Db} $db The Db adapter instance (e.g. instance of Db_Mysql)
	 * @param {mixed} ...$args Optional extra arguments (query type, clauses, etc.)
	 * @return {string} The resolved Db_Query_* adapter class name
	 * @throws {Exception} If the adapter class does not exist
	 *
	 * @example
	 *     $db = new Db_Mysql("main");
	 *     Db_Query::adapter($db); // "Db_Query_Mysql"
	 */
	public static function adapter(Db_Interface $db)
	{
		// Collect optional args (PHP 5.2–style)
		$args = func_get_args();
		array_shift($args); // remove $db

		// Ask helper to compute the adapter class
		$adapter = self::adapterClass($db);

		// Verify class exists
		if (!class_exists($adapter)) {
			throw new Exception("Query adapter class '$adapter' not found");
		}

		// For now just return the adapter class name.
		// Future: $args can be used for more granular resolution.
		return $adapter;
	}

	/**
	 * This class lets you create and use Db queries
	 * @class Db_Query
	 * @extends Db_Query
	 * @constructor
	 * @param {Db_Interface} $db An instance of a Db adapter
	 * @param {integer} $type The type of the query. See class constants beginning with TYPE_ .
	 * @param {array} [$clauses=array()] The clauses to add to the query right away
	 * @param {array} [$parameters=array()] The parameters to add to the query right away (to be bound when executing). Values corresponding to numeric keys replace question marks, while values corresponding to string keys replace ":key" placeholders, in the SQL.
	 * @param {array} [$tables=null] The tables operated with query
	 */
	function __construct (
		Db_Interface $db,
		$type,
		array $clauses = array(),
		array $parameters = array(),
		$table = null)
	{
		$this->db = $db;
		$this->type = $type;
		$this->table = $table;
		$this->parameters = array();
		foreach ($parameters as $key => $value) {
			if ($value instanceof Db_Expression) {
				if (is_array($value->parameters)) {
					$this->parameters = array_merge(
						$this->parameters,
						$value->parameters);
				}
			} else {
				$this->parameters[$key] = $value;
			}
		}

		// and now, for sharding
		if ($type === Db_Query::TYPE_INSERT || $type === Db_Query::TYPE_ROLLBACK) {
			$this->criteria = $parameters;
		}

		$conn = $this->db->connection();
		$prefix = empty($conn['prefix']) ? '' : $conn['prefix'];
		$app = Q::app();
		$this->replacements = array(
			'{{prefix}}' => $prefix,
			'{{app}}' => $app
		);
		if (isset($db->dbname)) {
			$this->replacements['{{dbname}}'] = $db->dbname;
		}

		// Put default contents in the clauses
		// in case the query gets run.
		if (count($clauses) > 0) {
			$this->clauses = $clauses;
		} else {
			switch ($type) {
				case Db_Query::TYPE_SELECT:
					$this->clauses = array(
						'SELECT' => '',
						'FROM' => '',
						'WHERE' => ''
					);
					break;
				case Db_Query::TYPE_INSERT:
					$this->clauses = array('INTO' => '', 'VALUES' => '');
					break;
				case Db_Query::TYPE_UPDATE:
					$this->clauses = array(
						'UPDATE' => array(),
						'SET' => array()
					);
					break;
				case Db_Query::TYPE_DELETE:
					break;
				case Db_Query::TYPE_RAW:
					break;
				case Db_Query::TYPE_ROLLBACK:
					$this->clauses = array("ROLLBACK" => true);
					break;
				default:
					throw new Exception("unknown query type", - 1);
			}
		}
	}

	function copy()
	{
		// We only have to do a shallow copy of the object,
		// because all its properties are arrays, and PHP will copy-on-write
		// them when we modify them in the copy.
		return clone($this);
	}

	/**
	 * Connects to database
	 * @method reallyConnect
	 * @protected
	 * @param {string} [$shardName=null]
	 * @return {PDO} The PDO object for connection
	 */
	protected function reallyConnect($shardName = null, &$shardInfo = null)
	{
		if (class_exists('Q')) {
			/**
			 * @event Db/reallyConnect {before}
			 * @param {Db_Query} query
			 * @param {string} 'shardName'
			 */
			Q::event(
				'Db/reallyConnect',
				array('query' => $this, 'shardName' => $shardName),
				'before'
			);
		}
		return $this->db->reallyConnect($shardName, $shardInfo);
	}

	/**
	 * Gets the SQL that would be executed with the execute() method. See {{#crossLink "Db_Query/build"}}{{/crossLink}}.
	 * @method getSQL
	 * @param {callable} [$callback=null] If not set, this function returns the generated SQL string.
	 * If it is set, this function calls $callback, passing it the SQL string, and then returns $this, for chainable interface.
	 * @param {boolean} [$template=false]
	 * @return {string|Db_Query} Depends on whether $callback is set or not.
	 * @throws {Exception} This function calls self::build()
	 */
	function getSQL ($callback = null, $template = false)
	{
		if (!$template) {
			if (isset($this->db->dbname)) {
				$this->replacements['{{dbname}}'] = $this->db->dbname;
			}
			$this->replacements['{{prefix}}'] = isset($this->db->prefix)
				? $this->db->prefix
				: '';
		}
		$repres = $this->build();
		$keys = array_keys($this->parameters);
		usort($keys, [get_called_class(), 'replaceKeysCompare']);
		foreach ($keys as $key) {
			$value = $this->parameters[$key];
			if (!isset($value)) {
				$value2 = "NULL";
			} else if ($value instanceof Db_Expression or !empty($this->dontQuote[$key])) {
				$value2 = $value;
			} else {
				$value2 = $this->reallyConnect()->quote($value);
			}
			if (is_numeric($key) and intval($key) == $key) {
				// replace one of the question marks
				if (false !== ($pos = strpos($repres, '?'))) {
					$repres = substr($repres, 0, $pos) . (string)$value2 . substr($repres, $pos+1);
				}
			} else {
				// we don't use $repres = str_replace(":$key", "$value2", $repres);
				// because we want to replace only one occurrence
				if (false !== ($pos = strpos($repres, ":$key"))) {
					$pos2 = $pos + strlen(":$key");
					$repres = substr($repres, 0, $pos) . (string)$value2 . substr($repres, $pos2);
				}
			}
		}
		foreach ($this->replacements as $k => $v) {
			$repres = str_replace($k, $v, $repres);
		}
		if (isset($callback)) {
			$args = array($repres);
			Q::call($callback, $args);
			return $this;
		}
		return $repres;
	}

	/**
	 * If cached data already exists on fetchAll and fetchDbRows, ignore it.
	 * @method ignoreCache
	 * @chainable
	 */
	function ignoreCache()
	{
		$this->ignoreCache = true;
		return $this;
	}

	/**
	 * Turn off automatic caching on fetchAll and fetchDbRows.
	 * @method caching
	 * @param {boolean} [$mode=null] Pass false to suppress all caching. Pass true to cache everything. The default is null, which caches everything except empty results.
	 * @return {Db_Query}
	 */
	function caching($mode = null)
	{
		$this->caching = $mode;
		return $this;
	}
	
	/**
	 * @method replaceKeysCompare
	 * @protected
	 * @return {integer}
	 */
	static protected function replaceKeysCompare($a, $b)
	{
		$aIsInteger = (is_numeric($a) and intval($a) == $a);
		$bIsInteger = (is_numeric($b) and intval($b) == $b);
		if ($aIsInteger and !$bIsInteger) {
			return 1;
		}
		if ($bIsInteger and !$aIsInteger) {
			return -1;
		}
		if ($aIsInteger and $bIsInteger) {
			return intval($a) - intval($b);
		}
		return strlen($b)-strlen($a);
	}

	/**
	 * Merges additional replacements over the default replacement array,
	 * which is currently just
	 * @example
	 *      array (
	 *         '{{prefix}}' => $conn['prefix']
	 *      )
	 *
	 * The replacements array is used to replace strings in the SQL before using it. Watch out,
	 * because it may replace more than you want!
	 * @method replace
	 * @param {array} [$replacements=array()] This must be an array.
	 */
	function replace(array $replacements = array())
	{
		$this->replacements = array_merge($this->replacements, $replacements);
	}

	/**
	 * Gets a clause from the query
	 * @method getClause
	 * @param {string} $clauseName
	 * @param {boolean} [$withAfter=false]
	 * @return {mixed} If $withAfter is true, returns array($clause, $after) otherwise just returns $clause
	 */
	function getClause($clauseName, $withAfter = false)
	{
		$clause = isset($this->clauses[$clauseName])
			? $this->clauses[$clauseName]
			: '';
		if (!$withAfter) {
			return $clause;
		}
		$after = isset($this->after[$clauseName])
			? $this->after[$clauseName]
			: '';
		return array($clause, $after);
	}

	/**
	 * You can bind more parameters to the query manually using this method.
	 * These parameters are bound in the order they are passed to the query.
	 * Here is an example:
	 * @example
	 * 	$result = $db->select('*', 'foo')
	 * 		->where(array('a' => $a))
	 * 		->andWhere('a = :moo')
	 * 		->bind(array('moo' => $moo))
	 * 		->execute();
	 *
	 * @method bind
	 * @param {array} [$parameters=array()] An associative array of parameters. The query should contain :name,
	 * where :name is a placeholder for the parameter under the key "name".
	 * The parameters will be properly escaped. You can also have the query contain question marks (the binding is
	 * done using PDO), but then the order of the parameters matters.
	 * @return {Db_Query}  The resulting object implementing Db_Query_Interface.
	 * @chainable
	 */
	function bind(array $parameters = array())
	{
		foreach ($parameters as $key => $value) {
			if ($value instanceof Db_Expression) {
				if (is_array($value->parameters)) {
					$this->parameters = array_merge(
						$this->parameters,
						$value->parameters
					);
				}
			} else {
				$this->parameters[$key] = $value;
			}
		}
		return $this;
	}

	/**
	 * @method shutdownFunction
	 * @static
	 */
	static function shutdownFunction()
	{
		$connections = 0;
		foreach (self::$nestedTransactions as $t) {
			if (!empty($t['count'])) {
				++$connections;
			}
		}
		if ($connections) {
			if (class_exists('Q')) {
				Q::log("WARNING: Forgot to resolve transactions on $connections connections."
					. "\nRolling them back:");
				$pdos = array();
				foreach (self::$nestedTransactions as $t) {
					if ($t['pdos']) {
						foreach ($t['pdos'] as $pdo) {
							$found = false;
							foreach ($pdos as $p) {
								if ($p === $pdo) {
									$found = true;
									break;
								}
							}
							if (!$found) {
								$pdos = array();
								try {
									$pdo->rollBack();
								} catch (Exception $e) {}
							}
						}
					}
					Q::log($t['connections']);
					Q::log($t['backtraces']);
				}
			}
		}
	}

	/**
	 * Works with SELECT queries to lock the selected rows.
	 * Use only with MySQL.
	 * @method lock
	 * @param {string} [$type='FOR UPDATE'] Defaults to 'FOR UPDATE', but can also be 'LOCK IN SHARE MODE'
	 * @chainable
	 */
	function lock($type = 'FOR UPDATE') {
		switch (strtoupper($type)) {
			case 'FOR UPDATE':
			case 'LOCK IN SHARE MODE':
				$this->clauses['LOCK'] = "$type";
				break;
			default:
				throw new Exception("Incorrect type for MySQL lock");
		}
		return $this;
	}

	/**
	 * Begins a transaction right before executing this query.
	 * The reason this method is part of the query class is because
	 * you often need the "where" clauses to figure out which database to send it to,
	 * if sharding is being used.
	 * @method begin
	 * @param {string|false} [$lockType='FOR UPDATE'] Defaults to 'FOR UPDATE', but can also be 'LOCK IN SHARE MODE'
	 *  or set it to false to avoid adding a "LOCK" clause
	 * @param {string} [$transactionKey=null] Passing a key here makes the system throw an
	 *  exception if the script exits without a corresponding commit by a query with the
	 *  same transactionKey or with "*" as the transactionKey to "resolve" this transaction.
	 * @chainable
	 */
	function begin($lockType = null, $transactionKey = null)
	{
		if (!isset($lockType) or $lockType === true) {
			$lockType = 'FOR UPDATE';
		}
		$this->ignoreCache();
		if ($lockType) {
			$this->lock($lockType);
		}
		if (isset($transactionKey)) {
			$this->transactionKey = $transactionKey;
		}
		$this->clauses["BEGIN"] = "START TRANSACTION";
		return $this;
	}

	/**
	 * Roll back a transaction right after executing this query.
	 * The reason this method is part of the query class is because
	 * you often need the "where" clauses to figure out which database to send it to,
	 * if sharding is being used.
	 * @method rollback
	 * @param {string} [$criteria=null] Pass this to target the rollback to the right shard.
	 * @chainable
	 */
	function rollback($criteria = null)
	{
		if (!empty($this->clauses["BEGIN"])) {
			throw new Exception("You can't use BEGIN and ROLLBACK in the same query.", -1);
		}
		if (!empty($this->clauses["COMMIT"])) {
			throw new Exception("You can't use COMMIT and ROLLBACK in the same query.", -1);
		}
		$this->clauses["ROLLBACK"] = "ROLLBACK";
		if ($criteria) {
			$this->criteria = $criteria;
		}
		return $this;
	}

	/**
	 * Commits a transaction right after executing this query.
	 * The reason this method is part of the query class is because
	 * you often need the "where" clauses to figure out which database to send it to,
	 * if sharding is being used.
	 * @method commit
	 * @param {string} [$transactionKey=null] Pass a transactionKey here to "resolve" a previously
	 *  executed that began a transaction with ->begin(). This is to guard against forgetting
	 *  to "resolve" a begin() query with a corresponding commit() or rollback() query
	 *  from code that knows about this transactionKey. Passing a transactionKey that doesn't
	 *  match the latest one on the transaction "stack" also generates an error.
	 *  Passing "*" here matches any transaction key that may have been on the top of the stack.
	 * @chainable
	 */
	function commit($transactionKey = null)
	{
		if (!empty($this->clauses["BEGIN"])) {
			throw new Exception("You can't use BEGIN and COMMIT in the same query.", -1);
		}
		if (!empty($this->clauses["ROLLBACK"])) {
			throw new Exception("You can't use COMMIT and ROLLBACK in the same query.", -1);
		}
		$this->ignoreCache();
		$this->clauses["COMMIT"] = "COMMIT";
		if (isset($transactionKey)) {
			$this->transactionKey = $transactionKey;
		}
		return $this;
	}

	/**
	 * Creates a query to select fields from one or more tables.
	 * @method select
	 * @param {string|array} $fields The fields as strings, or array of alias=>field
	 * @param {string|array} [$tables=''] The tables as strings, or array of alias=>table
	 * @param {boolean} [$repeat=false] If $tables is an array, and select() has
	 * already been called with the exact table name and alias
	 * as one of the tables in that array, then
	 * this table is not appended to the tables list if
	 * $repeat is false. Otherwise it is.
	 * This is really just for using in your hooks.
	 * @return {Db_Query} The resulting object implementing Db_Query_Interface.
	 * You can use it to chain the calls together.
	 * @throws {Exception} If $tables is specified incorrectly
	 * @chainable
	 */
	function select ($fields, $tables = '', $repeat = false)
	{
		if ($this->type === Db_Query::TYPE_INSERT) {
			$this->isInsertSelectQuery = true;
		}
		$as = ' '; // was: ' AS ', but now we made it more standard SQL
		if (is_array($fields)) {
			$fields_list = array();
			foreach ($fields as $alias => $column) {
				$fields_list[] = static::column($column) . (is_int($alias) ? '' : "$as$alias");
			}
			$fields = implode(', ', $fields_list);
		}
		if (! is_string($fields)) {
			throw new Exception("The fields to select need to be specified correctly.", -1);
		}

		if (empty($this->clauses['SELECT'])) {
			$this->clauses['SELECT'] = $fields;
		} else {
			$this->clauses['SELECT'] .= ", $fields";
		}

		if ($repeat) {
			$prev_tables_list = explode(',', $this->clauses['FROM']);
		}

		if (! empty($tables)) {
			if (is_array($tables)) {
				$tables_list = array();
				foreach ($tables as $alias => $table) {
					if ($table instanceof Db_Expression) {
						$table_string = is_int($alias) ? "($table)" : "($table) $as $alias";
						$this->parameters = array_merge(
							$this->parameters, $table->parameters
						);
					} else {
						$table_string = is_int($alias) ? "$table" : "$table $as $alias";
					}
					if ($repeat and in_array($table_string, $prev_tables_list)) {
						continue;
					}
					$tables_list[] = $table_string;
				}
				$tables = implode(', ', $tables_list);
			} else if ($tables instanceof Db_Expression) {
				if (isset($tables->parameters)) {
					$this->parameters = array_merge(
						$this->parameters, $tables->parameters
					);
				}
				$tables = $tables->expression;
			}
			if (! is_string($tables)) {
				throw new Exception("The tables to select from need to be specified correctly.", -1);
			}

			if (empty($this->clauses['FROM'])) {
				$this->clauses['FROM'] = $tables;
			} else {
				$this->clauses['FROM'] .= ", $tables";
			}
		}

		return $this;
	}

	/**
	 * Joins another table to use in the query
	 * @method join
	 * @param {string} $table The name of the table. May also be "name alias".
	 * @param {Db_Expression|array|string} $condition The condition to join on. Thus, JOIN table ON ($condition)
	 * @param {string} [$join_type='INNER'] The string to prepend to JOIN, such as 'INNER' (default), 'LEFT OUTER', etc.
	 * @return {Db_Query} The resulting object implementing Db_Query_Interface
	 * @throws {Exception} If JOIN clause does not belong to context or condition specified incorrectly
	 * @chainable
	 */
	function join ($table, $condition, $join_type = 'INNER')
	{
		switch ($this->type) {
			case Db_Query::TYPE_SELECT:
			case Db_Query::TYPE_UPDATE:
				break;
			case Db_Query::TYPE_DELETE:
				if (!empty($this->after['FROM'])) {
					break;
				}
			case Db_Query::TYPE_INSERT:
				if ($this->isInsertSelectQuery) {
					break;
				}
			default:
				throw new Exception("the JOIN clause does not belong in this context.", - 1);
		}

		static $i = 1;
		if (is_array($condition)) {
			$condition_list = array();
			foreach ($condition as $expr => $value) {
				if (is_array($value)) {
					// a bunch of OR criteria
					$pieces = array();
					foreach ($value as $v) {
						foreach ($v as $a => &$b) {
							$v[$a] = new Db_Expression($b);
						}
						$pieces[] = $this->criteria_internal($v);
					}
					$condition_list[] = implode(' OR ', $pieces);
				} else {
					$condition_list[] = $this->criteria_internal(array($expr => new Db_Expression($value)), $criteria);
				}
			}
			$condition = implode(' AND ', $condition_list);
		} else if ($condition instanceof Db_Expression) {
			if (is_array($condition->parameters)) {
				$this->parameters = array_merge(
					$this->parameters, $condition->parameters
				);
			}
			$condition = (string) $condition;
		}
		if (! is_string($condition)) {
			throw new Exception("The JOIN condition needs to be specified correctly.", -1);
		}

		$join = "$join_type JOIN $table ON ($condition)";

		if (empty($this->clauses['JOIN'])) {
			$this->clauses['JOIN'] = $join;
		} else {
			$this->clauses['JOIN'] .= " \n$join";
		}

		return $this;
	}

	/**
	 * Surround the query with "EXISTS()" or "NOT EXISTS()"
	 * to be used as a Db_Expression object
	 * @param {boolean} $shouldExist
	 * @chainable
	 */
	function exists($shouldExist)
	{
		if ($shouldExist) {
			$this->clauses['EXISTS'] = true;
		} else {
			$this->clauses['NOT EXISTS'] = true;
		}
		return $this;
	}

	/**
	 * Adds an IGNORE clause to certain queries
	 * @method ignore
	 * @return {Db_Query} The resulting object implementing Db_Query_Interface
	 * @throws {Exception} If WHERE clause does not belong to context
	 */
	function ignore ()
	{
		reset($this->clauses);
		$firstClause = key($this->clauses);
		$this->clauses[$firstClause] = 'IGNORE ' . $this->clauses[$firstClause];
		return $this;
	}

	/**
	 * Adds a WHERE clause to a query
	 * @method where
	 * @param {Db_Expression|array} $criteria An associative array of expression => value pairs.
	 * The values are automatically escaped using the database server, or turned into PDO placeholders for prepared statements
	 * They can also be arrays, in which case they are placed into an expression of the form key IN ('val1', 'val2')
	 * Or, this could be a Db_Expression object.
	 * @return {Db_Query} The resulting object implementing Db_Query_Interface
	 * @throws {Exception} If WHERE clause does not belong to context
	 * @chainable
	 */
	function where ($criteria)
	{
		switch ($this->type) {
			case Db_Query::TYPE_SELECT:
			case Db_Query::TYPE_UPDATE:
			case Db_Query::TYPE_DELETE:
				break;
			case Db_Query::TYPE_INSERT:
				if ($this->isInsertSelectQuery) {
					break;
				}
			default:
				throw new Exception("The WHERE clause does not belong in this context.", -1);
		}
		
		if (!isset($criteria)) {
			return $this;
		}

		// and now, for sharding
		if (is_array($criteria)) {
			$this->criteria = $criteria;
		}

		$criteria = $this->criteria_internal($criteria);
		if (! is_string($criteria)) {
			throw new Exception("The WHERE criteria need to be specified correctly.", - 1);
		}

		if (empty($criteria)) {
			return $this;
		}

		if (empty($this->clauses['WHERE'])) {
			$this->clauses['WHERE'] = "$criteria";
		} else {
			$this->clauses['WHERE'] = '(' . $this->clauses['WHERE'] . ") AND ($criteria)";
		}

		return $this;
	}

	/**
	 * Adds to the WHERE clause, like this:   "... AND (x OR y OR z)",
	 * where x, y and z are the arguments to this function.
	 * @method andWhere
	 * @param {array|Db_Expression|string} $criteria An associative array of expression => value pairs.
	 * The values are automatically escaped using the database server, or turned into PDO placeholders
	 * for prepared statements
	 * They can also be arrays, in which case they are placed into an expression of the form "key IN ('val1', 'val2')"
	 * Or, this could be a Db_Expression object.
	 * @param {array|Db_Expression|string} [$or_criteria=null]
	 * @return {Db_Query} The resulting object implementing Db_Query_Interface
	 * @throws {Exception} If WHERE clause does not belong to context
	 * @chainable
	 */
	function andWhere ($criteria, $or_criteria = null)
	{
		switch ($this->type) {
			case Db_Query::TYPE_SELECT:
			case Db_Query::TYPE_UPDATE:
			case Db_Query::TYPE_DELETE:
				break;
			case Db_Query::TYPE_INSERT:
				if ($this->isInsertSelectQuery) {
					break;
				}
			default:
				throw new Exception("The WHERE clause does not belong in this context.", -1);
		}
		
		if (!isset($criteria)) {
			return $this;
		}

		if (empty($this->clauses['WHERE'])) {
			throw new Exception("Don't call andWhere() when you haven't called where() yet", -1);
		}

		$args = func_get_args();
		$c_arr = array();
		$was_empty = true;
		foreach ($args as $arg) {
			if (!isset($arg)) {
				continue;
			}
			$c = $this->criteria_internal($arg);
			if (! is_string($c)) {
				throw new Exception("The WHERE criteria need to be specified correctly.", -1);
			}
			$c_arr[] = $c;
			if (!empty($c)) {
				$was_empty = false;
			}
		}

		if ($was_empty) {
			return $this;
		}

		// and now, for sharding
		if ($this->shardIndex() and is_array($criteria)) {
			if (empty($this->criteria)) {
				$this->criteria = $criteria;
			} else {
				if (count($args) > 1) {
					throw new Exception("You can't use OR in your WHERE clause when sharding.");
				}
				$this->criteria = array_merge($this->criteria, $criteria);
			}
		}

		$new_criteria = '('.implode(') OR (', $c_arr).')';
		$this->clauses['WHERE'] = '(' . $this->clauses['WHERE'] . ") AND ($new_criteria)";
		return $this;
	}

	/**
	 * Adds to the WHERE clause, like this:   "... OR (x AND y AND z)",
	 * where x, y and z are the arguments to this function.
	 * @method orWhere
	 * @param {array|Db_Expression|string} $criteria An associative array of expression => value pairs.
	 * The values are automatically escaped using the database server, or turned into PDO placeholders for prepared statements
	 * They can also be arrays, in which case they are placed into an expression of the form key IN ('val1', 'val2')
	 * Or, this could be a Db_Expression object.
	 * @param {array|Db_Expressio|string} [$and_criteria=null]
	 * @return {Db_Query} The resulting object implementing Db_Query_Interface
	 * @throws {Exception} If WHERE clause does not belong to context
	 * @chainable
	 */
	function orWhere ($criteria, $and_criteria = null)
	{
		switch ($this->type) {
			case Db_Query::TYPE_SELECT:
			case Db_Query::TYPE_UPDATE:
			case Db_Query::TYPE_DELETE:
				break;
			case Db_Query::TYPE_INSERT:
				if ($this->isInsertSelectQuery) {
					break;
				}
			default:
				throw new Exception("The WHERE clause does not belong in this context.", -1);
		}
		
		if (!isset($criteria)) {
			return $this;
		}

		$args = func_get_args();
		$c_arr = array();
		$was_empty = true;
		foreach ($args as $arg) {
			if (!isset($arg)) {
				continue;
			}
			$c = $this->criteria_internal($arg);
			if (! is_string($c)) {
				throw new Exception("The WHERE criteria need to be specified correctly.", -1);
			}
			if (!empty($c)) {
				$was_empty = false;
			}
			$c_arr[] = $c;
		}
		if ($was_empty) {
			return $this;
		}

		// and now, for sharding
		if ($this->shardIndex() and is_array($criteria) and !empty($this->criteria)) {
			throw new Exception("You can't use OR in your WHERE clause when sharding.");
		}

		$new_criteria = '('.implode(') AND (', $c_arr).')';
		$this->clauses['WHERE'] = '(' . $this->clauses['WHERE'] . ") OR ($new_criteria)";
		return $this;
	}

	/**
	 * This function is specifically for adding criteria to query for sharding purposes.
	 * It doesn't affect the SQL generated for the query.
	 * You can also call this function with an empty set of parameters, to get the current criteria.
	 * @method criteria
	 * @param {array} $criteria An associative array of expression => value pairs.
	 */
	function criteria($criteria = null)
	{
		if (is_array($criteria)) {
			if (empty($this->criteria)) {
				$this->criteria = $criteria;
			} else {
				$this->criteria = array_merge($this->criteria, $criteria);
			}
		}
		return $this->criteria;
	}

	/**
	 * Adds a GROUP BY clause to a query
	 * @method groupBy
	 * @param {Db_Expression|string} $expression
	 * @return {Db_Query} The resulting object implementing Db_Query_Interface
	 * @throws {Exception} If GROUP clause does not belong to context
	 * @chainable
	 */
	function groupBy ($expression)
	{
		switch ($this->type) {
			case Db_Query::TYPE_SELECT:
				break;
			case Db_Query::TYPE_INSERT:
				if ($this->isInsertSelectQuery) {
					break;
				}
			default:
				throw new Exception("The GROUP BY clause does not belong in this context.", -1);
		}

		if ($expression instanceof Db_Expression) {
			if (is_array($expression->parameters)) {
				$this->parameters = array_merge(
					$this->parameters, $expression->parameters
				);
			}
			$expression = (string) $expression;
		}
		if (! is_string($expression)) {
			throw new Exception("The GROUP BY expression has to be specified correctly.", -1);
		}

		if (empty($this->clauses['GROUP BY']))
			$this->clauses['GROUP BY'] = "$expression";
		else
			$this->clauses['GROUP BY'] .= ", $expression";
		//if (empty($this->clauses['ORDER BY']))
		//	$this->clauses['ORDER BY'] = "NULL"; // to avoid sorting overhead
		return $this;
	}

	/**
	 * Adds a HAVING clause to a query
	 * @method having
	 * @param {Db_Expression|array} $criteria An associative array of expression => value pairs.
	 * The values are automatically escaped using PDO placeholders. Or, this could be a Db_Expression object.
	 * @return {Db_Query} The resulting object implementing Db_Query_Interface
	 * @throws {Exception} If groupBy as not called or criteria is specified incorrectly
	 * @chainable
	 */
	function having ($criteria)
	{
		switch ($this->type) {
			case Db_Query::TYPE_SELECT:
				break;
			case Db_Query::TYPE_INSERT:
				if ($this->isInsertSelectQuery) {
					break;
				}
			default:
				throw new Exception(
					"The HAVING clause does not belong in this context.",
				-1);
		}
		if (empty($this->clauses['GROUP BY'])) {
			throw new Exception("Don't call having() when you haven't called groupBy() yet", -1);
		}

		$criteria = $this->criteria_internal($criteria);
		if (! is_string($criteria)) {
			throw new Exception("The HAVING criteria need to be specified correctly.", - 1);
		}

		if (empty($this->clauses['HAVING']))
			$this->clauses['HAVING'] = "$criteria";
		else
			$this->clauses['HAVING'] = '(' . $this->clauses['HAVING'] . ") AND ($criteria)";

		return $this;
	}

	/**
	 * Adds an ORDER BY clause to the query
	 * @method orderBy
	 * @param {Db_Expression|string} $expression A string or Db_Expression with the expression to order the results by.
	 *  Can also be "random", in which case you are highly encouraged to call ->ignoreCache() as well to get a new random result every time!
	 * @param {boolean|string} $ascending true/false or "ASC"/"DESC"
	 * @return {Db_Query}  The resulting object implementing Db_Query_Interface
	 * @throws {Exception} If ORDER BY clause does not belong to context
	 * @chainable
	 */
	function orderBy($expression, $ascending = true)
	{
		switch ($this->type) {
			case Db_Query::TYPE_SELECT:
			case Db_Query::TYPE_UPDATE:
				break;
			case Db_Query::TYPE_INSERT:
				if ($this->isInsertSelectQuery) break;
			default:
				throw new Exception("The ORDER BY clause does not belong in this context.", -1);
		}

		if ($expression instanceof Db_Expression) {
			if (is_array($expression->parameters)) {
				$this->parameters = array_merge($this->parameters, $expression->parameters);
			}
		}
		$expression = (string) $expression;

		if (!is_string($expression)) {
			throw new Exception("The ORDER BY expression has to be specified correctly.", -1);
		}

		$expression = $this->orderBy_expression($expression, $ascending);

		if (empty($this->clauses['ORDER BY']) || $this->clauses['ORDER BY'] === 'NULL') {
			$this->clauses['ORDER BY'] = $expression;
		} else {
			$this->clauses['ORDER BY'] .= ", $expression";
		}

		return $this;
	}

	/**
	 * Processes ORDER BY expression and handles backend-specific cases like RANDOM()
	 * @method orderBy_expression
	 * @param {string} $expression
	 * @param {boolean|string} $ascending
	 * @return {string} final expression to append
	 */
	protected function orderBy_expression($expression, $ascending)
	{
		$expr = strtoupper($expression);
		if ($expr === 'RANDOM' || $expr === 'RAND()') {
			return 'RANDOM()'; // Default for PostgreSQL and SQLite
		}

		if (is_bool($ascending)) {
			return $expression . ($ascending ? ' ASC' : ' DESC');
		}

		if (is_string($ascending)) {
			$dir = strtoupper($ascending);
			if ($dir === 'ASC' || $dir === 'DESC') {
				return $expression . ' ' . $dir;
			}
		}

		return $expression;
	}


	/**
	 * Adds optional LIMIT and OFFSET clauses to the query
	 * @method limit
	 * @param {integer} $limit A non-negative integer showing how many rows to return
	 * @param {integer} [$offset=null] A non-negative integer showing what row to start the result set with.
	 * @param {integer} [$useDeferredJoin=false] If the offset is not empty and this parameter is true, uses the Deferred JOIN technique to massively speed up queries with large offsets. But it only works if the WHERE clause criteria doesn't use joined tables.
	 * @return {Db_Query} The resulting object implementing Db_Query_Interface
	 * @throws {Exception} If limit/offset are negative, OFFSET is not alowed in context, LIMIT clause was
	 * specified or clause does not belong to context
	 * @chainable
	 */
	function limit ($limit, $offset = null, $useDeferredJoin = false)
	{
		if (!isset($limit)) {
			return $this;
		}
		if (!is_numeric($limit) or $limit < 0 or floor($limit) != $limit) {
			throw new Exception("the limit must be a non-negative integer");
		}
		if (isset($offset)) {
			if (!is_numeric($offset) or $offset < 0 or floor($offset) != $offset) {
				throw new Exception("the offset must be a non-negative integer");
			}
		}
		switch ($this->type) {
			case Db_Query::TYPE_SELECT:
				break;
			case Db_Query::TYPE_UPDATE:
			case Db_Query::TYPE_DELETE:
				if (isset($offset))
					throw new Exception("the LIMIT clause cannot have an OFFSET in this context");
				break;
			case Db_Query::TYPE_INSERT:
				if ($this->isInsertSelectQuery) {
					break;
				}
			default:
				throw new Exception("The LIMIT clause does not belong in this context.");
		}

		if (! empty($this->clauses['LIMIT']))
			throw new Exception("The LIMIT clause has already been specified.");

		$this->clauses['LIMIT'] = "$limit";
		if (isset($offset)) {
			$this->clauses['LIMIT'] .= " OFFSET $offset";
			$this->useDeferredJoin = $useDeferredJoin;
		}

		return $this;
	}

	/**
	 * Adds a SET clause to an UPDATE statement
	 * @method set
	 * @param {array} $updates An associative array of column => value pairs.
	 * The values are automatically escaped using PDO placeholders.
	 * The value can also be an array of changes, in which case they
	 * would form a CASE WHEN column = {{key}} THEN {{value}}
	 * and if there is a "" key with a corresponding elseValue, 
	 * then it ends with ELSE {{elseValue}}
	 * @return {Db_Query} The resulting object implementing Db_Query_Interface
	 * @chainable
	 */
	function set (array $updates)
	{
		$updates = $this->set_internal($updates);

		if (empty($this->clauses['SET'])) {
			$this->clauses['SET'] = $updates;
		} else {
			$this->clauses['SET'] .= ", $updates";
		}
		return $this;
	}

	/**
	 * Calculates SET clause
	 * @method set_internal
	 * @protected
	 * @param {array} $updates An associative array of column => value pairs.
	 * The values are automatically escaped using PDO placeholders.
	 * @return {string}
	 */
	protected function set_internal ($updates)
	{
		switch ($this->type) {
			case Db_Query::TYPE_UPDATE:
				break;
			default:
				throw new Exception("The SET clause does not belong in this context.", - 1);
		}

		static $i = 1;
		if (is_array($updates)) {
			$updates_list = array();
			foreach ($updates as $field => $value) {
				$column = static::column($field);
				if ($value instanceof Db_Expression) {
					if (is_array($value->parameters)) {
						$this->parameters = array_merge($this->parameters, $value->parameters);
					}
					$updates_list[] = "$column = $value";
				} else if (is_array($value)) {
					$cases = "$column = (CASE";
					foreach ($value as $k => $v) {
						if (!$k) {
							continue;
						}
						$cases .= "\n\tWHEN $column = :_set_$i THEN :_set_".($i+1);
						$this->parameters["_set_$i"] = $k;
						$this->parameters["_set_".($i+1)] = $v;
						$i += 2;
					}
					if (isset($value[''])) {
						$cases .= "\n\tELSE :_set_$i";
						$this->parameters["_set_$i"] = $k;
					} else {
						$cases .= "\n\tELSE ''";
					}
					++$i;
					$cases .= "\nEND)";
					$updates_list[] = $cases;
				} else {
					$updates_list[] = "$column = :_set_$i";
					$this->parameters["_set_$i"] = $value;
					++ $i;
				}
			}
			if (count($updates_list) > 0)
				$updates = implode(", \n", $updates_list);
			else
				$updates = '';
		}
		if (! is_string($updates)) {
			throw new Exception("The SET updates need to be specified correctly.", - 1);
		}

		return $updates;
	}

	/**
	 * Adds an ON DUPLICATE KEY UPDATE clause to an INSERT statement.
	 * Different database adapters should implement onDuplicateKeyUpdate_internal
	 * @method onDuplicateKeyUpdate
	 * @param {array} $updates An associative array of column => value pairs.
	 * The values are automatically escaped using PDO placeholders.
	 * @return {Db_Query_Mysql} The resulting object implementing Db_Query_Interface
	 * $chainable
	 */
	function onDuplicateKeyUpdate ($updates = array())
	{
		$updates = $this->onDuplicateKeyUpdate_internal($updates);
	}

	/**
	 * This function provides an easy way to provide additional clauses to the query.
	 * @method options
	 * @param {array} $options An associative array of key => value pairs, where the key is
	 * the name of the method to call, and the value is the array of arguments.
	 * If the value is not an array, it is wrapped in one.
	 * @chainable
	 */
	function options ($options)
	{
		if (empty($options)) {
			return $this;
		}
		foreach ($options as $key => $value) {
			if ($key !== 'options'
			and is_callable(array($this, $key))) {
				if (!is_array($value)) {
					$value = array($value);
				}
				call_user_func_array(array($this, $key), $value);
			}
		}
		return $this;
	}

	/**
	 * Inserts a custom clause after a particular clause
	 * @method after
	 * @param {string} $after The name of the standard clause to add after, such as FROM or UPDATE
	 * @param {string} $clause The text of the clause to add
	 * @chainable
	 */
	function after($after, $clause)
	{
		if ($clause) {
			$this->after[$after] = isset($this->after[$after])
				? $this->after[$after] . ' ' . $clause
				: $clause;
		}
		return $this;
	}

	/**
	 * Fetches an array of database rows matching the query.
	 * If this exact query has already been executed and
	 * fetchAll() has been called on the Db_Query, and
	 * the return value was cached by the Db_Query class, then
	 * that cached value is returned, unless $this->ignoreCache is true.
	 * Otherwise, the query is executed and fetchAll()
	 * is called on the result.
	 *
	 * See [PDO documentation](http://us2.php.net/manual/en/pdostatement.fetchall.php)
	 * @method fetchAll
	 * @param {enum} $fetch_style=PDO::FETCH_BOTH
	 * @param {enum} $column_index=null
	 * @param {array} $ctor_args=null
	 * @return {array}
	 */
	function fetchAll(
		$fetch_style = PDO::FETCH_BOTH,
		$fetch_argument = null,
		array $ctor_args = array())
	{
		$conn_name = $this->db->connectionName();

		if (empty($conn_name)) {
			$conn_name = 'empty connection name';
		}
		$sql = $this->getSQL();

		if (isset(Db_Query::$cache[$conn_name][$sql]['fetchAll'])
		and !$this->ignoreCache) {
			return Db_Query::$cache[$conn_name][$sql]['fetchAll'];
		}
		$result = $this->execute();
		$arguments = func_get_args();
		$ret = call_user_func_array(array($result, 'fetchAll'), $arguments);

		if ($this->caching === true
		or ($this->caching === null and !empty($ret))) {
			if (Db::allowCaching()) {
				// cache the result of executing this particular SQL on this db connection
				Db_Query::$cache[$conn_name][$sql]['fetchAll'] = $ret;
			}
		}
		return $ret;
	}

	/**
	 * Fetches an array of database rows matching the query.
	 * If this exact query has already been executed and
	 * fetchAll() has been called on the Db_Query, and
	 * the return value was cached by the Db_Query class, then
	 * that cached value is returned, unless $this->ignoreCache is true.
	 * Otherwise, the query is executed and fetchAll() is called on the result.
	 * @param {string} [$fields_prefix=''] This is the prefix, if any, to strip out when fetching the rows.
	 * @param {string} [$by_field=null] A field name to index the array by.
	 *  If the field's value is NULL in a given row, that row is just appended
	 *  in the usual way to the array.
	 * @return {array}
	 */
	function fetchArray(
		$fields_prefix = '',
		$by_field = null)
	{
		$conn_name = $this->db->connectionName();

		if (empty($conn_name)) {
			$conn_name = 'empty connection name';
		}
		$sql = $this->getSQL();

		if (isset(Db_Query::$cache[$conn_name][$sql]['fetchArray'][$by_field])
		and !$this->ignoreCache) {
			return Db_Query::$cache[$conn_name][$sql]['fetchArray'][$by_field];
		}
		$result = $this->execute();
		$arguments = func_get_args();
		$ret = call_user_func_array(array($result, 'fetchArray'), $arguments);

		if ($this->caching === true
		or ($this->caching === null and !empty($ret))) {
			if (Db::allowCaching()) {
				// cache the result of executing this particular SQL on this db connection
				Db_Query::$cache[$conn_name][$sql]['fetchArray'][$by_field] = $ret;
			}
		}
		return $ret;
	}

	/**
	 * Fetches an array of Db_Row objects (possibly extended).
	 * If this exact query has already been executed and
	 * fetchAll() has been called on the Db_Query, and
	 * the return value was cached by the Db_Query class, then
	 * that cached value is returned.
	 * Otherwise, the query is executed and fetchDbRows() is called on the result.
	 * @method fetchDbRows
	 * @param {string} [$class_name=null]  The name of the class to instantiate and fill objects from.
	 * Must extend Db_Row. Defaults to $this->className
	 * @param {string} [$fields_prefix=''] This is the prefix, if any, to strip out when fetching the rows.
	 * @param {string} [$by_field=null] A field name to index the array by.
	 * If the field's value is NULL in a given row, that row is just appended
	 * in the usual way to the array.
	 * @return {array}
	 */
	function fetchDbRows(
		$class_name = null,
		$fields_prefix = '',
		$by_field = null)
	{
		if (empty($conn_name)) {
			$conn_name = $this->db->connectionName();
		}
		if (empty($conn_name)) {
			$conn_name = 'empty connection name';
		}
		$sql = $this->getSQL();
		$key = $by_field . $fields_prefix;
		if (isset(Db_Query::$cache[$conn_name][$sql]['fetchDbRows'][$key])
		and !$this->ignoreCache) {
			return Db_Query::$cache[$conn_name][$sql]['fetchDbRows'][$key];
		}
		$ret = $this->execute()->fetchDbRows($class_name, $fields_prefix, $by_field);
		if ($this->caching === true
		or ($this->caching === null and !empty($ret))) {
			if (Db::allowCaching()) {
				// cache the result of executing this particular SQL on this db connection
				Db_Query::$cache[$conn_name][$sql]['fetchDbRows'][$key] = $ret;
			}
		}
		return $ret;
	}

	/**
	 * Fetches one Db_Row object (possibly extended).
	 * You can pass a prefix to strip from the field names.
	 * It will also filter the result.
	 * @method fetchDbRow
	 * @param {string} [$class_name=null] The name of the class to instantiate and fill objects from.
	 * Must extend Db_Row. Defaults to $this->query->className
	 * @param {string} [$fields_prefix=''] This is the prefix, if any, to strip out when fetching the rows.
	 * @return {DbRow|boolean} Returns false if no row, otherwise returns an object of type $class_name
	 */
	function fetchDbRow(
		$class_name = null,
		$fields_prefix = '')
	{
		$rows = $this->fetchDbRows($class_name, $fields_prefix);
		if (empty($rows)) {
			return null;
		}
		return reset($rows);
	}

	/**
	 * Sets context
	 * @method setContext
	 * @param {callable} $callback
	 * @param {array} [$args=array()]
	 */
	function setContext(
		$callback,
		$args = array())
	{
		$this->context = @compact('callback', 'args');
	}

	/**
	 * Can only be called if this is a query returned
	 * from a function that was supposed to execute it, but the user
	 * requested a chance to modify it.
	 * For example, Db_Row->getRelated and Db_Row->retrieve.
	 * After calling a chain of methods, call the resume() method
	 * to complete the original function and return the result.
	 * @method resume
	 */
	function resume()
	{
		if (empty($this->context['callback'])) {
			throw new Exception("Context is empty. Db_Query->resume() can only be called on an intermediate query.", -1);
		}
		$callback = $this->context['callback'];
		if (is_array($callback)) {
			$callback[1] .= '_resume';
		} else {
			$callback .= '_resume';
		}
		$args = empty($this->context['args']) ? array() : $this->context['args'];
		$args[] = $this;
		return call_user_func_array($callback, $args);
	}

	static function column($column)
	{
		if ($column instanceof Db_Expression) {
			return $column;
		}
		$len = strlen($column);
		$part = $column;
		$pos = false;
		for ($i=0; $i<$len; ++$i) {
			$c = $column[$i];
			if ($c !== '.'
			and $c !== '_'
			and $c !== '-'
			and $c !== '$'
			and ($c < 'a' or $c > 'z')
			and ($c < 'A' or $c > 'Z')
			and ($c < '0' or $c > '9')) {
				$pos = $i;
				$part = substr($column, 0, $pos);
				break;
			}
		}
		$parts = explode('.', $part);
		$quoted = array();
		foreach ($parts as $p) {
			$quoted[] = static::quoted($p);
		}
		return implode('.', $quoted) . ($pos ? substr($column, $pos) : '');
	}

	static function quoted($identifier) {
		return "`$identifier`"; // override per adapter
	}

	/**
	 * Builds the query from the clauses
	 * @method build
	 * @return {string} The SQL query built according to defined clauses
	 * @throws {Exception} Exception is thrown in case mandatory clause is missing
	 */
	function build ()
	{
		$where = $orderBy = $limit = null;
		if ($this->type !== Db_Query::TYPE_RAW) {
			$where = $this->build_where();
			$orderBy = $this->build_orderBy();
			$limit = $this->build_limit();
		}

		$joinClauses = $this->build_join($where, $orderBy, $limit);

		switch ($this->type) {
			case Db_Query::TYPE_RAW:
				return $this->build_raw();

			case Db_Query::TYPE_INSERT:
				if (empty($this->clauses['SELECT'])) {
					return $this->build_insertQuery($joinClauses, $where, $orderBy, $limit);
				}
				return $this->build_insertSelectQuery($joinClauses, $where, $orderBy, $limit);

			case Db_Query::TYPE_SELECT:
				return $this->build_selectQuery($joinClauses, $where, $orderBy, $limit);

			case Db_Query::TYPE_UPDATE:
				return $this->build_updateQuery(
					$joinClauses, 
					isset($where) ? $where : '', 
					isset($orderBy) ? $orderBy : '', 
					isset($limit) ? $limit : '', 
				);

			case Db_Query::TYPE_DELETE:
				return $this->build_deleteQuery(
					$joinClauses, 
					isset($where) ? $where : '', 
					isset($orderBy) ? $orderBy : '', 
					isset($limit) ? $limit : '', 
				);

			default:
				throw new Exception("Unknown query type: " . $this->type);
		}
	}

	protected function build_raw() {
		return isset($this->clauses['RAW']) ? $this->clauses['RAW'] : '';
	}

	protected function build_insertQuery($joinClauses, $where, $orderBy, $limit) {
		$into = $this->build_into();
		return $this->build_insert($into) . $this->build_onDuplicateKeyUpdate();
	}

	protected function build_insertSelectQuery($joinClauses, $where, $orderBy, $limit) {
		$q = "INSERT INTO " . $this->build_into() . "\n";
		$q2 = $this->build_select($joinClauses, $where, $orderBy, $limit);

		if (!empty($this->clauses['EXISTS'])) {
			$q2 = "EXISTS(\n$q2\n)";
		} else if (!empty($this->clauses['NOT EXISTS'])) {
			$q2 = "NOT EXISTS(\n$q2\n)";
		}
		$q .= $q2;
		$q .= $this->build_onDuplicateKeyUpdate();
		return $q;
	}

	protected function build_selectQuery($joinClauses, $where, $orderBy, $limit) {
		$q = $this->build_select($joinClauses, $where, $orderBy, $limit);

		if (!empty($this->clauses['EXISTS'])) {
			return "EXISTS(\n$q\n)";
		}
		if (!empty($this->clauses['NOT EXISTS'])) {
			return "NOT EXISTS(\n$q\n)";
		}
		return $q;
	}

	protected function build_updateQuery($joinClauses, $where, $orderBy, $limit) {
		return $this->build_update($joinClauses);
	}

	protected function build_deleteQuery($joinClauses, $where, $orderBy, $limit) {
		return $this->build_delete($joinClauses, $where, $limit);
	}

	protected function build_onDuplicateKeyUpdate() {
		throw new Q_Exception_MethodNotSupported(array('method' => 'build_onDuplicateKeyUpdate'));
	}

	protected function build_where() {
		$where = empty($this->clauses['WHERE']) ? '' : "\nWHERE ".$this->clauses['WHERE'];
		$where .= !isset($this->after['WHERE']) ? '' : "\n".$this->after['WHERE'];
		return $where;
	}

	protected function build_orderBy() {
		$orderBy = empty($this->clauses['ORDER BY']) ? '' : "\nORDER BY " . $this->clauses['ORDER BY'];
		$orderBy .= !isset($this->after['ORDER BY']) ? '' : "\n".$this->after['ORDER BY'];
		return $orderBy;
	}

	protected function build_limit() {
		$limit = empty($this->clauses['LIMIT']) ? '' : "\n LIMIT ".$this->clauses['LIMIT'];
		$limit .= !isset($this->after['LIMIT']) ? '' : "\n".$this->after['LIMIT'];
		return $limit;
	}

	protected function build_join(&$where, $orderBy, &$limit) {
		$joinClauses = isset($this->clauses['JOIN']) ? $this->clauses['JOIN'] : '';
		if ($this->useDeferredJoin and $this->className) {
			$className = $this->className;
			$row = new $className();
			$table = call_user_func([$className, 'table']);
			$pk = implode(', ', $row->getPrimaryKey());
			$subquery = "  SELECT $pk FROM $table$where$orderBy$limit";
			$joinClauses = "INNER JOIN (\n$subquery\n) Db_deferredJoinDerivedTable USING($pk)" . $joinClauses;
			$where = '';
			$limit = '';
		}
		return $joinClauses;
	}

	protected function build_into() {
		if (empty($this->clauses['INTO']))
			throw new Exception("missing INTO clause in DB query.", -2);
		$into = empty($this->clauses['INTO']) ? '' : $this->clauses['INTO'];
		$into .= !isset($this->after['INTO']) ? '' : $this->after['INTO'];
		return $into;
	}

	protected function build_insert($into) {
		$values       = $this->build_insert_values();
		$afterValues  = $this->build_insert_afterValues();
		$onDuplicate  = $this->build_insert_onDuplicateKeyUpdate();

		return "INSERT INTO $into \nVALUES ( $values ) $afterValues$onDuplicate";
	}

	protected function build_insert_values() {
		if (!isset($this->clauses['VALUES'])) {
			throw new Exception("Missing VALUES clause in DB query.", -3);
		}
		return $this->clauses['VALUES'];
	}

	protected function build_insert_afterValues() {
		return !isset($this->after['VALUES']) ? '' : "\n" . $this->after['VALUES'];
	}

	protected function build_insert_onDuplicateKeyUpdate() {
		throw new Q_Exception_MethodNotSupported(array('method' => 'build_onDuplicateKeyUpdate'));
	}

	protected function build_select($joinClauses, $where, $orderBy, $limit) {
		$select   = $this->build_select_select();
		$from     = $this->build_select_from();
		$join     = $this->build_select_join($joinClauses);
		$groupBy  = $this->build_select_groupBy();
		$having   = $this->build_select_having();
		$lock     = $this->build_select_lock();

		return "SELECT $select$from$join$where $groupBy $having $orderBy $limit $lock";
	}

	protected function build_select_select() {
		$select = empty($this->clauses['SELECT']) ? '*' : $this->clauses['SELECT'];
		$select .= !isset($this->after['SELECT']) ? '' : $this->after['SELECT'];
		return $select;
	}

	protected function build_select_from() {
		if (!isset($this->clauses['FROM'])) {
			throw new Exception("missing FROM clause in DB query.", -1);
		}
		$from = empty($this->clauses['FROM']) ? '' : "\nFROM " . $this->clauses['FROM'];
		$from .= !isset($this->after['FROM']) ? '' : "\n" . $this->after['FROM'];
		return $from;
	}

	protected function build_select_join($joinClauses) {
		$join = empty($joinClauses) ? '' : "\n" . $joinClauses;
		$join .= !isset($this->after['JOIN']) ? '' : "\n" . $this->after['JOIN'];
		return $join;
	}

	protected function build_select_groupBy() {
		$groupBy = empty($this->clauses['GROUP BY']) ? '' : "\nGROUP BY " . $this->clauses['GROUP BY'];
		$groupBy .= !isset($this->after['GROUP BY']) ? '' : "\n" . $this->after['GROUP BY'];
		return $groupBy;
	}

	protected function build_select_having() {
		$having = empty($this->clauses['HAVING']) ? '' : "\nHAVING " . $this->clauses['HAVING'];
		$having .= !isset($this->after['HAVING']) ? '' : "\n" . $this->after['HAVING'];
		return $having;
	}

	protected function build_select_lock() {
		$lock = empty($this->clauses['LOCK']) ? '' : "\n" . $this->clauses['LOCK'];
		$lock .= !isset($this->after['LOCK']) ? '' : "\n" . $this->after['LOCK'];
		return $lock;
	}


	protected function build_update($joinClauses) {
		if (empty($this->clauses['UPDATE']))
			throw new Exception("Missing UPDATE tables clause in DB query.", -2);
		$update = $this->clauses['UPDATE'];
		$update .= !isset($this->after['UPDATE']) ? '' : "\n".$this->after['UPDATE'];
		if (empty($this->clauses['SET']))
			throw new Exception("missing SET clause in DB query.", -3);
		$set = empty($this->clauses['SET']) ? '' : "\nSET ".$this->clauses['SET'];
		$set .= !isset($this->after['SET']) ? '' : "\n".$this->after['SET'];
		$join = empty($joinClauses) ? '' : "\n".$joinClauses;
		$join .= !isset($this->after['JOIN']) ? '' : "\n".$this->after['JOIN'];
		$where = empty($this->clauses['WHERE']) ? '' : "\nWHERE ".$this->clauses['WHERE'];
		$where .= !isset($this->after['WHERE']) ? '' : "\n".$this->after['WHERE'];
		$limit = empty($this->clauses['LIMIT']) ? '' : "\n LIMIT ".$this->clauses['LIMIT'];
		$limit .= !isset($this->after['LIMIT']) ? '' : "\n".$this->after['LIMIT'];
		return "UPDATE $update$join$set$where$limit";
	}

	protected function build_delete($joinClauses, $where, $limit) {
		if (empty($this->clauses['FROM']))
			throw new Exception("missing FROM clause in DB query.", -2);
		$from = "FROM ".$this->clauses['FROM'];
		$from .= !isset($this->after['FROM']) ? '' : $this->after['FROM'];
		$join = empty($joinClauses) ? '' : "\n".$joinClauses;
		$join .= !isset($this->after['JOIN']) ? '' : "\n".$this->after['JOIN'];
		return "DELETE $from$join$where$limit";
	}

	/**
	 * Executes a query against the database and returns the result set.
	 * @method execute
	 * @param {boolean} [$prepareStatement=false] If true, a PDO statement will be prepared
	 * from the query before it is executed. It is also saved for future invocations to use.
	 * Do this only if the statement will be executed many times with
	 * different parameters. Basically you would use ->bind(...) between
	 * invocations of ->execute().
	 * @param {array|string} [$shards] You can pass a shard name here, or a
	 *  numerically indexed array of shard names, or an associative array
	 *  where the keys are shard names and the values are the query to execute.
	 *  This will bypass the usual sharding algorithm.
	 * @return {Db_Result} The Db_Result object containing the PDO statement that resulted from the query.
	 */
	function execute($prepareStatement = false, $shards = null)
	{
		if (class_exists('Q')) {
			/**
			 * @event Db/query/execute {before}
			 * @param {Db_Query_Mysql} query
			 * @return {Db_Result}
			 */
			$result = Q::event('Db/query/execute', array('query' => $this), 'before');
		}
		if (isset($result)) {
			return $result;
		}

		$stmts = array();
		unset($this->replacements['{{dbname}}']);
		unset($this->replacements['{{prefix}}']);
		$this->startedTime = Db::milliseconds(true);

		if ($prepareStatement) {
			$this->execute_prepareStatement();
		}

		$sql_template = $this->getSQL(null, true);
		$queries = $this->execute_prepareStatementsForShards($shards);
		$connection = $this->db->connectionName();

		if (!empty($queries["*"])) {
			$shardNames = Q_Config::get(
				'Db', 'connections', $connection, 'shards', array('' => '')
			);
			$q = $queries["*"];
			foreach ($shardNames as $k => $v) {
				$queries[$k] = $q;
			}
			unset($queries['*']);
		}

		foreach ($queries as $shardName => $query) {
			try {
				$stmt = $this->execute_query($query, $prepareStatement, $shardName, $sql_template, $connection);
				if (isset($stmt)) {
					$stmts[] = $stmt;
				}
			} catch (Exception $exception) {
				$this->execute_handleException($query, $queries, $sql_template, $exception);
			}
		}

		$this->endedTime = Db::milliseconds(true);
		$sql = $this->getSQL();

		if (class_exists('Q')) {
			/**
			 * @event Db/query/execute {after}
			 * @param {Db_Query_Mysql} query
			 * @param {array} queries
			 * @param {string} sql
			 */
			Q::event('Db/query/execute', @compact('query', 'queries', 'sql'), 'after');
		}

		return new Db_Result($stmts, $this);
	}

	protected function execute_prepareStatement()
	{
		if (!isset($this->statement)) {
			if ($q = $this->build()) {
				$pdo = $this->reallyConnect();
				$this->statement = $pdo->prepare($q);
				if ($this->statement === false) {
					$sql = $this->getSQL();
					if (!class_exists('Q_Exception_DbQuery')) {
						throw new Exception("query could not be prepared [query was: $sql]", -1);
					}
					throw new Q_Exception_DbQuery(array(
						'sql' => $sql,
						'msg' => 'query could not be prepared'
					));
				}
			}
		}
		foreach ($this->parameters as $key => $value) {
			$this->statement->bindValue($key, $value);
		}
	}

	protected function execute_prepareStatementsForShards($shards)
	{
		if (isset($shards)) {
			if (is_string($shards)) {
				$shards = array($shards);
			}
			if (Db::isAssociative($shards)) {
				return $shards;
			}
			return array_fill_keys($shards, $this);
		}
		return $this->shard();
	}

	/**
	 * Executes the query on a specific MySQL shard.
	 *
	 * @param Db_Query $query
	 * @param bool $prepareStatement
	 * @param string $shardName
	 * @param string $sql_template
	 * @param string $connection
	 * @return mixed PDOStatement|true|null
	 */
	protected function execute_query($query, $prepareStatement, $shardName, $sql_template, $connection)
	{
		$pdo = $this->execute_query_connectAndInitialize($query, $shardName, $connection);
		$sql = $query->getSQL();
		$stmt = null;

		try {
			$this->execute_query_beginTransactionIfNeeded($query, $pdo, $connection, $shardName);

			if ($query->type !== Db_Query::TYPE_ROLLBACK) {
				$stmt = $prepareStatement
					? $this->execute_query_executePreparedStatement($query, $sql, $shardName)
					: ($sql ? $pdo->query($sql) : true);

				$this->execute_query_commitTransactionIfNeeded($query, $pdo, $stmt);
			}
		} catch (Exception $e) {
			$this->execute_query_rollbackOnError($pdo);
			throw $e;
		}

		$query->nestedTransactionCount = $this->execute_query_getNestedTransactionCount($pdo);
		$this->execute_query_logShardSplitIfApplicable($query, $shardName, $sql_template, $pdo, $connection);
		$query->endedTime = Db::milliseconds(true);

		return isset($stmt) ? $stmt : null;
	}

	/**
	 * Connects to the shard and initializes timezone and transaction tracking.
	 */
	protected function execute_query_connectAndInitialize($query, $shardName, $connection)
	{
		$shardInfo = null;
		$pdo = $query->reallyConnect($shardName, $shardInfo);
		$dsn = $shardInfo['dsn'];

		if (empty(self::$setTimezoneDone[$dsn])) {
			self::$setTimezoneDone[$dsn] = true;
			$query->db->setTimezone();
		}

		if (!isset(self::$nestedTransactions[$dsn])) {
			self::$nestedTransactions[$dsn] = [
				'count' => 0,
				'keys' => [],
				'connections' => [],
				'backtraces' => [],
				'shardNames' => [],
				'pdos' => []
			];
		}

		$query->startedTime = Db::milliseconds(true);
		return $pdo;
	}

	/**
	 * Begins a transaction if the query includes BEGIN or handles rollback.
	 */
	protected function execute_query_beginTransactionIfNeeded($query, $pdo, $connection, $shardName)
	{
		$dsn = $pdo->getAttribute(PDO::ATTR_CONNECTION_STATUS);
		$nt = &self::$nestedTransactions[$dsn];

		if (!empty($query->clauses["BEGIN"])) {
			$nt['keys'][] = isset($query->transactionKey) ? $query->transactionKey : null;
			$nt['connections'][] = $connection;
			$nt['shardNames'][] = $shardName;
			$nt['pdos'][] = $pdo;
			if (Db_Query::$backtracesOnExceptions) {
				$nt['backtraces'][] = Q::b();
			}
			if (++$nt['count'] === 1) {
				$pdo->beginTransaction();
			}
		} elseif (!empty($query->clauses["ROLLBACK"])) {
			$pdo->rollBack();
			$nt['count'] = 0;
			$nt['keys'] = $nt['shardNames'] = $nt['pdos'] = [];
		}
	}

	/**
	 * Executes a prepared statement.
	 */
	protected function execute_query_executePreparedStatement($query, $sql, $shardName)
	{
		try {
			$query->statement->execute();
			return $query->statement;
		} catch (Exception $e) {
			if (!class_exists('Q_Exception_DbQuery')) {
				throw new Exception($e->getMessage() . " [query was: $sql]", -1);
			}
			throw new Q_Exception_DbQuery([
				'shardName' => $shardName,
				'query' => $query,
				'sql' => $sql,
				'msg' => $e->getMessage()
			]);
		}
	}

	/**
	 * Commits a transaction if needed, with error and key validation.
	 */
	protected function execute_query_commitTransactionIfNeeded($query, $pdo, $stmt)
	{
		$dsn = $pdo->getAttribute(PDO::ATTR_CONNECTION_STATUS);
		$nt = &self::$nestedTransactions[$dsn];

		if (!empty($query->clauses["COMMIT"]) && $nt['count']) {
			if (!$stmt || ($stmt !== true && !in_array(substr($stmt->errorCode(), 0, 2), ['00', '01']))) {
				$err = $pdo->errorInfo();
				throw new Exception($err[0], $err[1]);
			}

			$lastKey = array_pop($nt['keys']);
			if ($lastKey && $query->transactionKey !== $lastKey && $query->transactionKey !== '*') {
				if (class_exists('Q')) {
					Q::log("WARNING: Forgot to resolve transactions via commit or rollback");
					foreach (self::$nestedTransactions as $t) {
						Q::log($t['connections']);
						if (Db_Query::$backtracesOnExceptions) {
							Q::log($t['backtraces']);
						}
					}
				}
				throw new Exception("forgot to resolve transaction with key $lastKey");
			}

			array_pop($nt['shardNames']);
			array_pop($nt['pdos']);
			array_pop($nt['connections']);
			if (Db_Query::$backtracesOnExceptions) {
				array_pop($nt['backtraces']);
			}

			if (--$nt['count'] === 0) {
				$pdo->commit();
			}
		}
	}

	/**
	 * Rolls back on error and clears transaction state.
	 */
	protected function execute_query_rollbackOnError($pdo)
	{
		$dsn = $pdo->getAttribute(PDO::ATTR_CONNECTION_STATUS);
		$nt = &self::$nestedTransactions[$dsn];

		if ($nt['count']) {
			$pdo->rollBack();
			$nt['count'] = 0;
			$nt['keys'] = $nt['shardNames'] = $nt['pdos'] = [];
		}
	}

	/**
	 * Returns the current nested transaction count for this connection.
	 */
	protected function execute_query_getNestedTransactionCount($pdo)
	{
		$dsn = $pdo->getAttribute(PDO::ATTR_CONNECTION_STATUS);
		return isset(self::$nestedTransactions[$dsn]['count'])
			? self::$nestedTransactions[$dsn]['count']
			: 0;
	}

	/**
	 * Logs shard-related SQL statements to the node if part of an upcoming split.
	 */
	protected function execute_query_logShardSplitIfApplicable($query, $shardName, $sql_template, $pdo, $connection)
	{
		if (!class_exists('Q')) return;

		$upcoming = Q_Config::get('Db', 'upcoming', $connection, false);
		if (!$upcoming || $shardName !== $upcoming['shard']) return;
		if ($query->type === Db_Query::TYPE_SELECT) return;

		$table = $query->table;
		foreach ($query->replacements as $k => $v) {
			$table = str_replace($k, $v, $table);
		}
		if ($table !== $upcoming['dbTable']) return;

		$timestamp = $pdo->query("SELECT CURRENT_TIMESTAMP")->fetchColumn();
		if (!$timestamp) $timestamp = date("Y-m-d H:i:s");

		$sql_template = str_replace('CURRENT_TIMESTAMP', "'$timestamp'", $sql_template);
		$transaction = !empty($query->clauses['COMMIT']) ? 'COMMIT' :
			(!empty($query->clauses['BEGIN']) ? 'START TRANSACTION' :
			(!empty($query->clauses['ROLLBACK']) ? 'ROLLBACK' : ''));

		$utable = $upcoming['table'];
		$sharded = $query->shard($upcoming['indexes'][$utable]);
		$upcoming_shards = array_keys($sharded);
		$logServer = Q_Config::get('Db', 'internal', 'sharding', 'logServer', null);

		if ($transaction && $transaction !== 'COMMIT') {
			Q_Utils::sendToNode([
				'Q/method' => 'Db/Shards/log',
				'shards' => $upcoming_shards,
				'sql' => "$transaction;"
			], $logServer);
		}

		Q_Utils::sendToNode([
			'Q/method' => 'Db/Shards/log',
			'shards' => $upcoming_shards,
			'sql' => trim(str_replace("\n", ' ', $sql_template))
		], $logServer);

		if ($transaction === 'COMMIT') {
			Q_Utils::sendToNode([
				'Q/method' => 'Db/Shards/log',
				'shards' => $upcoming_shards,
				'sql' => "$transaction;"
			], $logServer, true);
		}
	}

	protected function execute_handleException($query, $queries, $sql, $exception)
	{
		if (class_exists('Q')) {
			/**
			 * @event Db/query/exception {after}
			 * @param {Db_Query_Mysql} query
			 * @param {array} queries
			 * @param {string} sql
			 * @param {Exception} exception
			 */
			Q::event('Db/query/exception', 
				@compact('query', 'queries', 'sql', 'exception'),
				'after'
			);
		}
		if (!class_exists('Q_Exception_DbQuery')) {
			throw new Exception($exception->getMessage() . " [query was: $sql]", -1);
		}
		throw new Q_Exception_DbQuery(array(
			'sql' => $sql,
			'msg' => $exception->getMessage()
		), 'PDOException');
	}


	/**
	 * Analyzes the query's criteria and decides where to execute the query.
	 * Here is sample shards config:
	 * 
	 * **NOTE:** *"fields" shall be an object with keys as fields names and values containing hash definition
	 * 		in the format "type%length" where type is one of 'md5' or 'normalize' and length is hash length
	 * 		hash definition can be empty string or false. In such case 'md5%7' is used*
	 *
	 * **NOTE:** *"partition" can be an array. In such case shards shall be named after partition points*
	 *
	 *
	 *	"Streams": {
	 *		"prefix": "streams_",
	 *		"dsn": "mysql:host=127.0.0.1;dbname=DBNAME",
	 *		"username": "USER",
	 *		"password": "PASSWORD",
	 *		"driver_options": {
	 *			"3": 2
	 *		},
	 *		"shards": {
	 *			"alpha": {
	 *				"prefix": "alpha_",
	 *				"dsn": "mysql:host=127.0.0.1;dbname=SHARDDBNAME",
	 *				"username": "USER",
	 *				"password": "PASSWORD",
	 *				"driver_options": {
	 *					"3": 2
	 *				}
	 *			},
	 *			"betta": {
	 *				"prefix": "betta_",
	 *				"dsn": "mysql:host=127.0.0.1;dbname=SHARDDBNAME",
	 *				"username": "USER",
	 *				"password": "PASSWORD",
	 *				"driver_options": {
	 *					"3": 2
	 *				}
	 *			},
	 *			"gamma": {
	 *				"prefix": "gamma_",
	 *				"dsn": "mysql:host=127.0.0.1;dbname=SHARDDBNAME",
	 *				"username": "USER",
	 *				"password": "PASSWORD",
	 *				"driver_options": {
	 *					"3": 2
	 *				}
	 *			},
	 *			"delta": {
	 *				"prefix": "delta_",
	 *				"dsn": "mysql:host=127.0.0.1;dbname=SHARDDBNAME",
	 *				"username": "USER",
	 *				"password": "PASSWORD",
	 *				"driver_options": {
	 *					"3": 2
	 *				}
	 *			}
	 *		},
	 *		"indexes": {
	 *			"Stream": {
	 *				"fields": {"publisherId": "md5", "name": "normalize"},
	 *				"partition": {
	 *					"0000000.       ": "alpha",
	 *					"0000000.sample_": "betta",
	 *					"4000000.       ": "gamma",
	 *					"4000000.sample_": "delta",
	 *					"8000000.       ": "alpha",
	 *					"8000000.sample_": "betta",
	 *					"c000000.       ": "gamma",
	 *					"c000000.sample_": "delta"
	 *				}
	 *			}
	 *		}
	 *	}
	 *
	 * @method shard
	 * @param {array} [$upcoming=null] Temporary config to use in sharding. Used during shard split process only
	 * @param {array} [$criteria=null] Overrides the sharding criteria for the query. Rarely used unless testing what shards the query would be executed on. 
	 * @return {array} Returns an array of ($shardName => $query) pairs, where $shardName
	 *  can be the name of a shard, '' for just the main shard, or "*" to have the query run on all the shards.
	 */
	function shard($upcoming = null, $criteria = null)
	{
		if (isset($criteria)) {
			$this->criteria = $criteria;
		}
		$index = $this->shardIndex();
		if (!$index) {
			return array("" => $this);
		}
		if (empty($this->criteria)) {
			return array("*" => $this);
		}
		if (empty($index['fields'])) {
			throw new Exception("Db_Query: index for {$this->className} should have at least one field");
		}
		if (!isset($index['partition'])) {
			return array("" => $this);
		}
		$hashed = array();
		$fields = array_keys($index['fields']);
		foreach ($fields as $i => $field) {
			if (!isset($this->criteria[$field])) {
				// not enough information to target the query
				return array("*" => $this);
			}
			$value = $this->criteria[$field];
			$hash = !empty($index['fields'][$field]) ? $index['fields'][$field] : 'md5';
			$parts = explode('%', $hash);
			$hash = $parts[0];
			$len = isset($parts[1]) ? $parts[1] : self::HASH_LEN;
			if (is_array($value)) {
				$arr = array();
				foreach ($value as $v) {
					$arr[] = static::applyHash($v, $hash, $len);
				}
				$hashed[$i] = $arr;
			} else if ($value instanceof Db_Range) {
				if ($hash !== 'normalize') {
					throw new Exception("Db_Query: ranges don't work with $hash hash");
				}
				$hashed_min = static::applyHash($value->min, $hash, $len);
				$hashed_max = static::applyHash($value->max, $hash, $len);
				$hashed[$i] = new Db_Range(
					$hashed_min, $value->includeMin, $value->includeMax, $hashed_max
				);
			} else {
				$hashed[$i] = static::applyHash($value, $hash, $len);
			}
		}
		if (array_keys($index['partition']) === range(0, count($index['partition']) - 1)) {
			// $index['partition'] is simple array, name the shards after the partition points
			self::$mapping = array_combine($index['partition'], $index['partition']);
		} else {
			self::$mapping = $index['partition'];
		}
		return $this->shard_internal($index, $hashed);
	}

	/**
	 * Re-use an existing (prepared) statement. Rarely used except internally.
	 * @method reuseStatement
	 * @param {Db_Query} $query
	 */
	function reuseStatement($query)
	{
		$this->statement = $query->statement;
		return $this;
	}

	/**
	 * Calculates criteria
	 * @method criteria_internal
	 * @protected
	 * @param {Db_Expression|array|string} $criteria
	 * @param {array} [&$fillCriteria=null]
	 * @return {string}
	 */
	protected function criteria_internal($criteria, &$fillCriteria = null)
	{
		static $i = 1;
		if (!isset($fillCriteria)) {
			$fillCriteria = $this->criteria;
		}

		if (is_array($criteria)) {
			$criteria_list = [];
			foreach ($criteria as $expr => $value) {
				$criteria_list[] = $this->criteria_internal_handleExpression($expr, $value, $fillCriteria, $i);
			}
			return implode(' AND ', $criteria_list);
		}

		if ($criteria instanceof Db_Expression) {
			if (is_array($criteria->parameters)) {
				$this->parameters = array_merge($this->parameters, $criteria->parameters);
			}
			return (string) $criteria;
		}

		return $criteria;
	}

	protected function criteria_internal_handleExpression($expr, $value, &$fillCriteria, &$i)
	{
		$parts = array_map('trim', explode(',', $expr));
		$c = count($parts);

		if ($c > 1) {
			return $this->criteria_internal_tuple($parts, $value, $fillCriteria, $i);
		}

		if ($value === null) {
			return "ISNULL($expr)";
		}

		if ($value instanceof Db_Expression) {
			return $this->criteria_internal_expression($expr, $value);
		}

		if (is_array($value)) {
			return $this->criteria_internal_array($expr, $value, $fillCriteria, $i);
		}

		if ($value instanceof Db_Range) {
			return $this->criteria_internal_range($expr, $value, $i);
		}

		return $this->criteria_internal_scalar($expr, $value, $fillCriteria, $i);
	}

	protected function criteria_internal_tuple($columns, $value, &$fillCriteria, &$i)
	{
		$c = count($columns);
		if (!is_array($value)) {
			throw new Exception("Db_Query: The value should be an array of arrays");
		}

		$columnSql = [];
		foreach ($columns as $column) {
			$columnSql[] = static::column($column);
			if (!empty($fillCriteria[$column])) {
				$fillCriteria[$column] = [];
			}
		}

		$list = [];
		foreach ($value as $arr) {
			if (!is_array($arr)) {
				throw new Exception("Db.Query.Mysql: Value ".json_encode($arr)." needs to be an array");
			}
			if (count($arr) !== $c) {
				throw new Exception("Db_Query: Arrays should have $c elements to match tuple expression");
			}
			$vector = [];
			foreach ($arr as $j => $v) {
				$param = ":_where_$i";
				$this->parameters["_where_$i"] = $v;
				$vector[] = $param;
				$fillCriteria[$columns[$j]][] = $v;
				++$i;
			}
			$list[] = '(' . implode(',', $vector) . ')';
		}

		if (empty($list)) {
			return "FALSE";
		}

		return '(' . implode(',', $columnSql) . ') IN (' . implode(',', $list) . ')';
	}

	protected function criteria_internal_expression($expr, Db_Expression $value)
	{
		if (is_array($value->parameters)) {
			$this->parameters = array_merge($this->parameters, $value->parameters);
		}
		$lastChar = substr($expr, -1);
		if ($lastChar === '~') {
			$expr = substr($expr, 0, -1) . ' REGEXP BINARY ';
		}
		return preg_match('/\W/', $lastChar)
			? "$expr ($value)"
			: static::column($expr) . " = ($value)";
	}

	protected function criteria_internal_array($expr, array $value, &$fillCriteria, &$i)
	{
		if (empty($value)) {
			return preg_match('/\W/', substr($expr, -1)) ? "$expr ()" : "FALSE";
		}

		$value = array_unique($value);
		$placeholders = [];
		foreach ($value as $v) {
			$param = ":_where_$i";
			$this->parameters["_where_$i"] = $v;
			$placeholders[] = $param;
			$fillCriteria[$expr][] = $v;
			++$i;
		}

		$value_list = implode(',', $placeholders);
		if (preg_match('/\W/', substr($expr, -1))) {
			return "$expr ($value_list)";
		}
		return static::column($expr) . " IN ($value_list)";
	}

	protected function criteria_internal_scalar($expr, $value, &$fillCriteria, &$i)
	{
		$eq = preg_match('/\W/', substr($expr, -1)) ? '' : ' = ';
		$param = ":_where_$i";
		$this->parameters["_where_$i"] = $value;
		$fillCriteria[$expr] = $value;
		++$i;
		return static::column($expr) . "$eq$param";
	}

	protected function criteria_internal_range($expr, Db_Range $value, &$i)
	{
		$ranges = array_merge([$value], $value->additionalRanges);
		$rangeCriteria = [];

		foreach ($ranges as $range) {
			$conditions = [];
			if (isset($range->min)) {
				$cmp = $range->includeMin ? '>=' : '>';
				$param = ":_where_$i";
				$this->parameters["_where_$i"] = $range->min;
				$conditions[] = static::column($expr) . " $cmp $param";
				++$i;
			}
			if (isset($range->max)) {
				$cmp = $range->includeMax ? '<=' : '<';
				$param = ":_where_$i";
				$this->parameters["_where_$i"] = $range->max;
				$conditions[] = static::column($expr) . " $cmp $param";
				++$i;
			}
			if ($conditions) {
				$rangeCriteria[] = '(' . implode(' AND ', $conditions) . ')';
			}
		}

		return '(' . implode("\n\t OR ", $rangeCriteria) . ')';
	}

	/**
	 * Returns an array of field names that are "magic" when used
	 * @return {array}
	 */
	static function magicFieldNames()
	{
		return array('insertedTime', 'updatedTime', 'created_time', 'updated_time');
	}

	/**
	 * Calculate hash of the value
	 * @method hashed
	 * @param {string} $value
	 * @param {string} [$hash=null] Hash is one of 'md5' or 'normalize' optionally followed by '%' and number
	 * @return {string}
	 */
	static function hashed($value, $hash = null)
	{
		$hash = !isset($hash) ? $hash : 'md5';
		$parts = explode('%', $hash);
		$hash = $parts[0];
		$len = isset($parts[1]) ? $parts[1] : self::HASH_LEN;
		return static::applyHash($value, $hash, $len);
	}

	/**
	 * Calculates hash of the value
	 * @method applyHash
	 * @protected
	 * @param {string} $value
	 * @param {string} [$hash='normalize']
	 * @param {integer} [$len=self::HASH_LEN]
	 * @return {string}
	 */
	protected static function applyHash($value, $hash = 'normalize', $len = self::HASH_LEN)
	{
		if (!isset($value)) {
			return $value;
		}
		switch ($hash) {
			case 'normalize':
				$hashed = substr(Db::normalize($value), 0, $len);
				break;
			case 'md5':
				$hashed = substr(md5($value), 0, $len);
				break;
			default:
				throw new Exception("Db_Query: The hash $hash is not supported");
		}
		// each hash shall have fixed lenngth. Space is less than any char used in hash so
		// let's pad the result to desired length with spaces
		return str_pad($hashed, $len, " ", STR_PAD_LEFT);
	}

	/**
	 * This method returns the shard index that is used, if any.
	 */
	function shardIndex()
	{
		if (isset($this->cachedShardIndex)) {
			return $this->cachedShardIndex;
		}
		if (!class_exists('Q') || !$this->className) {
			return null;
		}
		$conn_name = $this->db->connectionName();
		$class_name = substr($this->className, strlen($conn_name)+1);
		$info = Q_Config::get('Db', 'upcoming', $conn_name, false);
		if (!$info) {
			$info = Q_Config::get('Db', 'connections', $conn_name, array());
		}
		return $this->cachedShardIndex = isset($info['indexes'][$class_name])
			? $info['indexes'][$class_name]
			: null;
	}

	/**
	 * does a depth first search
	 * and returns the array of shardname => $query pairs
	 * corresponding to which shards are affected
	 * @method shard_internal
	 * @protected
	 * @param {array} $index
	 * @param {string} $hashed
	 * @return {array}
	 */
	protected function shard_internal($index, $hashed)
	{
		// $index['partition'] shall contain strings "XXXXXX.YYYYYY.ZZZZZZ" where each point has full length of the hash
		$partition = array();
		$last_point = null;
		foreach (array_keys(static::$mapping) as $i => $point) {
			$partition[$i] = explode('.', $point);
			if (isset($last_point) and strcmp($point, $last_point) <= 0) {
				throw new Exception("Db_Query shard_internal: in {$this->className} partition, point $i is not greater than the previous point");
			}
			$last_point = $point;
		}
		$keys = array_map(
			array($this, "map_shard"), 
			static::slice_partitions($partition, 0, $hashed)
		);
		return array_fill_keys($keys, $this);
	}

	/**
	 * Narrows the partition list according to hashes
	 * @method slice_partitions
	 * @protected
	 * @param {array} $partition
	 * @param {integer} $j Currently processed hashed array member
	 * @param {array} $hashed
	 * @param {boolean} [$adjust=false]
	 * @return {array}
	 */
	static protected function slice_partitions($partition, $j, $hashed, $adjust = false) {
		// if hashed[$field] is a string only one point shall be found
		// if hashed[$field] is an array, let's process each array member
		// if hashed[$field] is range return all shards from interval min-max
		// do this recursively for each field one by one

		if (count($partition) <= 1) return $partition;

		// this shall be set!
		$hj = $hashed[$j];

		if (is_array($hj)) {
			$result = array();
			$temp = $hashed;
			foreach ($hj as $h) {
				$temp[$j] = $h;
				$result = array_merge(
					$result, 
					static::slice_partitions($partition, $j, $temp, $adjust)
				);
			}
			// $result may contain duplicates!
			return $result;
		}

		// $hj is a string or Db_Range
		$min = $max = $hj;
		$includeMax = true;
		if ($hj instanceof Db_Range) {
			$min = $hj->min;
			$max = $hj->max;
			if (!isset($min)) {
				throw new Exception("Db_Query slice_partitions: The minimum of the range should be set.");
			}
			//$includeMax = $hj->includeMax;
		}
		// the first item to keep
		$lower = 0;
		// the last item to keep
		$upper = count($partition)-1;
		// we need this if adjusting result for range search
		$lower_found = $upper_found = false;

		foreach ($partition as $i => $point) {
			// $upper_found shall be reset in each block
			$upper_found = $upper_found && isset($next);
			$current = $point[$j];
			// if $current is bigger than $max nothing to check anymore.
			// but if we adjust for range, we shall look trough all partition again 
			// to find upper bound at the end of partition array
			if (!$adjust && isset($max) && ($includeMax ? strcmp($current, $max) > 0 : strcmp($current, $max) >= 0)) break;
			// we shall wait till $current and $next are different
			if (($next = isset($partition[$i+1][$j]) ? $partition[$i+1][$j] : null) === $current) continue;
			// when adjusting $next may be less than $current but $lower is already found
			if ($adjust && strcmp($current, $next) > 0) $lower_found = !($next = null);

			// check lower bound we can skip all $partition up to $next but keep $next
			if (!$lower_found && (isset($next) && strcmp($min, $next) >= 0)) $lower = $i+1;

			// now check $next. That's the first time when $max < $next so we've found upper bound
			if (!$upper_found)
				if (!isset($next) || ($includeMax ? strcmp($max, $next) < 0 : strcmp($max, $next) <= 0)) {
					// we have found upper bound. We can skip all partitions starting from the $next
					$upper = $i;
					if (!$adjust) break;
					else $upper_found = true;
				}
		}

		// we are not interested in points up to $lower and over $upper
		// if $hj is Db_Range - check upper bound
		// if we have checked all $hashed - nothing to check anymore,
		// otherwise - check the rest of $hashed
		if (isset($hashed[$j+1])) {
			return static::slice_partitions(
				array_slice($partition, $lower, $upper-$lower+1), 
				$j+1, $hashed, $hj instanceof Db_Range || $adjust
			);
		} else {
			return array_slice($partition, $lower, $upper-$lower+1);
		}
	}

	/**
	 * Check if a field is indexed in a given table.
	 *
	 * This method delegates to an adapter-specific implementation.
	 *
	 * @method isIndexed
	 * @param {string} $table Table name
	 * @param {string} $field Column name
	 * @return {bool}
	 */
	public function isIndexed($table, $field)
	{
		return $this->isIndexed_internal($table, $field);
	}

	/**
	 * Adapter-specific implementation of isIndexed.
	 *
	 * @method isIndexed_internal
	 * @protected
	 * @param {string} $table Table name
	 * @param {string} $field Column name
	 * @return {bool}
	 * @throws {Exception} if not implemented in the subclass
	 */
	protected function isIndexed_internal($table, $field)
	{
		throw new Exception(get_class($this) . " must implement isIndexed_internal");
	}

	/**
	 * Select a batch of rows ordered by an indexed field.
	 *
	 * @method selectBatch
	 * @param {string} $table Table name
	 * @param {string} $field Field to order by
	 * @param {int} $limit Number of rows
	 * @param {string} $order "ASC" or "DESC"
	 * @return {array} Rows as associative arrays
	 */
	public function selectBatch($table, $field, $limit, $order = 'ASC')
	{
		$sql = "SELECT * FROM " . self::quoted($table) .
			" ORDER BY " . self::quoted($field) . " $order LIMIT :limit";
		$stmt = $this->db->reallyConnect()->prepare($sql);
		$stmt->bindValue(':limit', (int)$limit, PDO::PARAM_INT);
		$stmt->execute();
		return $stmt->fetchAll(PDO::FETCH_ASSOC);
	}

	/**
	 * Delete rows in a field range.
	 *
	 * @method deleteRange
	 * @param {string} $table Table name
	 * @param {string} $field Field to filter by
	 * @param {mixed} $min Lower bound (inclusive)
	 * @param {mixed} $max Upper bound (inclusive)
	 * @return {int} Number of rows deleted
	 */
	public function deleteRange($table, $field, $min, $max)
	{
		$sql = "DELETE FROM " . self::quoted($table) .
			" WHERE " . self::quoted($field) . " BETWEEN :min AND :max";
		$stmt = $this->db->reallyConnect()->prepare($sql);
		$stmt->execute(array(':min' => $min, ':max' => $max));
		return $stmt->rowCount();
	}


	/**
	 * Make partition from array of points
	 * @method map_shard
	 * @protected
	 * @param {array} $a
	 * @return {string}
	 */
	static protected function map_shard($a) {
		return self::$mapping[implode('.', $a)];
	}

	/**
	 * Actual points mapping depending if partition is plain or associative array
	 * @property $mapping
	 * @type array
	 * @protected
	 */
	static protected $mapping = null;
	/**
	 * Class cache
	 * @property $cache
	 * @type array
	 */
	static $cache = array();
	
	protected $cachedShardIndex = null;

}
