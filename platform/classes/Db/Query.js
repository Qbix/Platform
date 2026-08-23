/**
 * @module Db
 */
var Q = require('Q');

/**
 * Base query builder. All DBMS-agnostic SQL construction lives here.
 * Adapters (Mysql, Sqlite, Postgres) extend this and override:
 *   execute(), column(), getSQL(), reallyConnect(),
 *   _onDuplicateKeyUpdate_internal(), _buildLock()
 *
 * @class Query
 * @namespace Db
 * @constructor
 */
var Query = function(db, type, clauses, parameters, table) {
	this.db = db;
	this.type = type;
	this.clauses = clauses || {};
	// after-clauses live in their own map: the adapters assign an after()
	// method onto the instance, which used to overwrite this.after entirely.
	this.afterClauses = {};
	this.parameters = parameters || {};
	this.table = table || null;
	this.criteria = {};
	this.replacements = {};
	this.indexName = null;
	this.typename = "Db.Query";
	this.className = null;
	this._dupUpdI = 1;

	if (db) {
		this.replacements['{{prefix}}'] = db.prefix ? db.prefix() : '';
		var dn = db.dbname ? db.dbname() : '';
		this.replacements['{{dbname}}'] = dn || '';
	}

	// Merge Db.Expression parameters
	if (parameters) {
		for (var k in parameters) {
			var p = parameters[k];
			if (p && p.typename === 'Db.Expression') {
				if (p.parameters) {
					Q.extend(this.parameters, p.parameters);
				}
			} else {
				this.parameters[k] = p;
			}
		}
	}
};

// Lazy Db reference (avoids circular)
var _Db;
function Db() { if (!_Db) _Db = Q.require('Db'); return _Db; }

// The rest of this file refers to the Db namespace both as Db() and as Db.Xyz
// (e.g. Db.Query.TYPE_SELECT, Db.Expression, Db.Range). Without these getters
// the latter silently resolve to undefined on the Db function object, which is
// what turned every type switch below into a TypeError. Resolve them lazily so
// the circular require between Db.js and Db/Query.js is still avoided.
["Query", "Expression", "Range", "Row", "Mysql", "Sqlite", "Postgres"].forEach(function (k) {
	if (k in Db) return;
	Object.defineProperty(Db, k, {
		configurable: true,
		get: function () { return Db()[k]; }
	});
});

// Types of queries available right now
/**
 * Raw query
 * @property TYPE_RAW
 * @type integer
 * @final
 * @default 1
 */
Query.TYPE_RAW = 1;
/**
 * Select query
 * @property TYPE_SELECT
 * @type integer
 * @final
 * @default 2
 */
Query.TYPE_SELECT = 2;
/**
 * Insert query
 * @property TYPE_INSERT
 * @type integer
 * @final
 * @default 3
 */
Query.TYPE_INSERT = 3;
/**
 * Update query
 * @property TYPE_UPDATE
 * @type integer
 * @final
 * @default 4
 */
Query.TYPE_UPDATE = 4;
/**
 * Delete query
 * @property TYPE_DELETE
 * @type integer
 * @final
 * @default 5
 */
Query.TYPE_DELETE = 5;
/**
 * Rollback query
 * @property TYPE_ROLLBACK
 * @type integer
 * @final
 * @default 6
 */
Query.TYPE_ROLLBACK = 6;

// ── Lazy subclass accessors (avoids circular requires) ──
Object.defineProperty(Query, "Mysql", {
	get: function() { return Q.require("Db/Query/Mysql"); }
});
Object.defineProperty(Query, "Sqlite", {
	get: function() { return Q.require("Db/Query/Sqlite"); }
});
Object.defineProperty(Query, "Postgres", {
	get: function() { return Q.require("Db/Query/Postgres"); }
});

/**
 * Default column quoting — ANSI SQL double-quotes.
 * MySQL overrides with backticks.
 */
Query.column = function(column) {
	if (column instanceof Db().Expression) return column.valueOf();
	if (typeof column !== 'string') return String(column);
	if (column.indexOf('"') >= 0 || column.indexOf('.') >= 0
		|| column.indexOf('(') >= 0 || column.indexOf('*') >= 0) {
		return column;
	}
	return '"' + column + '"';
};

Query.least = function(a, b) {
	return new (Db().Expression)("LEAST(" + a + ", " + b + ")");
};
Query.greatest = function(a, b) {
	return new (Db().Expression)("GREATEST(" + a + ", " + b + ")");
};

/**
 * Use the adapter's column() if available, else default.
 * @private
 */
Query.prototype._column = function(col) {
	return (this.constructor.column || Query.column)(col);
};


/**
 * Builds the SELECT clause of the query
 * @method SELECT
 * @param {string|object} fields The fields as strings, or "*", or array of alias=>field
 * @param {string|object} [tables] The tables to select from
 * @param {boolean} [repeat=false] Whether to use SELECT again even if it was already used
 * @return {Db.Query} The resulting query object
 */
	Query.prototype.SELECT = function (fields, tables, repeat) {
		var as = ' '; // was: ' AS ', but now we made it more standard SQL
		var column, alias, fields_list, prev_tables_list;
		var table, table_string, tables_array, prev_tables_array;
		var that = this;
		if (typeof fields === 'object') {
			fields_list = [];
			for (alias in fields) {
				column = this._column(fields[alias]);
				if (isNaN(alias))
					fields_list.push(column + as + alias);
				else
					fields_list.push(column);
			}
			fields = fields_list.join(', ');
		}
		if (typeof fields !== 'string') {
			throw new Q.Exception("The fields to select need to be specified correctly.");
		}

		this.clauses['SELECT'] = this.clauses['SELECT'] ? this.clauses['SELECT'] + ", " + fields : fields;
		if (!tables) {
			return this;
		}

		function get_table_string(table, alias) {
			var table_string;
			if (table && table.typename === "Db.Expression") {
				// this is a subquery
				table_string = "(" + table + ")";
				Q.extend(that.parameters, table.parameters);
			} else {
				table_string = table.trim();
			}
			if (typeof alias !== "undefined" && alias) {
				table_string += as + alias;
			}
			return table_string;
		}
		
		if (!tables) {
			return this;
		}
		
		tables_array = [];
		switch (Q.typeOf(tables)) {
			case "Db.Expression":
				tables_array.push(get_table_string(tables));
				break;
			case "object":
				prev_tables_array = this.clauses['FROM'] ? this.clauses['FROM'] : [];
				for (alias in tables) {
					table_string = get_table_string(tables[alias], alias);
					if (!repeat && prev_tables_array.indexOf(table_string) >= 0) {
						continue;
					}
					tables_array.push(table_string);
				}
				break;
			case "string":
				tables_array = [tables];
				break;
			case "array":
				tables_array = tables;
				break;
			default:
				throw new Q.Exception("Db.Query: tables must be string, array or object");
		}
		this.clauses['FROM'] = this.clauses['FROM'] ? this.clauses['FROM'].concat(tables_array) : tables_array;

		return this;
	};

/**
 * Adds a JOIN clause to the query
 * @method join
 * @param {string|Db.Expression} table The table to join with
 * @param {object} condition The condition to join on
 * @param {string} [joinType='INNER'] The type of join (INNER, LEFT, RIGHT, CROSS)
 * @return {Db.Query} The resulting query object
 */
	Query.prototype.join = function (table, condition, join_type) {
		if (!join_type) {
			join_type = "INNER";
		}
		switch (this.type) {
			case Db.Query.TYPE_SELECT:
			case Db.Query.TYPE_UPDATE:
				break;
			case Db.Query.TYPE_DELETE:
				if (!this.afterClauses['FROM']) break;
			default:
				throw new Q.Exception("the JOIN clause does not belong in this context.");
		}

		var expr, value;
		if (condition && condition.typename === "Db.Expression") {
			Q.extend(this.parameters, condition.parameters);
			condition = condition.toString();
		} else if (typeof condition === 'object') {
			var conditionList = [];
			for (var expr in condition) {
				var i, l, value = condition[expr];
				if (Q.isArrayLike(value)) {
					// a bunch of OR criteria
					var pieces = [];
					for (i=0, l=value.length; i<l; ++i) {
						var v = value[i];
						v = v.map(function (a) {
							return new (Db().Expression)(a);
						});
						pieces.push(this._criteria_expression(v));
					}
					conditionList.push(pieces.join(' OR '));
				} else {
					conditionList.push(this._criteria_expression(
						Q.setObject({}, expr, new (Db().Expression)(value), '\u0000')
					));
				}
			}
			condition = conditionList.join(' AND ' );
		} else if (condition && condition.typename === "Db.Expression") {
			Q.extend(this.parameters, condition.parameters);
			condition = condition.toString();
		}
		if (typeof condition !== "string") {
			throw new Q.Exception("The JOIN condition needs to be specified correctly.");
		}
		
		var join = join_type + " JOIN " + table + " ON (" + condition + ")";
		
		this.clauses['JOIN'] = this.clauses['JOIN'] ? this.clauses['JOIN'] + " \n" + join : join;
		return this;
	};

/**
 * Adds a WHERE clause to the query
 * @method where
 * @param {object|Db.Expression} criteria An associative array of column: value pairs
 * @return {Db.Query} The resulting query object
 */
	Query.prototype.where = function (criteria) {
		switch (this.type) {
			case Db.Query.TYPE_SELECT:
			case Db.Query.TYPE_UPDATE:
			case Db.Query.TYPE_DELETE:
				break;
			default:
				throw new Q.Exception("The WHERE clause does not belong in this context.");
		}
		
		// and now, for sharding
		if (typeof criteria === 'object') {
			this.criteria = Q.copy(criteria);
		}
		
		var ci = this._criteria_expression(criteria);
		if (typeof ci !== 'string') {
			throw new Q.Exception("The WHERE criteria need to be specified correctly.");
		}
		if (!ci) {
			return this;
		}

		this.clauses['WHERE'] = this.clauses['WHERE'] ? "(" + this.clauses['WHERE'] + ") AND (" + ci + ")" : ci;
			
		return this;
	};

/**
 * Adds to the WHERE clause with an AND
 * @method andWhere
 * @param {object|Db.Expression} criteria An associative array of column: value pairs
 * @return {Db.Query} The resulting query object
 */
	Query.prototype.andWhere = function (criteria, or_criteria) {
		switch (this.type) {
			case Db.Query.TYPE_SELECT:
			case Db.Query.TYPE_UPDATE:
			case Db.Query.TYPE_DELETE:
				break;
			default:
				throw new Q.Exception("The WHERE clause does not belong in this context.");
		}

		// and now, for sharding
		if (typeof criteria === 'object') {
			if (!this.criteria) {
				this.criteria = criteria;
			} else if (this.shardIndex()) {
				if (arguments.length > 1) {
					throw new Q.Exception("You can't use OR in your WHERE clause when sharding.");
				}
				Q.extend(this.criteria, criteria);
			}
		}

		var c_arr = [];
		var was_empty = true;
		var c; 
		for (var i = 0; i < arguments.length; ++i ) {
			c = this._criteria_expression(arguments[i]);
			if (typeof c !== 'string') {
				throw new Q.Exception("The WHERE criteria need to be specified correctly");
			}
			c_arr.push(c);
			if (c) {
				was_empty = false;
			}
		}
		if (was_empty) {
			return this;
		}
		
		var new_criteria = "(" + c_arr.join(") OR (") + ")";
		this.clauses["WHERE"] = "(" + this.clauses["WHERE"] + ") AND (" + new_criteria + ")";
		return this;
	};

/**
 * Adds to the WHERE clause with an OR
 * @method orWhere
 * @param {object|Db.Expression} criteria An associative array of column: value pairs
 * @return {Db.Query} The resulting query object
 */
	Query.prototype.orWhere = function (criteria, and_criteria) {
		switch (this.type) {
			case Db.Query.TYPE_SELECT:
			case Db.Query.TYPE_UPDATE:
			case Db.Query.TYPE_DELETE:
				break;
			default:
				throw new Q.Exception("The WHERE clause does not belong in this context.");
		}

		// and now, for sharding
		if (typeof criteria === 'object') {
			if (this.shardIndex() && this.criteria) {
				throw new Q.Exception("You can't use OR in your WHERE clause when sharding.");
			}
		}

		var c_arr = [];
		var was_empty = true;
		var c;
		for (var i = 0; i < arguments.length; ++i ) {
			c = this._criteria_expression(arguments[i]);
			if (typeof c !== 'string') {
				throw new Q.Exception("The WHERE criteria need to be specified correctly");
			}
			c_arr.push(c);
			if (c) {
				was_empty = false;
			}
		}
		if (was_empty) {
			return this;
		}
		
		var new_criteria = "(" + c_arr.join(") AND (") + ")";
		this.clauses["WHERE"] = "(" + this.clauses["WHERE"] + ") OR (" + new_criteria + ")";
		return this;
	};

	Query.prototype.groupBy = function (expression) {
		switch (this.type) {
			case Db.Query.TYPE_SELECT:
				break;
			default:
				throw new Q.Exception("The GROUP BY clause does not belong in this context.");
		}

		if (expression && expression.typename === "Db.Expression") {
			Q.extend(this.parameters, expression.parameters);
			expression = expression.toString();
		}
		if (typeof expression !== 'string') {
			throw new Q.Exception("The GROUP BY expression has to be specified correctly.");
		}
		this.clauses['GROUP BY'] = this.clauses['GROUP BY'] ? this.clauses['GROUP BY'] + ", " + expression : expression;
		return this;
	};

	Query.prototype.having = function (criteria) {
		switch (this.type) {
			case Db.Query.TYPE_SELECT:
				break;
			default:
				throw new Q.Exception("The  clause does not belong in this context.");
		}

		if (!this.clauses['GROUP BY']) {
			throw new Q.Exception("Don't call having() when you haven't called groupBy() yet");
		}

		var ci = this._criteria_expression(criteria);
		if (typeof ci !== 'string') {
			throw new Q.Exception("The HAVING criteria need to be specified correctly.");
		}

		this.clauses['HAVING'] = this.clauses['HAVING'] ? "(" + this.clauses['HAVING'] + ") AND (" + ci + ")" : ci;

		return this;
	};

	Query.prototype.orderBy = function (expression, ascending) {
		switch (this.type) {
			case Db.Query.TYPE_SELECT:
			case Db.Query.TYPE_UPDATE:
				break;
			default:
				throw new Q.Exception("The ORDER BY clause does not belong in this context.");
		}

		if (expression && expression.typename === "Db.Expression") {
			Q.extend(this.parameters, expression.parameters);
			expression = expression.toString();
		}
		if (typeof expression !== 'string') {
			throw new Q.Exception("The ORDER BY expression has to be specified correctly.");
		}
		if (typeof ascending === 'boolean') {
			expression += ascending ? ' ASC' : ' DESC';
		} else if (typeof ascending === 'string') {
			if (ascending.toUpperCase() == 'DESC') {
				expression += ' DESC';
			} else {
				expression += ' ASC';
			}
		}
		this.clauses['ORDER BY'] = this.clauses['ORDER BY'] ? this.clauses['ORDER BY'] + ", " + expression : expression;
		return this;
	};

	Query.prototype.limit = function(limit, offset) {
		if (limit == null) {
			return this;
		}
		if (isNaN(limit) || limit < 0 || Math.floor(limit) !== limit) {
			throw new Q.Exception("the limit must be a non-negative integer");
		}
		if (offset !== undefined && offset !== null) {
			if (isNaN(offset) || offset < 0 || Math.floor(offset) !== offset) {
				throw new Q.Exception("the offset must be a non-negative integer");
			}
		}
		switch (this.type) {
			case Db.Query.TYPE_SELECT:
				break;
			case Db.Query.TYPE_UPDATE:
			case Db.Query.TYPE_DELETE:
				if (offset !== undefined && offset !== null) {
					throw new Q.Exception("the LIMIT clause cannot have an OFFSET in this context");
				}
				break;
			default:
				throw new Q.Exception("The LIMIT clause does not belong in this context.");
		}

		if (this.clauses['LIMIT'])
			throw new Q.Exception("The LIMIT clause has already been specified.");

		this.clauses['LIMIT'] = "LIMIT " + limit;
		if (offset !== undefined && offset !== null) {
			this.clauses['LIMIT'] += " OFFSET " + offset;
		}

		return this;
	};

	// _set_internal and _onDuplicateKeyUpdate_internal already append to the
	// clause and return the query, so appending their return value here a
	// second time stringified the whole query object into the SQL.
	Query.prototype.set = function (updates) {
		return this._set_internal(updates);
	};

	Query.prototype.onDuplicateKeyUpdate = function(updates) {
		return this._onDuplicateKeyUpdate_internal(updates);
	};

	Query.prototype.lock = function(type) {
		type = type || 'FOR UPDATE';
		switch (type.toUpperCase()) {
			case 'FOR UPDATE':
			case 'LOCK IN SHARE MODE':
				this.clauses['LOCK'] = type;
				break;
			default:
				throw new Q.Exception("Incorrect type for lock");
		}
		return this;
	};

	Query.prototype.begin = function(lockType)
	{
		if (lockType === undefined || lockType === true) {
			lockType = 'FOR UPDATE';
		}
		if (lockType) {
			this.lock(lockType);
		}
		this.clauses['BEGIN'] = 'START TRANSACTION';
		return this;
	};

	Query.prototype.commit = function() {
		this.clauses['COMMIT'] = 'COMMIT';
		return this;
	};

	Query.prototype.rollback = function(criteria) {
		this.clauses['ROLLBACK'] = 'ROLLBACK';
		// and now, for sharding
		if (typeof criteria === 'object') {
			this.criteria = Q.copy(criteria);
		}
		return this;
	};

	Query.prototype.options = function(options) {
		if (!options) {
			return this;
		}
		for (var key in options) {
			var value = options[key];
			if (typeof(this[key]) === 'function') {
				if (Q.typeOf(value) !== 'array') {
					value = [value];
				}
				var method = this[key];
				method.apply(this, value);
			}
		}
		return this;
	};

/**
 * Builds the SQL string from the clauses that have been added so far
 * @method build
 * @param {object} [options]
 * @return {string} The SQL query string
 */
	Query.prototype.build = function(options) {
		var sql = '', select, from, join, where, groupBy, having, orderBy, limit, lock,
			into, values, afterValues, onDuplicateKeyUpdate,
			update, set, i;
		switch (this.type) {
			case Db.Query.TYPE_RAW:
				sql = this.clauses['RAW'] || '';
				break;
			case Db.Query.TYPE_SELECT:
				// SELECT
				select = this.clauses['SELECT'] || '*';
				if (this.afterClauses['SELECT']) {
					select += " " + this.afterClauses['SELECT'];
				}
				// FROM
				from = (this.clauses['FROM'] || []).join(', ');
				// if (!from)
				// 	throw new Q.Exception("missing FROM clause in DB query.");
				if (this.afterClauses['FROM']) {
					from += " " + this.afterClauses['FROM'];
				}
				// JOIN
				join = this.clauses['JOIN'] || '';
				if (this.afterClauses['JOIN']) {
					join += " " + this.afterClauses['JOIN'];
				}
				// WHERE
				where = this.clauses['WHERE'] ? 'WHERE ' + this.clauses['WHERE'] : '';
				if (this.afterClauses['WHERE']) {
					where += " " + this.afterClauses['WHERE'];
				}
				// GROUP BY
				groupBy = this.clauses['GROUP BY'] ? "GROUP BY " + this.clauses['GROUP BY'] : '';
				if (this.afterClauses['GROUP BY']) {
					groupBy += " " + this.afterClauses['GROUP BY'];
				}
				// HAVING
				having = this.clauses['HAVING'] ? "HAVING " + this.clauses['HAVING'] : '';
				if (this.afterClauses['HAVING']) {
					having += " " + this.afterClauses['HAVING'];
				}
				// ORDER BY
				orderBy = this.clauses['ORDER BY'] ? "ORDER BY " + this.clauses['ORDER BY'] : '';
				if (this.afterClauses['ORDER BY']) {
					orderBy += " " + this.afterClauses['ORDER BY'];
				}
				// LIMIT
				limit = this.clauses['LIMIT'] || '';
				if (this.afterClauses['LIMIT']) {
					limit += " " + this.afterClauses['LIMIT'];
				}
				// LOCK
				lock = this.clauses['LOCK'] || '';
				if (this.afterClauses['LOCK']) {
					lock +=  " " + this.afterClauses['LOCK'];
				}
				sql = "SELECT " + select +
					(from ? "\nFROM " + from : '') +
					"\n" + join +
					"\n" + where +
					"\n" + groupBy +
					"\n" + having +
					"\n" + orderBy +
					"\n" + limit +
					"\n" + lock;
				break;
			case Db.Query.TYPE_INSERT:
				// INTO
				if (!this.clauses['INTO'])
					throw new Q.Exception("missing INTO clause in DB query.");
				into = this.clauses['INTO'] || '';
				if (into) {
					if (!this.clauses['FIELDS']) {
						throw new Q.Exception("missing FIELDS clause in DB query.");
					}
					into += '(' + this.clauses['FIELDS'] + ')';
				}
				if (this.afterClauses['INTO']) {
					into += " " + this.afterClauses['INTO'];
				}
				values = this.clauses['VALUES'] || '';
				afterValues = this.afterClauses['VALUES'] || '';
				onDuplicateKeyUpdate = this.clauses['ON DUPLICATE KEY UPDATE'] ?
					'ON DUPLICATE KEY UPDATE '  + this.clauses['ON DUPLICATE KEY UPDATE'] : '';
				sql = "INSERT INTO " + into +
					"\nVALUES (" + values + ")" +
					"\n" + afterValues +
					"\n" + onDuplicateKeyUpdate;
				break;
			case Db.Query.TYPE_UPDATE:
				// UPDATE
				if (!this.clauses['UPDATE'])
					throw new Q.Exception("Missing UPDATE tables clause in DB query.");
				if (!this.clauses['SET'])
					throw new Q.Exception("missing SET clause in DB query.");
				update = this.clauses['UPDATE'] || '';
				if (this.afterClauses['UPDATE']) {
					update += " " + this.afterClauses['UPDATE'];
				}
				// JOIN
				join = this.clauses['JOIN'] || '';
				if (this.afterClauses['JOIN']) {
					join += " " + this.afterClauses['JOIN'];
				}
				// SET
				set = this.clauses['SET'] || '';
				if (this.afterClauses['SET']) {
					set += " " + this.afterClauses['SET'];
				}
				// WHERE
				where = this.clauses['WHERE'] ? 'WHERE ' + this.clauses['WHERE'] : 'WHERE 1';
				if (this.afterClauses['WHERE']) {
					where += " " + this.afterClauses['WHERE'];
				}
				// LIMIT
				limit = this.clauses['LIMIT'] || '';
				if (this.afterClauses['LIMIT']) {
					limit += " " + this.afterClauses['LIMIT'];
				}
				sql = "UPDATE " + update +
					"\n" + join +
					"\nSET " + set +
					"\n" + where +
					"\n" + limit;
				break;
			case Db.Query.TYPE_DELETE:
				// DELETE
				if (!this.clauses['FROM'])
					throw new Q.Exception("missing FROM clause in DB query.");
				from = this.clauses['FROM'] || '';
				if (this.afterClauses['FROM']) {
					from += " " + this.afterClauses['FROM'];
				}
				// JOIN
				join = this.clauses['JOIN'] || '';
				if (this.afterClauses['JOIN']) {
					join += " " + this.afterClauses['JOIN'];
				}
				// WHERE
				where = this.clauses['WHERE'] ? 'WHERE ' + this.clauses['WHERE'] : 'WHERE 1';
				if (this.afterClauses['WHERE']) {
					where += " " + this.afterClauses['WHERE'];
				}
				// LIMIT
				limit = this.clauses['LIMIT'] || '';
				if (this.afterClauses['LIMIT']) {
					limit += " " + this.afterClauses['LIMIT'];
				}
				sql = "DELETE FROM " + from +
					"\n" + join +
					"\n" + where +
					"\n" + limit;
				break;
			case Db.Query.TYPE_ROLLBACK:
				break;
			default:
				throw new Q.Exception("Unknown query type "+this.type);
				break;
		}
		return sql;
	};

Query.prototype.valueOf = Query.prototype.toString = function() {
	return this.build();
};

	// Was assigning to this.after (replacing the whole map with a string),
	// which destroyed every other after-clause. Matches Db_Query::after in PHP.
	Query.prototype.after =
	Query.prototype.setAfter = function(after, clause) {
		if (clause) {
			this.afterClauses[after] = this.afterClauses[after]
				? this.afterClauses[after] + ' ' + clause
				: clause;
		}
		return this;
	};

	Query.prototype.getClause = function(clause_name, with_after) {
		var clause = this.clauses[clause_name] || '';
		if (!with_after) {
			return clause;
		}
		var after = this.afterClauses[clause_name] || '';
		return [clause, after];
	};

// ── Internal helpers ──
var _valueCounter = 1;

Query.prototype._set_internal = function(updates) {
	if (this.type !== Query.TYPE_UPDATE) {
		throw new Q.Exception("Query._set_internal: SET does not belong in this context.");
	}
	if (typeof updates === 'object') {
		var updates_list = [];
		for (var field in updates) {
			var value = updates[field];
			if (value && value.typename === "Db.Expression") {
				Q.extend(this.parameters, value.parameters);
				updates_list.push(this._column(field) + " = " + value);
			} else {
				updates_list.push(this._column(field) + " = :_set_" + _valueCounter);
				this.parameters["_set_" + _valueCounter] = value;
				_valueCounter = (_valueCounter + 1) % 1000000;
			}
		}
		updates = updates_list.join(", ");
	}
	if (typeof updates !== 'string') {
		throw new Q.Exception("Query._set_internal: updates must be an object or string.");
	}
	if (!this.clauses['SET']) this.clauses['SET'] = updates;
	else this.clauses['SET'] += ", " + updates;
	return this;
};

Query.prototype._onDuplicateKeyUpdate_internal = function(updates) {
	if (this.type !== Query.TYPE_INSERT) {
		throw new Q.Exception("onDuplicateKeyUpdate does not belong in this context.");
	}
	if (typeof updates === 'object') {
		var updates_list = [], field;
		for (field in updates) {
			var value = updates[field];
			if (value && value.typename === "Db.Expression") {
				Q.extend(this.parameters, value.parameters);
				updates_list.push(this._column(field) + " = " + value);
			} else {
				updates_list.push(
					this._column(field) + " = :_dupUpd_" + this._dupUpdI
				);
				this.parameters["_dupUpd_" + this._dupUpdI] = value;
				++this._dupUpdI;
			}
		}
		updates = updates_list.join(", ");
	}
	if (typeof updates !== 'string') {
		throw new Q.Exception("onDuplicateKeyUpdate updates must be object or string.");
	}
	if (!this.clauses['ON DUPLICATE KEY UPDATE'])
		this.clauses['ON DUPLICATE KEY UPDATE'] = updates;
	else
		this.clauses['ON DUPLICATE KEY UPDATE'] += ", " + updates;
	return this;
};


/**
 * Build a criteria SQL fragment from various input formats.
 * Ported from criteria_internal in Mysql.js.
 * @private
 */
Query.prototype._criteria_expression = function(criteria) {
	var criteria_list, expr, parts, columns, value, values, v, i, j, k, vl, vl2, pl;
	var fillCriteria = this.criteria;
	if (criteria && criteria.typename === "Db.Expression") {
		Q.extend(this.parameters, criteria.parameters);
		return criteria.toString();
	}
	if (typeof criteria === 'object') {
		criteria_list = [];
		for (expr in criteria) {
			value = criteria[expr];
			if (value instanceof Buffer) {
				value = value.toString();
			}
			parts = expr.split(',').map(function (str) {
				return str.trim();
			});
			pl = parts.length;
			if (pl > 1) {
				columns = [];
				for (j=0; j<pl; ++j) {
					columns.push(this._column(parts[j]));
				}
				// Check whether value is a Db.Expression
				if (value && value.typename === "Db.Expression") {
					Q.extend(this.parameters, value.parameters);
					criteria_list.push( "(" + columns.join(',') + ")" + " IN " + value );
				} else if (Q.isArrayLike(value)) {
					vl = value.length;
					if (vl) {
						var rhs_arr = [];
						for (i=0; i<vl; ++i) {
							v = value[i];
							if (Q.isArrayLike(v)) {
								var row_parts = [];
								vl2 = v.length;
								for (k=0; k<vl2; ++k) {
									row_parts.push(":_criteria_" + _valueCounter);
									this.parameters["_criteria_" + _valueCounter] = v[k];
									_valueCounter = (_valueCounter + 1) % 1000000;
								}
								rhs_arr.push("(" + row_parts.join(",") + ")");
							} else {
								rhs_arr.push(":_criteria_" + _valueCounter);
								this.parameters["_criteria_" + _valueCounter] = v;
								_valueCounter = (_valueCounter + 1) % 1000000;
							}
						}
						var lhs = "(" + columns.join(',') + ")";
						var rhs = "(" + rhs_arr.join(',') + ")";
						criteria_list.push(lhs + ' IN ' + rhs);
					} else {
						criteria_list.push('FALSE');
					}
				}
			} else {
				if (value === null || value === undefined) {
					criteria_list.push( this._column(expr) + " IS NULL");
				} else if (value && value.typename === "Db.Expression") {
					Q.extend(this.parameters, value.parameters);
					var v2 = value.valueOf();
					if (v2.charAt(0) === '(') {
						criteria_list.push( "" + this._column(expr) + "("+v2+")" );
					} else {
						criteria_list.push( "" + this._column(expr) + " = ("+v2+")" );
					}
				} else if (Q.isArrayLike(value)) {
					vl = value.length;
					if (vl) {
						var values_list = [];
						for (i=0; i<vl; ++i) {
							values_list.push(":_criteria_" + _valueCounter);
							this.parameters["_criteria_" + _valueCounter] = value[i];
							_valueCounter = (_valueCounter + 1) % 1000000;
						}
						criteria_list.push( "" + this._column(expr) + " IN (" + values_list.join(',') + ")");
					} else {
						criteria_list.push('FALSE');
					}
				} else if (typeof value === 'object' && ('min' in value || 'max' in value)) {
					if ('min' in value) {
						var c_min = (value.includeMin !== false) ? " >= " : " > ";
						criteria_list.push( "" + this._column(expr) + c_min + ":_criteria_" + _valueCounter );
						this.parameters["_criteria_" + _valueCounter] = value.min;
						_valueCounter = (_valueCounter + 1) % 1000000;
					}
					if ('max' in value) {
						var c_max = (value.includeMax !== false) ? " <= " : " < ";
						criteria_list.push( "" + this._column(expr) + c_max + ":_criteria_" + _valueCounter );
						this.parameters["_criteria_" + _valueCounter] = value.max;
						_valueCounter = (_valueCounter + 1) % 1000000;
					}
				} else {
					var eq = (value && typeof value === 'string' && value.substr(0,2) === '!=')
						? ' != ' : ' = ';
					if (eq === ' != ') value = value.substr(2);
					criteria_list.push( "" + this._column(expr) + eq + ":_criteria_" + _valueCounter );
					this.parameters["_criteria_" + _valueCounter] = value;
					fillCriteria[expr] = value;
					_valueCounter = (_valueCounter + 1) % 1000000;
				}
			}
		}
		criteria = criteria_list.join(" AND ");
	} else if (criteria && criteria.typename === "Db.Expression") {
		Q.extend(this.parameters, criteria.parameters);
		criteria = criteria.toString();
	}

	return criteria;
};


// ── copy / shard ──

/**
 * The adapters (Db.Query.Mysql and friends) assign every method onto the
 * instance inside their constructor closure, so Q.copy() -- which produces a
 * plain object -- strips getSQL, execute, build and the rest. Build a real
 * instance of the same class and copy the state across instead.
 * @method copy
 * @return {Db.Query} a new query with the same state
 */
Query.prototype.copy = function() {
	var ret = new this.constructor(
		this.db, this.type, Q.copy(this.clauses), {}, this.table
	);
	ret.parameters = Q.copy(this.parameters);
	ret.afterClauses = Q.copy(this.afterClauses);
	ret.criteria = Q.copy(this.criteria);
	ret.replacements = Q.copy(this.replacements);
	ret.className = this.className;
	ret.indexName = this.indexName;
	ret._dupUpdI = this._dupUpdI;
	if (this.cachedShardIndex !== undefined) {
		ret.cachedShardIndex = this.cachedShardIndex;
	}
	return ret;
};

/**
 * Returns the shard index in use for this query, or null.
 * Mirrors Db_Query::shardIndex() in PHP: the index lives under
 * Db/upcoming/{connection}/indexes/{className} falling back to
 * Db/connections/{connection}/indexes/{className}.
 * @method shardIndex
 * @return {object|null}
 */
Query.prototype.shardIndex = function() {
	if (this.cachedShardIndex !== undefined) {
		return this.cachedShardIndex;
	}
	if (!Q.Config || !this.className) {
		return this.cachedShardIndex = null;
	}
	var connName = this.db && (typeof this.db.connectionName === 'function'
		? this.db.connectionName()
		: this.db.connName);
	if (!connName) {
		return this.cachedShardIndex = null;
	}
	// className looks like "{connectionName}_{table}", e.g. "Streams_stream"
	var className = this.className.substring(connName.length + 1);
	var info = Q.Config.get(['Db', 'upcoming', connName], false);
	if (!info) {
		info = Q.Config.get(['Db', 'connections', connName], {});
	}
	var indexes = info && info.indexes;
	return this.cachedShardIndex = (indexes && indexes[className] !== undefined)
		? indexes[className]
		: null;
};

/**
 * Works out which shards this query needs to run on.
 *
 * IMPORTANT: this returns a map of {shardName: query} pairs, NOT the query.
 * Db.Query.Mysql.execute() iterates the returned object and calls getSQL() on
 * each value; returning `this` made it iterate the query's own properties and
 * throw "query.getSQL is not a function" on the first one.
 *
 * @method shard
 * @param {object} [upcoming] Temporary index config, used during a shard split
 * @param {object} [criteria] Overrides the sharding criteria, for testing
 * @return {object} {shardName: query} pairs. "" means the main shard only,
 *  "*" means run on every shard.
 */
Query.prototype.shard = function(upcoming, criteria) {
	if (criteria !== undefined && criteria !== null) {
		this.criteria = criteria;
	}
	var index = upcoming || this.shardIndex();
	var ret = {};
	if (!index) {
		ret[""] = this;
		return ret;
	}
	if (Q.isEmpty(this.criteria)) {
		ret["*"] = this;
		return ret;
	}
	if (Q.isEmpty(index.fields)) {
		throw new Q.Exception(
			"Db.Query: index for " + this.className + " should have at least one field"
		);
	}
	if (index.partition === undefined || index.partition === null) {
		ret[""] = this;
		return ret;
	}

	var hashed = [];
	var fields = Object.keys(index.fields);
	for (var i=0; i<fields.length; ++i) {
		var field = fields[i];
		if (this.criteria[field] === undefined) {
			// not enough information to target the query
			ret["*"] = this;
			return ret;
		}
		var value = this.criteria[field];
		var hash = index.fields[field] || 'md5';
		var parts = String(hash).split('%');
		hash = parts[0];
		var len = (parts[1] !== undefined) ? parseInt(parts[1]) : Query.HASH_LEN;
		if (Q.isArrayLike(value)) {
			var arr = [];
			for (var j=0; j<value.length; ++j) {
				arr.push(Query.applyHash(value[j], hash, len));
			}
			hashed[i] = arr;
		} else if (value && value.typename === 'Db.Range') {
			if (hash !== 'normalize') {
				throw new Q.Exception("Db.Query: ranges don't work with " + hash + " hash");
			}
			hashed[i] = new (Db().Range)(
				Query.applyHash(value.min, hash, len), value.includeMin,
				value.includeMax, Query.applyHash(value.max, hash, len)
			);
		} else {
			hashed[i] = Query.applyHash(value, hash, len);
		}
	}

	// NOTE: this is an ordered array of [point, shardName], not an object.
	// Partition points like "4000000" are integer-like strings, and JS moves
	// those to the front of an object's key order in ascending numeric order,
	// which silently reorders the partition (PHP preserves insertion order).
	var mapping = [];
	if (Q.isArrayLike(index.partition)) {
		for (var m=0; m<index.partition.length; ++m) {
			mapping.push([String(index.partition[m]), index.partition[m]]);
		}
	} else {
		for (var point in index.partition) {
			mapping.push([String(point), index.partition[point]]);
		}
		// restore the ascending order the config declares but JS may have lost
		mapping.sort(function (a, b) { return a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : 0); });
	}
	return this._shard_internal(index, hashed, mapping);
};

/**
 * Depth-first search over the partition points, returning {shardName: query}.
 * Ported from Db_Query::shard_internal / slice_partitions in PHP.
 * @method _shard_internal
 * @private
 */
Query.prototype._shard_internal = function(index, hashed, mapping) {
	var partition = [], lastPoint = null, byPoint = {};
	for (var i=0; i<mapping.length; ++i) {
		var point = mapping[i][0];
		if (lastPoint !== null && point <= lastPoint) {
			throw new Q.Exception(
				"Db.Query shard_internal: in " + this.className
				+ " partition, point " + i + " is not greater than the previous point"
			);
		}
		byPoint[point] = mapping[i][1];
		partition.push(point.split('.'));
		lastPoint = point;
	}
	var kept = _slice_partitions(partition, 0, hashed, false);
	var ret = {};
	for (var k=0; k<kept.length; ++k) {
		ret[byPoint[kept[k].join('.')]] = this;
	}
	return ret;
};

/**
 * Narrows the partition list according to the hashed criteria.
 * Ported from Db_Query::slice_partitions in PHP.
 * @private
 */
function _slice_partitions(partition, j, hashed, adjust) {
	if (partition.length <= 1) {
		return partition;
	}
	var hj = hashed[j], i, result;

	if (Q.isArrayLike(hj)) {
		result = [];
		var temp = hashed.slice(0);
		for (i=0; i<hj.length; ++i) {
			temp[j] = hj[i];
			result = result.concat(_slice_partitions(partition, j, temp, adjust));
		}
		return result;
	}

	var min = hj, max = hj, includeMax = true;
	if (hj && hj.typename === 'Db.Range') {
		min = hj.min;
		max = hj.max;
		if (min === undefined || min === null) {
			throw new Q.Exception(
				"Db.Query slice_partitions: The minimum of the range should be set."
			);
		}
	}

	var lower = 0, upper = partition.length - 1;
	var lowerFound = false, upperFound = false, next;

	for (i=0; i<partition.length; ++i) {
		upperFound = upperFound && (next !== undefined && next !== null);
		var current = partition[i][j];
		if (!adjust && max !== undefined && max !== null
		&& (includeMax ? current > max : current >= max)) {
			break;
		}
		next = (partition[i+1] && partition[i+1][j] !== undefined)
			? partition[i+1][j] : null;
		if (next === current) {
			continue;
		}
		if (adjust && next !== null && current > next) {
			next = null;
			lowerFound = true;
		}
		if (!lowerFound && next !== null && min >= next) {
			lower = i + 1;
		}
		if (!upperFound) {
			if (next === null || (includeMax ? max < next : max <= next)) {
				upper = i;
				if (!adjust) break;
				upperFound = true;
			}
		}
	}

	var sliced = partition.slice(lower, upper + 1);
	if (hashed[j+1] !== undefined) {
		return _slice_partitions(
			sliced, j+1, hashed,
			(hj && hj.typename === 'Db.Range') || adjust
		);
	}
	return sliced;
}

/**
 * Default hash length used when partitioning, matching Db_Query::HASH_LEN.
 */
Query.HASH_LEN = 7;

/**
 * Applies a hash to a value and left-pads it to a fixed length with spaces,
 * so that string comparison against partition points works.
 * Ported from Db_Query::applyHash in PHP.
 * @method applyHash
 * @static
 */
Query.applyHash = function(value, hash, len) {
	if (value === undefined || value === null) {
		return value;
	}
	if (hash === undefined || hash === null) hash = 'md5';
	if (len === undefined || len === null) len = Query.HASH_LEN;
	var hashed;
	switch (hash) {
		case 'normalize':
			hashed = Q.normalize(String(value)).substring(0, len);
			break;
		case 'md5':
			hashed = require('crypto').createHash('md5')
				.update(String(value)).digest('hex').substring(0, len);
			break;
		default:
			throw new Q.Exception("Db.Query: The hash " + hash + " is not supported");
	}
	// space sorts below any character used in a hash, so left-pad with spaces
	while (hashed.length < len) {
		hashed = ' ' + hashed;
	}
	return hashed;
};

/**
 * Get adapter query class name for a db connection.
 */
Query.adapterClass = function(db) {
	if (!db || !db.typename) return null;
	return 'Db/Query/' + db.typename.replace('Db.', '');
};

/**
 * Default _buildLock — MySQL uses LOCK IN SHARE MODE.
 * Adapters override for their syntax.
 */
Query.prototype._buildLock = function() {
	if (!this.clauses['LOCK']) return '';
	return ' ' + this.clauses['LOCK'];
};

module.exports = Query;