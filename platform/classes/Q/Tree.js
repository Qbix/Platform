/**
 * @module Q
 */

var Q = require('../Q');
var fs = require('fs');

/**
 * Creates a Q.Tree object
 * @class Tree
 * @namespace Q
 * @constructor
 * @param {object} [linked = {}] If supplied, then this object is
 *  used as the internal tree that Tree operates on.
 */
module.exports = function (linked) {
	if (linked === undefined) linked = {};
	if (Q.typeOf(linked) === 'Q.Tree') linked = linked.getAll();

	this.typename = "Q.Tree";

	/**
	 * Loads data from JSON found in a file
	 * @method load
	 * @param {String} filename The filename of the file to load.
	 * @param {Function} [callback] Takes (err, data)
	 * @return {Q.Tree|null} Returns this if loaded, otherwise null.
	 */
	this.load = function (filename, callback) {
		var that = this;
		var filenames;
		switch (Q.typeOf(filename)) {
			case 'string': filenames = [filename]; break;
			case 'array': filenames = filename; break;
			default: throw new Q.Exception("Q.Tree.load: filename has to be string|array");
		}
		var p = new Q.Pipe(filenames, function (params) {
			for (var i = 0; i<filenames.length; ++i) {
				var k = filenames[i];
				if (params[k][1]) that.merge(params[k][1]);
			}
			that.filename = filename;
			callback && callback.call(that, null, that.getAll());
		});
		for (var i = 0; i<filenames.length; ++i) {
			(function (i) {
				var isPHP = (filenames[i].slice(-4).toLowerCase() === '.php');
				fs.readFile(filenames[i].replace('/', Q.DS), 'utf-8', function (err, data) {
					if (err) return p.fill(filenames[i])(err, null);
					try {
						if (isPHP) {
							data = data.substring(data.indexOf("\n")+1, data.lastIndexOf("\n"));
						}
						data = data.replace(/\s*(?!<")\/\*[^\*]+\*\/(?!")\s*/gi, '');
						data = data.replace(/\,\s*\}/, '}');
						data = JSON.parse(data);
					} catch (e) { return p.fill(filenames[i])(e, null); }
					p.fill(filenames[i])(null, data);
				});
			})(i);
		}
	};

	/**
	 * Saves tree data to a file
	 * @method save
	 * @param {String} filename Name of file to save to. If tree was loaded, you can leave this blank to update that file.
	 * @param {Array} [arrayPaty] Array of keys identifying the path of the subtree to save
	 * @param {Array} [prefixPath] The JSON path to save the data under, defaults to array_path
	 * @param {Function} [callback]
	 * @return {Boolean} Returns true if saved, otherwise false;
	 **/
	this.save = function (filename, arrayPath, prefixPath, callback) {
		if (!filename && typeof this.filename === 'string') filename = this.filename;
		if (typeof arrayPath === 'function' || typeof arrayPath === 'undefined') {
			callback = arrayPath; arrayPath = prefixPath = [];
		} else if (typeof prefixPath === 'function' || typeof prefixPath === 'undefined') {
			callback = prefixPath; prefixPath = [];
		}
		var d, data = this.get.apply(this, [arrayPath]), that = this;
		if (Q.typeOf(prefixPath) !== 'array') prefixPath = prefixPath ? [prefixPath] : [];
		for (var i = prefixPath.length-1; i>=0; i--) {
			d = {}; d[prefixPath[i]] = data; data = d;
		}
		var to_save = JSON.stringify(data, null, '\t');
		var mask = process.umask(parseInt(Q.Config.get(['Q','internal','umask'],"0000"),8));
		fs.writeFile(filename.replace('/', Q.DS), to_save, function (err) {
			process.umask(mask);
			callback && callback.call(that, err);
		});
	};

	/**
	 * Gets the object of all tree data
	 * @method getAll
	 * @return {Object}
	 */
	this.getAll = function () { 
		return linked;
	};

	/**
	 * Gets the value of a field, possibly deep inside the array
	 * @method get
	 * @param {Array} keys
	 * @param {any} default
	 *  If only one argument is passed, the default is null
	 *  Otherwise, the last argument is the default value to return
	 *  in case the requested field was not found.
	 * @return {any}
	 */
	this.get = function (keys, def) {
		if (typeof keys === 'undefined') keys = [];
		if (typeof keys === 'string') {
			var arr = []; for (var j = 0;j<arguments.length-1;++j) arr.push(arguments[j]);
			keys = arr; def = arguments[arguments.length-1];
		}
		var result = linked, key, sawKeys = [];
		for (var i = 0,len = keys.length;i<len;++i) {
			key = keys[i];
			if (typeof result !== 'object' || result===null) {
				// silently ignore and return def
				// could throw with context: sawKeys
				return def;
			}
			if (!(key in result)) return def;
			result = result[key];
			sawKeys.push(key);
		}
		return result;
	};

	/**
	 * Sets the value of a tree item, possibly deep inside the object
	 * @method set
	 * @param {Array} keys
	 * @param {any} [value=null] The value to set the field to.
	 *  The last parameter should not be omitted unless the first parameter is an array.
	 */
	this.set = function (keys, value) {
		if (arguments.length===1) {
			linked = (typeof keys==="object") ? keys : [keys];
		} else {
			if (Q.typeOf(keys)==='object') {
				for (var k in keys) linked[k] = keys[k];
			} else {
				if (typeof keys==='string') {
					var arr = []; for (var j = 0;j<arguments.length-1;++j) arr.push(arguments[j]);
					keys = arr; value = arguments[arguments.length-1];
				}
				var result = linked, key;
				for (var i = 0,len = keys.length;i<len-1;++i) {
					key = keys[i];
					if (!(key in result) || Q.typeOf(result[key])!=='object') result[key] = {};
					result = result[key];
				}
				key = keys[len-1]; result[key] = value;
			}
		}
		return this;
	};

	/**
	 * Clears the value of a field, possibly deep inside the object
	 * @method clear
	 * @param {Array} keys
	 */
	this.clear = function (keys) {
		if (!keys) { linked = {}; return; }
		if (typeof keys==='string') keys = [keys];
		var result = linked, key;
		for (var i = 0,len = keys.length;i<len;++i) {
			key = keys[i];
			if (typeof result!=='object' || !(key in result)) return false;
			if (i===len-1) { delete result[key]; return true; }
			result = result[key];
		}
		return false;
	};

	/**
	 * Traverse the tree depth-first and call the callback.
	 *
	 * Callback return value semantics:
	 *
	 *   - return false  : abort the entire traversal immediately
	 *   - return true   : skip this node's children but continue with siblings
	 *   - return other  : descend normally into children (if associative)
	 *
	 * The callback receives: ($path, $value, $array, $context)
	 *
	 * @method depthFirst
	 * @param {Function} callback
	 * @param {Object} [context=null]
	 */
	this.depthFirst = function(cb, ctx) {
		_depthFirst.call(this,[],linked,cb,ctx);
	};

	/**
	 * Traverse the tree breadth-first and call the callback.
	 *
	 * Callback return value semantics:
	 *
	 *   - return false  : abort the entire traversal immediately
	 *   - return true   : skip this node's children but continue with siblings
	 *   - return other  : descend normally into children (if associative)
	 *
	 * The callback receives: ($path, $value, $array, $context)
	 *
	 * @method breadthFirst
	 * @param {Function} callback
	 * @param {Object} [context=null]
	 */
	this.breadthFirst = function(cb, ctx) {
		var rootCont = cb([], linked, linked, ctx);
		if (rootCont === false || rootCont === true) return;
		_breadthFirst.call(this, [], linked, cb, ctx);
	};

	/**
	 * Calculates a diff between this tree and another tree.
	 * Supports keyed diffs if you explicitly pass $keyField.
	 *
	 * @method diff
	 * @param {Q.Tree} tree
	 * @param {bool} [$skipUndefinedValues=false] Skip if the value is undefined in target
	 * @param {string|null} $keyField If provided, diff arrays of objects by this field
	 * @return {Q_Tree}
	 */
	this.diff = function(tree, skipUndefinedValues, keyField) {
		var context = {
			from: this,
			to: tree,
			diff: new Q.Tree(),
			skipUndefinedValues: !!skipUndefinedValues,
			keyField: keyField || null
		};
		this.depthFirst(_diffTo,context);
		tree.depthFirst(_diffFrom,context);
		return context.diff;
	};

	function _diffTo(path, value, arr, context) {
		// if empty path to return true (skip children, continue)
		if (!path.length) {
			return true;
		}
		var getArgs = path.slice();
		getArgs.push(null);
		var valueTo = context.to.get.apply(context.to, getArgs);
		var isAssocValue     = Q.isPlainObject(value);
		var isAssocValueTo   = Q.isPlainObject(valueTo);
		// If at least one side is NOT associative OR values differ:
		if ((!isAssocValue || !isAssocValueTo) && valueTo !== value) {
			// handle keyed arrays if both are arrays and not associative
			if (Q.isArrayLike(value) && Q.isArrayLike(valueTo)) {
				var keyField = context.keyField || _detectKeyField(
					Q.isArrayLike(value) ? value : [],
					Q.isArrayLike(valueTo) ? valueTo : []
				);
				if (keyField) {
					var d = _diffByKey(value, valueTo, context.keyField || keyField);
					if (Object.keys(d).length) {
						context.diff.set(path, d);
					}
					// PHP: return true to skip children but continue siblings
					return true;
				}

				// PHP: no keyField to use replace syntax
				valueTo = { replace: valueTo };
			}
			// skipUndefinedValues semantics
			if (context.skipUndefinedValues) {
				var lastKey  = path[path.length - 1];
				var parentPath = path.slice(0, -1);

				var parent = parentPath.length
					? context.to.get.apply(context.to, parentPath.concat(null))
					: context.to.parameters;

				if (!parent || !(lastKey in parent)) {
					// PHP: return true to skip children, continue traversal
					return true;
				}
			}
			// perform the diff write
			context.diff.set(path, valueTo);
		}
		if (valueTo == null) {
			return true;
		}
	}
	function _diffFrom(path, value, arr, context) {
		if (!path.length) {
			return true;
		}
		var getArgs = path.slice();
		getArgs.push(null);
		var valueFrom = context.from.get.apply(context.from, getArgs);
		// If from-tree doesn't have the key -> add it
		if (valueFrom === undefined) { // undefined wouldn't have been assigned normally
			context.diff.set(path, value);
			// PHP: return true -> skip children but continue siblings
			return true;
		}
		// else descend normally
	}

	this.merge = function(second,under,noNumericArrays) {
		if (Q.typeOf(second)==='Q.Tree') { this.merge(second.getAll(),under); }
		else if (typeof second==='object') {
			linked = (under===true)? _merge(second,linked,noNumericArrays): _merge(linked,second,noNumericArrays);
		} else return false;
		return this;
	};

	function _merge(first, second, noNumericArrays) {
		if (Array.isArray(first)) {
			if ((second.add || second.remove) && !second.updates) {
				throw new Q.Exception(
					"Q.Tree.merge: 'add'/'remove' require 'updates' to supply the keyField"
				);
			}
			if (second.updates) {
				var keyField = second.updates[0], updates = second.updates.slice(1);
				updates.forEach(function (upd) {
					for (var i = 0; i < first.length; i++) {
						if (first[i] && first[i][keyField] !== undefined
						&& first[i][keyField] === upd[keyField]) {
							first[i] = Object.assign({}, first[i], upd);
						}
					}
				});
				if (second.add) {
					second.add.forEach(function (a) {
						var found = false;
						for (var i = 0; i < first.length; i++) {
							if (first[i] && first[i][keyField] !== undefined
							&& first[i][keyField] === a[keyField]) { found = true; break; }
						}
						if (!found) first = first.concat([a]);
					});
				}
				if (second.remove) {
					first = first.filter(function (o) {
						return !second.remove.some(function (r) {
							return o && o[keyField] !== undefined && o[keyField] === r[keyField];
						});
					});
				}
				return first;
			}

			if (second.replace) return second.replace;

			if (second.prepend || second.append) {
				var result = first.slice();
				if (Array.isArray(second.prepend)) {
					for (var i = second.prepend.length - 1; i >= 0; i--) {
						var v = second.prepend[i];
						if (result.indexOf(v) === -1) result.unshift(v);
					}
				}
				if (Array.isArray(second.append)) {
					for (var i = 0; i < second.append.length; i++) {
						var v2 = second.append[i];
						if (result.indexOf(v2) === -1) result.push(v2);
					}
				}
				return result;
			}
		}

		// ── THE MISSING BRANCH ────────────────────────────────────────────────
		// PHP: $isNumeric = !$noNumericArrays && !isAssociative($array1)
		//                                     && !isAssociative($array2);
		//      if ($isNumeric) { if (!in_array($value, $result, true)) $result[] = $value; }
		// Without it, ["a","b","c"] + ["a","b","z"] index-assigns to ["a","b","z"]
		// in Node but appends to ["a","b","c","z"] in PHP.
		var isNumeric = !noNumericArrays && Array.isArray(first) && Array.isArray(second);

		var resultObj = Array.isArray(first)
			? (noNumericArrays ? Object.assign([], first) : first.slice())
			: Object.assign({}, first);

		if (isNumeric) {
			for (var i = 0; i < second.length; i++) {
				if (resultObj.indexOf(second[i]) === -1) resultObj.push(second[i]);
			}
			return resultObj;
		}

		var keys = Object.keys(second);
		for (var j = 0; j < keys.length; j++) {
			var k = keys[j];
			var bothMergeable = _mergeable(resultObj[k]) && _mergeable(second[k]);
			if (Object.prototype.hasOwnProperty.call(resultObj, k) && bothMergeable) {
				resultObj[k] = _merge(resultObj[k], second[k], noNumericArrays);
			} else {
				resultObj[k] = second[k];
			}
		}
		return resultObj;
	}

	function _mergeable(v) {
		return Array.isArray(v) || Q.isPlainObject(v);
	}

	function _diffByKey(oldArr,newArr,keyField) {
		var oldIndex = {}, newIndex = {};
		oldArr.forEach(o=>{ if(o[keyField]!=null) oldIndex[o[keyField]] = o; });
		newArr.forEach(n=>{ if(n[keyField]!=null) newIndex[n[keyField]] = n; });
		var add = [], remove = [], updates = [keyField];
		for (var k in newIndex) {
			if (!oldIndex[k]) add.push(newIndex[k]);
			else {
				var d = {}; for (var kk in newIndex[k]) if(oldIndex[k][kk]!==newIndex[k][kk]) d[kk] = newIndex[k][kk];
				if (Object.keys(d).length) { d[keyField] = k; updates.push(d); }
			}
		}
		for (var k in oldIndex) { if (!newIndex[k]) remove.push({[keyField]:k}); }
		var result = {}; if(add.length) result.add = add; if(remove.length) result.remove = remove; if(updates.length>1) result.updates = updates;
		return result;
	}
	function _detectKeyField(arr1,arr2) {
		var counts = {};
		[arr1,arr2].forEach(a=>{
			a.forEach(o=>{
				if (Q.isPlainObject(o)) { for (var k in o) { counts[k] = (counts[k]||0)+1; } }
			});
		});
		var maxKey = null,max = 0; for (var k in counts) { if(counts[k]>max) { max = counts[k]; maxKey = k; } }
		return maxKey;
	}
};

function _depthFirst(subpath, obj, callback, context) {
	for (var k in obj) {
		if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;

		var v = obj[k];
		var path = subpath.concat([k]);

		var ret = callback.call(this, path, v, obj, context);

		// false or true -> skip children, continue siblings
		if (ret === false || ret === true) {
			continue;
		}

		// descend into arrays or objects
		if (typeof v === 'object' && v !== null) {
			_depthFirst.call(this, path, v, callback, context);
		}
	}
}

function _breadthFirst(subpath, node, callback, context) {
	var queue = [];
	queue.push([subpath, node, node]); // [path, node, parent]

	while (queue.length > 0) {
		var item = queue.shift();
		var path = item[0];
		var current = item[1];
		var parent = item[2];

		for (var k in current) {
			if (!Object.prototype.hasOwnProperty.call(current, k)) continue;

			var value = current[k];
			var childPath = path.concat([k]);

			var cont = callback.call(
				this,
				childPath,   // path
				value,       // value
				current,     // parent
				context      // context
			);

			// false to abort all traversal
			if (cont === false) {
				return;
			}

			// true to skip children, continue siblings
			if (cont === true) {
				continue;
			}

			// descend into arrays or objects (match PHP)
			if (typeof value === 'object' && value !== null) {
				queue.push([childPath, value, current]);
			}
		}
	}
}
