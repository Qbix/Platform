#!/usr/bin/env php
<?php
/**
 * Qbix Platform — Database Migration Tool
 *
 * Migrates data between MySQL, SQLite, and PostgreSQL.
 * Uses the adapter layer so type conversion (dates, binary,
 * identifiers, quoting) is handled automatically.
 *
 * Usage:
 *   php scripts/migrate.php <APP_DIR> [options]
 *
 * Options:
 *   --source <dsn>         Source DSN (e.g. "sqlite:/data/app.db")
 *   --source-config <name> Or use a named connection from app config
 *   --target <dsn>         Target DSN (e.g. "pgsql:host=localhost;dbname=myapp")
 *   --target-config <name> Or use a named connection from app config
 *   --target-user <user>   Target DB username (default: from config)
 *   --target-pass <pass>   Target DB password (default: from config)
 *   --connections <list>   Comma-separated connection names to migrate
 *                          (default: all connections in app config)
 *   --tables <list>        Comma-separated table names to migrate
 *   --exclude <list>       Comma-separated table names to skip
 *   --batch <n>            Rows per INSERT batch (default: 500)
 *   --truncate             Truncate target tables before inserting
 *   --schema-only          Only create tables via plugin installer
 *   --data-only            Only copy data, assume tables exist
 *   --verify               After migration, verify row counts match
 *   --dry-run              Show plan without executing
 *   --verbose              Show detailed progress
 *   --reset-sequences      Reset Postgres sequences after insert
 *   --quiet                Suppress all output except errors
 *
 * Examples:
 *   # SQLite → PostgreSQL (growth path)
 *   php scripts/migrate.php /path/to/app \
 *       --source "sqlite:/data/app.db" \
 *       --target "pgsql:host=localhost;dbname=myapp" \
 *       --target-user qbix --target-pass secret \
 *       --verify --reset-sequences
 *
 *   # MySQL → PostgreSQL (modernization)
 *   php scripts/migrate.php /path/to/app \
 *       --source-config Users --target-config Users_pg
 *
 *   # PostgreSQL → SQLite (take data offline)
 *   php scripts/migrate.php /path/to/app \
 *       --source-config Users --target "sqlite:/data/offline.db" \
 *       --verify
 *
 *   # Dry run
 *   php scripts/migrate.php /path/to/app \
 *       --source "sqlite:/data/old.db" \
 *       --target "pgsql:host=pg;dbname=new" \
 *       --dry-run --verbose
 */

// ── Bootstrap ──

if (PHP_SAPI !== 'cli') {
	die("This script must be run from the command line.\n");
}

if (empty($argv[1]) || in_array($argv[1], array('--help', '-h'))) {
	$lines = file(__FILE__);
	foreach ($lines as $line) {
		if (strpos($line, ' * ') === 0) echo substr($line, 3);
		elseif (trim($line) === '*/') break;
	}
	exit(0);
}

$APP_DIR = realpath($argv[1]);
if (!$APP_DIR || !file_exists($APP_DIR . '/web/Q.inc.php')) {
	die("Error: '$argv[1]' is not a valid Qbix app directory.\n");
}
define('APP_DIR', $APP_DIR);
include APP_DIR . '/web/Q.inc.php';

// ── Parse Options ──

function getOpt($name, $default = null) {
	global $argv;
	for ($i = 2; $i < count($argv); $i++) {
		if ($argv[$i] === "--$name" && isset($argv[$i + 1]) && $argv[$i + 1][0] !== '-') {
			return $argv[$i + 1];
		}
	}
	return $default;
}

function hasFlag($name) {
	global $argv;
	return in_array("--$name", $argv);
}

$opt = array(
	'source'       => getOpt('source'),
	'sourceConfig' => getOpt('source-config'),
	'target'       => getOpt('target'),
	'targetConfig' => getOpt('target-config'),
	'targetUser'   => getOpt('target-user'),
	'targetPass'   => getOpt('target-pass'),
	'connections'  => getOpt('connections'),
	'tables'       => getOpt('tables'),
	'exclude'      => getOpt('exclude'),
	'batch'        => max(1, (int) getOpt('batch', 500)),
	'truncate'     => hasFlag('truncate'),
	'schemaOnly'   => hasFlag('schema-only'),
	'dataOnly'     => hasFlag('data-only'),
	'verify'       => hasFlag('verify'),
	'dryRun'       => hasFlag('dry-run'),
	'verbose'      => hasFlag('verbose'),
	'resetSeq'     => hasFlag('reset-sequences'),
	'quiet'        => hasFlag('quiet'),
);

function out($msg, $verboseOnly = false) {
	global $opt;
	if ($opt['quiet']) return;
	if ($verboseOnly && !$opt['verbose']) return;
	echo $msg . PHP_EOL;
}

// ── Helpers ──

function listTables($db, $prefix) {
	$tables = array();
	$dbms = $db->dbms();
	if ($dbms === 'mysql') {
		$rows = $db->rawQuery("SHOW TABLES")->execute()->fetchAll(PDO::FETCH_NUM);
		foreach ($rows as $r) if (!$prefix || strpos($r[0], $prefix) === 0) $tables[] = $r[0];
	} elseif ($dbms === 'sqlite') {
		$rows = $db->rawQuery("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
			->execute()->fetchAll(PDO::FETCH_ASSOC);
		foreach ($rows as $r) if (!$prefix || strpos($r['name'], $prefix) === 0) $tables[] = $r['name'];
	} elseif ($dbms === 'postgres') {
		$rows = $db->rawQuery(
			"SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name"
		)->execute()->fetchAll(PDO::FETCH_ASSOC);
		foreach ($rows as $r) if (!$prefix || strpos($r['table_name'], $prefix) === 0) $tables[] = $r['table_name'];
	}
	return $tables;
}

function getColumns($db, $table) {
	$cols = array();
	$dbms = $db->dbms();
	if ($dbms === 'mysql') {
		$rows = $db->rawQuery("SHOW COLUMNS FROM `$table`")->execute()->fetchAll(PDO::FETCH_ASSOC);
		foreach ($rows as $r) $cols[] = $r['Field'];
	} elseif ($dbms === 'sqlite') {
		$rows = $db->rawQuery("PRAGMA table_info(\"$table\")")->execute()->fetchAll(PDO::FETCH_ASSOC);
		foreach ($rows as $r) $cols[] = $r['name'];
	} elseif ($dbms === 'postgres') {
		$rows = $db->rawQuery(
			"SELECT column_name FROM information_schema.columns "
			. "WHERE table_schema='public' AND table_name='$table' ORDER BY ordinal_position"
		)->execute()->fetchAll(PDO::FETCH_ASSOC);
		foreach ($rows as $r) $cols[] = $r['column_name'];
	}
	return $cols;
}

function countRows($db, $table) {
	$qt = ($db->dbms() === 'mysql') ? "`$table`" : "\"$table\"";
	$rows = $db->rawQuery("SELECT COUNT(*) as c FROM $qt")->execute()->fetchAll(PDO::FETCH_ASSOC);
	return (int) $rows[0]['c'];
}

function quoteTable($db, $t) {
	if ($db->dbms() === 'mysql') return "`$t`";
	return "\"$t\"";
}

function quoteCol($db, $c) {
	if ($db->dbms() === 'mysql') return "`$c`";
	return "\"$c\"";
}

/**
 * Map source columns to target columns (case-insensitive match).
 * Postgres lowercases unquoted identifiers, so camelCase columns
 * from MySQL/SQLite map to lowercase in Postgres.
 */
function mapColumns($srcCols, $tgtCols) {
	$map = array();
	$tgtByLower = array();
	foreach ($tgtCols as $tc) $tgtByLower[strtolower($tc)] = $tc;
	foreach ($srcCols as $sc) {
		$lower = strtolower($sc);
		if (isset($tgtByLower[$lower])) $map[$sc] = $tgtByLower[$lower];
	}
	return $map;
}

function resetSequences($db, $table, $cols) {
	if ($db->dbms() !== 'postgres') return;
	$pdo = $db->reallyConnect();
	foreach ($cols as $col) {
		try {
			$rows = $pdo->query("SELECT pg_get_serial_sequence('public.\"$table\"', '$col') as seq")
				->fetchAll(PDO::FETCH_ASSOC);
			if (!empty($rows[0]['seq'])) {
				$seq = $rows[0]['seq'];
				$maxRows = $pdo->query("SELECT COALESCE(MAX(\"$col\"), 0) + 1 as nv FROM public.\"$table\"")
					->fetchAll(PDO::FETCH_ASSOC);
				$pdo->exec("ALTER SEQUENCE $seq RESTART WITH " . $maxRows[0]['nv']);
				out("    Sequence $seq → " . $maxRows[0]['nv'], true);
			}
		} catch (Exception $e) {
			// Column has no sequence — that's fine
		}
	}
}

// ── Migrate One Table ──

function migrateTable($srcDb, $tgtDb, $srcTable, $tgtTable, $opt) {
	$srcCols = getColumns($srcDb, $srcTable);
	$tgtCols = getColumns($tgtDb, $tgtTable);
	$colMap = mapColumns($srcCols, $tgtCols);

	if (empty($colMap)) {
		out("    $srcTable: no matching columns — skip", true);
		return 0;
	}

	// Read source
	$srcColsQ = array();
	foreach (array_keys($colMap) as $c) $srcColsQ[] = quoteCol($srcDb, $c);
	$sql = "SELECT " . implode(',', $srcColsQ) . " FROM " . quoteTable($srcDb, $srcTable);
	$rows = $srcDb->rawQuery($sql)->execute()->fetchAll(PDO::FETCH_ASSOC);
	$total = count($rows);

	if ($total === 0) {
		out("    $srcTable: 0 rows", true);
		return 0;
	}
	if ($opt['dryRun']) {
		out("    $srcTable → $tgtTable: $total rows (dry run)");
		return $total;
	}

	// Truncate
	if ($opt['truncate']) {
		if ($tgtDb->dbms() === 'sqlite') {
			$tgtDb->rawQuery("DELETE FROM " . quoteTable($tgtDb, $tgtTable))->execute();
		} else {
			$tgtDb->rawQuery("TRUNCATE TABLE " . quoteTable($tgtDb, $tgtTable))->execute();
		}
	}

	// Insert in batches
	$tgtPdo = $tgtDb->reallyConnect();
	$tgtDbms = $tgtDb->dbms();
	$tgtColNames = array_values($colMap);
	$tgtColsQ = array();
	foreach ($tgtColNames as $c) $tgtColsQ[] = quoteCol($tgtDb, $c);
	$colStr = implode(',', $tgtColsQ);
	$tgtQt = quoteTable($tgtDb, $tgtTable);
	$inserted = 0;

	foreach (array_chunk($rows, $opt['batch']) as $batch) {
		$valueSets = array();
		$params = array();
		$pi = 1;

		foreach ($batch as $row) {
			$phs = array();
			foreach (array_keys($colMap) as $srcCol) {
				$val = array_key_exists($srcCol, $row) ? $row[$srcCol] : null;
				if ($tgtDbms === 'postgres') {
					$phs[] = '$' . $pi;
					$params[] = $val;
				} else {
					$phs[] = '?';
					$params[] = $val;
				}
				$pi++;
			}
			$valueSets[] = '(' . implode(',', $phs) . ')';
		}

		$ins = "INSERT INTO $tgtQt ($colStr) VALUES " . implode(',', $valueSets);
		if ($tgtDbms === 'postgres') $ins .= ' ON CONFLICT DO NOTHING';
		elseif ($tgtDbms === 'sqlite') $ins = str_replace('INSERT INTO', 'INSERT OR IGNORE INTO', $ins);
		elseif ($tgtDbms === 'mysql') $ins = str_replace('INSERT INTO', 'INSERT IGNORE INTO', $ins);

		try {
			$stmt = $tgtPdo->prepare($ins);
			$stmt->execute($params);
			$inserted += count($batch);
		} catch (Exception $e) {
			fwrite(STDERR, "    $srcTable batch error: " . $e->getMessage() . "\n");
		}
	}

	// Sequences
	if ($opt['resetSeq']) {
		resetSequences($tgtDb, $tgtTable, $tgtColNames);
	}

	out("    $srcTable → $tgtTable: $inserted/$total rows");
	return $inserted;
}

// ── Resolve Connections ──

function resolveConnections($opt) {
	$pairs = array();

	if ($opt['connections']) {
		$names = array_map('trim', explode(',', $opt['connections']));
	} else {
		$all = Q_Config::get('Db', 'connections', array());
		$names = array_diff(array_keys($all), array('*'));
	}

	foreach ($names as $cn) {
		$info = Db::getConnection($cn);
		if (!$info) continue;

		// Source
		if ($opt['source']) {
			$src = array_merge($info, array('dsn' => $opt['source']));
		} elseif ($opt['sourceConfig']) {
			$src = Db::getConnection($opt['sourceConfig']);
			if (!$src) { fwrite(STDERR, "Source config '{$opt['sourceConfig']}' not found.\n"); continue; }
			$src['prefix'] = $info['prefix'] ?? '';
		} else {
			$src = $info;
		}

		// Target
		if ($opt['target']) {
			$tgt = array_merge($info, array('dsn' => $opt['target']));
			if ($opt['targetUser']) $tgt['username'] = $opt['targetUser'];
			if ($opt['targetPass']) $tgt['password'] = $opt['targetPass'];
		} elseif ($opt['targetConfig']) {
			$tgt = Db::getConnection($opt['targetConfig']);
			if (!$tgt) { fwrite(STDERR, "Target config '{$opt['targetConfig']}' not found.\n"); continue; }
			$tgt['prefix'] = $info['prefix'] ?? '';
		} else {
			fwrite(STDERR, "No --target for '$cn'.\n");
			continue;
		}

		if (($src['dsn'] ?? '') === ($tgt['dsn'] ?? '')) continue;
		$pairs[$cn] = array('source' => $src, 'target' => $tgt);
	}
	return $pairs;
}

// ── Main ──

out("Qbix Database Migration Tool");
out("=============================");

$pairs = resolveConnections($opt);
if (empty($pairs)) {
	fwrite(STDERR, "No connections to migrate. Use --source/--target or --source-config/--target-config.\n");
	exit(1);
}

$grandTables = 0;
$grandRows = 0;
$grandErrors = 0;

$filterTables = $opt['tables'] ? array_map('trim', explode(',', $opt['tables'])) : null;
$excludeTables = $opt['exclude'] ? array_map('trim', explode(',', $opt['exclude'])) : array();

foreach ($pairs as $connName => $pair) {
	out("\nConnection: $connName");

	$srcName = 'migrate_src_' . $connName;
	Db::setConnection($srcName, $pair['source']);
	$srcDb = Db::connect($srcName);
	$srcDb->reallyConnect();
	$srcPrefix = $pair['source']['prefix'] ?? '';

	$tgtName = 'migrate_tgt_' . $connName;
	Db::setConnection($tgtName, $pair['target']);
	$tgtDb = Db::connect($tgtName);
	$tgtDb->reallyConnect();
	$tgtPrefix = $pair['target']['prefix'] ?? '';

	out("  Source: {$srcDb->dbms()}, prefix '$srcPrefix'");
	out("  Target: {$tgtDb->dbms()}, prefix '$tgtPrefix'");

	if ($opt['schemaOnly']) {
		out("  Schema-only mode. Run 'php scripts/app.php <APP_DIR> --plugins' with target config to create tables.");
		continue;
	}

	$srcTables = listTables($srcDb, $srcPrefix);
	$tgtTables = listTables($tgtDb, $tgtPrefix);
	$tgtByLower = array();
	foreach ($tgtTables as $t) $tgtByLower[strtolower($t)] = $t;

	out("  Migrating " . count($srcTables) . " tables...");

	foreach ($srcTables as $st) {
		if ($filterTables && !in_array($st, $filterTables)) continue;
		if (in_array($st, $excludeTables)) continue;

		$tgtTable = $tgtByLower[strtolower($st)] ?? null;
		if (!$tgtTable) {
			out("    $st: no target table — skip", true);
			continue;
		}

		try {
			$r = migrateTable($srcDb, $tgtDb, $st, $tgtTable, $opt);
			$grandTables++;
			$grandRows += $r;
		} catch (Exception $e) {
			fwrite(STDERR, "    $st: " . $e->getMessage() . "\n");
			$grandErrors++;
		}
	}

	// Verify
	if ($opt['verify'] && !$opt['dryRun']) {
		out("\n  Verifying...");
		$mismatches = 0;
		foreach ($srcTables as $st) {
			if ($filterTables && !in_array($st, $filterTables)) continue;
			if (in_array($st, $excludeTables)) continue;
			$tt = $tgtByLower[strtolower($st)] ?? null;
			if (!$tt) continue;
			$sc = countRows($srcDb, $st);
			$tc = countRows($tgtDb, $tt);
			if ($sc !== $tc) {
				out("    MISMATCH $st: source=$sc target=$tc");
				$mismatches++;
			} else {
				out("    OK $st: $sc rows", true);
			}
		}
		out($mismatches === 0 ? "  All counts match." : "  $mismatches mismatch(es).");
	}
}

out("\n" . ($opt['dryRun'] ? "[DRY RUN] " : "") . "Done.");
out("  Tables: $grandTables | Rows: $grandRows" . ($grandErrors ? " | Errors: $grandErrors" : ""));
exit($grandErrors > 0 ? 1 : 0);
