<?php

/**
 * @module Db
 */

class Db_Expression
{
	/**
	 * This class lets you use Db expressions
	 * 
	 * **Note:** *if you re-use the same Db_Expression object across one or more queries,
	 * please be aware that this may cause problems if we ever decide
	 * to bind parameters by reference instead of value, as the parameter
	 * names will remain the same each time the Db_Expression object is used.*
	 * @class Db_Expression
	 * @constructor
	 * @param {Db_Expression|string} $chain1 Pass as many arguments as you want, and they will be concatenated together
	 * with spaces in between them. Db_Expression objects will be enclosed in parentheses before being concatenated.
	 */
	function __construct ($chain1, $chain2 = null)
	{
		$this->expression = '';
		$chain = func_get_args();
		$pieces = array();
		
		static $i = 1;
		foreach ($chain as $arg) {
			if (! isset($arg)) {
				$pieces[] = "NULL"; 
			} else if (is_numeric($arg)) {
				$pieces[] = "$arg";
			} else if (is_string($arg)) {
				$pieces[] = $arg; 
			} else if (is_array($arg)) {
				$expr_list = array();
				foreach ($arg as $expr => $value) {
					if ($value instanceof Db_Expression) {
						$str = $value;
						$this->parameters = array_merge(
							$this->parameters, 
							$value->parameters
						);
					} else {
						$str = ":_dbExpr_$i";
						$this->parameters["_dbExpr_$i"] = $value;
					}
					if (preg_match('/\W/', substr($expr, -1))) {
						$expr_list[] = "($expr $str)";
					} else {
						$expr_list[] = "($expr = $str)";
					}
					++ $i;
				}
				$pieces[] = '(' . implode(' AND ', $expr_list) . ')';
			} else if ($arg instanceof Db_Expression) {
				$pieces[] = "($arg)";
				if (is_array($arg->parameters)) {
					$this->parameters = array_merge(
						$this->parameters, 
						$arg->parameters
					);
				}
			}
		}
		$this->expression = implode(' ', $pieces);
	}

	/**
	 * Creates a safe copy of this Db_Query.
	 *
	 * The copy is shallow (PHP copy-on-write semantics apply), but all bound
	 * parameter placeholders are **renamed** to ensure the copied expression
	 * can be reused in the same query without parameter collisions.
	 *
	 * This is critical when the same Db_Expression (or a subquery built from it)
	 * is injected multiple times into a larger query (e.g. in WHERE clauses
	 * and again in SELECT expressions such as relevance scoring).
	 *
	 * Each call to copy() generates a unique namespace prefix for parameters,
	 * guaranteeing that:
	 * - named placeholders do not collide
	 * - parameter values remain correctly bound
	 * - prepared statements remain valid
	 *
	 * @method copy
	 * @return {Db_Expression} A cloned expression with rewritten parameter names
	 */
	function copy()
	{
		// We only need a shallow clone of the object.
		// The expression and parameters are duplicated lazily (copy-on-write),
		// and we explicitly rewrite parameter names to avoid collisions when
		// the same expression is reused in a larger query.
		static $j = 1;

		$copy = clone $this;

		if (empty($copy->parameters) || !is_array($copy->parameters)) {
			return $copy;
		}

		$newParams = array();
		$replacements = array();

		foreach ($copy->parameters as $key => $value) {
			if (!is_string($key)) {
				$newParams[$key] = $value;
				continue;
			}

			$newKey = '_copy_' . $j . '_' . $key;

			$replacements[":$key"] = ":$newKey";
			$newParams[$newKey] = $value;
		}

		$j++;

		// Replace all occurrences safely; keys are unique by construction
		$copy->expression = strtr($copy->expression, $replacements);
		$copy->parameters = $newParams;

		return $copy;
	}

	/**
	 * Walks through an array and calls Q::interpolate() on
	 * expressions inside Db_Expression objects.
	 * @method interpolateArray
	 * @static
	 * @param {array} $arr
	 * @param {array} $params
	 * @return {array}
	 */
	static function interpolateArray(array $arr, array $params)
	{
		$result = array();
		foreach ($arr as $k => $v) {
			if ($v instanceof Db_Expression) {
				$v2 = clone $v;
				$v2->expression = Q::interpolate($v->expression, $params);
				$result[$k] = $v2;
			} else {
				$result[$k] = $v;
			}
		}
		return $result;
	}

	/**
	 * The expression as a string
	 * @property $expression
	 * @type string
	 */
	public $expression;
	
	/**
	 * The query that was run to produce this result
	 * @property $chain
	 * @type Db_Query
	 */
	public $chain;
	
	/**
	 * The parameters to bind with the expression
	 * @property $parameters
	 * @type array
	 * @public
	 */
	public $parameters = array();

	function __toString ()
	{
		return $this->expression;
	}
}