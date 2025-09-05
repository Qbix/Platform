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

	this.getAll = function () { return linked; };

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

	this.depthFirst = function(cb, ctx) { _depthFirst.call(this,[],linked,cb,ctx); };
	this.breadthFirst = function(cb,ctx) { cb([],linked,linked,ctx); _breadthFirst.call(this,[],linked,cb,ctx); };

	this.diff = function(tree, skipUndefinedValues) {
		var context = {from:this,to:tree,diff:new Q.Tree(),skipUndefinedValues:!!skipUndefinedValues};
		this.depthFirst(_diffTo,context);
		tree.depthFirst(_diffFrom,context);
		return context.diff;
	};

	function _diffTo(path,value,arr,context) {
		var valueTo = context.to.get(path,null);
		if ((!Q.isPlainObject(value)||!Q.isPlainObject(valueTo)) && valueTo!==value) {
			if (Q.isArrayLike(value)&&Q.isArrayLike(valueTo)) {
				var keyField = _detectKeyField(value,valueTo);
				if (keyField) {
					var d = _diffByKey(value,valueTo,keyField);
					if (Object.keys(d).length) context.diff.set(path,d);
					return false;
				}
				valueTo = {replace:valueTo};
			}
			if (context.skipUndefinedValues) {
				var lastKey = path[path.length-1];
				var parent = context.to.get(path.slice(0,-1), {});
				if (!(lastKey in parent)) return false;
			}
			context.diff.set(path,valueTo);
		}
		if (valueTo==null) return false;
	}
	function _diffFrom(path,value,arr,context) {
		var valueFrom = context.from.get(path,undefined);
		if (valueFrom===undefined) { context.diff.set(path,value); return false; }
	}

	this.merge = function(second,under,noNumericArrays) {
		if (Q.typeOf(second)==='Q.Tree') { this.merge(second.getAll(),under); }
		else if (typeof second==='object') {
			linked = (under===true)? _merge(second,linked,noNumericArrays): _merge(linked,second,noNumericArrays);
		} else return false;
		return this;
	};

	function _merge(first,second,noNumericArrays) {
		if (Q.typeOf(first)==='array') {
			if (second.updates) {
				var keyField = second.updates[0], updates = second.updates.slice(1);
				updates.forEach(upd=>{
					for (var i = 0;i<first.length;i++) {
						if (first[i][keyField]===upd[keyField]) first[i] = Object.assign({},first[i],upd);
					}
				});
				if (second.add) first = first.concat(second.add);
				if (second.remove) {
					first = first.filter(o=>{
						return !second.remove.some(r=>o[keyField]===r[keyField]);
					});
				}
				return first;
			}
			if (second.replace) return second.replace;
		}
		var result = Array.isArray(first)?first.slice():Object.assign({},first);
		for (var k in second) {
			if (!(k in result)) result[k] = second[k];
			else if (typeof result[k]!=='object'||result[k]===null) result[k] = second[k];
			else if (typeof second[k]!=='object'||second[k]===null) result[k] = second[k];
			else result[k] = _merge(result[k],second[k],noNumericArrays);
		}
		return result;
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

function _depthFirst(subpath, obj, callback, context)  {
	var k, v, path;
	for (k in obj) {
		v = obj[k];
		path = subpath.concat([k]);
		if (false === callback.call(this, path, v, obj, context)) {
			continue;
		}
		if (Q.isPlainObject(v)) {
			_depthFirst.call(this, path, v, callback, context);
		}
	}
}

function _breadthFirst(subpath, obj, callback, context) {
	var k, v, path;
	for (k in obj) {
		v = obj[k];
		path = subpath.concat([k]);
		if (false === callback.call(this, path, v, obj, context)) {
			break;
		}
	}
	for (k in obj) {
		if (Q.isPlainObject(v)) {
			path = subpath.concat([k]);
			_breadthFirst.call(this, path, v, callback);
		}
	}
}
