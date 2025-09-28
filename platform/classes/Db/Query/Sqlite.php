<?php

include_once(dirname(__FILE__) . DS . '..' . DS . 'Query.php');

/**
 * @module Db
 */
class Db_Query_Sqlite extends Db_Query implements Db_Query_Interface
{
	/**
	 * This class lets you create and use Db queries for SQLite
	 * @class Db_Query_Sqlite
	 * @extends Db_Query
	 */
	function __construct(
		Db_Interface $db,
		$type,
		array $clauses = array(),
		array $parameters = array(),
		$table = null
	) {
		parent::__construct($db, $type, $clauses, $parameters, $table);
	}

	/**
	 * Convert Db_Query_Sqlite to its representation
	 * @method __toString
	 * @return {string}
	 */
	function __toString()
	{
		try {
			$repres = $this->build();
		} catch (Exception $e) {
			return '*****' . $e->getMessage();
		}
		return $repres;
	}

    static function column($column)
    {
        if ($column instanceof Db_Expression) {
            return $column;
        }

        $len = strlen($column);
        $part = $column;
        $pos = false;
        for ($i = 0; $i < $len; ++$i) {
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
            $quoted[] = "\"$p\""; // Use double quotes for SQLite
        }
        return implode('.', $quoted) . ($pos ? substr($column, $pos) : '');
    }


	/**
	 * SQLite uses double quotes for quoting identifiers
	 */
	static function quoted($identifier)
	{
		return '"' . str_replace('"', '""', $identifier) . '"';
	}

    /**
     * Collects ON CONFLICT DO UPDATE assignments for SQLite.
     *
     * @param array $updates Associative array of column => value pairs.
     * @return string SQL fragment with "col = ..." expressions.
     * @throws Exception
     */
    protected function onDuplicateKeyUpdate_internal($updates)
    {
        if ($this->type !== Db_Query::TYPE_INSERT) {
            throw new Exception("ON CONFLICT DO UPDATE only applies to INSERT queries.", -1);
        }

        if (!is_array($updates)) {
            throw new Exception("Updates must be an associative array.", -1);
        }

        $i               = 1;
        $updates_list    = [];
        $conflictColumns = [];

        foreach ($updates as $field => $value) {
            $conflictColumns[] = $field;

            if ($value === self::DONT_CHANGE()) {
                $updates_list[] = self::column($field) . " = " . self::column($field);
            } elseif ($value instanceof Db_Expression) {
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

        // Only infer ON CONFLICT target if not already provided
        if (empty($this->clauses['ON CONFLICT TARGET']) && !empty($conflictColumns)) {
            $this->clauses['ON CONFLICT TARGET'] =
                '(' . implode(', ', array_map([self::class, 'column'], $conflictColumns)) . ')';
        }

        $updates_sql = implode(', ', $updates_list);

        // Save the assignments for build step
        if (empty($this->clauses['ON DUPLICATE KEY UPDATE'])) {
            $this->clauses['ON DUPLICATE KEY UPDATE'] = $updates_sql;
        } else {
            $this->clauses['ON DUPLICATE KEY UPDATE'] .= ", $updates_sql";
        }

        return $updates_sql;
    }

    /**
     * Builds the ON CONFLICT DO UPDATE clause for SQLite.
     *
     * @return string Full ON CONFLICT clause or empty string.
     * @throws Exception
     */
    protected function build_onDuplicateKeyUpdate()
    {
        if (empty($this->clauses['ON DUPLICATE KEY UPDATE'])) {
            return '';
        }
        if (empty($this->clauses['ON CONFLICT TARGET'])) {
            throw new Exception("SQLite requires ON CONFLICT target.");
        }

        return "\nON CONFLICT " . $this->clauses['ON CONFLICT TARGET']
            . " DO UPDATE SET " . $this->clauses['ON DUPLICATE KEY UPDATE'];
    }

	/**
	 * SQLite-compatible ORDER BY expression handler
	 */
	protected function orderBy_expression($expression, $ascending)
	{
		$expr = strtoupper($expression);
		if ($expr === 'RANDOM' || $expr === 'RAND()') {
			return 'RANDOM()'; // SQLite uses RANDOM()
		}
		return parent::orderBy_expression($expression, $ascending);
	}

    /**
     * Generates CASE-based assignment for array updates (SQLite).
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
            if ($k === '' || $k === null) continue;
            $cases .= "\n\tWHEN $basedOn = :_set_$i THEN :_set_" . ($i+1);
            $this->parameters["_set_$i"]     = $k;
            $this->parameters["_set_" . ($i+1)] = $v;
            $i += 2;
        }
        // SQLite fallback: keep current value
        $cases .= "\n\tELSE $column END)";
        return $cases;
    }

    /**
     * Calculates SET clause for SQLite
     * @method set_internal
     * @protected
     * @param {array} $updates An associative array of column => value pairs.
     * The values are automatically escaped using PDO placeholders.
     * @return {string}
     */
    protected function set_internal($updates)
    {
        switch ($this->type) {
            case Db_Query::TYPE_UPDATE:
                break;
            default:
                throw new Exception("The SET clause does not belong in this context.", -1);
        }

        static $i = 1;
        if (is_array($updates)) {
            $updates_list = [];
            foreach ($updates as $field => $value) {
                $column = static::column($field);

                if ($value instanceof Db_Expression) {
                    if (is_array($value->parameters)) {
                        $this->parameters = array_merge($this->parameters, $value->parameters);
                    }
                    $updates_list[] = "$column = $value";

                } else if (is_array($value)) {
                    // CASE expression for bulk updates
                    $basedOn = isset($this->basedOn[$field])
                        ? static::column($this->basedOn[$field])
                        : $column;

                    $cases = "$column = (CASE";
                    foreach ($value as $k => $v) {
                        if ($k === '' || $k === null) {
                            continue;
                        }

                        $cases .= "\n\tWHEN $basedOn = :_set_$i THEN ";
                        if ($v === null) {
                            $cases .= "NULL";
                            $this->parameters["_set_$i"] = $k;
                            $i++;
                        } else {
                            $cases .= ":_set_" . ($i+1);
                            $this->parameters["_set_$i"] = $k;
                            $this->parameters["_set_" . ($i+1)] = $v;
                            $i += 2;
                        }
                    }
                    // In SQLite: safe fallback is to keep current value
                    $cases .= "\n\tELSE $column END)";
                    $updates_list[] = $cases;

                } else {
                    $updates_list[] = "$column = :_set_$i";
                    $this->parameters["_set_$i"] = $value;
                    ++$i;
                }
            }
            $updates = count($updates_list) > 0
                ? implode(", \n", $updates_list)
                : '';
        }
        if (!is_string($updates)) {
            throw new Exception("The SET updates need to be specified correctly.", -1);
        }

        return $updates;
    }

    /**
     * Check if a column is indexed in a SQLite table.
     *
     * Uses `PRAGMA index_list` and `PRAGMA index_info` to find indexes
     * defined on the specified table and see if the column is included.
     *
     * @method isIndexed_internal
     * @protected
     * @param {string} $table Table name
     * @param {string} $field Column name
     * @return {bool} True if the column is indexed, false otherwise
     */
    protected function isIndexed_internal($table, $field)
    {
        $pdo = $this->db->reallyConnect();
        $stmt = $pdo->query("PRAGMA index_list(" . static::quoted($table) . ")");
        $indexes = $stmt->fetchAll(PDO::FETCH_ASSOC);

        foreach ($indexes as $index) {
            $info = $pdo->query("PRAGMA index_info(" . static::quoted($index['name']) . ")")
                        ->fetchAll(PDO::FETCH_ASSOC);
            foreach ($info as $col) {
                if ($col['name'] === $field) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * List all tables in the current SQLite database.
     *
     * @method _listTables
     * @protected
     * @return {array} Array of table names
     */
    protected function _listTables() {
        $sql = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name";
        $stmt = $this->rawQuery($sql)->execute();
        return $stmt->fetchAll(PDO::FETCH_COLUMN, 0);
    }

    /**
     * Introspect table columns for SQLite.
     * Must return same shape as MySQL/Postgres version:
     * [ 'Field' => ..., 'Type' => ..., 'Null' => YES/NO, 'Key' => PRI, 'Default' => ..., 'Extra' => ..., 'Comment' => ... ]
     *
     * @method _introspectColumns
     * @protected
     * @param {string} $table_name
     * @return {array} Array of column definitions
     */
    protected function _introspectColumns($table_name) {
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
                'Extra'   => '', // SQLite has no "auto_increment" flag here
                'Comment' => ''  // SQLite has no table/column comments
            );
        }
        return $cols;
    }

    /**
     * Introspect table comment for SQLite.
     * Always empty because SQLite doesn’t store comments.
     *
     * @method _introspectTableComment
     * @protected
     * @param {string} $table_name
     * @return {string}
     */
    protected function _introspectTableComment($table_name) {
        return '';
    }

    /**
     * Normalize default value from SQLite.
     *
     * @method _normalizeDefault
     * @protected
     * @param {string} $d Default expression from PRAGMA
     * @return {string|null} Normalized default
     */
    protected function _normalizeDefault($d) {
        if ($d === null || $d === '') {
            return null;
        }
        $dl = strtoupper(trim($d, "'\"")); // strip quotes for literals
        if ($dl === 'CURRENT_TIMESTAMP') {
            return 'CURRENT_TIMESTAMP';
        }
        if ($dl === 'CURRENT_DATE') {
            return 'CURRENT_DATE';
        }
        if ($dl === 'CURRENT_TIME') {
            return 'CURRENT_TIME';
        }
        return $d;
    }

    /**
     * Introspect model comment(s) for SQLite.
     * Always empty because SQLite doesn’t support comments.
     *
     * @method _introspectModelComment
     * @protected
     * @param {string} $prefix
     * @return {string}
     */
    protected function _introspectModelComment($prefix) {
        return '';
    }

}