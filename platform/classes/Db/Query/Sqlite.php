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

        $i = 1;
        $updates_list = [];

        foreach ($updates as $field => $value) {
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

        // Infer ON CONFLICT target from the table's PRIMARY KEY via PRAGMA
        if (empty($this->clauses['ON CONFLICT TARGET'])) {
            $tableName = isset($this->clauses['INTO'])
                ? $this->clauses['INTO'] : $this->table;
            // Strip column list: "tablename (col1, col2)" → "tablename"
            if ($tableName && preg_match('/^([^(]+)/', $tableName, $tnm)) {
                $tableName = trim($tnm[1]);
            }
            if ($tableName) {
                $bare = preg_replace('/^(main\.|{{dbname}}\.|\w+\.)/', '', $tableName);
                $bare = str_replace('{{prefix}}', $this->db->prefix, $bare);
                $bare = trim($bare, '`"');
                try {
                    $cols = $this->db->rawQuery("PRAGMA table_info(\"$bare\")")
                        ->execute()->fetchAll(\PDO::FETCH_ASSOC);
                    $pkCols = [];
                    foreach ($cols as $col) {
                        if ($col['pk'] > 0) $pkCols[] = $col['name'];
                    }
                    if (!empty($pkCols)) {
                        $this->clauses['ON CONFLICT TARGET'] =
                            '(' . implode(', ', array_map([self::class, 'column'], $pkCols)) . ')';
                    }
                } catch (\Exception $e) {
                    // Log the error for debugging
                    // PK lookup failed — fallback to update columns
                }
            }
            // Fallback: use all update columns
            if (empty($this->clauses['ON CONFLICT TARGET'])) {
                $conflictColumns = array_keys($updates);
                $this->clauses['ON CONFLICT TARGET'] =
                    '(' . implode(', ', array_map([self::class, 'column'], $conflictColumns)) . ')';
            }
        }

        $updates_sql = implode(', ', $updates_list);

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
     * Called by base Db_Query::build_insert() — delegate to build_onDuplicateKeyUpdate.
     */
    protected function build_insert_onDuplicateKeyUpdate()
    {
        return $this->build_onDuplicateKeyUpdate();
    }

	/**
	 * SQLite doesn't support FOR UPDATE / LOCK IN SHARE MODE — return empty.
	 */
	protected function build_select_lock() {
		return '';
	}

	/**
	 * Override getSQL to translate MySQL functions to SQLite equivalents
	 */
	function getSQL($callback = null, $template = false)
	{
		$sql = parent::getSQL($callback, $template);
		if (is_string($sql) && !$template) {
			$sql = $this->translateSQL($sql);
		}
		return $sql;
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
	 * SQLite uses MIN() instead of LEAST()
	 */
	static function least($a, $b)
	{
		return new Db_Expression("MIN($a, $b)");
	}

	/**
	 * SQLite uses MAX() instead of GREATEST()
	 */
	static function greatest($a, $b)
	{
		return new Db_Expression("MAX($a, $b)");
	}

	/**
	 * Translate MySQL function names to SQLite equivalents in built SQL.
	 * Called during getSQL() before parameter binding.
	 * @method translateSQL
	 * @param {string} $sql
	 * @return {string}
	 */
	protected function translateSQL($sql)
	{
		// LEAST(a,b) → MIN(a,b), GREATEST(a,b) → MAX(a,b)
		$sql = preg_replace('/\bLEAST\s*\(/i', 'MIN(', $sql);
		$sql = preg_replace('/\bGREATEST\s*\(/i', 'MAX(', $sql);
		// RAND() → RANDOM()
		$sql = preg_replace('/\bRAND\s*\(\s*\)/i', 'RANDOM()', $sql);
		// IF(cond,a,b) → IIF(cond,a,b)
		$sql = preg_replace('/\bIF\s*\(/i', 'IIF(', $sql);
		// 'value' - INTERVAL N SECOND → datetime('value', '-N seconds')
		// 'value' + INTERVAL N SECOND → datetime('value', '+N seconds')
		$sql = preg_replace_callback(
			"/('[\d\- :]+')\\s*([+-])\\s*INTERVAL\\s+(\\d+)\\s+SECOND/i",
			function ($m) {
				$sign = ($m[2] === '-') ? '-' : '+';
				return "datetime({$m[1]}, '{$sign}{$m[3]} seconds')";
			},
			$sql
		);
		// column - INTERVAL N SECOND → datetime(column, '-N seconds')
		$sql = preg_replace_callback(
			'/(\w+)\s*([+-])\s*INTERVAL\s+(\d+)\s+SECOND/i',
			function ($m) {
				$sign = ($m[2] === '-') ? '-' : '+';
				return "datetime({$m[1]}, '{$sign}{$m[3]} seconds')";
			},
			$sql
		);
		// NOW() → datetime('now')
		$sql = preg_replace('/\bNOW\s*\(\s*\)/i', "datetime('now')", $sql);
		// JSON_UNQUOTE(JSON_EXTRACT(col, path)) → json_extract(col, path)
		// Match the full pattern including both closing parens
		$sql = preg_replace(
			'/\bJSON_UNQUOTE\s*\(\s*JSON_EXTRACT\s*\(([^)]+)\)\s*\)/i',
			'json_extract($1)',
			$sql
		);
		// Standalone JSON_EXTRACT → json_extract (SQLite has this)
		$sql = preg_replace('/\bJSON_EXTRACT\s*\(/i', 'json_extract(', $sql);
		// CONCAT('a', b, 'c') → ('a' || b || 'c')
		$sql = preg_replace_callback('/\bCONCAT\s*\(([^)]+)\)/i', function($m) {
			return '(' . implode(' || ', array_map('trim', explode(',', $m[1]))) . ')';
		}, $sql);
		return $sql;
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


	function vectorMetricsSupported()
	{
		return array('cosine', 'euclidean');
	}

	function vectorsSupported()
	{
		$db = $this->db;
		return $db and method_exists($db, 'vectorsSupported')
			? $db->vectorsSupported() : false;
	}

	/**
	 * By convention the sidecar vec0 table is "<table>_vec", and its rowid
	 * matches the base table's rowid.
	 * @method vectorTableFor
	 */
	function vectorTableFor($table)
	{
		$bare = preg_replace('/^\w+\./', '', $table);
		return str_replace(array('"', '`'), '', $bare) . '_vec';
	}

	/**
	 * SQLite is the structural outlier: vectors live in a separate vec0
	 * virtual table, so this cannot be an ORDER BY on the current table.
	 * It joins against a KNN subquery instead.
	 * @method vectorNearestTo
	 * @chainable
	 */
	function nearestTo($column, $vector, $options = array())
	{
		return $this->vectorNearestTo($column, $vector, $options);
	}

	function vectorNearestTo($column, $vector, $options = array())
	{
		if (!($vector instanceof Db_Vector)) {
			$metric = isset($options['metric']) ? $options['metric'] : 'cosine';
			$vector = new Db_Vector($vector, $metric);
		}
		if (!$this->vectorsSupported()) {
			throw new Exception(
				"Db_Query_Sqlite::vectorNearestTo: the sqlite-vec extension is not loaded"
			);
		}
		$metrics = $this->vectorMetricsSupported();
		if (!in_array($vector->metric, $metrics)) {
			throw new Exception(
				"Db_Query_Sqlite::vectorNearestTo: this adapter supports "
				. implode(' and ', $metrics) . " distance, not '{$vector->metric}'"
			);
		}
		// vec0 requires k; without a limit there is no sensible default, so
		// bound it rather than scanning the whole table.
		$k = isset($options['limit']) ? (int)$options['limit'] : 100;
		$from = isset($this->clauses['FROM']) ? $this->clauses['FROM'] : $this->table;
		if (is_array($from)) {
			$from = reset($from);
		}
		$vecTable = $this->vectorTableFor($from);
		// The metric is baked into the vec0 declaration; querying with another
		// does not re-rank, it silently answers in the built-in units.
		$db = $this->db;
		if ($db and method_exists($db, 'vectorIndexMetric')) {
			$built = $db->vectorIndexMetric($from);
			if ($built and $built !== $vector->metric) {
				throw new Exception(
					"Db_Query_Sqlite::vectorNearestTo: $vecTable was built for $built"
					. " distance, but this query asks for {$vector->metric}."
				);
			}
		}
		$alias = '_vec' . (++self::$vectorCounter);
		$name = '_vec_' . self::$vectorCounter;
		$this->parameters[$name] = $vector->toBinary();

		$join = 'JOIN (SELECT rowid AS _rid, distance FROM '
			. self::quoted($vecTable)
			. ' WHERE ' . self::quoted($column) . ' MATCH :' . $name
			. ' AND k = ' . $k . ') ' . $alias
			. ' ON ' . $alias . '._rid = ' . self::quoted($from) . '.rowid';
		$this->clauses['JOIN'] = empty($this->clauses['JOIN'])
			? $join : $this->clauses['JOIN'] . "\n" . $join;

		$distance = $alias . '.distance';
		$this->clauses['ORDER BY'] = empty($this->clauses['ORDER BY'])
			? $distance : $this->clauses['ORDER BY'] . ', ' . $distance;
		if (!empty($options['distanceAs'])) {
			$select = empty($this->clauses['SELECT']) ? '*' : $this->clauses['SELECT'];
			$this->clauses['SELECT'] = $select . ', ' . $distance
				. ' AS ' . self::column($options['distanceAs']);
		}
		if (isset($options['limit'])) {
			$offset = isset($options['offset']) ? $options['offset'] : null;
			$this->limit($options['limit'], $offset);
		}
		return $this;
	}

	protected static $vectorCounter = 0;


	function vectorLiteral(Db_Vector $vector)
	{
		return $vector->toBinary(); // sqlite-vec wants packed little-endian float32
	}

}