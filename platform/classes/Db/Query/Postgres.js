/**
 * @module Db
 */
var Q = require('Q');
var Db = Q.require('Db');
var _pgVecCounter = 0;

/**
 * PostgreSQL query class for Node.js.
 * Inherits all query-building methods (where, join, orderBy, etc.)
 * from Db.Query.Mysql, then overrides execute() to use the pg Pool.
 * @class Postgres
 * @namespace Db.Query
 * @constructor
 */
var Query_Postgres = function (pg, type, clauses, parameters, table) {
	// Inherits query building from the Db.Query base class, the same way
	// Db_Query_Postgres extends Db_Query in PHP. It used to call
	// Db.Query.Mysql.call() here, which transplanted MySQL's instance methods
	// (and MySQL's backtick quoting) onto every Postgres query.
	Db.Query.call(this, pg, type, clauses, parameters, table);
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

		mq._vectorParametersPrepare();
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

	// onDuplicateKeyUpdate / build overrides now live on the prototype,
	// below, since the base class supplies them.
	void 0;
};

Query_Postgres.prototype.onDuplicateKeyUpdate = function (updates) {
	this._pgConflictUpdates = updates;
	return this;
};

Query_Postgres.prototype.build = function (options) {
	var mq = this;
	{
		var sql = Db.Query.prototype.build.call(mq, options);
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
	}
};

Query_Postgres.prototype._randomExpression = function () { return 'RANDOM()'; };

Query_Postgres.prototype.vectorLiteral = function (vector) {
	// pgvector parses the bracketed text form directly for a vector column
	return vector.toText();
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


// ── vector search (pgvector) ──

Query_Postgres.prototype.vectorMetricsSupported = function () { return ['cosine', 'euclidean', 'dot']; };

Query_Postgres.prototype.vectorsSupported = function () {
	return this.db && typeof this.db.vectorsSupported === 'function'
		? this.db.vectorsSupported()
		: false;
};

Query_Postgres.prototype._vectorDistance_expression = function (column, vector) {
	var op;
	switch (vector.metric) {
		case 'cosine':    op = '<=>'; break;
		case 'euclidean': op = '<->'; break;
		case 'dot':       op = '<#>'; break;
		default:
			throw new Q.Exception(
				"Db.Query.Postgres: unsupported metric '" + vector.metric + "'"
			);
	}
	var name = '_vec_' + (++_pgVecCounter);
	this.parameters[name] = vector.toText();
	// The ::vector cast is required: without it Postgres sees a text literal
	// and the operator does not resolve.
	return Query_Postgres.column(column) + ' ' + op + ' (:' + name + ')::vector';
};

// PHP defines __toString on each adapter class too (Db_Query_Postgres,
// Db_Query_Sqlite); mirror that so String(query) builds SQL instead of
// falling through to Object.prototype.toString.
Query_Postgres.prototype.toString = function () {
	try { return this.build(); }
	catch (e) { return '*****' + (e && e.message); }
};
Query_Postgres.prototype.valueOf = function () { return this.toString(); };

Q.mixin(Query_Postgres, Db.Query);

module.exports = Query_Postgres;
