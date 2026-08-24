<?php
// Verifies a VECTOR column that arrived via the install.php migration path
// is fully usable: model generated, save/search work, index is the one the
// migration declared.
include dirname(__FILE__).'/Q.inc.php';
$pass=0;$fail=0;$f=array();
function t($n,$fn){global $pass,$fail,$f;try{$r=$fn();
 echo "[OK]   $n :: ".preg_replace('/\s+/',' ',substr((string)$r,0,180))."\n";$pass++;}
 catch(Throwable $e){echo "[FAIL] $n :: ".$e->getMessage()."\n";$f[]=$n;$fail++;}}
function embed($text){$D=768;$v=array_fill(0,$D,0.0);
 $s=' '.preg_replace('/[^a-z0-9 ]/','',strtolower($text)).' ';
 for($i=0;$i+3<=strlen($s);++$i){$g=substr($s,$i,3);$h=5381;
  for($j=0;$j<strlen($g);++$j){$h=(($h*33)^ord($g[$j]))&0xFFFFFFFF;}$v[$h%$D]+=1;}
 $n=0;foreach($v as $x){$n+=$x*$x;}$n=sqrt($n)?:1;
 foreach($v as $k=>$x){$v[$k]=$x/$n;}return $v;}

$db = Db::connect('Hebrews');
t('migration created the table', function() use($db){
  $r=$db->rawQuery("SHOW TABLES LIKE 'hebrews_note'")->fetchAll(PDO::FETCH_NUM);
  if(!$r) throw new Exception('hebrews_note not found');
  return 'hebrews_note exists'; });
t('column is a real VECTOR(768)', function() use($db){
  $r=$db->rawQuery("SHOW COLUMNS FROM hebrews_note LIKE 'embedding'")->fetchAll(PDO::FETCH_ASSOC);
  if(!$r) throw new Exception('embedding column missing');
  if(stripos($r[0]['Type'],'vector(768)')===false) throw new Exception('type is '.$r[0]['Type']);
  return $r[0]['Type']; });
t('index survives with the declared metric', function() use($db){
  $m=$db->vectorIndexMetric('hebrews_note','embedding');
  if($m!=='cosine') throw new Exception('metric is '.var_export($m,true));
  return "cosine"; });
t('model class was generated for it', function(){
  if(!class_exists('Hebrews_Note')) throw new Exception('Hebrews_Note not generated');
  $n=new Hebrews_Note();
  if(!method_exists($n,'maxDimensions_embedding')) throw new Exception('no maxDimensions_embedding');
  return 'Hebrews_Note, maxDimensions_embedding()='.$n->maxDimensions_embedding(); });
t('save + search on the migrated table', function() use($db){
  $db->rawQuery("DELETE FROM hebrews_note")->execute();
  foreach(array('the cat sat on the warm mat','a cat naps on a warm rug',
                'she deployed the database migration') as $body){
    $n=new Hebrews_Note(); $n->publisherId='Hebrews'; $n->body=$body;
    $n->embeddingModel='stub-768'; $n->embedding=embed($body); $n->save();
  }
  $rows=Hebrews_Note::select()
    ->vectorNearestTo('embedding', Db::vector(embed('the cat sat on the warm mat')), array('limit'=>2))
    ->fetchDbRows();
  $got=array(); foreach($rows as $r){$got[]=$r->body;}
  if($got[0]!=='the cat sat on the warm mat') throw new Exception('self not first: '.implode('|',$got));
  if($got[1]!=='a cat naps on a warm rug') throw new Exception('wrong neighbour: '.$got[1]);
  return implode(' | ',$got); });
echo "\n==== migration path: $pass passed, $fail failed ====\n";
if($f) echo "failed: ".implode(', ',$f)."\n";
exit($fail?1:0);
