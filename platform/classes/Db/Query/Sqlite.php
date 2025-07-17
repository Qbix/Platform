<?php

include_once(dirname(__FILE__).DS.'..'.DS.'Query.php');

/**
 * @module Db
 */

class Db_Query_Sqlite extends Db_Query_Mysql implements Db_Query_Interface
{
	/**
	 * This class adapts Db_Query_Mysql for SQLite compatibility
	 * @class Db_Query_Sqlite
	 * @extends Db_Query_Mysql
	 * @constructor
	 * @param {Db_Interface} $db
	 * @param {integer} $type
	 * @param {array} [$clauses=array()]
	 * @param {array} [$parameters=array()]
	 * @param {array} [$tables=null]
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
	 * Override onDuplicateKeyUpdate to SQLite-compatible behavior (noop or UPSERT)
	 * @method onDuplicateKeyUpdate
	 * @param {array} $updates
	 * @return {Db_Query_Sqlite}
	 */
	function onDuplicateKeyUpdate ($updates = array())
	{
		$updates = $this->onDuplicateKeyUpdate_internal($updates);
		
		if ($this->type !== Db_Query::TYPE_INSERT) {
			throw new Exception("ON DUPLICATE KEY UPDATE is only valid for INSERT", -1);
		}

		// Convert MySQL ON DUPLICATE KEY UPDATE to SQLite UPSERT syntax
		if (empty($this->clauses['INTO'])) {
			throw new Exception("Cannot apply UPSERT without INTO clause.", -1);
		}
		$table = $this->clauses['INTO'];
		
		// Note: SQLite requires a UNIQUE constraint on conflict target
		if (!isset($this->clauses['UPSERT'])) {
			$this->clauses['UPSERT'] = " ON CONFLICT DO UPDATE SET $updates";
		} else {
			$this->clauses['UPSERT'] .= ", $updates";
		}
		return $this;
	}

	/**
	 * Override build() to handle SQLite-specific SQL generation
	 * @method build
	 * @return {string}
	 */
	function build ()
	{
		$q = parent::build();
		if ($this->type === Db_Query::TYPE_INSERT && isset($this->clauses['UPSERT'])) {
			$q .= $this->clauses['UPSERT'];
		}
		return $q;
	}
}
