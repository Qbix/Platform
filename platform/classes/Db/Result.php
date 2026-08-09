<?php

/**
 * @module Db
 */

class Db_Result
{
	/**
	 * This class lets you use Db results from Db queries
	 * @class Db_Result
	 * @constructor
	 * @param {PDOStatement|array} $stmt The PDO statement object that this result uses
	 *  Can also be an array of PDO statements, in which case
	 *  this was the result of an aggregated query.
	 * @param {Db_Query_Interface} $query The query that was run to produce this result 
	 */
	function __construct ($stmt, Db_Query_Interface $query)
	{
		if (is_array($stmt)) {
			$this->stmts = $stmt;
			$this->stmt = isset($stmt[0]) ? $stmt[0] : null;
		} else {
			$this->stmt = $stmt;
		}
		$this->query = $query;
	}
	
	/**
	 * The PDO statement object that this result uses
	 * @property stmt
	 * @type PDOStatement
	 */
	public $stmt;
	
	/**
	 * An array of PDO statements if passed to the constructor
	 * @property $stmts
	 * @type array
	 */
	public $stmts;
	
	/**
	 * The query that was run to produce this result
	 * @property $query
	 * @type Db_Query_Mysql
	 */
	public $query;

	/**
	 * Fetches an array of database rows matching the query.
	 * The query is executed and fetchAll() is called on the result.
	 * 
	 * See [PDO documentation](http://us2.php.net/manual/en/pdostatement.fetchall.php)
	 * @method fetchAll
	 * @return {array}
	 */
	function fetchAll(
		$fetch_style = PDO::FETCH_BOTH, 
		$fetch_argument = null,
		array $ctor_args = array())
	{
		$arguments = func_get_args();
		if ($this->stmts) {
			$result = array();
			foreach ($this->stmts as $stmt) {
				$r = call_user_func_array(array($stmt, 'fetchAll'), $arguments);
				if ($r) {
					$result = array_merge($result, $r);
				}
			}
		} else {
			$result = call_user_func_array(array($this->stmt, 'fetchAll'), $arguments);
		}
		return $result;
	}
	
	/**
	 * Fetches an array of database rows matching the query.
	 * The query is executed and fetchAll() is called on the result.
	 *
	 * The stripping and indexing is done by
	 * {{#crossLink "Db_Query/arrangeArrayRows"}}{{/crossLink}}, so that rows
	 * coming from a query's cache are arranged exactly the same way as rows
	 * coming straight off a statement.
	 * @method fetchArray
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
		return Db_Query::arrangeArrayRows(
			$this->fetchAll(PDO::FETCH_ASSOC),
			$fields_prefix,
			$by_field
		);
	}

	/**
	 * Fetches an array of Db_Row objects (possibly extended).
	 * You can pass a prefix to strip from the field names.
	 * It will also filter the result.
	 *
	 * The rows themselves are built by
	 * {{#crossLink "Db_Query/hydrateDbRows"}}{{/crossLink}}, which is the same
	 * code path a query uses when it builds rows out of its cache, so the two
	 * can't drift apart.
	 * @method fetchDbRows
	 * @param {string} [$class_name=null] The name of the class to instantiate and fill objects from.
	 *  Must extend Db_Row. Defaults to $this->query->className
	 * @param {string} [$fields_prefix=''] This is the prefix, if any, to strip out when fetching the rows.
	 * @param {string|array} [$by_field=null] A field name to index the array by.
	 *  You can also pass an array containing the field name as its only item,
	 *  in order to accumulate arrays of rows per field, if your query might return
	 *  multiple rows with the same field value.
	 *  If the field's value is NULL in a given row, that row is just appended
	 *  in the usual way to the array.
	 * @return {array}
	 */
	function fetchDbRows (
		$class_name = null, 
		$fields_prefix = '',
		$by_field = null)
	{
		return Db_Query::hydrateDbRows(
			$this->fetchAll(PDO::FETCH_ASSOC),
			$this,
			$this->resolveClassName($class_name),
			$fields_prefix,
			$by_field
		);
	}
	
	/**
	 * Fetches one Db_Row object (possibly extended).
	 * You can pass a prefix to strip from the field names.
	 * It will also filter the result.
	 *
	 * Note that unlike fetchDbRows(), this does not fire the row's afterFetch
	 * callback. That has always been the case, and is preserved here.
	 * @method fetchDbRow
	 * @param {string} [$class_name=null] The name of the class to instantiate and fill objects from.
	 *  Must extend Db_Row. Defaults to $this->query->className
	 * @param {string} [$fields_prefix=''] This is the prefix, if any, to strip out when fetching the rows.
	 * @return {Db_Row|false} Returns false if no row, otherwise returns an object of type $class_name
	 */
	function fetchDbRow(
		$class_name = null, 
		$fields_prefix = '')
	{
		$arr = $this->fetch(PDO::FETCH_ASSOC);
		if (!$arr) {
			return false;
		}
		$rows = Db_Query::hydrateDbRows(
			array($arr),
			$this,
			$this->resolveClassName($class_name),
			$fields_prefix,
			null,
			false // fetchDbRow has never fired afterFetch
		);
		return reset($rows);
	}

	/**
	 * Works out which class the rows of this result should be loaded into.
	 * The query's className is only used when there is no JOIN, since the
	 * columns of a joined query don't belong to any one table's class.
	 * @method resolveClassName
	 * @protected
	 * @param {string} [$class_name=null] An explicitly requested class, if any
	 * @return {string|null}
	 */
	protected function resolveClassName($class_name = null)
	{
		if (empty($class_name) and isset($this->query)
		and !$this->query->getClause('JOIN')) {
			$class_name = $this->query->className;
		}
		return $class_name;
	}

	/**
	 * Dumps the result as an HTML table. 
	 * Side effect, though: can't fetch anymore until the cursor is closed.
	 * @method __toMarkup
	 * @return {string}
	 */
	function __toMarkup ()
	{
		$return = "<table class='dbResultTable'>\n";
		
		try {
			$rows = $this->fetchAll(PDO::FETCH_ASSOC);
			$return .= "<tr class='heading'>\n";
			if (count($rows) > 0) {
				foreach ($rows[0] as $key => $value) {
					$return .= '<td>' . htmlentities($key) . '</td>' . "\n";
				}
			} else {
				return "<div class='dbResultTable'>Db_Result contains zero rows.</div>";
			}
			$return .= "</tr>\n";
			foreach ($rows as $row) {
				$return .= "<tr>\n";
				foreach ($row as $key => $value) {
					$return .= '<td>' . htmlentities($value) . '</td>' . "\n";
				}
				$return .= "</tr>\n";
			}
			$return .= "</table>";
			return $return;
		} catch (Exception $e) {
			return $e->getMessage();
		}
	}
	
	/**
	 * Dumps the result as a table in text mode
	 * Side effect, though: can't fetch anymore until the cursor is closed.
	 * @method __toString
	 * @return {string}
	 */
	function __toString ()
	{
		return "Db_Result";
		try {
			$ob = new Q_OutputBuffer();
			$rows = $this->fetchAll(PDO::FETCH_ASSOC);
			Db::dump_table($rows);
			return $ob->getClean();
		} catch (Exception $e) {
			return $e->getMessage();
		}
	}

	/**
	 * Forwards all other calls to the PDOStatement object
	 * @method __call
	 * @param {string} $name The function name
	 * @param {array} $arguments The arguments
	 */
	function __call ($name, array $arguments)
	{
		return call_user_func_array(array($this->stmt, $name), $arguments);
	}
}