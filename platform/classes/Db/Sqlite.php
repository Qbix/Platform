<?php

/**
 * @module Db
 */

class Db_Sqlite implements Db_Interface
{
	/**
	 * This class lets you create and use PDO database connections.
	 * @class Db_Sqlite
	 * @extends Db_Interface
	 * @constructor
	 *
	 * @param {string} $connectionName The name of the connection out of the connections added with Db::setConnection()
	 * @param {PDO} [$pdo=null] Existing PDO connection. Only accepts connections to Sqlite.
	 */
	function __construct ($connectionName, $pdo = null)
	{
		$this->connectionName = $connectionName;
		if ($pdo) {
			$driver_name = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
			if (strtolower($driver_name) !== 'sqlite') {
				throw new Exception("the PDO object is not for sqlite", -1);
			}
			$this->pdo = $pdo;
		}
	}

	/**
	 * List all tables in the current SQLite database.
	 *
	 * @method _listTables
	 * @protected
	 * @return {array} Array of table names
	 */
	protected function _listTables()
	{
		$sql = "
			SELECT name
			FROM sqlite_master
			WHERE type='table'
			  AND name NOT LIKE 'sqlite_%'
			ORDER BY name
		";
		$stmt = $this->rawQuery($sql)->execute();
		return $stmt->fetchAll(PDO::FETCH_COLUMN, 0);
	}

	/**
	 * Introspect table columns for SQLite.
	 * Must return same shape as MySQL/Postgres version.
	 *
	 * @method _introspectColumns
	 * @protected
	 * @param {string} $table_name
	 * @return {array}
	 */
	protected function _introspectColumns($table_name)
	{
		$sql = "PRAGMA table_info(" . $this->quoted($table_name) . ")";
		$rows = $this->rawQuery($sql)->execute()->fetchAll(PDO::FETCH_ASSOC);

		$cols = array();
		foreach ($rows as $r) {
			$cols[] = array(
				'Field'   => $r['name'],
				'Type'    => $r['type'],
				'Null'    => $r['notnull'] ? 'NO' : 'YES',
				'Key'     => $r['pk'] ? 'PRI' : '',
				'Default' => $r['dflt_value'],
				'Extra'   => '',
				'Comment' => ''
			);
		}

		return $cols;
	}

	/**
	 * Introspect table comment for SQLite.
	 *
	 * @method _introspectTableComment
	 * @protected
	 * @param {string} $table_name
	 * @return {string}
	 */
	protected function _introspectTableComment($table_name)
	{
		return '';
	}

	/**
	 * Introspect indexes for SQLite.
	 * Must return same shape as MySQL/Postgres version.
	 *
	 * @method _introspectTableIndexes
	 * @protected
	 * @param {string} $table_name
	 * @return {array}
	 */
	protected function _introspectTableIndexes($table_name)
	{
		$list = $this->rawQuery(
			"PRAGMA index_list(" . $this->quoted($table_name) . ")"
		)->execute()->fetchAll(PDO::FETCH_ASSOC);

		$indexes = [];

		foreach ($list as $idx) {
			$name = $idx['name'];

			$cols = $this->rawQuery(
				"PRAGMA index_info(" . $this->quoted($name) . ")"
			)->execute()->fetchAll(PDO::FETCH_ASSOC);

			$columns = [];
			foreach ($cols as $c) {
				$columns[(int)$c['seqno']] = $c['name'];
			}
			ksort($columns);

			$indexes[$name] = [
				'unique'  => (bool)$idx['unique'],
				'type'    => 'btree',
				'columns' => array_values($columns),
				'partial' => (bool)$idx['partial']
			];
		}

		return $indexes;
	}

	/**
	 * Introspect model comment(s) for SQLite.
	 *
	 * @method _introspectModelComment
	 * @protected
	 * @param {string} $prefix
	 * @return {string}
	 */
	protected function _introspectModelComment($prefix)
	{
		return '';
	}

	/**
	 * Normalize default value from SQLite.
	 *
	 * @method _normalizeDefault
	 * @protected
	 * @param {string} $d
	 * @return {string|null}
	 */
	protected function _normalizeDefault($d)
	{
		if ($d === null || $d === '') {
			return null;
		}

		$dt = trim($d);
		$du = strtoupper(trim($dt, "'\""));

		if ($du === 'CURRENT_TIMESTAMP'
		||  $du === 'CURRENT_DATE'
		||  $du === 'CURRENT_TIME') {
			return $du;
		}

		return $dt;
	}
}

include_once(dirname(__FILE__).'/Query/Sqlite.php');