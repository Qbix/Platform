// Db.Query.Mysql: a failed COMMIT must reach the caller as an error.
//
// Unlike the other scripts here this one does NOT go through Q.inc: it needs no
// app, no database and no npm install, because the only thing under test is
// which arguments execute() hands the caller when the COMMIT statement fails.
// It requires the real platform/classes/Db/Query/Mysql.js and stubs the four
// things that module touches from Q on this path (Q.require, Q.Pipe,
// Q.Config.get, Q.mixin) plus a scripted connection whose COMMIT answers with
// whatever the case needs. Run it from anywhere:
//
//     node platform/tests/committest.js
//
var path = require('path');
var Module = require('module');

var MYSQL_JS = path.resolve(__dirname, '..', 'classes', 'Db', 'Query', 'Mysql.js');

// --- the smallest Q this module needs ------------------------------------

// Q.Pipe as Db.Query.Mysql uses it: fill(field) returns a function that stores
// its arguments under that field, and the callback runs once every required
// field has been filled (params, subjects).
function Pipe(requires, callback) {
	this.requires = requires;
	this.callback = callback;
	this.params = {};
	this.subjects = {};
}
Pipe.prototype.fill = function (field) {
	var pipe = this;
	return function () {
		pipe.params[field] = Array.prototype.slice.call(arguments);
		pipe.subjects[field] = this;
		for (var i=0; i<pipe.requires.length; ++i) {
			if (!(pipe.requires[i] in pipe.params)) return;
		}
		pipe.callback(pipe.params, pipe.subjects);
	};
};

// Db.Query, the base constructor Db.Query.Mysql applies (classes/Db/Query.js).
function Query(db, type, clauses, bind) {
	this.db = db;
	this.type = type;
	this.clauses = clauses || {};
	this.after = {};
	this.parameters = bind || {};
	this.replacements = {};
	this.indexName = null;
	this.typename = 'Db.Query';
}
Query.TYPE_RAW = 1;
Query.TYPE_SELECT = 2;
Query.TYPE_INSERT = 3;
Query.TYPE_UPDATE = 4;
Query.TYPE_DELETE = 5;
Query.TYPE_ROLLBACK = 6;

var Db = { Query: Query, Expression: function Expression() {}, emit: function () {} };

var Q = {
	require: function (name) {
		if (name === 'Db') return Db;
		throw new Error('the committest.js Q stub has no ' + name);
	},
	Pipe: Pipe,
	Config: { get: function (keys, def) { return def; } },
	isArrayLike: function (x) { return Array.isArray(x); },
	isInteger: function (x) { return !isNaN(Number(x)) && Number(x) % 1 === 0; },
	copy: function (x) { var o = {}; for (var k in x) o[k] = x[k]; return o; },
	extend: function (t) {
		for (var i=1; i<arguments.length; ++i) {
			for (var k in arguments[i]) t[k] = arguments[i][k];
		}
		return t;
	},
	Exception: Error,
	// Q.mixin(A, B): copy B's prototype and statics onto A where A lacks them.
	// The module calls it once at load, as Q.mixin(Query_Mysql, Db.Query).
	mixin: function (A) {
		for (var i=1; i<arguments.length; ++i) {
			var m = arguments[i];
			for (var k in m.prototype) if (!(k in A.prototype)) A.prototype[k] = m.prototype[k];
			for (var s in m) if (!(s in A)) A[s] = m[s];
		}
	}
};

// Route this module's bare require('Q') to the stub, and nothing else.
var realResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent) {
	if (request === 'Q') return '\0Q-stub';
	return realResolve.apply(this, arguments);
};
require.cache['\0Q-stub'] = {
	id: '\0Q-stub', filename: '\0Q-stub', loaded: true, exports: Q
};

var Query_Mysql = require(MYSQL_JS);

// --- one UPDATE ... COMMIT against a scripted connection -----------------

/**
 * @param {Error|null} commitOutcome what the COMMIT statement answers with
 * @param {Function} callback receives (err, sent) — sent is the SQL in order
 */
function run(commitOutcome, callback) {
	var db = { connName: 'Test', emit: function () {}, toDateTime: function () {} };
	var q = new Query_Mysql(
		db, Db.Query.TYPE_UPDATE, { UPDATE: 't', SET: 'x = 1', COMMIT: 'COMMIT' }, {}, 't'
	);
	var sent = [];
	var connection = {
		query: function (sql, cb) {
			sent.push(sql);
			if (sql === 'COMMIT;') return process.nextTick(function () { cb(commitOutcome); });
			if (sql === 'ROLLBACK;') return process.nextTick(function () { cb(null); });
			return process.nextTick(function () { cb(null, { affectedRows: 1 }, []); });
		},
		escape: function (v) { return JSON.stringify(v); }
	};
	// getSQL() renders through build(), which wants the whole clause grammar;
	// the SQL text is irrelevant here, only which statements follow it.
	q.getSQL = function (cb) { cb('UPDATE t SET x = 1', connection); };
	q.toString = q.valueOf = function () { return 'UPDATE t SET x = 1'; };
	// shards: '' — one shard, the default connection, no sharding lookup.
	q.execute(function (err) { callback(err, sent); }, { shards: '' });
}

var pass = 0, fail = 0;
function t(name, fn) {
	try { fn(); console.log('[OK]   ' + name); pass++; }
	catch (e) { console.log('[FAIL] ' + name + ' :: ' + (e && (e.message || e))); fail++; }
}

run(null, function (err, sent) {
	t('a successful COMMIT still reports success', function () {
		if (sent.join(' | ') !== 'UPDATE t SET x = 1 | COMMIT;') {
			throw new Error('sent ' + sent.join(' | '));
		}
		if (err) throw new Error('err was ' + err);
	});

	var commitErr = new Error('Lock wait timeout exceeded; try restarting transaction');
	run(commitErr, function (err2, sent2) {
		t('a failed COMMIT is reported to the caller', function () {
			// execute() hands non-SELECT callers {shardName: error}.
			if (!err2) {
				throw new Error('callback got err=null for a write the failed COMMIT '
					+ 'discarded — the caller acknowledges a change the database never kept');
			}
			if (err2[''] !== commitErr) {
				throw new Error('the error reported is not the COMMIT failure: '
					+ require('util').inspect(err2, { depth: 1 }));
			}
		});
		t('the statement still ran and the COMMIT was still attempted', function () {
			if (sent2.join(' | ') !== 'UPDATE t SET x = 1 | COMMIT;') {
				throw new Error('sent ' + sent2.join(' | '));
			}
		});
		console.log('\n==== failed COMMIT: ' + pass + ' passed, ' + fail + ' failed ====');
		process.exit(fail ? 1 : 0);
	});
});
