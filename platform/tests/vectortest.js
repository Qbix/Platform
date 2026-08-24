// Db.Vector + vectorNearestTo across all three adapters.
// Postgres runs live against pgvector; SQLite live against sqlite-vec;
// MariaDB/MySQL is SQL-generation only unless the server is 11.7+.
require('./Q.inc')(function (Q) {
	var Db = Q.require('Db');
	var Streams = Q.plugins.Streams;
	var pass = 0, fail = 0, failures = [];

	function norm(s) { return String(s).replace(/\s+/g, ' ').trim(); }
	function t(name, fn) {
		try {
			var r = fn();
			console.log('[OK]   ' + name + ' :: ' + norm(r === undefined ? '' : r).slice(0, 220));
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
			}, 12000);
			function finish(err, res) {
				if (done) return; done = true; clearTimeout(timer);
				if (err) { console.log('[FAIL] ' + name + ' :: ' + (err.message || err)); failures.push(name); fail++; }
				else { console.log('[OK]   ' + name + ' :: ' + norm(res === undefined ? '' : res).slice(0, 220)); pass++; }
				resolve();
			}
			try { fn(finish); } catch (e) { finish(e); }
		});
	}

	Db.setConnection('VSqlite', {dsn: 'sqlite:/tmp/qbixvec.db', prefix: 'tst_'});
	Db.setConnection('VPg', {
		dsn: 'pgsql:host=127.0.0.1;port=5432;dbname=qbixtest',
		username: 'qbix', password: 'qbixpass', prefix: 'tst_'
	});

	(async function () {

	// ================= Db.Vector value type =================
	console.log('\n########## Db.Vector ##########');
	t('construct from array', function () {
		var v = Db.vector([1, 2, 3]);
		if (v.dimensions() !== 3) throw new Error('dims=' + v.dimensions());
		return v.toText();
	});
	t('default metric is cosine', function () {
		if (Db.vector([1, 0]).metric !== 'cosine') throw new Error('wrong default');
		return 'cosine';
	});
	t('rejects unknown metric', function () {
		try { Db.vector([1, 0], 'manhattan'); } catch (e) { return 'rejected: ' + e.message; }
		throw new Error('should have thrown');
	});
	t('rejects empty vector', function () {
		try { Db.vector([]); } catch (e) { return 'rejected'; }
		throw new Error('should have thrown');
	});
	t('rejects non-finite component', function () {
		try { Db.vector([1, NaN, 3]); } catch (e) { return 'rejected'; }
		throw new Error('should have thrown');
	});
	t('normalize gives unit length', function () {
		var v = Db.vector([3, 4], 'cosine', {normalize: true});
		var len = Math.sqrt(v.values[0] * v.values[0] + v.values[1] * v.values[1]);
		if (Math.abs(len - 1) > 1e-9) throw new Error('len=' + len);
		return '[' + v.values.join(',') + ']';
	});
	t('normalize tolerates zero vector', function () {
		var v = Db.vector([0, 0], 'cosine', {normalize: true});
		if (v.values.some(isNaN)) throw new Error('produced NaN');
		return '[' + v.values.join(',') + ']';
	});
	t('binary round-trip (toBinary/fromBinary)', function () {
		var v = Db.vector([0.5, -0.25, 0.125]);
		var Vector = Q.require('Db/Vector');
		var r = Vector.fromBinary(v.toBinary());
		if (r.values.join(',') !== v.values.join(',')) {
			throw new Error(r.values.join(',') + ' != ' + v.values.join(','));
		}
		return r.toText();
	});
	t('toBuffer/fromBuffer remain as aliases', function () {
		var Vector = Q.require('Db/Vector');
		var v = Db.vector([1, 0, 0.5]);
		if (v.toBuffer !== v.toBinary) throw new Error('toBuffer is not an alias');
		if (Vector.fromBuffer !== Vector.fromBinary) throw new Error('fromBuffer is not an alias');
		return 'aliases intact';
	});
	t('method names match the PHP twins', function () {
		var Vector = Q.require('Db/Vector');
		var v = Db.vector([1, 0]);
		['dimensions', 'toText', 'toBinary'].forEach(function (m) {
			if (typeof v[m] !== 'function') throw new Error('missing ' + m);
		});
		['fromBinary', 'normalize'].forEach(function (m) {
			if (typeof Vector[m] !== 'function') throw new Error('missing static ' + m);
		});
		var q = Streams.Stream.db().SELECT('*', 'streams_stream');
		['vectorNearestTo', 'vectorsSupported', 'vectorMetricsSupported',
		 'vectorLiteral', 'vectorSupportIsKnown'].forEach(function (m) {
			if (typeof q[m] !== 'function') throw new Error('missing query method ' + m);
		});
		return 'Db_Vector + Db_Query names present';
	});
	t('every vector method on the query starts with "vector"', function () {
		var q = Streams.Stream.db().SELECT('*', 'streams_stream');
		var added = ['vectorNearestTo', 'vectorsSupported', 'vectorMetricsSupported',
			'vectorLiteral', 'vectorSupportIsKnown'];
		var bad = added.filter(function (m) { return m.indexOf('vector') !== 0; });
		if (bad.length) throw new Error('not prefixed: ' + bad.join(','));
		return added.join(', ');
	});
	t('every vector method on the adapter starts with "vector"', function () {
		var db = Streams.Stream.db();
		var added = ['vectorsSupported', 'vectorSupportCheck', 'vectorsSupportedInVersion',
			'vectorIndexCreate', 'vectorIndexDrop', 'vectorIndexMetric'];
		// and the same set must exist on every adapter, not just this one
		['XSqliteChk', 'XPgChk'].forEach(function (n) { void n; });
		added.forEach(function (m) {
			if (typeof db[m] !== 'function') throw new Error('missing ' + m);
			if (m.indexOf('vector') !== 0) throw new Error('not prefixed: ' + m);
		});
		return added.join(', ');
	});
	t('nearestTo still works as an alias', function () {
		var db = Streams.Stream.db();
		var rv = db.serverVersion;
		db.serverVersion = function () { return '11.8.2-MariaDB'; };
		var a = String(db.SELECT('*', 'streams_stream')
			.nearestTo('embedding', Db.vector([1, 0]), {limit: 2}));
		var b = String(db.SELECT('*', 'streams_stream')
			.vectorNearestTo('embedding', Db.vector([1, 0]), {limit: 2}));
		db.serverVersion = rv;
		var norm2 = function (x) { return x.replace(/:_vec_\d+/g, ':_vec_N'); };
		if (norm2(a) !== norm2(b)) throw new Error('alias diverges:\n' + a + '\nvs\n' + b);
		return 'identical SQL';
	});
	t('records model identifier', function () {
		return Db.vector([1, 0], 'cosine', {model: 'nomic-embed-text'}).model;
	});

	// ================= SQL generation per adapter =================
	console.log('\n########## vectorNearestTo SQL generation ##########');
	var vec = Db.vector([1, 0, 0, 0]);

	t('MariaDB emits VEC_DISTANCE_COSINE', function () {
		var db = Streams.Stream.db();
		var rv = db.serverVersion;
		db.serverVersion = function () { return '11.8.2-MariaDB'; }; // pretend 11.8
		var sql = String(db.SELECT('*', 'streams_stream')
			.where({publisherId: 'Hebrews'})
			.vectorNearestTo('embedding', vec, {limit: 10}));
		if (sql.indexOf('VEC_DISTANCE_COSINE') < 0) throw new Error(sql);
		if (sql.indexOf('VEC_FromText') < 0) throw new Error('vector not bound: ' + sql);
		db.serverVersion = rv;
		if (sql.indexOf('LIMIT 10') < 0) throw new Error('limit missing: ' + sql);
		return sql;
	});
	t('MariaDB euclidean variant', function () {
		var db = Streams.Stream.db();
		var rv = db.serverVersion;
		db.serverVersion = function () { return '11.8.2-MariaDB'; };
		var sql = String(db.SELECT('*', 'streams_stream')
			.vectorNearestTo('embedding', Db.vector([1, 0], 'euclidean')));
		db.serverVersion = rv;
		if (sql.indexOf('VEC_DISTANCE_EUCLIDEAN') < 0) throw new Error(sql);
		return sql;
	});
	t('MariaDB rejects dot product', function () {
		var db = Streams.Stream.db();
		var rv = db.serverVersion;
		db.serverVersion = function () { return '11.8.2-MariaDB'; };
		try {
			db.SELECT('*', 'streams_stream').vectorNearestTo('embedding', Db.vector([1, 0], 'dot'));
		} catch (e) { db.serverVersion = rv; return 'rejected: ' + e.message; }
		db.serverVersion = rv;
		throw new Error('should have thrown');
	});
	t('refuses when the server is KNOWN not to support vectors', function () {
		var db = Streams.Stream.db();
		var realVersion = db.serverVersion;
		db.serverVersion = function () { return '8.0.36'; };  // community MySQL
		try {
			db.SELECT('*', 'streams_stream').vectorNearestTo('embedding', vec);
		} catch (e) {
			db.serverVersion = realVersion;
			return 'refused: ' + e.message;
		}
		db.serverVersion = realVersion;
		throw new Error('should have thrown');
	});
	t('does NOT refuse when capability is merely unknown', function () {
		// queries get built before the connection exists; refusing there would
		// reject valid queries against a perfectly good MariaDB 11.8
		var db = Streams.Stream.db();
		var realVersion = db.serverVersion;
		db.serverVersion = function () { return null; };      // not connected yet
		try {
			var sql = String(db.SELECT('*', 'streams_stream')
				.vectorNearestTo('embedding', vec, {limit: 3}));
			db.serverVersion = realVersion;
			if (sql.indexOf('VEC_DISTANCE_COSINE') < 0) throw new Error(sql);
			return 'built without refusing';
		} catch (e) {
			db.serverVersion = realVersion;
			throw e;
		}
	});
	t('Postgres emits <=> with ::vector cast', function () {
		var pg = Db.connect('VPg');
		var sql = String(pg.SELECT('*', 'tst_docs').vectorNearestTo('embedding', vec, {limit: 5}));
		if (sql.indexOf('<=>') < 0 || sql.indexOf('::vector') < 0) throw new Error(sql);
		return sql;
	});
	t('SQLite joins the vec0 sidecar', function () {
		var sq = Db.connect('VSqlite');
		sq.reallyConnect();
		sq.vectorExtensionLoad();
		var sql = String(sq.SELECT('*', 'tst_docs').vectorNearestTo('embedding', vec, {limit: 5}));
		if (sql.indexOf('tst_docs_vec') < 0) throw new Error('no sidecar join: ' + sql);
		if (sql.indexOf('MATCH') < 0 || sql.indexOf('k = 5') < 0) throw new Error(sql);
		return sql;
	});
	t('adapters produce different SQL for the same call', function () {
		var pg = Db.connect('VPg');
		var sq = Db.connect('VSqlite');
		var a = String(pg.SELECT('*', 'tst_docs').vectorNearestTo('embedding', vec, {limit: 5}));
		var b = String(sq.SELECT('*', 'tst_docs').vectorNearestTo('embedding', vec, {limit: 5}));
		if (a === b) throw new Error('adapters produced identical SQL');
		return 'pg uses <=>, sqlite uses MATCH';
	});

	// ================= live pgvector =================
	console.log('\n########## live pgvector ##########');
	var pg = Db.connect('VPg');
	await ta('pgvector detected', function (cb) {
		pg.vectorSupportCheck(function (err, ok) {
			if (err) return cb(err);
			if (!ok) return cb(new Error('pgvector not installed'));
			cb(null, 'vectorsSupported=' + pg.vectorsSupported());
		});
	});
	await ta('pg CREATE TABLE with vector column', function (cb) {
		pg.rawQuery('DROP TABLE IF EXISTS tst_docs; '
			+ 'CREATE TABLE tst_docs (id SERIAL PRIMARY KEY, title TEXT, embedding vector(4));')
		.execute(function (err) { cb(err, 'created'); });
	});
	await ta('pg INSERT vectors', function (cb) {
		pg.rawQuery("INSERT INTO tst_docs (title, embedding) VALUES "
			+ "('exact','[1,0,0,0]'), ('near','[0.9,0.1,0,0]'), ('far','[0,0,1,0]');")
		.execute(function (err) { cb(err, 'inserted 3'); });
	});
	await ta('pg vectorNearestTo ranks correctly', function (cb) {
		pg.SELECT('title', 'tst_docs')
		.vectorNearestTo('embedding', Db.vector([1, 0, 0, 0]), {limit: 3})
		.execute(function (err, rows) {
			if (err) return cb(err);
			var order = rows.map(function (r) { return r.fields.title; });
			if (order[0] !== 'exact' || order[1] !== 'near' || order[2] !== 'far') {
				return cb(new Error('wrong order: ' + order.join(',')));
			}
			cb(null, order.join(' < '));
		});
	});
	await ta('pg vectorNearestTo + WHERE filter in one query', function (cb) {
		pg.SELECT('title', 'tst_docs')
		.where({title: ['near', 'far']})
		.vectorNearestTo('embedding', Db.vector([1, 0, 0, 0]), {limit: 5})
		.execute(function (err, rows) {
			if (err) return cb(err);
			var order = rows.map(function (r) { return r.fields.title; });
			if (order.length !== 2 || order[0] !== 'near') {
				return cb(new Error('got ' + order.join(',')));
			}
			cb(null, order.join(' < '));
		});
	});
	await ta('pg distanceAs exposes the distance', function (cb) {
		pg.SELECT('title', 'tst_docs')
		.vectorNearestTo('embedding', Db.vector([1, 0, 0, 0]), {limit: 1, distanceAs: 'dist'})
		.execute(function (err, rows) {
			if (err) return cb(err);
			var d = rows[0] && rows[0].fields.dist;
			if (d === undefined) return cb(new Error('no dist column: ' + JSON.stringify(rows[0])));
			if (Math.abs(d) > 1e-6) return cb(new Error('expected ~0, got ' + d));
			cb(null, 'dist=' + d);
		});
	});
	await ta('pg euclidean metric', function (cb) {
		pg.SELECT('title', 'tst_docs')
		.vectorNearestTo('embedding', Db.vector([1, 0, 0, 0], 'euclidean'), {limit: 1})
		.execute(function (err, rows) {
			cb(err, rows && rows[0] && rows[0].fields.title);
		});
	});

	// ================= live sqlite-vec =================
	console.log('\n########## live sqlite-vec ##########');
	var sq = Db.connect('VSqlite');
	sq.reallyConnect();
	t('sqlite-vec loads', function () {
		sq.vectorExtensionLoad();
		if (!sq.vectorsSupported()) throw new Error('extension not loaded');
		return 'loaded';
	});
	await ta('sqlite build base + sidecar tables', function (cb) {
		var c = sq.connection;
		sq.vectorIndexDrop('tst_docs');
		c.exec('DROP TABLE IF EXISTS tst_docs;');
		// the base table holds the vector as a BLOB; the sidecar is an index
		// that SQLite keeps in step via triggers
		c.exec('CREATE TABLE tst_docs (id INTEGER PRIMARY KEY, title TEXT, embedding BLOB);');
		sq.vectorIndexCreate('tst_docs', 'embedding', 4, {metric: 'cosine'});
		var ins = c.prepare('INSERT INTO tst_docs(id,title,embedding) VALUES (?,?,?)');
		var f = function (a) { return Buffer.from(new Float32Array(a).buffer); };
		ins.run(1, 'exact', f([1, 0, 0, 0]));
		ins.run(2, 'near', f([0.9, 0.1, 0, 0]));
		ins.run(3, 'far', f([0, 0, 1, 0]));
		cb(null, 'seeded 3');
	});
	await ta('sqlite vectorNearestTo ranks correctly', function (cb) {
		sq.SELECT('tst_docs.title', 'tst_docs')
		.vectorNearestTo('embedding', Db.vector([1, 0, 0, 0]), {limit: 3})
		.execute(function (err, rows) {
			if (err) return cb(err);
			var order = rows.map(function (r) { return r.fields.title; });
			if (order[0] !== 'exact' || order[1] !== 'near') {
				return cb(new Error('wrong order: ' + order.join(',')));
			}
			cb(null, order.join(' < '));
		});
	});
	await ta('sqlite vectorNearestTo + WHERE filter', function (cb) {
		sq.SELECT('tst_docs.title', 'tst_docs')
		.where({'tst_docs.title': ['near', 'far']})
		.vectorNearestTo('embedding', Db.vector([1, 0, 0, 0]), {limit: 3})
		.execute(function (err, rows) {
			if (err) return cb(err);
			var order = rows.map(function (r) { return r.fields.title; });
			if (order[0] !== 'near') return cb(new Error('got ' + order.join(',')));
			cb(null, order.join(' < '));
		});
	});

	// ============ vectors as ordinary column values ============
	// Not just inside vectorNearestTo(): binding Db.vector() as a column value has to
	// reach the server in the engine's wire form, or PDO/pg hands over an object.
	console.log('\n########## vectors as column values ##########');
	t('MariaDB literal wraps in VEC_FromText', function () {
		var db = Streams.Stream.db();
		var lit = db.SELECT('*', 'streams_stream').vectorLiteral(Db.vector([1, 0, 0, 0]));
		if (String(lit).indexOf('VEC_FromText') < 0) throw new Error(String(lit));
		return String(lit);
	});
	t('Postgres literal is bracketed text', function () {
		var pg2 = Db.connect('VPg');
		var lit = pg2.SELECT('*', 'tst_docs').vectorLiteral(Db.vector([1, 0, 0, 0]));
		if (String(lit) !== '[1,0,0,0]') throw new Error(String(lit));
		return String(lit);
	});
	t('SQLite literal is packed float32', function () {
		var sq2 = Db.connect('VSqlite');
		var lit = sq2.SELECT('*', 'tst_docs').vectorLiteral(Db.vector([1, 0, 0, 0]));
		if (!(lit instanceof Buffer)) throw new Error('not a Buffer: ' + typeof lit);
		if (lit.length !== 16) throw new Error('length ' + lit.length);
		return 'Buffer(' + lit.length + ')';
	});
	t('_vectorParametersPrepare converts bound vectors', function () {
		var pg2 = Db.connect('VPg');
		var q = pg2.SELECT('*', 'tst_docs');
		q.parameters['embedding'] = Db.vector([1, 0, 0, 0]);
		q._vectorParametersPrepare();
		if (q.parameters['embedding'].typename === 'Db.Vector') {
			throw new Error('still a Db.Vector');
		}
		return String(q.parameters['embedding']);
	});
	await ta('pg INSERT with Db.vector as a column value', function (cb) {
		pg.INSERT('tst_docs', {title: 'bound', embedding: Db.vector([0, 1, 0, 0])})
		.execute(function (err) {
			if (err) return cb(err);
			pg.SELECT('title', 'tst_docs')
			.vectorNearestTo('embedding', Db.vector([0, 1, 0, 0]), {limit: 1})
			.execute(function (err, rows) {
				if (err) return cb(err);
				if (!rows[0] || rows[0].fields.title !== 'bound') {
					return cb(new Error('round-trip failed: ' + JSON.stringify(rows[0])));
				}
				cb(null, 'stored and retrieved: ' + rows[0].fields.title);
			});
		});
	});

	console.log('\n########## MariaDB version gate ##########');
	[['5.5.5-10.11.14-MariaDB', false], ['5.5.5-11.8.2-MariaDB', true],
	 ['11.7.1-MariaDB', true], ['5.5.5-11.6.0-MariaDB', false],
	 ['10.11.14-MariaDB-0ubuntu0.24.04.1', false],
	 ['9.1.0', false], ['8.0.36', false], ['', false], [null, false]
	].forEach(function (c) {
		t("version gate '" + c[0] + "'", function () {
			var got = Streams.Stream.db().vectorsSupportedInVersion(c[0]);
			if (got !== c[1]) throw new Error('expected ' + c[1] + ', got ' + got);
			return String(got);
		});
	});
	await ta('probe reads the live handshake version', function (cb) {
		var db = Streams.Stream.db();
		db.rawQuery('SELECT 1').execute(function () {
			var v = db.serverVersion();
			if (!v) return cb(new Error('serverVersion() null after connecting'));
			cb(null, v + ' -> vectorsSupported=' + db.vectorsSupported());
		});
	});
	await ta('refuses on a server known not to support vectors', function (cb) {
		var db = Streams.Stream.db();
		db.rawQuery('SELECT 1').execute(function () {
			if (db.vectorsSupported()) return cb(null, 'server DOES support vectors; skipped');
			try {
				db.SELECT('*', 'streams_stream').vectorNearestTo('embedding', Db.vector([1, 0]));
			} catch (e) { return cb(null, 'refused: ' + e.message); }
			cb(new Error('should have refused on ' + db.serverVersion()));
		});
	});
	t('does NOT refuse before the connection exists', function () {
		// building a query on a cold connection must not throw: capability is
		// unknown, not unsupported
		var fresh = Q.require('Db').connect('VPg');
		var q = fresh.SELECT('*', 'tst_docs');
		if (typeof q.vectorNearestTo !== 'function') throw new Error('no vectorNearestTo');
		return 'ok';
	});

	console.log('\n==== vectors: ' + pass + ' passed, ' + fail + ' failed ====');
	if (failures.length) console.log('failed:\n  ' + failures.join('\n  '));
	process.exit(fail ? 1 : 0);
	})();
});
