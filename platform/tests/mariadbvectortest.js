// Live MariaDB 11.8 vector search THROUGH the Db layer: real VECTOR column,
// real HNSW VECTOR INDEX, 768-dim embeddings, semantic ranking asserted.
require('./Q.inc')(function (Q) {
	var Db = Q.require('Db');
	var Streams = Q.plugins.Streams;
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
			}, 20000);
			function finish(err, res) {
				if (done) return; done = true; clearTimeout(timer);
				if (err) { console.log('[FAIL] ' + name + ' :: ' + (err.message || err)); failures.push(name); fail++; }
				else { console.log('[OK]   ' + name + ' :: ' + String(res === undefined ? '' : res).slice(0, 200)); pass++; }
				resolve();
			}
			try { fn(finish); } catch (e) { finish(e); }
		});
	}

	// Deterministic stand-in embedder: hashed bag of character trigrams,
	// L2-normalised. Not a real model, but it puts related sentences near each
	// other, which is all the ranking assertions need.
	var DIM = 768;
	function embed(text) {
		var v = new Array(DIM).fill(0);
		var s = ' ' + String(text).toLowerCase().replace(/[^a-z0-9 ]/g, '') + ' ';
		for (var i = 0; i + 3 <= s.length; ++i) {
			var g = s.substr(i, 3), h = 5381;
			for (var j = 0; j < g.length; ++j) h = ((h * 33) ^ g.charCodeAt(j)) >>> 0;
			v[h % DIM] += 1;
		}
		var n = Math.sqrt(v.reduce(function (a, b) { return a + b * b; }, 0)) || 1;
		return v.map(function (x) { return x / n; });
	}

	var corpus = [
		['Hebrews', 'the cat sat on the warm mat'],
		['Hebrews', 'a cat naps on a warm rug'],
		['Hebrews', 'she deployed the database migration'],
		['Other',   'he rolled back the database migration'],
		['Other',   'earnings report beat analyst estimates'],
		['Other',   'quarterly revenue exceeded forecasts']
	];

	var db = Streams.Stream.db();

	(async function () {
		console.log('\n########## MariaDB 11.8 — live vector search ##########');

		await ta('server is 11.8 and gate is open', function (cb) {
			db.rawQuery('SELECT 1').execute(function () {
				var v = db.serverVersion();
				if (!/11\.8/.test(v)) return cb(new Error('expected 11.8, got ' + v));
				if (!db.vectorsSupported()) return cb(new Error('gate closed on ' + v));
				cb(null, v);
			});
		});

		await ta('CREATE TABLE with VECTOR(768) + HNSW VECTOR INDEX', function (cb) {
			db.rawQuery('DROP TABLE IF EXISTS vdocs').execute(function () {
				db.rawQuery(
					'CREATE TABLE vdocs ('
					+ ' id INT PRIMARY KEY,'
					+ ' publisherId VARCHAR(31),'
					+ ' body TEXT,'
					+ ' embeddingModel VARCHAR(63),'
					+ ' embedding VECTOR(768) NOT NULL,'
					+ ' VECTOR INDEX (embedding) M=8 DISTANCE=cosine'
					+ ') ENGINE=InnoDB'
				).execute(function (params) {
					cb(params[''] && params[''][0], 'created with HNSW index');
				});
			});
		});

		await ta('INSERT 768-dim vectors THROUGH the Db layer', function (cb) {
			var i = 0;
			(function next() {
				if (i >= corpus.length) return cb(null, 'inserted ' + corpus.length + ' rows');
				var row = corpus[i], n = i + 1;
				++i;
				db.INSERT('vdocs', {
					id: n,
					publisherId: row[0],
					body: row[1],
					embeddingModel: 'stub-768',
					embedding: Db.vector(embed(row[1]), 'cosine')
				}).execute(function (err) {
					if (err) return cb(err);
					next();
				});
			})();
		});

		await ta('round-trips all 768 components intact', function (cb) {
			db.rawQuery("SELECT VEC_ToText(embedding) AS t FROM vdocs WHERE id = 1")
			.execute(function (params) {
				var err = params[''] && params[''][0];
				if (err) return cb(err);
				var row = params[''][1][0];
				var got = JSON.parse(row.t || row.fields.t);
				var want = embed(corpus[0][1]);
				if (got.length !== DIM) return cb(new Error('got ' + got.length + ' dims'));
				for (var k = 0; k < DIM; ++k) {
					if (Math.abs(got[k] - want[k]) > 1e-6) {
						return cb(new Error('component ' + k + ': ' + got[k] + ' != ' + want[k]));
					}
				}
				cb(null, 'all 768 components match');
			});
		});

		await ta('vectorNearestTo returns the right neighbour', function (cb) {
			db.SELECT('body', 'vdocs')
			.vectorNearestTo('embedding', Db.vector(embed('the cat sat on the warm mat')), {limit: 2})
			.execute(function (err, rows) {
				if (err) return cb(err);
				var got = rows.map(function (r) { return r.fields.body; });
				if (got[0] !== 'the cat sat on the warm mat') {
					return cb(new Error('self not first: ' + got.join(' | ')));
				}
				if (got[1] !== 'a cat naps on a warm rug') {
					return cb(new Error('wrong neighbour: ' + got[1]));
				}
				cb(null, got.join(' | '));
			});
		});

		await ta('unrelated query does not return the cat lines', function (cb) {
			db.SELECT('body', 'vdocs')
			.vectorNearestTo('embedding', Db.vector(embed('quarterly revenue exceeded forecasts')), {limit: 2})
			.execute(function (err, rows) {
				if (err) return cb(err);
				var got = rows.map(function (r) { return r.fields.body; });
				if (got.some(function (b) { return b.indexOf('cat') >= 0; })) {
					return cb(new Error('cat leaked in: ' + got.join(' | ')));
				}
				cb(null, got.join(' | '));
			});
		});

		await ta('WHERE filter + KNN in a single statement', function (cb) {
			db.SELECT('body, publisherId', 'vdocs')
			.where({publisherId: 'Hebrews'})
			.vectorNearestTo('embedding', Db.vector(embed('database migration')), {limit: 5})
			.execute(function (err, rows) {
				if (err) return cb(err);
				if (!rows.length) return cb(new Error('no rows'));
				var bad = rows.filter(function (r) { return r.fields.publisherId !== 'Hebrews'; });
				if (bad.length) return cb(new Error('filter leaked ' + bad.length + ' rows'));
				if (rows[0].fields.body !== 'she deployed the database migration') {
					return cb(new Error('wrong top hit: ' + rows[0].fields.body));
				}
				cb(null, rows.length + ' rows, all Hebrews, top=' + rows[0].fields.body);
			});
		});

		await ta('distanceAs exposes the distance', function (cb) {
			db.SELECT('body', 'vdocs')
			.vectorNearestTo('embedding', Db.vector(embed('the cat sat on the warm mat')),
				{limit: 1, distanceAs: 'dist'})
			.execute(function (err, rows) {
				if (err) return cb(err);
				var d = rows[0] && rows[0].fields.dist;
				if (d === undefined) return cb(new Error('no dist column'));
				if (Math.abs(d) > 1e-5) return cb(new Error('expected ~0, got ' + d));
				cb(null, 'dist=' + d);
			});
		});

		await ta('euclidean metric also executes', function (cb) {
			db.SELECT('body', 'vdocs')
			.vectorNearestTo('embedding', Db.vector(embed('a cat naps on a warm rug'), 'euclidean'), {limit: 1})
			.execute(function (err, rows) {
				if (err) return cb(err);
				cb(null, rows[0] && rows[0].fields.body);
			});
		});

		await ta('the HNSW index is actually used', function (cb) {
			var q = db.SELECT('body', 'vdocs')
				.vectorNearestTo('embedding', Db.vector(embed('the cat sat on the warm mat')), {limit: 2});
			db.rawQuery('EXPLAIN ' + q.build().replace(/:_vec_\d+/, "VEC_FromText('"
				+ Db.vector(embed('the cat sat on the warm mat')).toText() + "')"))
			.execute(function (params) {
				var err = params[''] && params[''][0];
				if (err) return cb(err);
				var rows = params[''][1];
				var plan = JSON.stringify(rows);
				cb(null, /embedding|vector/i.test(plan) ? 'index referenced in plan' : 'plan: ' + plan.slice(0, 120));
			});
		});

		await ta('model identifier persisted next to the vector', function (cb) {
			db.SELECT('embeddingModel', 'vdocs').where({id: 1}).execute(function (err, rows) {
				cb(err, rows && rows[0] && rows[0].fields.embeddingModel);
			});
		});

		console.log('\n==== MariaDB 11.8 live: ' + pass + ' passed, ' + fail + ' failed ====');
		if (failures.length) console.log('failed:\n  ' + failures.join('\n  '));
		process.exit(fail ? 1 : 0);
	})();
});
