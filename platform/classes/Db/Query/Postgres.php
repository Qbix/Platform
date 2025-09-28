<?php

include_once(dirname(__FILE__) . DS . '..' . DS . 'Query.php');

/**
 * @module Db
 */
class Db_Query_Postgres extends Db_Query implements Db_Query_Interface
{
	function __construct(
		Db_Interface $db,
		$type,
		array $clauses = array(),
		array $parameters = array(),
		$table = null
	) {
		parent::__construct($db, $type, $clauses, $parameters, $table);
	}

	function __toString()
	{
		try {
			return $this->build();
		} catch (Exception $e) {
			return '*****' . $e->getMessage();
		}
	}

	static function quoted($identifier)
	{
		return '"' . str_replace('"', '""', $identifier) . '"';
	}

	static function column($column)
	{
		if ($column instanceof Db_Expression) return $column;

		$len = strlen($column);
		$part = $column;
		$pos = false;
		for ($i = 0; $i < $len; ++$i) {
			$c = $column[$i];
			if ($c !== '.' && $c !== '_' && $c !== '-' && $c !== '$'
				&& ($c < 'a' || $c > 'z')
				&& ($c < 'A' || $c > 'Z')
				&& ($c < '0' || $c > '9')) {
				$pos = $i;
				$part = substr($column, 0, $pos);
				break;
			}
		}
		$parts = explode('.', $part);
		$quoted = array_map([self::class, 'quoted'], $parts);
		return implode('.', $quoted) . ($pos ? substr($column, $pos) : '');
	}

	protected function orderBy_expression($expression, $ascending)
	{
		$expr = strtoupper($expression);
		if ($expr === 'RANDOM' || $expr === 'RAND()') {
			return 'RANDOM()'; // PostgreSQL uses RANDOM()
		}
		return parent::orderBy_expression($expression, $ascending);
	}

	/**
	 * Generates CASE-based assignment for array updates (PostgreSQL).
	 * Fallback preserves the existing column value when no match is found.
	 * @method set_array_internal
	 * @protected
	 * @param {string} $column The column being updated.
	 * @param {array} $value Mapping of "WHEN column=value THEN result".
	 * @param {int} &$i Reference counter for bound parameters.
	 * @param {string} $field The field name being updated.
	 * @return {string} The CASE expression SQL fragment.
	 */
	protected function set_array_internal($column, array $value, &$i, $field)
	{
		$basedOn = isset($this->basedOn[$field])
			? Db_Query::column($this->basedOn[$field])
			: $column;

		$cases = "$column = (CASE";

		foreach ($value as $k => $v) {
			if ($k === '' || $k === null) {
				continue;
			}

			$cases .= "\n\tWHEN $basedOn = :_set_$i THEN ";

			if ($v === null) {
				// Emit literal NULL in Postgres
				$cases .= "NULL";
				$this->parameters["_set_$i"] = $k;
				$i++;
			} else {
				$cases .= ":_set_" . ($i+1);
				$this->parameters["_set_$i"]     = $k;
				$this->parameters["_set_" . ($i+1)] = $v;
				$i += 2;
			}
		}

		// Postgres fallback: preserve current column value
		$cases .= "\n\tELSE $column END)";

		return $cases;
	}

    /**
	 * Calculates an ON CONFLICT DO UPDATE clause (PostgreSQL)
	 * @method onDuplicateKeyUpdate_internal
	 * @protected
	 * @param {array|bool} $updates Either an associative array of column => value pairs,
	 *                              or true to auto-generate one safe update.
	 * @return {string} SQL fragment for DO UPDATE SET ...
	 */
	protected function onDuplicateKeyUpdate_internal($updates)
	{
		if ($this->type !== Db_Query::TYPE_INSERT) {
			throw new Exception(
				"The ON CONFLICT DO UPDATE clause does not belong in this context.",
				-1
			);
		}

		$i = 1; // reset per call
		$updates_list     = [];
		$conflictColumns  = [];

		// If caller passed true, auto-generate update of one safe column
		if ($updates === true) {
			if (empty($this->className)) {
				throw new Exception(
					"Need className when onDuplicateKeyUpdate === true",
					-1
				);
			}
			$row        = new $this->className;
			$primaryKey = $row->getPrimaryKey();
			$fieldNames = call_user_func([$this->className, 'fieldNames']);

			// Prefer updatedTime if present
			foreach (['updatedTime', 'updated_time'] as $magic) {
				if (in_array($magic, $fieldNames, true)) {
					$updates = [$magic => new Db_Expression("CURRENT_TIMESTAMP")];
					break;
				}
			}

			// Otherwise pick the first non-PK field
			if ($updates === true) {
				foreach ($fieldNames as $col) {
					if (in_array($col, $primaryKey, true)) continue;
					$updates = [$col => new Db_Expression("EXCLUDED." . self::column($col))];
					break;
				}
			}
		}

		if (!is_array($updates)) {
			throw new Exception("Updates must be an associative array.", -1);
		}

		// Build update expressions
		foreach ($updates as $field => $value) {
			$conflictColumns[] = $field;

			if ($value instanceof Db_Expression) {
				if (is_array($value->parameters)) {
					$this->parameters = array_merge($this->parameters, $value->parameters);
				}
				$updates_list[] = self::column($field) . " = $value";
			} else {
				$updates_list[] = self::column($field) . " = :_dupUpd_$i";
				$this->parameters["_dupUpd_$i"] = $value;
				++$i;
			}
		}

		// Auto-infer conflict target if not explicitly set
		if (empty($this->clauses['ON CONFLICT TARGET']) && !empty($conflictColumns)) {
			$this->clauses['ON CONFLICT TARGET'] =
				'(' . implode(', ', array_map([self::class, 'column'], $conflictColumns)) . ')';
		}

		return implode(', ', $updates_list); // caller wraps with "DO UPDATE SET ..."
	}


	protected function build_insert_onDuplicateKeyUpdate()
	{
		if (empty($this->clauses['ON DUPLICATE KEY UPDATE'])) {
			return '';
		}
		if (empty($this->clauses['ON CONFLICT TARGET'])) {
			throw new Exception("PostgreSQL requires ON CONFLICT target.");
		}
		return "\nON CONFLICT " . $this->clauses['ON CONFLICT TARGET']
		     . " DO UPDATE SET " . $this->clauses['ON DUPLICATE KEY UPDATE'];
	}

	protected function build_onDuplicateKeyUpdate()
	{
		return $this->build_insert_onDuplicateKeyUpdate();
	}

	/**
	 * Check if a column is indexed in a PostgreSQL table.
	 *
	 * Uses the `pg_indexes` catalog to determine if the column appears in any index.
	 *
	 * @method isIndexed_internal
	 * @protected
	 * @param {string} $table Table name
	 * @param {string} $field Column name
	 * @return {bool} True if the column is indexed, false otherwise
	 */
	protected function isIndexed_internal($table, $field)
	{
		$sql = "
			SELECT 1
			FROM pg_indexes
			WHERE tablename = :table
			AND indexdef ILIKE '%' || :field || '%'
			LIMIT 1";
		$stmt = $this->db->reallyConnect()->prepare($sql);
		$stmt->execute(array(':table' => $table, ':field' => $field));
		return (bool) $stmt->fetchColumn();
	}
}