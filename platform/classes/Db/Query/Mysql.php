<?php

include_once(dirname(__FILE__).DS.'..'.DS.'Query.php');

/**
 * @module Db
 */

class Db_Query_Mysql extends Db_Query implements Db_Query_Interface
{
	/**
	 * This class lets you create and use Db queries
	 * @class Db_Query_Mysql
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
		parent::__construct($db, $type, $clauses, $parameters, $table);
	}

	/**
	 * Convert Db_Query_Mysql to it's representation
	 * @method __toString
	 * @return {string}
	 */
	function __toString ()
	{
		try {
			$repres = $this->build();
		} catch (Exception $e) {
			return '*****' . $e->getMessage();
		}
		return $repres;
	}

	/**
	 * MySQL supports ON DUPLICATE KEY UPDATE
	 */
	protected function build_insert_onDuplicateKeyUpdate() {
		return empty($this->clauses['ON DUPLICATE KEY UPDATE'])
			? ''
			: "\nON DUPLICATE KEY UPDATE " . $this->clauses['ON DUPLICATE KEY UPDATE'];
	}

	/**
	 * MySQL supports INSERT ... SELECT ... ON DUPLICATE KEY UPDATE
	 * So we override build_select to allow appending that
	 */
	protected function build_select_onDuplicateKeyUpdate() {
		return empty($this->clauses['ON DUPLICATE KEY UPDATE'])
			? ''
			: "\nON DUPLICATE KEY UPDATE " . $this->clauses['ON DUPLICATE KEY UPDATE'];
	}

	/**
	 * MySQL supports ON DUPLICATE KEY UPDATE
	 * So we override build_onDuplicateKeyUpdate
	 */
	protected function build_onDuplicateKeyUpdate() {
		return empty($this->clauses['ON DUPLICATE KEY UPDATE'])
			? ''
			: "\nON DUPLICATE KEY UPDATE " . $this->clauses['ON DUPLICATE KEY UPDATE'];
	}

	/**
	 * Calculates an ON DUPLICATE KEY UPDATE clause
	 * @method onDuplicateKeyUpdate_internal
	 * @private
	 * @param {array} $updates An associative array of column => value pairs.
	 * The values are automatically escaped using PDO placeholders.
	 * @return {string}
	 */
	private function onDuplicateKeyUpdate_internal ($updates)
	{
		if ($this->type != Db_Query::TYPE_INSERT) {
			throw new Exception("The ON DUPLICATE KEY UPDATE clause does not belong in this context.", -1);
		}

		static $i = 1;
		if (is_array($updates)) {
			$updates_list = array();
			foreach ($updates as $field => $value) {
				if ($value instanceof Db_Expression) {
					if (is_array($value->parameters)) {
						$this->parameters = array_merge($this->parameters,
							$value->parameters);
					}
					$updates_list[] = self::column($field) . " = $value";
				} else {
					$updates_list[] = self::column($field) . " = :_dupUpd_$i";
					$this->parameters["_dupUpd_$i"] = $value;
					++ $i;
				}
			}
			$updates = implode(", ", $updates_list);
		}
		if (! is_string($updates))
			throw new Exception("The ON DUPLICATE KEY updates need to be specified correctly.", -1);

		return $updates;
	}
}
