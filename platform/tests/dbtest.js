require('./Q.inc')(function (Q) {
	var Db = Q.require('Db');
	var Streams = Q.plugins.Streams;
	var pass = 0, fail = 0, failures = [];

	function norm(s) { return String(s).replace(/\s+/g, ' ').trim(); }

	// synchronous SQL-building assertions
	function t(name, fn) {
		try {
			var r = fn();
			console.log('[OK]   ' + name + ' :: ' + norm(r).slice(0, 240));
			pass++;
		} catch (e) {
			console.log('[FAIL] ' + name + ' :: ' + (e && (e.message || e)));
			failures.push(name); fail++;
		}
	}

	// async execution assertions
	function ta(name, fn) {
		return new Promise(function (resolve) {
			var done = false;
			var timer = setTimeout(function () {
				if (done) return; done = true;
				console.log('[FAIL] ' + name + ' :: TIMEOUT');
				failures.push(name); fail++; resolve();
			}, 10000);
			function finish(err, res) {
				if (done) return; done = true; clearTimeout(timer);
				if (err) {
					console.log('[FAIL] ' + name + ' :: ' + (err.stack || err.message || JSON.stringify(err)));
					failures.push(name); fail++;
				} else {
					console.log('[OK]   ' + name + ' :: ' + norm(res === undefined ? '' : res).slice(0, 240));
					pass++;
				}
				resolve();
			}
			try { fn(finish); }
			catch (e) { finish(e); }
		});
	}

	var db = Streams.Stream.db();
	var S = function () { return db.SELECT('*', 'streams_stream'); };
	var p = 'streams_';
	function S() { return db.SELECT('*', p + 'stream'); }

	// ---------- query construction ----------
	t('SELECT basic', function () { return S().limit(1); });
	t('SELECT where', function () { return S().where({publisherId: 'x'}); });
	t('SELECT where IN', function () { return S().where({publisherId: ['a', 'b']}); });
	t('SELECT where empty IN', function () { return S().where({publisherId: []}); });
	t('SELECT where NULL', function () { return S().where({publisherId: null}); });
	t('SELECT where Range', function () {
		return S().where({insertedTime: new Db.Range('2020-01-01', true, false, '2021-01-01')});
	});
	t('SELECT tuple IN', function () {
		return S().where({'publisherId,name': [['a', 'b'], ['c', 'd']]});
	});
	t('SELECT expression', function () { return S().where(new Db.Expression('1=1')); });
	t('SELECT alias fields', function () { return db.SELECT({n: 'name'}, p + 'stream'); });
	t('andWhere', function () { return S().where({publisherId: 'x'}).andWhere({name: 'y'}); });
	t('orWhere', function () { return S().where({publisherId: 'x'}).orWhere({name: 'y'}); });
	t('join', function () {
		return db.SELECT('*', p + 'stream s').join(p + 'message m', new Db.Expression('s.name = m.streamName'));
	});
	t('groupBy+having', function () {
		return db.SELECT('publisherId, COUNT(1) c', p + 'stream').groupBy('publisherId').having({c: 2});
	});
	t('orderBy', function () { return S().orderBy('insertedTime', false); });
	t('limit offset', function () { return S().limit(10, 5); });
	t('after()', function () { return S().after('FROM', 'FORCE INDEX (PRIMARY)'); });
	t('after() twice keeps both', function () {
		var q = S().after('FROM', 'FORCE INDEX (PRIMARY)').after('WHERE', 'AND 1');
		if (!q.afterClauses['FROM'] || !q.afterClauses['WHERE']) {
			throw new Error('after clauses clobbered: ' + JSON.stringify(q.afterClauses));
		}
		return JSON.stringify(q.afterClauses);
	});
	t('lock', function () { return S().where({publisherId: 'x'}).lock('FOR UPDATE'); });
	t('INSERT', function () { return db.INSERT(p + 'stream', {publisherId: 'x', name: 'y'}); });
	t('INSERT onDuplicateKeyUpdate', function () {
		var sql = String(db.INSERT(p + 'stream', {publisherId: 'x', name: 'y'}).onDuplicateKeyUpdate({name: 'z'}));
		if (/SELECT|INSERT INTO[\s\S]*INSERT INTO/.test(sql.split('ON DUPLICATE')[1] || '')) {
			throw new Error('query object leaked into clause: ' + sql);
		}
		return sql;
	});
	t('UPDATE set', function () { return db.UPDATE(p + 'stream').set({name: 'z'}).where({publisherId: 'x'}); });
	t('UPDATE set twice', function () {
		var sql = String(db.UPDATE(p + 'stream').set({name: 'z'}).set({title: 'q'}).where({publisherId: 'x'}));
		if (sql.indexOf('SELECT') >= 0 || sql.indexOf('UPDATE', 1) >= 0) {
			throw new Error('query object leaked into SET: ' + sql);
		}
		return sql;
	});
	t('DELETE', function () { return db.DELETE(p + 'stream').where({publisherId: 'x'}); });
	t('rawQuery', function () { return db.rawQuery('SELECT 1 AS one'); });
	t('getSQL sync', function () { return S().where({publisherId: 'x'}).getSQL(); });

	// ---------- PHP/JS parity helpers ----------
	t('fromDate uses a 0-indexed month correctly', function () {
		// the Date constructor takes month 0-11; passing "11" for November
		// used to yield December, and "12" rolled into the next year
		var pairs = [['2023-01-15', '2023-01-15'], ['2023-11-14', '2023-11-14'],
			['2023-12-31', '2023-12-31'], ['2024-02-29', '2024-02-29']];
		pairs.forEach(function (p) {
			var got = db.toDate(db.fromDate(p[0]));
			if (got !== p[1]) throw new Error(p[0] + ' -> ' + got);
		});
		return 'round-trips on all 4 dates';
	});
	t('fromDateTime round-trips', function () {
		var v = '2023-12-31 23:59:59';
		var got = db.toDateTime(db.fromDateTime(v));
		if (got !== v) throw new Error(v + ' -> ' + got);
		return got;
	});
	t('fromDate returns milliseconds', function () {
		// JS timestamps are ms; PHP's mktime twin returns seconds
		var ms = db.fromDate('2023-11-14');
		if (ms !== 1699920000 * 1000) throw new Error('got ' + ms);
		return ms + ' (exactly 1000x the PHP value)';
	});
	t('limit(0) means zero rows, not all rows', function () {
		var sql = String(db.SELECT('*', 'streams_stream').limit(0));
		if (sql.indexOf('LIMIT 0') < 0) throw new Error('LIMIT 0 dropped: ' + sql);
		return norm(sql);
	});
	t('Db.normalize matches the PHP implementation', function () {
		var cases = {
			'Hello World!': 'hello_world_',
			'Ünïcode/x': '_n_code_x',
			'Café': 'caf_',
			'naïve test': 'na_ve_test',
			'日本語abc': '_abc',
			'a  b__c': 'a_b_c',
			'CamelCase': 'camelcase'
		};
		for (var k in cases) {
			var got = Db.normalize(k);
			if (got !== cases[k]) throw new Error(k + ' -> ' + got + ', expected ' + cases[k]);
		}
		if (Db.normalize(null) !== null) throw new Error('null should pass through');
		return Object.keys(cases).length + ' cases match PHP';
	});
	t('Db.hashCode and Db.hash exist and agree with PHP', function () {
		if (Db.hashCode('hello') !== 99162322) throw new Error('hashCode=' + Db.hashCode('hello'));
		if (Db.hash('hello') !== '5d41402abc4b2a76b9719d911017c592') {
			throw new Error('hash=' + Db.hash('hello'));
		}
		return 'hashCode + hash match';
	});

	// ---------- after-clauses ----------
	// These had almost no coverage, which is how a bug that silently dropped
	// every after-clause survived: the adapter assigned an after() METHOD over
	// the after data map, and build() read the clause off a function.
	t('every after-clause position reaches the SQL', function () {
		var q = db.SELECT('*', 'streams_stream s')
			.join('streams_stream m', new Db.Expression('s.name=m.name'))
			.where({publisherId: 'x'}).groupBy('s.name').having({c: 1})
			.orderBy('s.name').limit(5)
			.after('SELECT', '/*S*/').after('FROM', '/*F*/').after('JOIN', '/*J*/')
			.after('WHERE', '/*W*/').after('GROUP BY', '/*G*/').after('HAVING', '/*H*/')
			.after('ORDER BY', '/*O*/').after('LIMIT', '/*L*/');
		var sql = String(q);
		var missing = ['/*S*/','/*F*/','/*J*/','/*W*/','/*G*/','/*H*/','/*O*/','/*L*/']
			.filter(function (m) { return sql.indexOf(m) < 0; });
		if (missing.length) throw new Error('dropped: ' + missing.join(','));
		return 'all 8 positions present';
	});
	t('LOCK after-clause reaches the SQL', function () {
		var sql = String(db.SELECT('*', 'streams_stream').where({publisherId: 'x'})
			.lock('FOR UPDATE').after('LOCK', 'SKIP LOCKED'));
		if (sql.indexOf('SKIP LOCKED') < 0) throw new Error(sql);
		return norm(sql);
	});
	t('a copy uses its own after-clauses', function () {
		var q = db.SELECT('*', 'streams_stream').after('FROM', '/*orig*/');
		var c = q.copy();
		c.after('FROM', '/*copy*/');
		if (String(c).indexOf('/*copy*/') < 0) throw new Error('copy ignored its own');
		if (String(q).indexOf('/*copy*/') >= 0) throw new Error('leaked into the original');
		return 'independent';
	});
	t('build() receives the instance as `this`', function () {
		// instance methods close over `mq`; every call site must be attached so
		// `this` and `mq` are the same object
		var q = db.SELECT('*', 'streams_stream');
		var seen = null, real = q.build;
		q.build = function () { seen = this; return real.apply(this, arguments); };
		q.getSQL(function () {});
		if (seen !== q) throw new Error('this !== the query instance');
		return 'this === instance';
	});

	// ---------- named-parameter substitution ----------
	t('a repeated named parameter is fully substituted', function () {
		var q = db.rawQuery('SELECT :x AS a, :x AS b', {});
		q.parameters['x'] = 'HELLO';
		var sql = q.getSQL();
		if (sql.indexOf(':x') >= 0) throw new Error('left unsubstituted: ' + sql);
		return sql;
	});
	t(':p1 does not match inside :p10', function () {
		var q = db.rawQuery('SELECT :p10 AS a, :p1 AS b', {});
		q.parameters['p1'] = 'ONE'; q.parameters['p10'] = 'TEN';
		var sql = q.getSQL();
		if (!/'TEN' AS a/.test(sql) || !/'ONE' AS b/.test(sql)) throw new Error(sql);
		return sql;
	});
	t('$ and backslashes in values survive substitution', function () {
		var q = db.rawQuery('SELECT :v AS a', {});
		q.parameters['v'] = "it's $1 & 100% \\ done";
		var sql = q.getSQL();
		if (sql.indexOf('$1') < 0) throw new Error('lost $1: ' + sql);
		return sql;
	});
	t('copy() is not infinite recursion', function () {
		// Q.copy delegates to x.copy() when present; the old implementation
		// called Q.copy(this) and blew the stack on every call
		var q = S().where({publisherId: 'x'});
		var c = q.copy();
		if (!c || typeof c.build !== 'function') throw new Error('copy failed');
		return 'copy() returns a usable ' + c.constructor.name;
	});

	// ---------- the regression: shard()/copy() ----------
	t('shard() returns {shardName: query}', function () {
		var q = S().where({publisherId: 'x'});
		var shards = q.shard();
		var keys = Object.keys(shards);
		if (!keys.length) throw new Error('shard() returned no shards');
		keys.forEach(function (k) {
			if (typeof shards[k].getSQL !== 'function') {
				throw new Error('shard "' + k + '" value has no getSQL (this is the reported bug)');
			}
		});
		return 'keys=[' + keys.join('|') + ']';
	});
	t('shardIndex() is null when unsharded', function () {
		var v = S().shardIndex();
		if (v !== null) throw new Error('expected null, got ' + JSON.stringify(v));
		return 'null';
	});
	t('copy() preserves methods and SQL', function () {
		var q = S().where({publisherId: 'x'});
		var c = q.copy();
		if (typeof c.getSQL !== 'function') throw new Error('copy() lost getSQL');
		if (typeof c.execute !== 'function') throw new Error('copy() lost execute');
		if (norm(c.build()) !== norm(q.build())) {
			throw new Error('copy() SQL differs:\n' + c.build() + '\nvs\n' + q.build());
		}
		return c.getSQL();
	});
	t('copy() is independent of original', function () {
		var q = S().where({publisherId: 'x'});
		var c = q.copy();
		c.orderBy('name');
		if (String(q).indexOf('ORDER BY') >= 0) throw new Error('copy() shares clauses with original');
		return 'independent';
	});
	t('applyHash md5 pads to length', function () {
		var h = Db.Query.applyHash('hello', 'md5', 7);
		if (h.length !== 7) throw new Error('bad length ' + h.length);
		return h;
	});
	t('shard() across a real partition', function () {
		var q = S().where({publisherId: 'x'});
		q.className = 'Streams_stream';
		q.cachedShardIndex = {
			fields: {publisherId: 'md5'},
			partition: ['       ', '4000000', '8000000', 'c000000']
		};
		var shards = q.shard();
		var keys = Object.keys(shards);
		keys.forEach(function (k) {
			if (typeof shards[k].getSQL !== 'function') throw new Error('shard ' + k + ' not a query');
		});
		return 'keys=[' + keys.join('|') + ']';
	});
	t('shard() with no criteria hits all shards', function () {
		var q = S();
		q.className = 'Streams_stream';
		q.cachedShardIndex = {fields: {publisherId: 'md5'}, partition: ['       ', '8000000']};
		var keys = Object.keys(q.shard());
		if (keys.join() !== '*') throw new Error('expected ["*"], got ' + JSON.stringify(keys));
		return '*';
	});

	// ---------- real execution against MariaDB ----------
	(async function () {
		console.log('');
		await ta('EXEC rawQuery', function (cb) {
			db.rawQuery('SELECT 1 AS one').execute(function (params) {
				var err = params[''][0];
				cb(err, JSON.stringify(params[''][1]));
			});
		});
		await ta('EXEC SELECT rows', function (cb) {
			S().limit(3).execute(function (err, rows) { cb(err, 'rows=' + (rows && rows.length)); });
		});
		await ta('EXEC SELECT where', function (cb) {
			S().where({publisherId: 'Hebrews'}).limit(3).execute(function (err, rows) {
				cb(err, 'rows=' + (rows && rows.length));
			});
		});
		await ta('EXEC Db.Row select', function (cb) {
			Streams.Stream.SELECT('*').limit(3).execute(function (err, rows) {
				if (err) return cb(err);
				cb(null, 'rows=' + rows.length + ' isRow=' + (rows[0] ? !!rows[0].fields : 'n/a'));
			});
		});
		await ta('EXEC options.shards as array', function (cb) {
			db.rawQuery('SELECT 2 AS two').execute(function (params) {
				var keys = Object.keys(params);
				if (!keys.length) return cb(new Error('array shards produced no results (silent no-op)'));
				cb(params[keys[0]][0], 'shards=[' + keys.join('|') + ']');
			}, {shards: ['']});
		});
		await ta('EXEC insert/update/select/delete roundtrip', function (cb) {
			db.rawQuery("DELETE FROM streams_stream WHERE publisherId='jstest'").execute(function () {
				db.INSERT(p + 'stream', {
					publisherId: 'jstest', name: 'Streams/jstest', type: 'Streams/text',
					title: 't', content: '', insertedTime: new Db.Expression('CURRENT_TIMESTAMP')
				}).execute(function (err) {
					if (err) return cb(err);
					db.UPDATE(p + 'stream').set({title: 't2'}).where({publisherId: 'jstest'})
					.execute(function (err) {
						if (err) return cb(err);
						db.SELECT('title', p + 'stream').where({publisherId: 'jstest'})
						.execute(function (err, rows) {
							if (err) return cb(err);
							var title = rows[0] && rows[0].fields.title;
							db.DELETE(p + 'stream').where({publisherId: 'jstest'})
							.execute(function (err) {
								if (err) return cb(err);
								db.SELECT('1', p + 'stream').where({publisherId: 'jstest'})
								.execute(function (err, rows2) {
									if (err) return cb(err);
									if (title !== 't2') return cb(new Error('update did not apply: ' + title));
									if (rows2.length) return cb(new Error('delete did not apply'));
									cb(null, 'title=' + title + ' remaining=' + rows2.length);
								});
							});
						});
					});
				});
			});
		});
		await ta('EXEC Streams.Message.post (the reported crash)', function (cb) {
			Streams.Stream.SELECT('*').where({publisherId: 'Hebrews'}).limit(1)
			.execute(function (err, rows) {
				if (err) return cb(err);
				if (!rows.length) return cb(null, 'skipped, no streams in db');
				postTo(rows[0].fields.publisherId, rows[0].fields.name);
			});
			function postTo(publisherId, name) {
				Streams.Message.post({
					publisherId: publisherId, streamName: name, byUserId: publisherId,
					type: 'Streams/chat/message', content: 'db harness'
				}, function (err, message) {
					if (err) return cb(err);
					cb(null, 'ordinal=' + (message && message.fields && message.fields.ordinal));
				});
			}
		});

		console.log('\n==== JS: ' + pass + ' passed, ' + fail + ' failed ====');
		if (failures.length) console.log('failed: ' + failures.join(', '));
		process.exit(fail ? 1 : 0);
	})();
});
