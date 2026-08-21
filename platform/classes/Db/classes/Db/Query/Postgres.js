/**
 * @module Db
 */
var Q = require('Q');
var Db = Q.require('Db');

/**
 * PostgreSQL query class for Node.js.
 * Inherits all query-building methods (where, join, orderBy, etc.)
 * from Db.Query.Mysql, then overrides execute() to use the pg Pool.
 * @class Postgres
 * @namespace Db.Query
 * @constructor
 */
var Query_Postgres = function (pg, type, clauses, parameters, table) {
	// Inherit all builder methods from Db.Query.Mysql
	Db.Query.Mysql.call(this, pg, type, clauses, parameters, table);
	this.typename = 'Db.Query.Postgres';

	var mq = this;

	// Override execute to use pg Pool instead of mysql connection
	var _originalExecute = mq.execute;
	mq.execute = function (callback, options) {
		options = options || {};
		var pool = mq.db.connection;
		if (!pool) {
			mq.db.reallyConnect();
			pool = mq.db.connection;
		}
		if (!pool) {
			var err = new Q.Exception("Db.Query.Postgres: not connected");
			if (callback) { callback(err); return mq; }
			throw err;
		}

		var sql = mq.build();
		for (var k in mq.replacements) {
			sql = sql.split(k).join(mq.replacements[k]);
		}

		// Translate MySQL-isms to Postgres:
		// backtick quoting → double-quote
		sql = sql.replace(/`([^`]+)`/g, '"$1"');
		// IFNULL → COALESCE
		sql = sql.replace(/\bIFNULL\b/gi, 'COALESCE');
		// INSERT IGNORE → INSERT ... ON CONFLICT DO NOTHING
		if (/^INSERT\s+IGNORE/i.test(sql)) {
			sql = sql.replace(/^INSERT\s+IGNORE/i, 'INSERT');
			if (sql.indexOf('ON CONFLICT') === -1) {
				sql += ' ON CONFLICT DO NOTHING';
			}
		}

		// Convert named params (:name) to positional ($1, $2, ...)
		var values = [];
		var paramIndex = 0;
		var processedSql = sql.replace(/:(\w+)/g, function (match, name) {
			if (mq.parameters.hasOwnProperty(name)) {
				var val = mq.parameters[name];
				if (val && val.typename === 'Db.Expression') {
					return val.valueOf();
				}
				values.push(val);
				paramIndex++;
				return '$' + paramIndex;
			}
			return match;
		});

		pool.query(processedSql, values, function (err, result) {
			if (callback) {
				if (err) {
					err.sql = processedSql;
					callback(err, null, null);
				} else {
					// Mysql and Sqlite hand back Db.Row instances (or {fields: row}
					// wrappers); this adapter was returning raw pg rows, so any code
					// written against the row.fields contract broke on Postgres, and
					// className models were never constructed.
					var rows = result.rows || [];
					var isSelect = mq.type === Db.Query.TYPE_SELECT
						|| (mq.type === Db.Query.TYPE_RAW && /^\s*SELECT/i.test(processedSql));
					if (!isSelect) {
						return callback(null, rows, result.fields || null);
					}
					var results2 = [], ri, rowClass = null;
					if (mq.className) {
						try {
							rowClass = Q.require(mq.className.split('_').join('/'));
						} catch (rcErr) {
							rowClass = null;
						}
					}
					for (ri = 0; ri < rows.length; ++ri) {
						if (rowClass) {
							results2.push(rowClass.newRow
								? rowClass.newRow(rows[ri], true)
								: new rowClass(rows[ri], true));
						} else {
							results2.push({ fields: rows[ri] });
						}
					}
					callback(null, results2, result.fields || null);
				}
			}
		});
		return mq;
	};

	// Override onDuplicateKeyUpdate to use Postgres ON CONFLICT syntax
	var _originalODKU = mq.onDuplicateKeyUpdate;
	mq.onDuplicateKeyUpdate = function (updates) {
		mq._pgConflictUpdates = updates;
		return mq;
	};

	// Override build to inject ON CONFLICT for upserts
	var _originalBuild = mq.build;
	mq.build = function (options) {
		var sql = _originalBuild.call(mq, options);
		if (mq._pgConflictUpdates && mq.type === Db.Query.TYPE_INSERT) {
			var setParts = [];
			var updates = mq._pgConflictUpdates;
			if (Array.isArray(updates)) {
				for (var i = 0; i < updates.length; i++) {
					setParts.push('"' + updates[i] + '" = EXCLUDED."' + updates[i] + '"');
				}
			} else if (typeof updates === 'object') {
				for (var col in updates) {
					if (updates.hasOwnProperty(col)) {
						var val = updates[col];
						if (val && val.typename === 'Db.Expression') {
							setParts.push('"' + col + '" = ' + val.valueOf());
						} else {
							setParts.push('"' + col + '" = EXCLUDED."' + col + '"');
						}
					}
				}
			}
			if (setParts.length > 0) {
				// Detect PK from table for ON CONFLICT clause
				var pk = mq._pgConflictKey || mq.clauses['ON_CONFLICT_KEY'];
				if (pk) {
					sql += ' ON CONFLICT ("' + pk + '") DO UPDATE SET ' + setParts.join(', ');
				} else {
					sql += ' ON CONFLICT DO UPDATE SET ' + setParts.join(', ');
				}
			}
		}
		return sql;
	};
};

/**
 * Quote a column identifier for PostgreSQL.
 * @method column
 * @static
 */
Query_Postgres.column = function _column(column) {
	if (column instanceof Db.Expression) return column.valueOf();
	if (column.indexOf('"') >= 0 || column.indexOf('.') >= 0
		|| column.indexOf('(') >= 0 || column.indexOf('*') >= 0) {
		return column;
	}
	return '"' + column + '"';
};

/**
 * Quote an identifier for PostgreSQL (double quotes).
 * @method quoted
 * @static
 */
Query_Postgres.quoted = function _quoted(identifier) {
	return '"' + identifier.replace(/"/g, '""') + '"';
};

Q.mixin(Query_Postgres, Db.Query);

module.exports = Query_Postgres;
