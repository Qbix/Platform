/**
 * @module Db
 */
var Q = require('Q');
var Db = Q.require('Db');

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
