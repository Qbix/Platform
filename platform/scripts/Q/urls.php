<?php
$FROM_APP = defined('RUNNING_FROM_APP');

$argv = $_SERVER['argv'];
$count = count($argv);

$usage = "Usage: php {$argv[0]} " . ($FROM_APP ? '' : '<app_root> ');
if(!$FROM_APP)
	$usage.=PHP_EOL.PHP_EOL.'<app_root> must be a path to the application root directory';

$help = <<<EOT
Script to update information for cache url rewriting

1) Checks modified times of files in \$app_dir/web, and \$plugin_dir/web for each plugin
2) Caches this information in \$app_dir/config/Q/urls.php, for use during requests

$usage

EOT;

if (isset($argv[1]) and in_array($argv[1], array('--help', '/?', '-h', '-?', '/h')))
	die($help);

if ($count < 1 or !$FROM_APP)
	die($usage);

$LOCAL_DIR = $FROM_APP ? APP_DIR : $argv[1];

$longopts = array('integrity', 'timestamps');
$options = getopt('it', $longopts);
if (isset($options['help'])) { echo $help; exit; }

if (!file_exists($Q_filename = dirname(__FILE__) . DIRECTORY_SEPARATOR . 'Q.inc.php'))
	die("[ERROR] $Q_filename not found" . PHP_EOL);

if (!is_dir($LOCAL_DIR))
	die("[ERROR] $LOCAL_DIR doesn't exist or is not a directory" . PHP_EOL);

if (!defined('APP_DIR'))
	define('APP_DIR', $LOCAL_DIR);

include($Q_filename);

$snapshot = new Q_Snapshot(
	'urls',
	APP_CONFIG_DIR.DS.'Q',
	APP_WEB_DIR.DS.'Q'.DS.'urls'
);

$result = null;
Q_script_urls_glob(APP_WEB_DIR, null, 'sha256', null, $result, $snapshot);
$snapshot->save($result);
echo PHP_EOL;
$snapshot->diffs($result);
echo PHP_EOL;
Q_Cache::clear(true);

function Q_script_urls_glob(
	$dir, $ignore, $algo, $len, &$result, $snapshot, $levels = 0
) {
	global $options;
	if (!empty($options['i']) or !empty($options['integrity'])) {
		$calculateHashes = true;
	} else if ($environment = Q_Config::get('Q', 'environment', '')) {
		$calculateHashes = Q_Config::get(
			'Q', 'environments', $environment, 'urls', 'integrity', false
		);
	} else {
		$calculateHashes = false;
	}

	if (!$calculateHashes && !glob($snapshot->entriesDir().DS.'*')) {
		if (empty($options['t']) and empty($options['timestamps'])) {
			return $result = array();
		}
	}

	static $n = 0, $i = 0;
	if (!isset($result)) {
		$result = array();
		$len = strlen($dir);
	}
	$tree = new Q_Tree($result);
	$filenames = glob($dir.DS.'*');
	foreach ($filenames as $f) {
		$u = substr($f, $len+1);
		$v = str_replace(DS, '/', $u);
		$ignore = Q_Config::get('Q', 'urls', 'ignore', array());
		if (in_array($v, $ignore)) continue;
		$ext = pathinfo($u, PATHINFO_EXTENSION);
		if ($ext === 'php') continue;
		if (!is_dir($f)) {
			if (is_array($ignore) and in_array($ext, $ignore)) continue;
			if (filesize($f) > Q_Config::get(
				'Q', 'urls', 'script', 'maxFilesize', pow(2, 20)*10
			)) continue;
			$mt = filemtime($f);
			$t = $snapshot->time;
			if ($calculateHashes) {
				$c = file_get_contents($f);
				$h = Q_Snapshot::hash($c, $algo);
				if (!$snapshot->changed($u, $h, $mt)) continue;
				$value = compact('t', 'h');
			} else if (!$snapshot->changed($u, '', $mt)) {
				continue;
			} else {
				$value = compact('t');
			}
			$parts = explode(DS, $u);
			$parts[] = $value;
			call_user_func_array(array($tree, 'set'), $parts);
		}
		++$n;
		$is_link = is_link($f) ? 1 : 0;
		if ($levels <= 2 or !$is_link) {
			Q_script_urls_glob($f, $ignore, $algo, $len, $result, $snapshot, $levels + $is_link);
		}
		++$i;
		echo "\033[100D";
		echo "Processed $i of $n files                 ";
	}
	gc_collect_cycles();
	return $result;
}
