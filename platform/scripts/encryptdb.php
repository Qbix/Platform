<?php
$FROM_APP = defined('RUNNING_FROM_APP');
$argv = $_SERVER['argv'];
$count = count($argv);

// Usage & help
$usage = "Usage: php {$argv[0]} " . ($FROM_APP ? '' : '<app_root> ') . "[--dry-run|--run|--rollback|--drop] [--only=table1,table2] [--log=output.json] [--nobackup]";
if (!$FROM_APP) $usage .= PHP_EOL . PHP_EOL . '<app_root> must be a path to the application root directory';

$help = <<<EOT
Script to encrypt MySQL tables using ENCRYPTION='Y'.

$usage

Options:
  --dry-run        Show what would happen
  --run            Perform actual migration
  --rollback       Undo rename by restoring *_old backup tables
  --drop           Drop all *_old backup tables
  --nobackup       Don't keep backup; replaces table directly
  --only=TABLES    Comma-separated list of tables to operate on
  --log=FILE       Save actions to specified JSON log file
EOT;

if (isset($argv[1]) && in_array($argv[1], ['--help', '/?', '-h', '-?', '/h'])) die($help . PHP_EOL);

// Load app
if (!$FROM_APP && $count < 2) die($usage . PHP_EOL);
$LOCAL_DIR = $FROM_APP ? APP_DIR : $argv[1];
if (!is_dir($LOCAL_DIR)) die("[ERROR] $LOCAL_DIR is not a directory" . PHP_EOL);
if (!defined('APP_DIR')) define('APP_DIR', $LOCAL_DIR);
$Q_filename = dirname(__FILE__) . DIRECTORY_SEPARATOR . 'Q.inc.php';
if (!file_exists($Q_filename)) die("[ERROR] $Q_filename not found" . PHP_EOL);
require_once($Q_filename);

// Parse flags
$options = implode(' ', $argv);
$dryRun   = strpos($options, '--dry-run') !== false;
$run      = strpos($options, '--run') !== false;
$rollback = strpos($options, '--rollback') !== false;
$drop     = strpos($options, '--drop') !== false;
$nobackup = strpos($options, '--nobackup') !== false;

preg_match('/--only=([\w,]+)/', $options, $onlyMatch);
$onlyTables = isset($onlyMatch[1]) ? array_map('strtolower', array_map('trim', explode(',', $onlyMatch[1]))) : [];

preg_match('/--log=([\w.\-\/]+)/', $options, $logMatch);
$logFile = $logMatch[1] ?? null;
$log = [];

if (!$dryRun && !$run && !$rollback && !$drop) {
    echo "No mode passed. Defaulting to --run\n";
    $run = true;
}

function logmsg($msg) {
    global $log;
    echo $msg . PHP_EOL;
    $log[] = $msg;
}

echo "Starting encryption: " . date('Y-m-d H:i:s') . PHP_EOL;

$connections = Q_Config::get('Q', 'appInfo', 'connections', []);
$plugins = Q::plugins();

foreach ($connections as $conn) {
    if ($conn === '*') continue;

    echo "\n--- Processing [$conn] ---\n";

    try {
        $db = Db::connect($conn);
    } catch (Exception $e) {
        logmsg("Skipping [$conn]: " . $e->getMessage());
        continue;
    }

    // Check if encryption is supported
    try {
        $res = $db->query("SELECT @@have_encryption")->fetch(PDO::FETCH_NUM);
        if (!$res || strtoupper($res[0]) !== 'YES') {
            logmsg("[FATAL] MySQL ENCRYPTION is not available. Aborting.");
            exit(1);
        }
    } catch (PDOException $e) {
        logmsg("[FATAL] Could not check encryption support: " . $e->getMessage());
        exit(1);
    }

    $tables = $db->query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'")->fetchAll(PDO::FETCH_COLUMN);

    foreach ($tables as $table) {
        if ($drop && preg_match('/_old$/', $table)) {
            logmsg("Dropping backup table: $table");
            if (!$dryRun) $db->exec("DROP TABLE IF EXISTS `$table`");
            continue;
        }

        if (preg_match('/(_old|_new)$/', $table)) continue;
        if (!empty($onlyTables) && !in_array(strtolower($table), $onlyTables)) continue;

        $stmt = $db->query("SHOW CREATE TABLE `$table`");
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        $createSQL = $row['Create Table'] ?? null;
        if (!$createSQL) {
            logmsg("ERROR: Could not get CREATE TABLE for $table");
            continue;
        }

        $alreadyEncrypted = stripos($createSQL, 'ENCRYPTION=') !== false;
        $newTable = "{$table}_new";
        $oldTable = "{$table}_old";

        if ($rollback) {
            logmsg("Restoring $oldTable → $table");
            if (!$dryRun) {
                $db->exec("DROP TABLE IF EXISTS `$table`");
                $db->exec("RENAME TABLE `$oldTable` TO `$table`");
            }
            continue;
        }

        if ($alreadyEncrypted) {
            logmsg("Skipping $table (already encrypted)");
            continue;
        }

        logmsg("Encrypting $table");

        $modified = preg_replace('/;$/', '', $createSQL) . " ENCRYPTION='Y';";
        $createEncrypted = str_replace("CREATE TABLE `$table`", "CREATE TABLE `$newTable`", $modified);

        if ($dryRun) {
            logmsg("[DRY RUN] Would create $newTable, copy from $table, and swap");
            continue;
        }

        try {
            $db->exec("DROP TABLE IF EXISTS `$newTable`");
            $db->exec($createEncrypted);
            $db->exec("INSERT INTO `$newTable` SELECT * FROM `$table`");

            if ($nobackup) {
                $db->exec("DROP TABLE `$table`");
                $db->exec("RENAME TABLE `$newTable` TO `$table`");
            } else {
                $db->exec("RENAME TABLE `$table` TO `$oldTable`, `$newTable` TO `$table`");
            }

            logmsg("Encrypted and replaced $table");
        } catch (PDOException $e) {
            logmsg("Error on $table: " . $e->getMessage());
        }
    }

    logmsg("Finished [$conn]");
}

if ($logFile) {
    file_put_contents($logFile, json_encode($log, JSON_PRETTY_PRINT));
    logmsg("Log written to $logFile");
}

logmsg("Done.");
