/**
 * @module Db
 */
var Q = require('Q');
var Db = Q.require('Db');
var _sqliteVecCounter = 0;

/**
 * PK cache so we don't hit PRAGMA on every upsert
 * @private
 */
var _pkCache = {};

/**
 * SQLite query class for Node.js.
 * Inherits query-building from Db.Query, overrides execute() for better-sqlite3.
 * @class Sqlite
 * @namespace Db.Query
 * @constructor
 */
var Query_Sqlite = function (sqlite, type, clauses, parameters, table) {
	// Inherits query building from the Db.Query base class, mirroring how
	// Db_Query_Sqlite extends Db_Query in PHP. Previously this called
	// Db.Query.Mysql.call(), which meant every SQLite query was built as
	// MySQL and then regex-rewritten on the way out.
	Db.Query.call(this, sqlite, type, clauses, parameters, table);
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

		mq._vectorParametersPrepare();
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


Query_Sqlite.prototype._randomExpression = function () { return 'RANDOM()'; };

Query_Sqlite.prototype.vectorLiteral = function (vector) {
	return vector.toBuffer();   // sqlite-vec wants packed little-endian float32
};

Query_Sqlite.prototype._least = function () {
	return 'MIN(' + Array.prototype.slice.call(arguments).join(', ') + ')';
};
Query_Sqlite.prototype._greatest = function () {
	return 'MAX(' + Array.prototype.slice.call(arguments).join(', ') + ')';
};

// ── vector search (sqlite-vec) ──
// SQLite is the structural outlier. Vectors live in a separate vec0 virtual
// table, so this cannot be an ORDER BY on the current table -- it has to join
// against a KNN subquery. By convention the sidecar table is "<table>_vec"
// and its rowid matches the base table's rowid.

Query_Sqlite.prototype.vectorMetricsSupported = function () { return ['cosine', 'euclidean']; };

Query_Sqlite.prototype.vectorsSupported = function () {
	return this.db && typeof this.db.vectorsSupported === 'function'
		? this.db.vectorsSupported()
		: false;
};

Query_Sqlite.prototype.vectorTableFor = function (table) {
	return String(table).replace(/^\w+\./, '').replace(/["`]/g, '') + '_vec';
};

Query_Sqlite.prototype.vectorNearestTo = function (column, vector, options) {
	options = options || {};
	if (!vector || vector.typename !== 'Db.Vector') {
		vector = new (Db.Vector)(vector, options.metric);
	}
	if (!this.vectorsSupported()) {
		throw new Q.Exception(
			"Db.Query.Sqlite.vectorNearestTo: the sqlite-vec extension is not loaded"
		);
	}
	var metrics = this.vectorMetricsSupported();
	if (metrics.indexOf(vector.metric) < 0) {
		throw new Q.Exception(
			"Db.Query.vectorNearestTo: " + this.typename + " supports "
			+ metrics.join(' and ') + " distance, not '" + vector.metric + "'"
		);
	}
	// k is required by vec0; without a limit there is no sensible default,
	// so fall back to something bounded rather than scanning everything.
	var k = (options.limit !== undefined && options.limit !== null)
		? parseInt(options.limit) : 100;
	var base = (this.clauses['FROM'] || [this.table])[0];
	var vecTable = this.vectorTableFor(base);
	// The metric is baked into the vec0 column declaration. Querying with a
	// different one does NOT re-rank -- vec0 just returns the metric it was
	// built with -- so a mismatch would silently produce distances in the
	// wrong units. Refuse instead.
	if (this.db && typeof this.db.vectorIndexMetric === 'function') {
		var built = this.db.vectorIndexMetric(base);
		if (built && built !== vector.metric) {
			throw new Q.Exception(
				"Db.Query.Sqlite.vectorNearestTo: " + vecTable + " was built for "
				+ built + " distance, but this query asks for " + vector.metric
				+ ". Rebuild the index with vectorIndexCreate(..., {metric: '"
				+ vector.metric + "'}) or query with '" + built + "'."
			);
		}
	}
	var alias = '_vec' + (++_sqliteVecCounter);
	var pName = '_vec_' + _sqliteVecCounter;
	this.parameters[pName] = vector.toBuffer();

	var join = 'JOIN (SELECT rowid AS _rid, distance FROM ' + this._quoted(vecTable)
		+ ' WHERE ' + this._quoted(column) + ' MATCH :' + pName
		+ ' AND k = ' + k + ') ' + alias
		+ ' ON ' + alias + '._rid = ' + this._quoted(base) + '.rowid';
	this.clauses['JOIN'] = this.clauses['JOIN']
		? this.clauses['JOIN'] + '\n' + join : join;

	var distanceExpr = alias + '.distance';
	this.clauses['ORDER BY'] = this.clauses['ORDER BY']
		? this.clauses['ORDER BY'] + ', ' + distanceExpr : distanceExpr;
	if (options.distanceAs) {
		var select = this.clauses['SELECT'] || '*';
		this.clauses['SELECT'] = select + ', ' + distanceExpr
			+ ' AS ' + this._column(options.distanceAs);
	}
	if (options.limit !== undefined && options.limit !== null) {
		this.limit(options.limit, options.offset);
	}
	return this;
};

// PHP defines __toString on each adapter class too (Db_Query_Postgres,
// Db_Query_Sqlite); mirror that so String(query) builds SQL instead of
// falling through to Object.prototype.toString.
Query_Sqlite.prototype.toString = function () {
	try { return this.build(); }
	catch (e) { return '*****' + (e && e.message); }
};
Query_Sqlite.prototype.valueOf = function () { return this.toString(); };

Query_Sqlite.prototype.nearestTo = function () {
	return this.vectorNearestTo.apply(this, arguments);
};

Q.mixin(Query_Sqlite, Db.Query);

module.exports = Query_Sqlite;
