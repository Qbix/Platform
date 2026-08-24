/**
 * @module Db
 */
var Q = require('Q');
var Db = Q.require('Db');

var _pools = {};

/**
 * PostgreSQL connection class for Node.js.
 * Uses the 'pg' (node-postgres) package.
 * @class Postgres
 * @namespace Db
 * @constructor
 * @param {string} connName
 * @param {object} [dsn]
 */
function Db_Postgres(connName, dsn) {
	var info = Db.getConnection(connName);
	if (!info) {
		throw new Q.Exception("Database connection \"" + connName + "\" wasn't registered with Db.");
	}
	if (!dsn) {
		dsn = Db.parseDsnString(info['dsn']);
	}
	var dbm = this;

	dbm.connName = connName;
	dbm.connection = null;
	dbm.connected = false;

	dbm.info = function (shardName, modifications) {
		return Q.extend({}, info, modifications || {});
	};

	dbm.reallyConnect = function (callback, shardName, modifications) {
		var merged = Q.extend({}, info, modifications || {});
		var parsedDsn = Db.parseDsnString(merged.dsn);
		var cacheKey = merged.dsn || connName;
		if (_pools[cacheKey]) {
			dbm.connection = _pools[cacheKey];
			dbm.connected = true;
			callback && callback();
			return dbm;
		}
		try {
			var pg = require('pg');
			var pool = new pg.Pool({
				host: parsedDsn.host || 'localhost',
				port: parseInt(parsedDsn.port) || 5432,
				database: parsedDsn.dbname || connName,
				user: merged.username || parsedDsn.user,
				password: merged.password,
				max: 10
			});
			dbm.connection = pool;
			_pools[cacheKey] = pool;
			dbm.connected = true;
		} catch (e) {
			Q.log('Db.Postgres connection error: ' + e.message, 'warn');
			dbm.connected = false;
		}
		callback && callback();
		return dbm;
	};

	var _pgVectors = null;
	// Unknown means "not yet probed", not "unsupported". Refusing before the
	// async probe has answered made vectorNearestTo() fail on the first call of
	// every process. If pgvector really is missing, Postgres itself raises a
	// clear "operator does not exist" error.
	dbm.vectorsSupported = function () { return _pgVectors !== false; };
	/**
	 * Checks whether the pgvector extension is installed in this database.
	 */
	dbm.vectorSupportCheck = function (callback) {
		callback = callback || function () {};
		if (_pgVectors !== null) { return callback(null, _pgVectors); }
		dbm.rawQuery(
			"SELECT 1 AS ok FROM pg_extension WHERE extname = 'vector'"
		).execute(function (err, rows) {
			if (err) { return callback(err); }
			_pgVectors = !!(rows && rows.length);
			callback(null, _pgVectors);
		});
	};

	/**
	 * Adds an HNSW vector index. pgvector picks the operator class from the
	 * metric, which is why the metric has to be known at index time.
	 * @method vectorIndexCreate
	 */
	dbm.vectorIndexCreate = function (table, column, dimensions, options, callback) {
		options = options || {};
		var metric = (options.metric || 'cosine').toLowerCase();
		var ops = {
			cosine: 'vector_cosine_ops',
			euclidean: 'vector_l2_ops',
			dot: 'vector_ip_ops'
		}[metric];
		if (!ops) {
			throw new Q.Exception(
				"Db.Postgres.vectorIndexCreate: unsupported metric '" + metric + "'"
			);
		}
		var t = String(table).replace(/["]/g, '');
		var c = String(column).replace(/["]/g, '');
		var name = t + '_' + c + '_hnsw';
		var m = parseInt(options.M || 16);
		var sql = 'CREATE INDEX IF NOT EXISTS "' + name + '" ON "' + t
			+ '" USING hnsw ("' + c + '" ' + ops + ') WITH (m = ' + m + ')';
		return dbm.rawQuery(sql).execute(function (err) {
			callback && callback(err || null);
		});
	};

	dbm.vectorIndexDrop = function (table, column, callback) {
		var t = String(table).replace(/["]/g, '');
		var c = String(column).replace(/["]/g, '');
		return dbm.rawQuery(
			'DROP INDEX IF EXISTS "' + t + '_' + c + '_hnsw"'
		).execute(function (err) { callback && callback(err || null); });
	};

	/**
	 * The metric a vector index was built with, read back from the operator
	 * class in the index definition.
	 * @method vectorIndexMetric
	 */
	dbm.vectorIndexMetric = function (table, column, callback) {
		var t = String(table).replace(/["]/g, '');
		var c = String(column).replace(/["]/g, '');
		return dbm.rawQuery(
			"SELECT indexdef FROM pg_indexes WHERE tablename = '" + t
			+ "' AND indexname = '" + t + '_' + c + "_hnsw'"
		).execute(function (err, rows) {
			if (err) { return callback && callback(err); }
			var r = rows && rows[0];
			var def = r && (r.indexdef || (r.fields && r.fields.indexdef));
			if (!def) { return callback && callback(null, null); }
			var metric = /vector_cosine_ops/.test(def) ? 'cosine'
				: (/vector_ip_ops/.test(def) ? 'dot' : 'euclidean');
			callback && callback(null, metric);
		});
	};

	dbm.prefix = function () { return info.prefix || ''; };
	dbm.dbname = function () { return dsn.dbname || info.dbname || connName; };

	dbm.rawQuery = function (query, parameters) {
		query = query.replaceAllPlaceholders({ '{{prefix}}': dbm.prefix() });
		return new Db.Query.Postgres(this, Db.Query.TYPE_RAW, {"RAW": query}, parameters);
	};

	dbm.rollback = function (criteria) {
		return new Db.Query.Postgres(this, Db.Query.TYPE_ROLLBACK).rollback(criteria);
	};

	dbm.SELECT = function (fields, tables) {
		if (!fields) throw new Q.Exception("fields not specified in call to 'SELECT'.");
		if (tables === undefined) throw new Q.Exception("tables not specified in call to 'SELECT'.");
		return new Db.Query.Postgres(this, Db.Query.TYPE_SELECT).SELECT(fields, tables);
	};

	dbm.INSERT = function (table_into, fields) {
		if (!table_into) throw new Q.Exception("table not specified in call to 'INSERT'.");
		var cols = [], vals = [];
		for (var c in fields) {
			var v = fields[c];
			cols.push(Db.Query.Postgres.column(c));
			vals.push(v && v.typename === 'Db.Expression' ? v.valueOf() : ':' + c);
		}
		return new Db.Query.Postgres(this, Db.Query.TYPE_INSERT,
			{ "INTO": table_into, "FIELDS": cols.join(', '), "VALUES": vals.join(', ') },
			fields, table_into);
	};

	dbm.UPDATE = function (table) {
		if (!table) throw new Q.Exception("table not specified in call to 'UPDATE'.");
		return new Db.Query.Postgres(this, Db.Query.TYPE_UPDATE, {"UPDATE": table}, null, table);
	};

	dbm.DELETE = function (table_from, table_using) {
		if (!table_from) throw new Q.Exception("table not specified in call to 'DELETE'.");
		var cl = {"FROM": table_from};
		if (table_using) cl["USING"] = table_using;
		return new Db.Query.Postgres(this, Db.Query.TYPE_DELETE, cl, null, table_from);
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

Q.makeEventEmitter(Db_Postgres, true);
module.exports = Db_Postgres;
