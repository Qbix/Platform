<?php
// Integration test: vector search through the MODEL layer, the way an app
// actually uses it -- generated Base classes, ->save(), ->retrieve(),
// Model::select()->vectorNearestTo()->fetchDbRows() -- not raw db->select().
include dirname(__FILE__).'/Q.inc.php';

$pass = 0; $fail = 0; $failures = array();
function t($name, $fn) {
	global $pass, $fail, $failures;
	try {
		$r = $fn();
		echo "[OK]   $name :: " . preg_replace('/\s+/', ' ', substr((string)$r, 0, 200)) . "\n";
		$pass++;
	} catch (Throwable $e) {
		echo "[FAIL] $name :: " . $e->getMessage() . "\n";
		$failures[] = $name; $fail++;
	}
}

// deterministic stand-in embedder, identical to the JS one
function embed($text) {
	$DIM = 768;
	$v = array_fill(0, $DIM, 0.0);
	$s = ' ' . preg_replace('/[^a-z0-9 ]/', '', strtolower($text)) . ' ';
	for ($i = 0; $i + 3 <= strlen($s); ++$i) {
		$g = substr($s, $i, 3); $h = 5381;
		for ($j = 0; $j < strlen($g); ++$j) {
			$h = (($h * 33) ^ ord($g[$j])) & 0xFFFFFFFF;
		}
		$v[$h % $DIM] += 1;
	}
	$n = 0; foreach ($v as $x) { $n += $x * $x; }
	$n = sqrt($n) ?: 1;
	foreach ($v as $k => $x) { $v[$k] = $x / $n; }
	return $v;
}

$CORPUS = array(
	array('Hebrews', 'Warm cat',      'the cat sat on the warm mat'),
	array('Hebrews', 'Napping cat',   'a cat naps on a warm rug'),
	array('Hebrews', 'Migration ran', 'she deployed the database migration'),
	array('Other',   'Migration back','he rolled back the database migration'),
	array('Other',   'Earnings',      'earnings report beat analyst estimates'),
);

$db = Db::connect('Hebrews');
$db->rawQuery("DELETE FROM hebrews_document")->execute();

t('model class exists and is a Db_Row', function () {
	$d = new Hebrews_Document();
	if (!($d instanceof Db_Row)) throw new Exception('not a Db_Row');
	return get_class($d);
});

t('generated maxDimensions accessor', function () {
	$d = new Hebrews_Document();
	if (!method_exists($d, 'maxDimensions_embedding')) {
		throw new Exception('maxDimensions_embedding was not generated');
	}
	$n = $d->maxDimensions_embedding();
	if ($n !== 768) throw new Exception("expected 768, got $n");
	return "maxDimensions_embedding() = $n";
});

t('beforeSet coerces a plain array to Db_Vector', function () {
	$d = new Hebrews_Document();
	$d->embedding = embed('hello world');
	if (!($d->embedding instanceof Db_Vector)) {
		throw new Exception('got ' . gettype($d->embedding));
	}
	return 'coerced to Db_Vector, dims=' . $d->embedding->dimensions();
});

t('beforeSet rejects the wrong dimension count', function () {
	$d = new Hebrews_Document();
	try {
		$d->embedding = array(1, 2, 3);
	} catch (Exception $e) {
		return 'rejected: ' . $e->getMessage();
	}
	throw new Exception('should have rejected a 3-dim vector');
});

t('save() persists a row with a vector', function () use ($CORPUS) {
	foreach ($CORPUS as $i => $row) {
		$d = new Hebrews_Document();
		$d->publisherId = $row[0];
		$d->title = $row[1];
		$d->body = $row[2];
		$d->embeddingModel = 'stub-768';
		$d->embedding = embed($row[2]);
		$d->save();
	}
	$n = count(Hebrews_Document::select()->fetchDbRows());
	if ($n !== count($CORPUS)) throw new Exception("expected " . count($CORPUS) . " rows, got $n");
	return "$n rows saved via ->save()";
});

t('retrieve() round-trips the vector', function () {
	$rows = Hebrews_Document::select()->where(array('title' => 'Warm cat'))->fetchDbRows();
	if (!$rows) throw new Exception('row not found');
	$d = reset($rows);
	$want = embed('the cat sat on the warm mat');
	$got = $d->embedding;
	if (is_string($got)) {
		// engines hand back their own wire form; normalize for comparison
		$got = (strpos($got, '[') === 0)
			? new Db_Vector($got)
			: Db_Vector::fromBinary($got);
	}
	if (!($got instanceof Db_Vector)) throw new Exception('got ' . gettype($d->embedding));
	if ($got->dimensions() !== 768) throw new Exception('dims=' . $got->dimensions());
	for ($k = 0; $k < 768; ++$k) {
		if (abs($got->values[$k] - $want[$k]) > 1e-6) {
			throw new Exception("component $k differs");
		}
	}
	return 'all 768 components match after retrieve()';
});

t('Model::select()->vectorNearestTo()->fetchDbRows()', function () {
	$rows = Hebrews_Document::select()
		->vectorNearestTo('embedding', Db::vector(embed('the cat sat on the warm mat')), array('limit' => 2))
		->fetchDbRows();
	$got = array();
	foreach ($rows as $r) { $got[] = $r->title; }
	if ($got[0] !== 'Warm cat') throw new Exception('self not first: ' . implode('|', $got));
	if ($got[1] !== 'Napping cat') throw new Exception('wrong neighbour: ' . $got[1]);
	return implode(' | ', $got);
});

t('rows come back as model instances, not arrays', function () {
	$rows = Hebrews_Document::select()
		->vectorNearestTo('embedding', Db::vector(embed('database migration')), array('limit' => 1))
		->fetchDbRows();
	$r = reset($rows);
	if (!($r instanceof Hebrews_Document)) throw new Exception('got ' . get_class($r));
	return get_class($r) . ' title=' . $r->title;
});

t('where() + vectorNearestTo() compose on the model', function () {
	$rows = Hebrews_Document::select()
		->where(array('publisherId' => 'Hebrews'))
		->vectorNearestTo('embedding', Db::vector(embed('database migration')), array('limit' => 5))
		->fetchDbRows();
	foreach ($rows as $r) {
		if ($r->publisherId !== 'Hebrews') throw new Exception('filter leaked');
	}
	$first = reset($rows);
	if ($first->title !== 'Migration ran') throw new Exception('wrong top hit: ' . $first->title);
	return count($rows) . ' rows, all Hebrews, top=' . $first->title;
});

t('remove() takes the row out of search', function () {
	$rows = Hebrews_Document::select()->where(array('title' => 'Napping cat'))->fetchDbRows();
	$d = reset($rows);
	$d->remove();
	$after = Hebrews_Document::select()
		->vectorNearestTo('embedding', Db::vector(embed('the cat sat on the warm mat')), array('limit' => 5))
		->fetchDbRows();
	foreach ($after as $r) {
		if ($r->title === 'Napping cat') throw new Exception('removed row still searchable');
	}
	return count($after) . ' rows remain, removed row gone';
});

t('save() on an existing row updates the vector', function () {
	$rows = Hebrews_Document::select()->where(array('title' => 'Earnings'))->fetchDbRows();
	$d = reset($rows);
	$newBody = 'entirely unrelated astronomy telescope nebula';
	$d->body = $newBody;
	$d->embedding = embed($newBody);
	$d->save();
	$hit = Hebrews_Document::select()
		->vectorNearestTo('embedding', Db::vector(embed($newBody)), array('limit' => 1))
		->fetchDbRows();
	$top = reset($hit);
	if ($top->title !== 'Earnings') throw new Exception('update not reflected: ' . $top->title);
	return 'ranking follows the updated vector';
});

t('dimension mismatch is refused, not silently wrong', function () {
	try {
		Hebrews_Document::select()
			->vectorNearestTo('embedding', Db::vector(array(1,0,0,0)), array('limit' => 1));
	} catch (Exception $e) {
		if (strpos($e->getMessage(), '768-dimensional') === false) {
			throw new Exception('unexpected message: '.$e->getMessage());
		}
		return 'refused: '.substr($e->getMessage(), 0, 70);
	}
	throw new Exception('a 4-dim query against a VECTOR(768) column was allowed;'
		.' the engine returns every row with a NULL distance in arbitrary order');
});
t('correct dimensions still pass', function () {
	$q = Hebrews_Document::select()
		->vectorNearestTo('embedding', Db::vector(array_fill(0, 768, 0.1)), array('limit' => 1));
	return 'accepted';
});

echo "\n==== model-layer integration: $pass passed, $fail failed ====\n";
if ($failures) echo "failed:\n  " . implode("\n  ", $failures) . "\n";
exit($fail ? 1 : 0);
