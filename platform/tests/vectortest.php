<?php
include dirname(__FILE__).'/Q.inc.php';
$pass=0; $fail=0; $failures=array();
function t($name,$fn){ global $pass,$fail,$failures; try{ $r=$fn();
  echo "[OK]   $name :: ".preg_replace('/\s+/',' ',substr((string)$r,0,220))."\n"; $pass++; }
  catch(Throwable $e){ echo "[FAIL] $name :: ".$e->getMessage()."\n"; $failures[]=$name; $fail++; } }

t('construct from array', function(){ $v=Db::vector(array(1,2,3)); if($v->dimensions()!==3) throw new Exception('dims'); return $v->toText(); });
t('default metric cosine', function(){ if(Db::vector(array(1,0))->metric!=='cosine') throw new Exception('x'); return 'cosine'; });
t('parses string form', function(){ return Db::vector('[1,2,3]')->toText(); });
t('rejects unknown metric', function(){ try{ Db::vector(array(1,0),'manhattan'); }catch(Exception $e){ return 'rejected'; } throw new Exception('should throw'); });
t('rejects empty vector', function(){ try{ Db::vector(array()); }catch(Exception $e){ return 'rejected'; } throw new Exception('should throw'); });
t('normalize unit length', function(){ $v=Db::vector(array(3,4),'cosine',array('normalize'=>true));
  $len=sqrt($v->values[0]**2+$v->values[1]**2); if(abs($len-1)>1e-9) throw new Exception("len=$len"); return $v->toText(); });
t('normalize tolerates zero', function(){ $v=Db::vector(array(0,0),'cosine',array('normalize'=>true));
  foreach($v->values as $x){ if(is_nan($x)) throw new Exception('NaN'); } return $v->toText(); });
t('binary round-trip', function(){ $v=Db::vector(array(0.5,-0.25,0.125));
  $r=Db_Vector::fromBinary($v->toBinary()); if($r->toText()!==$v->toText()) throw new Exception($r->toText()); return $r->toText(); });
t('records model', function(){ return Db::vector(array(1,0),'cosine',array('model'=>'nomic-embed-text'))->model; });

// SQL generation
$db=Db::connect('Streams');
t('MariaDB VEC_DISTANCE_COSINE', function() use($db){
  $q=$db->select('*','streams_stream')->where(array('publisherId'=>'Hebrews'));
  $r=new ReflectionMethod($q,'vectorDistance_expression'); $r->setAccessible(true);
  $e=$r->invoke($q,'embedding',Db::vector(array(1,0,0,0)));
  if(strpos($e,'VEC_DISTANCE_COSINE')===false) throw new Exception($e);
  if(strpos($e,'VEC_FromText')===false) throw new Exception('not bound');
  return $e; });
t('MariaDB euclidean', function() use($db){
  $q=$db->select('*','streams_stream');
  $r=new ReflectionMethod($q,'vectorDistance_expression'); $r->setAccessible(true);
  return $r->invoke($q,'embedding',Db::vector(array(1,0),'euclidean')); });
t('MariaDB rejects dot', function() use($db){
  $q=$db->select('*','streams_stream');
  $r=new ReflectionMethod($q,'vectorDistance_expression'); $r->setAccessible(true);
  try{ $r->invoke($q,'embedding',Db::vector(array(1,0),'dot')); }catch(Exception $e){ return 'rejected'; }
  throw new Exception('should throw'); });
t('refuses without server support', function() use($db){
  $q=$db->select('*','streams_stream');
  if($q->vectorsSupported()) return 'server supports vectors (MariaDB 11.7+)';
  try{ $q->vectorNearestTo('embedding',Db::vector(array(1,0))); }catch(Exception $e){ return 'refused'; }
  throw new Exception('should throw'); });
t('vectorsSupported probes server', function() use($db){
  return 'vectorsSupported='.var_export($db->vectorsSupported(),true).' (VERSION='.
    $db->rawQuery('SELECT VERSION() v')->fetchAll(PDO::FETCH_ASSOC)[0]['v'].')'; });
echo "\n==== PHP vectors: $pass passed, $fail failed ====\n";
if($failures) echo "failed: ".implode(', ',$failures)."\n";

// vector as an ordinary column value must survive parameter binding
$pass2=0;$fail2=0;
function t2($n,$f){ global $pass2,$fail2; try{ $r=$f(); echo "[OK]   $n :: ".substr((string)$r,0,180)."\n"; $pass2++; }
  catch(Throwable $e){ echo "[FAIL] $n :: ".$e->getMessage()."\n"; $fail2++; } }
t2('vectorLiteral wraps for MariaDB', function() use($db){
  $q=$db->select('*','streams_stream');
  $lit=$q->vectorLiteral(Db::vector(array(1,0,0,0)));
  if(!($lit instanceof Db_Expression)) throw new Exception('not an expression');
  if(strpos((string)$lit,'VEC_FromText')===false) throw new Exception((string)$lit);
  return (string)$lit; });
t2('vectorParametersPrepare converts', function() use($db){
  $q=$db->insert('streams_stream', array('publisherId'=>'x','name'=>'y'));
  $q->parameters['embedding']=Db::vector(array(1,0,0,0));
  $r=new ReflectionMethod($q,'vectorParametersPrepare'); $r->setAccessible(true); $r->invoke($q);
  $v=$q->parameters['embedding'];
  if($v instanceof Db_Vector) throw new Exception('still a Db_Vector');
  return get_class($v).' => '.(string)$v; });
echo "\n==== PHP vector params: $pass2 passed, $fail2 failed ====\n";

// version gate: the "5.5.5-" prefix MariaDB sends would otherwise read as 5.5
$pass3=0;$fail3=0;
foreach (array(
  array('5.5.5-10.11.14-MariaDB', false), array('5.5.5-11.8.2-MariaDB', true),
  array('11.7.1-MariaDB', true), array('5.5.5-11.6.0-MariaDB', false),
  array('10.11.14-MariaDB-0ubuntu0.24.04.1', false),
  array('9.1.0', false), array('8.0.36', false), array('', false),
) as $c) {
  $got = Db_Mysql::vectorsSupportedInVersion($c[0]);
  if ($got === $c[1]) { echo "[OK]   version gate '{$c[0]}' -> ".var_export($got,true)."\n"; $pass3++; }
  else { echo "[FAIL] version gate '{$c[0]}' -> ".var_export($got,true)."\n"; $fail3++; }
}
echo "\n==== PHP version gate: $pass3 passed, $fail3 failed ====\n";

// method-name parity with the JS twin
$pass4=0;$fail4=0;
$v = Db::vector(array(1,0));
foreach (array('dimensions','toText','toBinary') as $m) {
  if (method_exists($v,$m)) { echo "[OK]   Db_Vector::$m exists\n"; $pass4++; }
  else { echo "[FAIL] Db_Vector::$m missing\n"; $fail4++; }
}
foreach (array('fromBinary','normalize') as $m) {
  if (method_exists('Db_Vector',$m)) { echo "[OK]   Db_Vector::$m (static) exists\n"; $pass4++; }
  else { echo "[FAIL] Db_Vector::$m missing\n"; $fail4++; }
}
$q = Db::connect('Streams')->select('*','streams_stream');
foreach (array('vectorNearestTo','vectorsSupported','vectorMetricsSupported','vectorLiteral') as $m) {
  if (method_exists($q,$m)) { echo "[OK]   Db_Query::$m exists\n"; $pass4++; }
  else { echo "[FAIL] Db_Query::$m missing\n"; $fail4++; }
}
foreach (array('vectorIndexCreate','vectorIndexDrop','vectorIndexMetric','vectorsSupported') as $m) {
  if (method_exists('Db_Mysql',$m) and method_exists('Db_Postgres',$m) and method_exists('Db_Sqlite',$m)) {
    echo "[OK]   $m on all three adapters\n"; $pass4++;
  } else { echo "[FAIL] $m missing from an adapter\n"; $fail4++; }
}
// every method we added must start with "vector", so they group in autocomplete
$added = array(
  'Db_Query' => array('vectorNearestTo','vectorsSupported','vectorMetricsSupported','vectorLiteral'),
  'Db_Mysql' => array('vectorsSupported','vectorsSupportedInVersion','vectorIndexCreate','vectorIndexDrop','vectorIndexMetric'),
  'Db_Sqlite' => array('vectorsSupported','vectorExtensionLoad','vectorIndexCreate','vectorIndexDrop','vectorIndexMetric','vectorIndexDrift'),
  'Db_Postgres' => array('vectorsSupported','vectorSupportCheck','vectorIndexCreate','vectorIndexDrop','vectorIndexMetric'),
);
foreach ($added as $cls => $methods) {
  $bad = array();
  foreach ($methods as $m) {
    if (strpos($m, 'vector') !== 0) { $bad[] = "$m not prefixed"; }
    else if (!method_exists($cls, $m) and !method_exists('Db_Query_Mysql', $m)) { $bad[] = "$m missing"; }
  }
  if ($bad) { echo "[FAIL] $cls: ".implode(', ', $bad)."\n"; $fail4++; }
  else { echo "[OK]   $cls: all ".count($methods)." vector methods prefixed and present\n"; $pass4++; }
}
// the fluent alias still resolves
$q2 = Db::connect('Streams')->select('*','streams_stream');
if (method_exists($q2,'nearestTo')) { echo "[OK]   nearestTo alias present\n"; $pass4++; }
else { echo "[FAIL] nearestTo alias missing\n"; $fail4++; }
echo "\n==== PHP name parity: $pass4 passed, $fail4 failed ====\n";
