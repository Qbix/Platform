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

    protected function onDuplicateKeyUpdate_internal($updates)
    {
        if ($this->type !== Db_Query::TYPE_INSERT) {
            throw new Exception("ON DUPLICATE KEY UPDATE only applies to INSERT queries.", -1);
        }

        static $i = 1;
        if (!is_array($updates)) {
            throw new Exception("Updates must be an associative array.", -1);
        }

        $updates_list = [];
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

        // Only infer ON CONFLICT TARGET if not already set
        if (empty($this->clauses['ON CONFLICT TARGET']) && !empty($conflictColumns)) {
            $this->clauses['ON CONFLICT TARGET'] =
                '(' . implode(', ', array_map([self::class, 'column'], $conflictColumns)) . ')';
        }

        $updates_sql = implode(', ', $updates_list);

        // Append to existing updates if already called once
        if (empty($this->clauses['ON DUPLICATE KEY UPDATE'])) {
            $this->clauses['ON DUPLICATE KEY UPDATE'] = $updates_sql;
        } else {
            $this->clauses['ON DUPLICATE KEY UPDATE'] .= ", $updates_sql";
        }

        return $updates_sql;
    }

    protected function build_onDuplicateKeyUpdate() {
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
}