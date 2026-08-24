// Cross-engine vector suite.
//
// One battery of assertions, run identically against every engine that
// supports vector search: MariaDB 11.7+, pgvector, and sqlite-vec. The point
// is that `vectorNearestTo` is adapter-agnostic -- the same application code has to
// give the same answers everywhere -- so the tests are written once and the
// engines are data.
//
// Engines that aren't available (no pgvector, MariaDB < 11.7, no sqlite-vec)
// are reported as SKIP rather than failing the run.
require('./Q.inc')(function (Q) {
	var Db = Q.require('Db');
	var Streams = Q.plugins.Streams;
	var pass = 0, fail = 0, skip = 0, failures = [];

	function ok(n, r)   { console.log('  [OK]   ' + n + (r ? ' :: ' + String(r).slice(0, 150) : '')); pass++; }
	function bad(n, e)  { console.log('  [FAIL] ' + n + ' :: ' + (e && (e.message || e))); failures.push(n); fail++; }
	function skipped(n, why) { console.log('  [SKIP] ' + n + ' :: ' + why); skip++; }

	function ta(name, fn) {
		return new Promise(function (resolve) {
			var done = false;
			var timer = setTimeout(function () {
				if (done) return; done = true; bad(name, new Error('TIMEOUT')); resolve();
			}, 20000);
			function finish(err, res) {
				if (done) return; done = true; clearTimeout(timer);
				err ? bad(name, err) : ok(name, res);
				resolve();
			}
			try { fn(finish); } catch (e) { finish(e); }
		});
	}

	// Deterministic stand-in embedder: hashed character trigrams, L2-normalised.
	// Not a real model, but related sentences land near each other, which is all
	// the ranking assertions need -- and it's reproducible across engines.
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

	var CORPUS = [
		[1, 'Hebrews', 'the cat sat on the warm mat'],
		[2, 'Hebrews', 'a cat naps on a warm rug'],
		[3, 'Hebrews', 'she deployed the database migration'],
		[4, 'Other',   'he rolled back the database migration'],
		[5, 'Other',   'earnings report beat analyst estimates'],
		[6, 'Other',   'quarterly revenue exceeded forecasts']
	];

	Db.setConnection('XSqlite', {dsn: 'sqlite:/tmp/qbixcross.db', prefix: ''});
	Db.setConnection('XPg', {
		dsn: 'pgsql:host=127.0.0.1;port=5432;dbname=qbixtest',
		username: 'qbix', password: 'qbixpass', prefix: ''
	});

	// ---- per-engine setup/teardown; everything after this is shared ----
	var engines = [
		{
			name: 'MariaDB',
			db: function () { return Streams.Stream.db(); },
			available: function (db, cb) {
				db.rawQuery('SELECT 1').execute(function () {
					cb(db.vectorsSupported()
						? null : 'server is ' + (db.serverVersion() || '?') + ', needs MariaDB 11.7+');
				});
			},
			setup: function (db, cb) {
				db.rawQuery('DROP TABLE IF EXISTS xdocs').execute(function () {
					db.rawQuery('CREATE TABLE xdocs (id INT PRIMARY KEY,'
						+ ' publisherId VARCHAR(31), body TEXT, embeddingModel VARCHAR(63),'
						+ ' embedding VECTOR(' + DIM + ') NOT NULL,'
						+ ' VECTOR INDEX (embedding) M=8 DISTANCE=cosine) ENGINE=InnoDB'
					).execute(function (p) { cb(p[''] && p[''][0]); });
				});
			},
			teardown: function (db, cb) { db.rawQuery('DROP TABLE IF EXISTS xdocs').execute(function () { cb(); }); }
		},
		{
			name: 'pgvector',
			db: function () { return Db.connect('XPg'); },
			available: function (db, cb) {
				db.vectorSupportCheck(function (err, okv) {
					cb(err ? err.message : (okv ? null : 'pgvector extension not installed'));
				});
			},
			setup: function (db, cb) {
				db.rawQuery('DROP TABLE IF EXISTS xdocs;'
					+ ' CREATE TABLE xdocs (id INT PRIMARY KEY, "publisherId" TEXT, body TEXT,'
					+ ' "embeddingModel" TEXT, embedding vector(' + DIM + '));'
				).execute(function (err) {
					if (err) return cb(err);
					db.vectorIndexCreate('xdocs', 'embedding', DIM,
						{metric: 'cosine'}, cb);
				});
			},
			teardown: function (db, cb) { db.rawQuery('DROP TABLE IF EXISTS xdocs').execute(function () { cb(); }); }
		},
		{
			name: 'sqlite-vec',
			db: function () { return Db.connect('XSqlite'); },
			available: function (db, cb) {
				db.reallyConnect();
				db.vectorExtensionLoad();
				cb(db.vectorsSupported() ? null : 'sqlite-vec extension not loadable');
			},
			setup: function (db, cb) {
				var c = db.connection;
				db.vectorIndexDrop('xdocs');
				c.exec('DROP TABLE IF EXISTS xdocs;');
				c.exec('CREATE TABLE xdocs (id INTEGER PRIMARY KEY, publisherId TEXT,'
					+ ' body TEXT, embeddingModel TEXT, embedding BLOB);');
				// Sidecar + triggers: the base table holds the BLOB, SQLite keeps
				// the vec0 index in step. No mirroring in application code.
				db.vectorIndexCreate('xdocs', 'embedding', DIM, {metric: 'cosine'});
				cb();
			},
			teardown: function (db, cb) {
				db.vectorIndexDrop('xdocs');
				db.connection.exec('DROP TABLE IF EXISTS xdocs;');
				cb();
			}
		}
	];

	function seed(db, cb) {
		var i = 0;
		(function next() {
			if (i >= CORPUS.length) return cb();
			var row = CORPUS[i++];
			db.INSERT('xdocs', {
				id: row[0], publisherId: row[1], body: row[2],
				embeddingModel: 'stub-768',
				embedding: Db.vector(embed(row[2]), 'cosine')
			}).execute(function (err) { err ? cb(err) : next(); });
		})();
	}

	function bodies(rows) { return rows.map(function (r) { return r.fields.body; }); }

	(async function () {
		var topHits = {};
		var distances = {};      // engine -> "id:dist id:dist ..." for the same query
		var euclid = {};         // the same, under the euclidean metric
		var metricSupport = {};  // engine -> vectorMetricsSupported()
		var indexMetrics = {};   // engine -> metric its index was built with

		for (var e = 0; e < engines.length; ++e) {
			var eng = engines[e], db = eng.db();
			console.log('\n########## ' + eng.name + ' ##########');

			var why = await new Promise(function (res) { eng.available(db, res); });
			if (why) {
				skipped(eng.name + ': entire engine', why);
				continue;
			}

			await ta(eng.name + ': create table and vector index', function (cb) {
				eng.setup(db, function (err) { cb(err, 'ready'); });
			});
			await ta(eng.name + ': insert corpus through the Db layer', function (cb) {
				seed(db, function (err) { cb(err, CORPUS.length + ' rows'); });
			});

			// ---- the shared battery ----
			await ta(eng.name + ': nearest neighbour is the related sentence', function (cb) {
				db.SELECT('body', 'xdocs')
				.vectorNearestTo('embedding', Db.vector(embed('the cat sat on the warm mat')), {limit: 2})
				.execute(function (err, rows) {
					if (err) return cb(err);
					var g = bodies(rows);
					if (g[0] !== 'the cat sat on the warm mat') return cb(new Error('self not first: ' + g));
					if (g[1] !== 'a cat naps on a warm rug') return cb(new Error('wrong neighbour: ' + g[1]));
					cb(null, g.join(' | '));
				});
			});
			await ta(eng.name + ': unrelated query excludes the cat lines', function (cb) {
				db.SELECT('body', 'xdocs')
				.vectorNearestTo('embedding', Db.vector(embed('quarterly revenue exceeded forecasts')), {limit: 2})
				.execute(function (err, rows) {
					if (err) return cb(err);
					var g = bodies(rows);
					if (g.some(function (b) { return b.indexOf('cat') >= 0; })) {
						return cb(new Error('cat leaked in: ' + g));
					}
					cb(null, g.join(' | '));
				});
			});
			await ta(eng.name + ': WHERE filter + KNN in one statement', function (cb) {
				var col = eng.name === 'pgvector' ? '"publisherId"' : 'publisherId';
				var q = db.SELECT('body, ' + col, 'xdocs');
				var crit = {}; crit[eng.name === 'sqlite-vec' ? 'xdocs.publisherId' : 'publisherId'] = 'Hebrews';
				q.where(crit)
				.vectorNearestTo('embedding', Db.vector(embed('database migration')), {limit: 5})
				.execute(function (err, rows) {
					if (err) return cb(err);
					if (!rows.length) return cb(new Error('no rows'));
					var bad2 = rows.filter(function (r) { return r.fields.publisherId !== 'Hebrews'; });
					if (bad2.length) return cb(new Error('filter leaked ' + bad2.length));
					if (rows[0].fields.body !== 'she deployed the database migration') {
						return cb(new Error('wrong top hit: ' + rows[0].fields.body));
					}
					topHits[eng.name] = rows[0].fields.body;
					cb(null, rows.length + ' rows, all Hebrews');
				});
			});
			await ta(eng.name + ': distanceAs exposes the distance', function (cb) {
				db.SELECT('body', 'xdocs')
				.vectorNearestTo('embedding', Db.vector(embed('the cat sat on the warm mat')),
					{limit: 1, distanceAs: 'dist'})
				.execute(function (err, rows) {
					if (err) return cb(err);
					var d = rows[0] && rows[0].fields.dist;
					if (d === undefined || d === null) return cb(new Error('no dist column'));
					if (Math.abs(d) > 1e-4) return cb(new Error('expected ~0, got ' + d));
					cb(null, 'dist=' + d);
				});
			});
			await ta(eng.name + ': euclidean metric executes', function (cb) {
				// sqlite-vec bakes the metric into the vec0 declaration, so
				// switching metric means rebuilding the sidecar. MariaDB and
				// pgvector can answer either metric off the same column.
				if (eng.name === 'sqlite-vec') {
					db.vectorIndexCreate('xdocs', 'embedding', DIM, {metric: 'euclidean'});
				}
				db.SELECT('body', 'xdocs')
				.vectorNearestTo('embedding', Db.vector(embed('a cat naps on a warm rug'), 'euclidean'), {limit: 1})
				.execute(function (err, rows) {
					if (eng.name === 'sqlite-vec') {
						db.vectorIndexCreate('xdocs', 'embedding', DIM, {metric: 'cosine'});
					}
					if (err) return cb(err);
					cb(null, rows[0] && rows[0].fields.body);
				});
			});
			await ta(eng.name + ': euclidean distances match across engines', function (cb) {
				if (eng.name === 'sqlite-vec') {
					db.vectorIndexCreate('xdocs', 'embedding', DIM, {metric: 'euclidean'});
				}
				db.SELECT('body', 'xdocs')
				.vectorNearestTo('embedding', Db.vector(embed('the cat sat on the warm mat'), 'euclidean'),
					{limit: 3, distanceAs: 'dist'})
				.execute(function (err, rows) {
					if (eng.name === 'sqlite-vec') {
						db.vectorIndexCreate('xdocs', 'embedding', DIM, {metric: 'cosine'});
					}
					if (err) return cb(err);
					euclid[eng.name] = rows.map(function (r) {
						return r.fields.body.slice(0, 12) + ':' + Number(r.fields.dist).toFixed(4);
					}).join(' ');
					cb(null, euclid[eng.name]);
				});
			});
			await ta(eng.name + ': limit is honoured', function (cb) {
				db.SELECT('body', 'xdocs')
				.vectorNearestTo('embedding', Db.vector(embed('database migration')), {limit: 3})
				.execute(function (err, rows) {
					if (err) return cb(err);
					if (rows.length !== 3) return cb(new Error('expected 3, got ' + rows.length));
					cb(null, '3 rows');
				});
			});
			await ta(eng.name + ': vectorIndexMetric reports what was built', function (cb) {
				var r = db.vectorIndexMetric('xdocs', 'embedding', function (err, metric) {
					if (err) return cb(err);
					if (metric !== 'cosine') {
						return cb(new Error('expected cosine, got ' + metric));
					}
					indexMetrics[eng.name] = metric;
					cb(null, metric);
				});
				// the sqlite adapter answers synchronously; the others call back
				if (typeof r === 'string' && !indexMetrics[eng.name]) {
					indexMetrics[eng.name] = r;
				}
			});
			await ta(eng.name + ': reports which metrics it supports', function (cb) {
				var m = db.SELECT('*', 'xdocs').vectorMetricsSupported();
				if (!m || !m.length) return cb(new Error('no metrics reported'));
				if (m.indexOf('cosine') < 0 || m.indexOf('euclidean') < 0) {
					return cb(new Error('missing a core metric: ' + m.join(',')));
				}
				metricSupport[eng.name] = m;
				cb(null, m.join(', '));
			});
			await ta(eng.name + ': refuses an unsupported metric consistently', function (cb) {
				var m = db.SELECT('*', 'xdocs').vectorMetricsSupported();
				if (m.indexOf('dot') >= 0) return cb(null, 'supports dot; nothing to refuse');
				try {
					db.SELECT('*', 'xdocs').vectorNearestTo('embedding', Db.vector(embed('x'), 'dot'));
				} catch (e) {
					if (!/supports .* distance, not 'dot'/.test(e.message)) {
						return cb(new Error('non-standard wording: ' + e.message));
					}
					return cb(null, 'refused with the standard wording');
				}
				cb(new Error('should have refused dot'));
			});
			await ta(eng.name + ': cosine distances for comparison', function (cb) {
				db.SELECT('body', 'xdocs')
				.vectorNearestTo('embedding', Db.vector(embed('the cat sat on the warm mat')),
					{limit: 3, distanceAs: 'dist'})
				.execute(function (err, rows) {
					if (err) return cb(err);
					distances[eng.name] = rows.map(function (r) {
						return r.fields.body.slice(0, 12) + ':' + Number(r.fields.dist).toFixed(4);
					}).join(' ');
					cb(null, distances[eng.name]);
				});
			});
			await ta(eng.name + ': model identifier persisted beside the vector', function (cb) {
				// object form so the adapter quotes the identifier: Postgres folds
				// unquoted names to lowercase, and Qbix columns are camelCase
				db.SELECT({m: 'embeddingModel'}, 'xdocs').where({id: 1})
				.execute(function (err, rows) {
					if (err) return cb(err);
					var m = rows[0] && rows[0].fields.m;
					if (m !== 'stub-768') return cb(new Error('got ' + m));
					cb(null, m);
				});
			});

			// ---- writes stay searchable: the sidecar-drift check ----
			await ta(eng.name + ': DELETE removes the row from search', function (cb) {
				db.DELETE('xdocs').where({id: 2}).execute(function (err) {
					if (err) return cb(err);
					db.SELECT('body', 'xdocs')
					.vectorNearestTo('embedding', Db.vector(embed('the cat sat on the warm mat')), {limit: 6})
					.execute(function (err, rows) {
						if (err) return cb(err);
						var g = bodies(rows);
						if (g.indexOf('a cat naps on a warm rug') >= 0) {
							return cb(new Error('deleted row still searchable — index drifted'));
						}
						if (g.length !== CORPUS.length - 1) {
							return cb(new Error('expected ' + (CORPUS.length - 1) + ' rows, got ' + g.length));
						}
						cb(null, g.length + ' rows, deleted row gone');
					});
				});
			});
			await ta(eng.name + ': INSERT is immediately searchable', function (cb) {
				db.INSERT('xdocs', {
					id: 99, publisherId: 'Hebrews', body: 'a kitten dozes on a warm blanket',
					embeddingModel: 'stub-768',
					embedding: Db.vector(embed('a kitten dozes on a warm blanket'), 'cosine')
				}).execute(function (err) {
					if (err) return cb(err);
					db.SELECT('body', 'xdocs')
					.vectorNearestTo('embedding', Db.vector(embed('a kitten dozes on a warm blanket')), {limit: 1})
					.execute(function (err, rows) {
						if (err) return cb(err);
						if (!rows[0] || rows[0].fields.body !== 'a kitten dozes on a warm blanket') {
							return cb(new Error('new row not searchable — index drifted'));
						}
						cb(null, 'found immediately');
					});
				});
			});
			await ta(eng.name + ': UPDATE of the vector changes ranking', function (cb) {
				var newText = 'entirely unrelated astronomy telescope nebula';
				db.UPDATE('xdocs')
				.set({body: newText, embedding: Db.vector(embed(newText), 'cosine')})
				.where({id: 99}).execute(function (err) {
					if (err) return cb(err);
					db.SELECT('body', 'xdocs')
					.vectorNearestTo('embedding', Db.vector(embed(newText)), {limit: 1})
					.execute(function (err, rows) {
						if (err) return cb(err);
						if (!rows[0] || rows[0].fields.body !== newText) {
							return cb(new Error('updated vector not reflected — index drifted'));
						}
						cb(null, 'ranking follows the update');
					});
				});
			});

			if (eng.name === 'sqlite-vec') {
				await ta(eng.name + ': sidecar has zero drift after all writes', function (cb) {
					var d = db.vectorIndexDrift('xdocs', 'embedding');
					if (d.drift !== 0) {
						return cb(new Error('drift=' + d.drift + ' (base ' + d.base + ', sidecar ' + d.sidecar + ')'));
					}
					cb(null, 'base=' + d.base + ' sidecar=' + d.sidecar + ' drift=0');
				});
				await ta(eng.name + ': raw SQL writes also stay in sync', function (cb) {
					// the triggers fire for statements that never touch the Db layer
					var f = Buffer.from(new Float32Array(embed('raw sql inserted row')).buffer);
					db.connection.prepare(
						'INSERT INTO xdocs(id, publisherId, body, embeddingModel, embedding) VALUES (?,?,?,?,?)'
					).run(1234, 'Hebrews', 'raw sql inserted row', 'stub-768', f);
					var d = db.vectorIndexDrift('xdocs', 'embedding');
					if (d.drift !== 0) return cb(new Error('drift=' + d.drift + ' after raw insert'));
					db.SELECT('body', 'xdocs')
					.vectorNearestTo('embedding', Db.vector(embed('raw sql inserted row')), {limit: 1})
					.execute(function (err, rows) {
						if (err) return cb(err);
						if (!rows[0] || rows[0].fields.body !== 'raw sql inserted row') {
							return cb(new Error('raw-SQL row not searchable'));
						}
						cb(null, 'trigger mirrored a raw INSERT');
					});
				});
			}

			await new Promise(function (res) { eng.teardown(db, res); });
		}

		// ---- cross-engine agreement ----
		console.log('\n########## cross-engine agreement ##########');
		var names = Object.keys(topHits);
		if (names.length < 2) {
			skipped('engines agree on the top hit', 'need 2+ engines, had ' + names.length);
		} else {
			var values = names.map(function (n) { return topHits[n]; });
			var same = values.every(function (v) { return v === values[0]; });
			same ? ok('engines agree on the top hit',
					names.join(' + ') + ' -> ' + values[0])
				 : bad('engines agree on the top hit',
					new Error(JSON.stringify(topHits)));
		}

		var dn = Object.keys(distances);
		if (dn.length < 2) {
			skipped('engines agree on cosine DISTANCES', 'need 2+ engines');
		} else {
			var dv = dn.map(function (n) { return distances[n]; });
			dv.every(function (v) { return v === dv[0]; })
				? ok('engines agree on cosine DISTANCES', dn.join(' + ') + ' -> ' + dv[0])
				: bad('engines agree on cosine DISTANCES', new Error(JSON.stringify(distances, null, 1)));
		}
		var en = Object.keys(euclid);
		if (en.length < 2) {
			skipped('engines agree on euclidean DISTANCES', 'need 2+ engines');
		} else {
			var ev = en.map(function (n) { return euclid[n]; });
			ev.every(function (v) { return v === ev[0]; })
				? ok('engines agree on euclidean DISTANCES', en.join(' + ') + ' -> ' + ev[0])
				: bad('engines agree on euclidean DISTANCES', new Error(JSON.stringify(euclid, null, 1)));
		}
		var im = Object.keys(indexMetrics);
		if (im.length < 2) {
			skipped('vectorIndexCreate works the same everywhere', 'need 2+ engines');
		} else {
			var iv = im.map(function (n) { return indexMetrics[n]; });
			iv.every(function (v) { return v === 'cosine'; })
				? ok('vectorIndexCreate works the same everywhere',
					im.join(' + ') + ' -> all report cosine')
				: bad('vectorIndexCreate works the same everywhere',
					new Error(JSON.stringify(indexMetrics)));
		}
		var mn = Object.keys(metricSupport);
		if (mn.length < 2) {
			skipped('cosine and euclidean available everywhere', 'need 2+ engines');
		} else {
			var missing = mn.filter(function (n) {
				return metricSupport[n].indexOf('cosine') < 0
					|| metricSupport[n].indexOf('euclidean') < 0;
			});
			missing.length
				? bad('cosine and euclidean available everywhere', new Error(missing.join(',')))
				: ok('cosine and euclidean available everywhere', mn.join(' + '));
		}

		console.log('\n==== cross-engine vectors: ' + pass + ' passed, '
			+ fail + ' failed, ' + skip + ' skipped ====');
		if (failures.length) console.log('failed:\n  ' + failures.join('\n  '));
		process.exit(fail ? 1 : 0);
	})();
});
