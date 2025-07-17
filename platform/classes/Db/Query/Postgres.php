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

    protected function onDuplicateKeyUpdate_internal($updates)
    {
        if ($this->type !== Db_Query::TYPE_INSERT) {
            throw new Exception("The ON CONFLICT DO UPDATE clause does not belong in this context.", -1);
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

        // Append to existing clause if necessary
        if (empty($this->clauses['ON DUPLICATE KEY UPDATE'])) {
            $this->clauses['ON DUPLICATE KEY UPDATE'] = $updates_sql;
        } else {
            $this->clauses['ON DUPLICATE KEY UPDATE'] .= ", $updates_sql";
        }

        return $updates_sql;
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
}