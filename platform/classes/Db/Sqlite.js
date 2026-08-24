/**
 * @module Db
 */
var Q = require('Q');
var Db = Q.require('Db');
var _vectorMetrics = {};

var _dbs = {};

/**
 * SQLite connection class for Node.js.
 * Uses better-sqlite3 (synchronous, WAL mode).
 * @class Sqlite
 * @namespace Db
 * @constructor
 * @param {string} connName
 * @param {object} [dsn]
 */
function Db_Sqlite(connName, dsn) {
	var info = Db.getConnection(connName);
	if (!info) {
		throw new Q.Exception("Database connection \"" + connName + "\" wasn't registered with Db.");
	}
	if (!dsn) {
		dsn = Db.parseDsnString(info['dsn']);
	}
	// SQLite uses 'main' as the default schema qualifier
	info.dbname = 'main';
	dsn.dbname = 'main';
	var dbm = this;

	dbm.connName = connName;
	dbm.connection = null;
	dbm.connected = false;

	dbm.info = function (shardName, modifications) {
		return Q.extend({}, info, modifications || {});
	};

	dbm.reallyConnect = function (callback, shardName, modifications) {
		var merged = Q.extend({}, info, modifications || {});
		// Extract file path directly from DSN: "sqlite:/tmp/hebrews.db" → "/tmp/hebrews.db"
		var filePath = merged.dsn.replace(/^sqlite:\/?\/?/i, '/');
		var cacheKey = filePath || connName;
		if (_dbs[cacheKey]) {
			dbm.connection = _dbs[cacheKey];
			dbm.connected = true;
			callback && callback();
			return dbm;
		}
		try {
			var Database = require('better-sqlite3');
			dbm.connection = new Database(filePath);
			dbm.connection.pragma('journal_mode = WAL');
			dbm.connection.pragma('foreign_keys = ON');
			_dbs[cacheKey] = dbm.connection;
			dbm.connected = true;
		} catch (e) {
			Q.log('Db.Sqlite connection error: ' + e.message, 'warn');
			dbm.connected = false;
		}
		callback && callback();
		return dbm;
	};

	// True once the sqlite-vec extension has been loaded into this connection.
	dbm.vectorsSupported = function () {
		if (!dbm.connection) { return false; }
		try {
			dbm.connection.prepare('SELECT vec_version()').get();
			return true;
		} catch (e) {
			return false;
		}
	};

	/**
	 * Loads the sqlite-vec extension into this connection.
	 * Call once after connecting, before any vectorNearestTo() query.
	 */
	/**
	 * Callback-shaped twin of vectorsSupported(), for parity with the other
	 * adapters (Postgres genuinely needs to ask the server).
	 * @method vectorSupportCheck
	 */
	dbm.vectorSupportCheck = function (callback) {
		var ok = dbm.vectorsSupported();
		callback && callback(null, ok);
		return ok;
	};

	dbm.vectorExtensionLoad = function () {
		if (!dbm.connection) { dbm.reallyConnect(); }
		try {
			require('sqlite-vec').load(dbm.connection);
			return true;
		} catch (e) {
			Q.log('Db.Sqlite: could not load sqlite-vec: ' + e.message, 'warn');
			return false;
		}
	};

	/**
	 * Creates the vec0 sidecar table for a vector column, plus triggers that
	 * keep it in step with the base table.
	 *
	 * SQLite cannot store vectors on the row, so they live in a separate
	 * virtual table joined on rowid. Rather than asking callers to mirror every
	 * write, the base table keeps the packed float32 BLOB as the source of
	 * truth and SQLite itself maintains the sidecar. Drift then becomes
	 * impossible: the triggers fire for raw SQL just as they do for Db_Row.
	 *
	 * @method vectorIndexCreate
	 * @param {String} table The base table, which must have a BLOB column
	 * @param {String} column The column holding packed float32 vectors
	 * @param {Number} dimensions
	 * @param {Object} [options]
	 * @param {String} [options.metric='cosine'] 'cosine' or 'euclidean'. vec0
	 *   bakes the metric into the column declaration, and unlike MariaDB it does
	 *   NOT fall back to a scan when you query with a different one -- it just
	 *   returns the metric it was built with. vectorNearestTo() therefore refuses a
	 *   mismatch rather than silently answering in the wrong units.
	 * @param {Boolean} [options.backfill=true] Populate from existing rows
	 */
	dbm.vectorIndexCreate = function (table, column, dimensions, options, callback) {
		options = options || {};
		var metric = (options.metric || 'cosine').toLowerCase();
		if (metric !== 'cosine' && metric !== 'euclidean') {
			throw new Q.Exception(
				"Db.Sqlite.vectorIndexCreate: metric must be cosine or euclidean, got '"
				+ metric + "'"
			);
		}
		// vec0 spells L2 'l2', not 'euclidean'
		var vecMetric = (metric === 'euclidean') ? 'l2' : 'cosine';
		if (!dbm.connection) { dbm.reallyConnect(); }
		if (!dbm.vectorsSupported()) {
			dbm.vectorExtensionLoad();
		}
		var c = dbm.connection;
		var t = String(table).replace(/^\w+\./, '').replace(/["`]/g, '');
		var col = String(column).replace(/["`]/g, '');
		var vec = t + '_vec';
		var q = function (n) { return '"' + n + '"'; };

		// vec0's declaration parser does not accept a quoted column name --
		// CREATE VIRTUAL TABLE x USING vec0("embedding" float[768]) fails with
		// "Could not parse". The name goes in bare; it is validated above.
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(col)) {
			throw new Q.Exception(
				"Db.Sqlite.vectorIndexCreate: unsupported column name '" + col + "'"
			);
		}
		// IF NOT EXISTS would silently keep a sidecar built for a DIFFERENT
		// metric, so changing metric became a no-op that returned the old
		// distances. Drop and rebuild when the metric differs.
		delete _vectorMetrics[t];
		var existing = dbm.vectorIndexMetric(t);
		if (existing && existing !== metric) {
			c.exec('DROP TABLE IF EXISTS ' + q(vec) + ';');
		}
		c.exec('CREATE VIRTUAL TABLE IF NOT EXISTS ' + q(vec)
			+ ' USING vec0(' + col + ' float[' + parseInt(dimensions) + ']'
			+ ' distance_metric=' + vecMetric + ');');
		_vectorMetrics[t] = metric;

		// AFTER INSERT / DELETE / UPDATE, mirroring the BLOB into the sidecar.
		// The WHEN guard lets rows exist without a vector yet.
		c.exec('DROP TRIGGER IF EXISTS ' + q(vec + '_ai') + ';');
		c.exec('CREATE TRIGGER ' + q(vec + '_ai') + ' AFTER INSERT ON ' + q(t)
			+ ' WHEN NEW.' + q(col) + ' IS NOT NULL BEGIN'
			+ ' INSERT INTO ' + q(vec) + '(rowid, ' + q(col) + ')'
			+ ' VALUES (NEW.rowid, NEW.' + q(col) + '); END;');

		c.exec('DROP TRIGGER IF EXISTS ' + q(vec + '_ad') + ';');
		c.exec('CREATE TRIGGER ' + q(vec + '_ad') + ' AFTER DELETE ON ' + q(t)
			+ ' BEGIN DELETE FROM ' + q(vec) + ' WHERE rowid = OLD.rowid; END;');

		c.exec('DROP TRIGGER IF EXISTS ' + q(vec + '_au') + ';');
		c.exec('CREATE TRIGGER ' + q(vec + '_au') + ' AFTER UPDATE ON ' + q(t)
			+ ' BEGIN DELETE FROM ' + q(vec) + ' WHERE rowid = OLD.rowid;'
			+ ' INSERT INTO ' + q(vec) + '(rowid, ' + q(col) + ')'
			+ ' SELECT NEW.rowid, NEW.' + q(col)
			+ ' WHERE NEW.' + q(col) + ' IS NOT NULL; END;');

		if (options.backfill !== false) {
			c.exec('DELETE FROM ' + q(vec) + ';');
			c.exec('INSERT INTO ' + q(vec) + '(rowid, ' + q(col) + ')'
				+ ' SELECT rowid, ' + q(col) + ' FROM ' + q(t)
				+ ' WHERE ' + q(col) + ' IS NOT NULL;');
		}
		callback && callback(null);
		return dbm;
	};

	/**
	 * Removes the sidecar table and its triggers.
	 * @method vectorIndexDrop
	 */
	/**
	 * The metric a sidecar index was built with, or null if unknown.
	 * @method vectorIndexMetric
	 */
	dbm.vectorIndexMetric = function (table, column, callback) {
		var t = String(table).replace(/^\w+\./, '').replace(/["`]/g, '');
		function _done(v) { callback && callback(null, v); return v; }
		if (_vectorMetrics[t]) { return _done(_vectorMetrics[t]); }
		if (!dbm.connection) { return _done(null); }
		try {
			var row = dbm.connection.prepare(
				"SELECT sql FROM sqlite_master WHERE name = ?"
			).get(t + '_vec');
			if (!row || !row.sql) { return _done(null); }
			var m = /distance_metric\s*=\s*(\w+)/i.exec(row.sql);
			if (!m) { return _done('euclidean'); }  // vec0 default is L2
			return _done(_vectorMetrics[t] =
				(m[1].toLowerCase() === 'cosine') ? 'cosine' : 'euclidean');
		} catch (e) {
			return _done(null);
		}
	};

	dbm.vectorIndexDrop = function (table, column, callback) {
		if (!dbm.connection) { dbm.reallyConnect(); }
		var t = String(table).replace(/^\w+\./, '').replace(/["`]/g, '');
		var vec = t + '_vec';
		['_ai', '_ad', '_au'].forEach(function (sfx) {
			dbm.connection.exec('DROP TRIGGER IF EXISTS "' + vec + sfx + '";');
		});
		dbm.connection.exec('DROP TABLE IF EXISTS "' + vec + '";');
		delete _vectorMetrics[t];
		callback && callback(null);
		return dbm;
	};

	/**
	 * Reports whether the sidecar has drifted from the base table.
	 * Should always be zero once vectorIndexCreate has run; useful as a
	 * migration check after importing data with triggers disabled.
	 * @method vectorIndexDrift
	 * @return {Object} {base, sidecar, drift}
	 */
	dbm.vectorIndexDrift = function (table, column) {
		if (!dbm.connection) { dbm.reallyConnect(); }
		var t = String(table).replace(/^\w+\./, '').replace(/["`]/g, '');
		var col = String(column).replace(/["`]/g, '');
		var base = dbm.connection.prepare(
			'SELECT COUNT(1) n FROM "' + t + '" WHERE "' + col + '" IS NOT NULL'
		).get().n;
		var side = dbm.connection.prepare(
			'SELECT COUNT(1) n FROM "' + t + '_vec"'
		).get().n;
		return {base: base, sidecar: side, drift: base - side};
	};

	dbm.prefix = function () { return info.prefix || ''; };
	dbm.dbname = function () { return 'main'; };

	dbm.rawQuery = function (query, parameters) {
		query = query.replaceAllPlaceholders({ '{{prefix}}': dbm.prefix() });
		return new Db.Query.Sqlite(this, Db.Query.TYPE_RAW, {"RAW": query}, parameters);
	};

	dbm.rollback = function (criteria) {
		return new Db.Query.Sqlite(this, Db.Query.TYPE_ROLLBACK).rollback(criteria);
	};

	dbm.SELECT = function (fields, tables) {
		if (!fields) throw new Q.Exception("fields not specified in call to 'SELECT'.");
		if (tables === undefined) throw new Q.Exception("tables not specified in call to 'SELECT'.");
		return new Db.Query.Sqlite(this, Db.Query.TYPE_SELECT).SELECT(fields, tables);
	};

	dbm.INSERT = function (table_into, fields) {
		if (!table_into) throw new Q.Exception("table not specified in call to 'INSERT'.");
		var cols = [], vals = [];
		for (var c in fields) {
			var v = fields[c];
			cols.push(Db.Query.Sqlite.column(c));
			vals.push(v && v.typename === 'Db.Expression' ? v.valueOf() : ':' + c);
		}
		return new Db.Query.Sqlite(this, Db.Query.TYPE_INSERT,
			{ "INTO": table_into, "FIELDS": cols.join(', '), "VALUES": vals.join(', ') },
			fields, table_into);
	};

	dbm.UPDATE = function (table) {
		if (!table) throw new Q.Exception("table not specified in call to 'UPDATE'.");
		return new Db.Query.Sqlite(this, Db.Query.TYPE_UPDATE, {"UPDATE": table}, null, table);
	};

	dbm.DELETE = function (table_from, table_using) {
		if (!table_from) throw new Q.Exception("table not specified in call to 'DELETE'.");
		var cl = {"FROM": table_from};
		if (table_using) cl["USING"] = table_using;
		return new Db.Query.Sqlite(this, Db.Query.TYPE_DELETE, cl, null, table_from);
	};

	dbm.uniqueId = function (table, field, callback) {
		var chars = 'abcdefghijklmnopqrstuvwxyz';
		var id = '';
		for (var i = 0; i < 8; i++) {
			id += chars[Math.floor(Math.random() * chars.length)];
		}
		callback && callback(id);
		return id;
	};

	dbm.fromDate = function (d) { return d instanceof Date ? d.toISOString().slice(0,10) : d; };
	dbm.fromDateTime = function (d) { return d instanceof Date ? d.toISOString().slice(0,19).replace('T',' ') : d; };
	dbm.toDate = function (i) { return new Date(i); };
	dbm.toDateTime = function (i) { return new Date(i); };
	dbm.getCurrentTimestamp = function (cb) {
		var ts = new Date().toISOString().slice(0,19).replace('T',' ');
		cb && cb(ts);
		return ts;
	};
}

Q.makeEventEmitter(Db_Sqlite, true);
module.exports = Db_Sqlite;
