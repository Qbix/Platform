<?php
include dirname(__FILE__).'/Q.inc.php';

$pass = 0; $fail = 0;
function t($name, $fn) {
	global $pass, $fail;
	try {
		$r = $fn();
		echo "[OK]   $name :: " . preg_replace('/\s+/', ' ', substr((string)$r, 0, 260)) . "\n";
		$pass++;
	} catch (Throwable $e) {
		echo "[FAIL] $name :: " . get_class($e) . ': ' . $e->getMessage() . "\n";
		$fail++;
	}
}

$db = Db::connect('Streams');
$p = Q_Config::get('Db','connections','Streams','prefix','streams_');

t('SELECT basic', function() use ($db,$p) { return $db->select('*', $p.'stream')->limit(1); });
t('SELECT where', function() use ($db,$p) { return $db->select('*', $p.'stream')->where(array('publisherId'=>'x')); });
t('SELECT where IN', function() use ($db,$p) { return $db->select('*', $p.'stream')->where(array('publisherId'=>array('a','b'))); });
t('SELECT where NULL', function() use ($db,$p) { return $db->select('*', $p.'stream')->where(array('publisherId'=>null)); });
t('SELECT where Range', function() use ($db,$p) { return $db->select('*', $p.'stream')->where(array('insertedTime'=>new Db_Range('2020-01-01', true, false, '2021-01-01'))); });
t('SELECT tuple IN', function() use ($db,$p) { return $db->select('*', $p.'stream')->where(array('publisherId,name'=>array(array('a','b'),array('c','d')))); });
t('SELECT expression', function() use ($db,$p) { return $db->select('*', $p.'stream')->where(new Db_Expression('1=1')); });
t('andWhere', function() use ($db,$p) { return $db->select('*', $p.'stream')->where(array('publisherId'=>'x'))->andWhere(array('name'=>'y')); });
t('orWhere', function() use ($db,$p) { return $db->select('*', $p.'stream')->where(array('publisherId'=>'x'))->orWhere(array('name'=>'y')); });
t('join', function() use ($db,$p) { return $db->select('*', $p.'stream s')->join($p.'message m', new Db_Expression('s.name = m.streamName')); });
t('groupBy+having', function() use ($db,$p) { return $db->select('publisherId, COUNT(1) c', $p.'stream')->groupBy('publisherId')->having(array('c'=>2)); });
t('orderBy', function() use ($db,$p) { return $db->select('*', $p.'stream')->orderBy('insertedTime', false); });
t('limit offset', function() use ($db,$p) { return $db->select('*', $p.'stream')->limit(10, 5); });
t('after()', function() use ($db,$p) { return $db->select('*', $p.'stream')->after('FROM', 'FORCE INDEX (PRIMARY)'); });
t('lock', function() use ($db,$p) { return $db->select('*', $p.'stream')->where(array('publisherId'=>'x'))->lock('FOR UPDATE'); });
t('INSERT', function() use ($db,$p) { return $db->insert($p.'stream', array('publisherId'=>'x','name'=>'y')); });
t('INSERT onDuplicateKeyUpdate', function() use ($db,$p) { return $db->insert($p.'stream', array('publisherId'=>'x','name'=>'y'))->onDuplicateKeyUpdate(array('name'=>'z')); });
t('UPDATE set', function() use ($db,$p) { return $db->update($p.'stream')->set(array('name'=>'z'))->where(array('publisherId'=>'x')); });
t('DELETE', function() use ($db,$p) { return $db->delete($p.'stream')->where(array('publisherId'=>'x')); });
t('rawQuery', function() use ($db) { return $db->rawQuery('SELECT 1 AS one'); });
t('begin', function() use ($db,$p) { return $db->select('*', $p.'stream')->where(array('publisherId'=>'x'))->begin(); });
t('commit', function() use ($db,$p) { return $db->select('*', $p.'stream')->where(array('publisherId'=>'x'))->commit(); });
t('getSQL', function() use ($db,$p) { return $db->select('*', $p.'stream')->where(array('publisherId'=>'x'))->getSQL(); });
t('copy()', function() use ($db,$p) { $q = $db->select('*', $p.'stream')->where(array('publisherId'=>'x')); $c = $q->copy(); return get_class($c).' '.$c->getSQL(); });
t('shard()', function() use ($db,$p) { $q = $db->select('*', $p.'stream')->where(array('publisherId'=>'x')); $s = $q->shard(); return 'keys=['.implode('|', array_keys($s)).'] classes='.implode(',', array_map('get_class', $s)); });
t('shardIndex()', function() use ($db,$p) { $q = $db->select('*', $p.'stream'); return var_export($q->shardIndex(), true); });

// ---- real execution ----
t('EXEC rawQuery', function() use ($db) { $r = $db->rawQuery('SELECT 1 AS one')->execute()->fetchAll(PDO::FETCH_ASSOC); return json_encode($r); });
t('EXEC select fetchAll', function() use ($db,$p) { $r = $db->select('*', $p.'stream')->limit(3)->fetchAll(PDO::FETCH_ASSOC); return 'rows='.count($r); });
t('EXEC Streams_Stream::select', function() { $r = Streams_Stream::select()->limit(3)->fetchDbRows(); return 'rows='.count($r); });
t('EXEC insert+update+delete roundtrip', function() use ($db,$p) {
	$db->rawQuery("DELETE FROM {$p}stream WHERE publisherId='dbtest'")->execute();
	$db->insert($p.'stream', array(
		'publisherId'=>'dbtest','name'=>'Streams/dbtest','type'=>'Streams/text',
		'title'=>'t','content'=>'','insertedTime'=>new Db_Expression('CURRENT_TIMESTAMP')
	))->execute();
	$db->update($p.'stream')->set(array('title'=>'t2'))->where(array('publisherId'=>'dbtest'))->execute();
	$rows = $db->select('title', $p.'stream')->where(array('publisherId'=>'dbtest'))->fetchAll(PDO::FETCH_ASSOC);
	$got = $rows[0]['title'];
	$db->delete($p.'stream')->where(array('publisherId'=>'dbtest'))->execute();
	$after = $db->select('1', $p.'stream')->where(array('publisherId'=>'dbtest'))->fetchAll(PDO::FETCH_ASSOC);
	return "updatedTitle=$got remaining=".count($after);
});
t('EXEC Db_Row save/retrieve/remove', function() {
	$s = new Streams_Stream();
	$s->publisherId = 'dbtest'; $s->name = 'Streams/dbtest2';
	$s->type = 'Streams/text'; $s->title = 'row';
	$s->save(true);
	$s2 = new Streams_Stream(); $s2->publisherId='dbtest'; $s2->name='Streams/dbtest2';
	$found = $s2->retrieve();
	$title = $found ? $found->title : 'NOT FOUND';
	$s->remove();
	return "title=$title";
});

t('repeated named parameter fully substituted', function() use ($db) {
	$q = $db->rawQuery("SELECT :x AS a, :x AS b"); $q->bind(array('x'=>'HELLO'));
	$sql = $q->getSQL();
	if (strpos($sql, ':x') !== false) throw new Exception("left unsubstituted: $sql");
	return $sql; });
t(':p1 does not match inside :p10', function() use ($db) {
	$q = $db->rawQuery("SELECT :p10 AS a, :p1 AS b");
	$q->bind(array('p1'=>'ONE','p10'=>'TEN'));
	$sql = $q->getSQL();
	if (!preg_match("/'TEN' AS a/", $sql) or !preg_match("/'ONE' AS b/", $sql)) {
		throw new Exception($sql);
	}
	return $sql; });
t('$ and backslashes in values survive substitution', function() use ($db) {
	$q = $db->rawQuery("SELECT :v AS a");
	$q->bind(array('v'=>'it\'s $1 & 100% \\ done'));
	$sql = $q->getSQL();
	if (strpos($sql, '$1') === false) throw new Exception("lost \$1: $sql");
	return $sql; });

t('limit(0) means zero rows, not all rows', function() use ($db) {
	$sql = (string)$db->select('*', 'streams_stream')->limit(0);
	if (strpos($sql, 'LIMIT 0') === false) {
		throw new Exception('LIMIT 0 dropped (empty("0") is true in PHP): '.$sql);
	}
	return preg_replace('/\s+/', ' ', trim($sql)); });
t('EXEC limit(0) returns no rows', function() use ($db) {
	$n = count($db->select('*', 'streams_stream')->limit(0)->fetchAll(PDO::FETCH_ASSOC));
	if ($n !== 0) throw new Exception("returned $n rows");
	return 'rows=0'; });
t('normalize/hashCode/hash reference values', function() {
	if (Db::normalize('Ünïcode/x') !== '_n_code_x') throw new Exception(Db::normalize('Ünïcode/x'));
	if (Db::hashCode('hello') !== 99162322) throw new Exception('hashCode='.Db::hashCode('hello'));
	if (Db::hash('hello') !== '5d41402abc4b2a76b9719d911017c592') throw new Exception('hash mismatch');
	return 'match the JS twins'; });

echo "\n==== PHP: $pass passed, $fail failed ====\n";
