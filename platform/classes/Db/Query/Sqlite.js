/**
 * @module Db
 */
var Q = require('Q');
var Db = Q.require('Db');

/**
 * PK cache so we don't hit PRAGMA on every upsert
 * @private
 */
var _pkCache = {};

/**
 * SQLite query class for Node.js.
 * Inherits query-building from Query.Mysql, overrides execute() for better-sqlite3.
 * @class Sqlite
 * @namespace Db.Query
 * @constructor
 */
var Query_Sqlite = function (sqlite, type, clauses, parameters, table) {
	Db.Query.Mysql.call(this, sqlite, type, clauses, parameters, table);
	this.typename = 'Db.Query.Sqlite';

	var mq = this;

	/**
	 * Get primary key columns for a table (cached).
	 * @private
	 */
	function _getPrimaryKey(connection, tableName) {
		// Strip schema qualifier: "main.streams_stream" → "streams_stream"
		var bare = tableName.replace(/^\w+\./, '').replace(/["`]/g, '');
		if (_pkCache[bare]) return _pkCache[bare];
		try {
			var rows = connection.prepare(
				"PRAGMA table_info(\"" + bare + "\")"
			).all();
			var pkCols = [];
			for (var i = 0; i < rows.length; i++) {
				if (rows[i].pk > 0) pkCols.push(rows[i].name);
			}
			if (pkCols.length > 0) _pkCache[bare] = pkCols;
			return pkCols;
		} catch (e) {
			return [];
		}
	}

	/**
	 * Translate MySQL ON DUPLICATE KEY UPDATE to SQLite ON CONFLICT DO UPDATE SET.
	 * Mirrors the logic in PHP Db_Query_Sqlite::build_onDuplicateKeyUpdate().
	 * @private
	 */
	function _translateUpsert(sql, connection) {
		var m = sql.match(
			/^(INSERT\s+INTO\s+(\S+)\s*\([^)]*\)\s*\n?VALUES\s*\([^)]*\))\s*\n?ON DUPLICATE KEY UPDATE\s+(.+)$/is
		);
		if (!m) return sql;

		var insertPart = m[1];
		var tableName = m[2];
		var updateAssignments = m[3];

		// Get PK columns from the table
		var pkCols = _getPrimaryKey(connection, tableName);
		if (pkCols.length === 0) {
			// Fallback: use DO NOTHING (can't determine conflict target)
			return insertPart + "\nON CONFLICT DO NOTHING";
		}

		// Build: ON CONFLICT (pk1, pk2) DO UPDATE SET col = excluded.col, ...
		// But keep the original assignments since they use :_dupUpd_ parameters
		var conflictTarget = pkCols.map(function(c) {
			return '"' + c + '"';
		}).join(', ');

		return insertPart + "\nON CONFLICT (" + conflictTarget 
			+ ") DO UPDATE SET " + updateAssignments;
	}

	/**
	 * Override execute to use better-sqlite3 synchronous API.
	 * @method execute
	 */
	mq.execute = function (callback, options) {
		options = options || {};
		var connection = mq.db.connection;
		if (!connection) {
			mq.db.reallyConnect();
			connection = mq.db.connection;
		}
		if (!connection) {
			var err = new Q.Exception("Db.Query.Sqlite: not connected to " + mq.db.connName);
			if (callback) { callback(err); return mq; }
			throw err;
		}

		var sql = mq.build();
		// Apply replacements
		for (var k in mq.replacements) {
			sql = sql.split(k).join(mq.replacements[k]);
		}

		// Translate ON DUPLICATE KEY UPDATE → ON CONFLICT ... DO UPDATE SET
		if (sql.indexOf('ON DUPLICATE KEY UPDATE') >= 0) {
			sql = _translateUpsert(sql, connection);
		}

		// Translate MySQL functions to SQLite equivalents
		sql = sql.replace(/\bLEAST\s*\(/gi, 'MIN(');
		sql = sql.replace(/\bGREATEST\s*\(/gi, 'MAX(');
		sql = sql.replace(/\bRAND\s*\(\s*\)/gi, 'RANDOM()');
		sql = sql.replace(/\bIF\s*\(/gi, 'IIF(');
		// JSON_UNQUOTE(JSON_EXTRACT(col, path)) → json_extract(col, path)
		sql = sql.replace(/\bJSON_UNQUOTE\s*\(\s*JSON_EXTRACT\s*\(([^)]+)\)\s*\)/gi, 'json_extract($1)');
		sql = sql.replace(/\bJSON_EXTRACT\s*\(/gi, 'json_extract(');
		// CONCAT('a', b) → ('a' || b)
		sql = sql.replace(/\bCONCAT\s*\(([^)]+)\)/gi, function(m, args) {
			return '(' + args.split(',').map(function(s) { return s.trim(); }).join(' || ') + ')';
		});

		// Collect named parameters
		var params = {};
		for (var p in mq.parameters) {
			var val = mq.parameters[p];
			if (val === undefined) val = null;
			if (val && val.typename === 'Db.Expression') {
				sql = sql.split(':' + p).join(val.valueOf());
			} else {
				params[p] = val;
			}
		}

		try {
			var isSelect = mq.type === Db.Query.TYPE_SELECT
				|| (mq.type === Db.Query.TYPE_RAW && /^\s*(SELECT|PRAGMA)/i.test(sql));

			var result;
			if (isSelect) {
				var stmt = connection.prepare(sql);
				result = (Object.keys(params).length > 0)
					? stmt.all(params) : stmt.all();
			} else {
				if (Object.keys(params).length > 0) {
					try {
						var stmt2 = connection.prepare(sql);
						result = stmt2.run(params);
					} catch (prepErr) {
						// Multi-statement SQL — split and exec individually
						var statements = sql.split(';').filter(function(s) {
							return s.trim().length > 0;
						});
						for (var si = 0; si < statements.length; si++) {
							connection.exec(statements[si]);
						}
						result = { changes: 0 };
					}
				} else {
					connection.exec(sql);
					result = { changes: 0 };
				}
			}

			if (callback) {
				if (isSelect) {
					// Wrap results like MySQL adapter: each row becomes {fields: row}
					// If className is set, wrap in the model class instead
					var results2 = [];
					var rows = result || [];
					if (mq.className) {
						try {
							var rowClass = Q.require(mq.className.split('_').join('/'));
							for (var ri = 0; ri < rows.length; ri++) {
								var row = rowClass.newRow
									? rowClass.newRow(rows[ri], true)
									: new rowClass(rows[ri], true);
								results2.push(row);
							}
						} catch (rcErr) {
							// Fallback to plain {fields: row} wrapper
							for (var ri2 = 0; ri2 < rows.length; ri2++) {
								results2.push({ fields: rows[ri2] });
							}
						}
					} else {
						for (var ri3 = 0; ri3 < rows.length; ri3++) {
							results2.push({ fields: rows[ri3] });
						}
					}
					callback(null, results2, null);
				} else {
					callback(null, result, null);
				}
			}
		} catch (e) {
			if (callback) {
				callback(e, null, null);
			} else {
				throw e;
			}
		}
		return mq;
	};
};

/**
 * Quote a column identifier for SQLite.
 * @method column
 * @static
 */
Query_Sqlite.column = function _column(column) {
	if (column instanceof Db.Expression) return column.valueOf();
	if (column.indexOf('"') >= 0 || column.indexOf('.') >= 0
		|| column.indexOf('(') >= 0 || column.indexOf('*') >= 0) {
		return column;
	}
	return '"' + column + '"';
};

Q.mixin(Query_Sqlite, Db.Query);

module.exports = Query_Sqlite;
