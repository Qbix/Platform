// End-to-end: realistic 768-dim embeddings, inserted THROUGH the Db layer
// (not raw SQL), searched via vectorNearestTo, with semantic ranking asserted.
// Mirrors what an app doing Streams search would actually do.
require('./Q.inc')(function (Q) {
	var Db = Q.require('Db');
	var pass = 0, fail = 0, failures = [];

	function t(name, fn) {
		try {
			var r = fn();
			console.log('[OK]   ' + name + ' :: ' + String(r === undefined ? '' : r).slice(0, 200));
			pass++;
		} catch (e) {
			console.log('[FAIL] ' + name + ' :: ' + (e && (e.message || e)));
			failures.push(name); fail++;
		}
	}
	function ta(name, fn) {
		return new Promise(function (resolve) {
			var done = false;
			var timer = setTimeout(function () {
				if (done) return; done = true;
				console.log('[FAIL] ' + name + ' :: TIMEOUT'); failures.push(name); fail++; resolve();
			}, 30000);
			function finish(err, res) {
				if (done) return; done = true; clearTimeout(timer);
				if (err) { console.log('[FAIL] ' + name + ' :: ' + (err.message || err)); failures.push(name); fail++; }
				else { console.log('[OK]   ' + name + ' :: ' + String(res === undefined ? '' : res).slice(0, 200)); pass++; }
				resolve();
			}
			try { fn(finish); } catch (e) { finish(e); }
		});
	}

	var DIM = 768;   // nomic-embed-text

	// A deterministic stand-in for a real embedder. Ollama isn't reachable
	// from this container, so this produces stable 768-dim unit vectors whose
	// cosine similarity tracks token overlap -- enough to assert that
	// semantically closer documents actually rank higher.
	// Stopwords are dropped: without this, "the cat sat on the warm mat" and
	// "the dog barked at the mailman" score as near-neighbours purely on shared
	// function words, which a real embedder would not do.
	var STOP = {the:1, a:1, an:1, on:1, at:1, of:1, to:1, in:1, and:1, is:1, it:1};
	function embed(text) {
		var v = new Array(DIM);
		for (var i = 0; i < DIM; ++i) v[i] = 0;
		var tokens = text.toLowerCase().split(/\W+/).filter(function (w) {
			return w && !STOP[w];
		});
		tokens.forEach(function (tok) {
			var h = 2166136261;
			for (var i = 0; i < tok.length; ++i) {
				h ^= tok.charCodeAt(i); h = Math.imul(h, 16777619);
			}
			for (var j = 0; j < 8; ++j) {
				var idx = Math.abs((h + Math.imul(j, 2654435761)) % DIM);
				v[idx] += ((h >> j) & 1) ? 1 : -1;
			}
		});
		return Db.vector(v, 'cosine', {normalize: true, model: 'stub-768'});
	}

	var CORPUS = [
		'the cat sat on the warm mat',
		'a cat naps on a warm rug',
		'kittens sleep on soft blankets',
		'quarterly revenue exceeded projections',
		'earnings report beat analyst estimates',
		'the pitcher threw a fastball',
		'baseball season opens next week',
		'she deployed the database migration',
		'rolling out schema changes to production',
		'the dog barked at the mailman'
	];

	Db.setConnection('E2ePg', {
		dsn: 'pgsql:host=127.0.0.1;port=5432;dbname=qbixtest',
		username: 'qbix', password: 'qbixpass', prefix: 'e2e_'
	});
	Db.setConnection('E2eSq', {dsn: 'sqlite:/tmp/e2e_full.db', prefix: 'e2e_'});

	(async function () {

	// ================= embedder sanity =================
	console.log('\n########## embedder ##########');
	t('produces ' + DIM + '-dim unit vectors', function () {
		var v = embed('the cat sat on the warm mat');
		if (v.dimensions() !== DIM) throw new Error('dims=' + v.dimensions());
		var len = Math.sqrt(v.values.reduce(function (a, x) { return a + x * x; }, 0));
		if (Math.abs(len - 1) > 1e-6) throw new Error('not unit: ' + len);
		return 'dim=' + DIM + ' |v|=' + len.toFixed(6);
	});
	t('is deterministic', function () {
		if (embed('hello world').toText() !== embed('hello world').toText()) {
			throw new Error('not deterministic');
		}
		return 'stable';
	});
	t('similar text is closer than unrelated text', function () {
		function cos(a, b) {
			var s = 0; for (var i = 0; i < DIM; ++i) s += a.values[i] * b.values[i]; return s;
		}
		var q = embed('the cat sat on the warm mat');
		var near = cos(q, embed('a cat naps on a warm rug'));
		var far = cos(q, embed('quarterly revenue exceeded projections'));
		if (!(near > far)) throw new Error('near=' + near + ' far=' + far);
		return 'near=' + near.toFixed(3) + ' > far=' + far.toFixed(3);
	});

	// ================= POSTGRES end to end =================
	console.log('\n########## end-to-end: pgvector, ' + DIM + ' dims ##########');
	var pg = Db.connect('E2ePg');

	await ta('create table with vector(' + DIM + ') + HNSW index', function (cb) {
		pg.rawQuery(
			'DROP TABLE IF EXISTS e2e_docs; '
			+ 'CREATE TABLE e2e_docs ('
			// quote the camelCase columns: Postgres folds unquoted identifiers
			// to lowercase, but the query builder quotes them as written
			+ '  id SERIAL PRIMARY KEY, "publisherId" TEXT, body TEXT,'
			+ '  embedding vector(' + DIM + '), "embeddingModel" TEXT); '
			+ 'CREATE INDEX e2e_docs_emb ON e2e_docs '
			+ '  USING hnsw (embedding vector_cosine_ops);'
		).execute(function (err) { cb(err, 'created + indexed'); });
	});

	await ta('insert corpus THROUGH the Db layer', function (cb) {
		var i = 0;
		(function next(err) {
			if (err) return cb(err);
			if (i >= CORPUS.length) return cb(null, 'inserted ' + CORPUS.length + ' rows');
			var body = CORPUS[i];
			var v = embed(body);
			// No raw SQL: the vector goes in as an ordinary column value
			pg.INSERT('e2e_docs', {
				publisherId: (i % 2 ? 'Hebrews' : 'Other'),
				body: body,
				embedding: v,
				embeddingModel: v.model
			}).execute(function (e) { ++i; next(e); });
		})();
	});

	await ta('round-trips a ' + DIM + '-dim vector intact', function (cb) {
		pg.SELECT('body, embedding', 'e2e_docs').where({body: CORPUS[0]})
		.execute(function (err, rows) {
			if (err) return cb(err);
			var stored = Db.vector(JSON.parse(rows[0].fields.embedding));
			var original = embed(CORPUS[0]);
			if (stored.dimensions() !== DIM) return cb(new Error('dims=' + stored.dimensions()));
			for (var i = 0; i < DIM; ++i) {
				if (Math.abs(stored.values[i] - original.values[i]) > 1e-6) {
					return cb(new Error('component ' + i + ' drifted'));
				}
			}
			cb(null, 'all ' + DIM + ' components match');
		});
	});

	await ta('semantic search returns the right neighbour', function (cb) {
		pg.SELECT('body', 'e2e_docs')
		.vectorNearestTo('embedding', embed('the cat sat on the warm mat'), {limit: 3})
		.execute(function (err, rows) {
			if (err) return cb(err);
			var got = rows.map(function (r) { return r.fields.body; });
			if (got[0] !== CORPUS[0]) return cb(new Error('self not first: ' + got[0]));
			if (got[1] !== CORPUS[1]) return cb(new Error('expected the rug line 2nd, got: ' + got[1]));
			return cb(null, got.slice(0, 2).join(' | '));
		});
	});

	await ta('unrelated query does not return the cat lines', function (cb) {
		pg.SELECT('body', 'e2e_docs')
		.vectorNearestTo('embedding', embed('earnings report beat analyst estimates'), {limit: 2})
		.execute(function (err, rows) {
			if (err) return cb(err);
			var got = rows.map(function (r) { return r.fields.body; });
			if (got[0] !== CORPUS[4]) return cb(new Error('got ' + got[0]));
			if (got.indexOf(CORPUS[0]) >= 0) return cb(new Error('cat line leaked in'));
			cb(null, got.join(' | '));
		});
	});

	await ta('WHERE filter + KNN in a single statement', function (cb) {
		pg.SELECT('*', 'e2e_docs')
		.where({publisherId: 'Hebrews'})
		.vectorNearestTo('embedding', embed('the cat sat on the warm mat'),
			{limit: 3, distanceAs: 'dist'})
		.execute(function (err, rows) {
			if (err) return cb(err);
			if (!rows.length) return cb(new Error('no rows'));
			for (var i = 0; i < rows.length; ++i) {
				if (rows[i].fields.publisherId !== 'Hebrews') {
					return cb(new Error('filter leaked: ' + JSON.stringify(rows[i].fields)));
				}
				if (rows[i].fields.dist === undefined) return cb(new Error('no dist'));
			}
			// distances must be non-decreasing
			for (var j = 1; j < rows.length; ++j) {
				if (rows[j].fields.dist < rows[j-1].fields.dist) {
					return cb(new Error('not ordered by distance'));
				}
			}
			cb(null, rows.length + ' rows, all Hebrews, ordered');
		});
	});

	await ta('model identifier persisted alongside the vector', function (cb) {
		pg.SELECT('*', 'e2e_docs').limit(1).execute(function (err, rows) {
			if (err) return cb(err);
			var m = rows[0].fields.embeddingModel || rows[0].fields.embeddingmodel;
			if (m !== 'stub-768') return cb(new Error('got ' + m));
			cb(null, m);
		});
	});

	// ================= SQLITE end to end =================
	console.log('\n########## end-to-end: sqlite-vec, ' + DIM + ' dims ##########');
	var sq = Db.connect('E2eSq');
	sq.reallyConnect();
	sq.vectorExtensionLoad();

	await ta('create base table + vec0 sidecar', function (cb) {
		var c = sq.connection;
		c.exec('DROP TABLE IF EXISTS e2e_docs;');
		sq.vectorIndexDrop('e2e_docs');
		c.exec('CREATE TABLE e2e_docs (id INTEGER PRIMARY KEY, publisherId TEXT, body TEXT, embeddingModel TEXT, embedding BLOB);');
		// build the sidecar for the metric we search with -- vec0 bakes the
		// metric into the declaration and will not re-rank for another
		sq.vectorIndexCreate('e2e_docs', 'embedding', DIM, {metric: 'cosine'});
		cb(null, 'created');
	});

	await ta('insert corpus (triggers mirror the sidecar)', function (cb) {
		var i = 0;
		(function next(err) {
			if (err) return cb(err);
			if (i >= CORPUS.length) return cb(null, 'inserted ' + CORPUS.length + ' rows');
			var body = CORPUS[i], v = embed(body), id = i + 1;
			sq.INSERT('e2e_docs', {
				id: id, publisherId: (i % 2 ? 'Hebrews' : 'Other'),
				body: body, embeddingModel: v.model,
				embedding: v                       // triggers mirror it
			}).execute(function (e) {
				if (e) return next(e);
				++i; next();
			});
		})();
	});

	await ta('semantic search returns the right neighbour', function (cb) {
		sq.SELECT('e2e_docs.body', 'e2e_docs')
		.vectorNearestTo('embedding', embed('the cat sat on the warm mat'), {limit: 3})
		.execute(function (err, rows) {
			if (err) return cb(err);
			var got = rows.map(function (r) { return r.fields.body; });
			if (got[0] !== CORPUS[0]) return cb(new Error('self not first: ' + got[0]));
			if (got[1] !== CORPUS[1]) return cb(new Error('expected rug line 2nd, got: ' + got[1]));
			cb(null, got.slice(0, 2).join(' | '));
		});
	});

	await ta('WHERE filter + KNN in a single statement', function (cb) {
		sq.SELECT('e2e_docs.body, e2e_docs.publisherId', 'e2e_docs')
		.where({'e2e_docs.publisherId': 'Hebrews'})
		.vectorNearestTo('embedding', embed('the cat sat on the warm mat'), {limit: 5})
		.execute(function (err, rows) {
			if (err) return cb(err);
			if (!rows.length) return cb(new Error('no rows'));
			for (var i = 0; i < rows.length; ++i) {
				if (rows[i].fields.publisherId !== 'Hebrews') {
					return cb(new Error('filter leaked'));
				}
			}
			cb(null, rows.length + ' rows, all Hebrews');
		});
	});

	await ta('both engines agree on the top result', function (cb) {
		var query = embed('she deployed the database migration');
		pg.SELECT('body', 'e2e_docs').vectorNearestTo('embedding', query, {limit: 2})
		.execute(function (err, pgRows) {
			if (err) return cb(err);
			sq.SELECT('e2e_docs.body', 'e2e_docs').vectorNearestTo('embedding', query, {limit: 2})
			.execute(function (err2, sqRows) {
				if (err2) return cb(err2);
				var a = pgRows.map(function (r) { return r.fields.body; });
				var b = sqRows.map(function (r) { return r.fields.body; });
				if (a[0] !== b[0]) {
					return cb(new Error('disagree: pg=' + a[0] + ' sqlite=' + b[0]));
				}
				cb(null, 'both: ' + a[0]);
			});
		});
	});

	console.log('\n==== end-to-end: ' + pass + ' passed, ' + fail + ' failed ====');
	if (failures.length) console.log('failed:\n  ' + failures.join('\n  '));
	process.exit(fail ? 1 : 0);
	})();
});
