// Real end-to-end test: actually connects to SQLite and Postgres and executes.
require('./Q.inc')(function (Q) {
	var Db = Q.require('Db');
	var pass = 0, fail = 0, failures = [];

	function norm(s) { return String(s).replace(/\s+/g, ' ').trim(); }
	function t(name, fn) {
		try {
			var r = fn();
			console.log('[OK]   ' + name + ' :: ' + norm(r === undefined ? '' : r).slice(0, 200));
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
			}, 10000);
			function finish(err, res) {
				if (done) return; done = true; clearTimeout(timer);
				if (err) {
					console.log('[FAIL] ' + name + ' :: ' + (err.message || err));
					failures.push(name); fail++;
				} else {
					console.log('[OK]   ' + name + ' :: ' + norm(res === undefined ? '' : res).slice(0, 200));
					pass++;
				}
				resolve();
			}
			try { fn(finish); } catch (e) { finish(e); }
		});
	}

	// register connections
	Db.setConnection('TestSqlite', {dsn: 'sqlite:/tmp/qbixtest.db', prefix: 'tst_'});
	Db.setConnection('TestPg', {
		dsn: 'pgsql:host=127.0.0.1;port=5432;dbname=qbixtest',
		username: 'qbix', password: 'qbixpass', prefix: 'tst_'
	});

	(async function () {

	// ================= SQLITE =================
	console.log('\n########## SQLITE (better-sqlite3, live file) ##########');
	var sq = Db.connect('TestSqlite');
	t('sqlite connect', function () {
		sq.reallyConnect();
		if (!sq.connected) throw new Error('not connected');
		return 'connected, typename=' + sq.typename;
	});

	await ta('sqlite CREATE TABLE', function (cb) {
		sq.rawQuery('DROP TABLE IF EXISTS tst_item;').execute(function (err) {
			if (err) return cb(err);
			sq.rawQuery('CREATE TABLE tst_item (id INTEGER PRIMARY KEY, publisherId TEXT, name TEXT, weight REAL);')
			.execute(function (err) { cb(err, 'created'); });
		});
	});

	// --- construction (exercises the base class through the Sqlite adapter) ---
	t('sqlite SELECT+where', function () { return sq.SELECT('*', 'tst_item').where({publisherId: 'x'}); });
	t('sqlite where IN', function () { return sq.SELECT('*', 'tst_item').where({publisherId: ['a', 'b']}); });
	t('sqlite where NULL', function () { return sq.SELECT('*', 'tst_item').where({publisherId: null}); });
	t('sqlite where Expression', function () {
		var sql = String(sq.SELECT('*', 'tst_item').where(new Db.Expression('1=1')));
		if (sql.indexOf('typename') >= 0) throw new Error('Expression enumerated as object: ' + sql);
		return sql;
	});
	t('sqlite join Expression', function () {
		return sq.SELECT('*', 'tst_item a').join('tst_item b', new Db.Expression('a.id=b.id'));
	});
	t('sqlite groupBy/having', function () {
		return sq.SELECT('publisherId, COUNT(1) c', 'tst_item').groupBy('publisherId').having({c: 1});
	});
	t('sqlite orderBy/limit', function () { return sq.SELECT('*', 'tst_item').orderBy('id', false).limit(5, 2); });
	t('sqlite after()', function () {
		var q = sq.SELECT('*', 'tst_item').after('FROM', 'INDEXED BY sqlite_autoindex_tst_item_1');
		if (!q.afterClauses['FROM']) throw new Error('after clause lost');
		return JSON.stringify(q.afterClauses);
	});
	t('sqlite copy()', function () {
		var q = sq.SELECT('*', 'tst_item').where({publisherId: 'x'});
		var c = q.copy();
		if (typeof c.execute !== 'function') throw new Error('copy lost execute');
		if (norm(c.build()) !== norm(q.build())) throw new Error('copy SQL differs');
		c.orderBy('id');
		if (String(q).indexOf('ORDER BY') >= 0) throw new Error('copy shares state');
		return c.build();
	});
	t('sqlite shard() returns a map', function () {
		var q = sq.SELECT('*', 'tst_item').where({publisherId: 'x'});
		var s = q.shard(), keys = Object.keys(s);
		if (!keys.length) throw new Error('no shards');
		keys.forEach(function (k) {
			if (typeof s[k].build !== 'function') throw new Error('shard value is not a query');
		});
		return 'keys=[' + keys.join('|') + ']';
	});

	// --- live execution ---
	await ta('sqlite INSERT executes', function (cb) {
		sq.INSERT('tst_item', {publisherId: 'alice', name: 'first', weight: 1.5})
		.execute(function (err, res) { cb(err, 'ok'); });
	});
	await ta('sqlite INSERT second row', function (cb) {
		sq.INSERT('tst_item', {publisherId: 'bob', name: 'second', weight: 2.5})
		.execute(function (err) { cb(err, 'ok'); });
	});
	await ta('sqlite SELECT returns rows', function (cb) {
		sq.SELECT('*', 'tst_item').execute(function (err, rows) {
			if (err) return cb(err);
			if (rows.length !== 2) return cb(new Error('expected 2 rows, got ' + rows.length));
			cb(null, 'rows=' + rows.length + ' first=' + rows[0].fields.publisherId);
		});
	});
	await ta('sqlite SELECT where filters', function (cb) {
		sq.SELECT('*', 'tst_item').where({publisherId: 'alice'}).execute(function (err, rows) {
			if (err) return cb(err);
			if (rows.length !== 1) return cb(new Error('expected 1 row, got ' + rows.length));
			cb(null, 'name=' + rows[0].fields.name);
		});
	});
	await ta('sqlite SELECT where IN', function (cb) {
		sq.SELECT('*', 'tst_item').where({publisherId: ['alice', 'bob']}).execute(function (err, rows) {
			cb(err, rows && ('rows=' + rows.length));
		});
	});
	await ta('sqlite UPDATE executes', function (cb) {
		sq.UPDATE('tst_item').set({name: 'renamed'}).where({publisherId: 'alice'})
		.execute(function (err) {
			if (err) return cb(err);
			sq.SELECT('name', 'tst_item').where({publisherId: 'alice'}).execute(function (err, rows) {
				if (err) return cb(err);
				if (rows[0].fields.name !== 'renamed') return cb(new Error('update did not apply'));
				cb(null, 'name=' + rows[0].fields.name);
			});
		});
	});
	await ta('sqlite DELETE executes', function (cb) {
		sq.DELETE('tst_item').where({publisherId: 'bob'}).execute(function (err) {
			if (err) return cb(err);
			sq.SELECT('*', 'tst_item').execute(function (err, rows) {
				if (err) return cb(err);
				if (rows.length !== 1) return cb(new Error('expected 1 row after delete'));
				cb(null, 'remaining=' + rows.length);
			});
		});
	});

	// ================= POSTGRES =================
	console.log('\n########## POSTGRES (pg, live server) ##########');
	var pgdb = Db.connect('TestPg');
	t('postgres connect object', function () {
		return 'typename=' + pgdb.typename + ' conn=' + pgdb.connName;
	});
	t('postgres SELECT+where', function () { return pgdb.SELECT('*', 'tst_item').where({publisherId: 'x'}); });
	t('postgres where Expression', function () {
		var sql = String(pgdb.SELECT('*', 'tst_item').where(new Db.Expression('1=1')));
		if (sql.indexOf('typename') >= 0) throw new Error('Expression enumerated as object: ' + sql);
		return sql;
	});
	t('postgres join Expression', function () {
		return pgdb.SELECT('*', 'tst_item a').join('tst_item b', new Db.Expression('a.id=b.id'));
	});
	t('postgres orderBy/limit', function () { return pgdb.SELECT('*', 'tst_item').orderBy('id', false).limit(5, 2); });
	t('postgres UPDATE set', function () { return pgdb.UPDATE('tst_item').set({name: 'z'}).where({publisherId: 'x'}); });
	t('postgres after()', function () {
		var q = pgdb.SELECT('*', 'tst_item').after('WHERE', 'AND 1=1');
		if (!q.afterClauses['WHERE']) throw new Error('after clause lost');
		return JSON.stringify(q.afterClauses);
	});
	t('postgres copy()', function () {
		var q = pgdb.SELECT('*', 'tst_item').where({publisherId: 'x'});
		var c = q.copy();
		if (typeof c.execute !== 'function') throw new Error('copy lost execute');
		if (norm(c.build()) !== norm(q.build())) throw new Error('copy SQL differs');
		return c.build();
	});
	t('postgres shard() returns a map', function () {
		var q = pgdb.SELECT('*', 'tst_item').where({publisherId: 'x'});
		var s = q.shard(), keys = Object.keys(s);
		if (!keys.length) throw new Error('no shards');
		keys.forEach(function (k) {
			if (typeof s[k].build !== 'function') throw new Error('shard value is not a query');
		});
		return 'keys=[' + keys.join('|') + ']';
	});

	await ta('postgres CREATE TABLE', function (cb) {
		pgdb.rawQuery('DROP TABLE IF EXISTS tst_item; CREATE TABLE tst_item (id SERIAL PRIMARY KEY, "publisherId" TEXT, name TEXT, weight REAL);')
		.execute(function (err) { cb(err, 'created'); });
	});
	await ta('postgres INSERT executes', function (cb) {
		pgdb.INSERT('tst_item', {publisherId: 'alice', name: 'first', weight: 1.5})
		.execute(function (err) { cb(err, 'ok'); });
	});
	await ta('postgres SELECT returns rows', function (cb) {
		pgdb.SELECT('*', 'tst_item').execute(function (err, rows) {
			if (err) return cb(err);
			cb(null, 'rows=' + (rows && rows.length));
		});
	});
	await ta('postgres SELECT where filters', function (cb) {
		pgdb.SELECT('*', 'tst_item').where({publisherId: 'alice'}).execute(function (err, rows) {
			if (err) return cb(err);
			if (!rows || rows.length !== 1) return cb(new Error('expected 1 row, got ' + (rows && rows.length)));
			cb(null, 'name=' + rows[0].fields.name);
		});
	});
	await ta('postgres UPDATE executes', function (cb) {
		pgdb.UPDATE('tst_item').set({name: 'renamed'}).where({publisherId: 'alice'})
		.execute(function (err) {
			if (err) return cb(err);
			pgdb.SELECT('name', 'tst_item').where({publisherId: 'alice'}).execute(function (err, rows) {
				if (err) return cb(err);
				if (rows[0].fields.name !== 'renamed') return cb(new Error('update did not apply'));
				cb(null, 'name=' + rows[0].fields.name);
			});
		});
	});
	await ta('postgres DELETE executes', function (cb) {
		pgdb.DELETE('tst_item').where({publisherId: 'alice'}).execute(function (err) {
			if (err) return cb(err);
			pgdb.SELECT('*', 'tst_item').execute(function (err, rows) {
				if (err) return cb(err);
				cb(null, 'remaining=' + (rows ? rows.length : 0));
			});
		});
	});

	console.log('\n==== adapters: ' + pass + ' passed, ' + fail + ' failed ====');
	if (failures.length) console.log('failed: ' + failures.join('\n        '));
	process.exit(fail ? 1 : 0);
	})();
});
