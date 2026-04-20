/**
 * @module Q
 */

var Q = require('Q');
var fs = require('fs');
var path = require('path');
var util = require('util');
var crypto = require('crypto');
var Db = Q.require('Db');
var Db_Mysql = Q.require('Db/Mysql');

/**
 * Different utilities
 * @class Utils
 * @namespace Q
 * @static
 */
var Utils = {};

/**
 * Generate a local secret that is stable but hard to guess from outside.
 * Mirrors Q_Utils::generateLocalSecret() in PHP.
 * @method generateLocalSecret
 * @private
 * @return {string}
 */
function generateLocalSecret() {
	var os = require('os');
	var parts = [
		os.hostname(),
		os.type(),
		__filename
	];
	try {
		if (fs.existsSync('/etc/machine-id')) {
			parts.push(fs.readFileSync('/etc/machine-id', 'utf8').trim());
		}
	} catch (e) {}
	return crypto.createHash('sha256').update(parts.join("\t")).digest('hex');
}

function ksort(obj) {
	var i, sorted = {}, keys = Object.keys(obj);
	keys.sort();
	for (i=0; i<keys.length; i++) {
		var value = obj[keys[i]];
		sorted[keys[i]] = Q.isPlainObject(value) ? ksort(value) : value;
	}
	return sorted;
}

function urlencode (str) {
	// http://kevin.vanzonneveld.net
	str = (str + '').toString();
	return encodeURIComponent(str)
		.replace(/!/g, '%21')
		.replace(/'/g, '%27')
		.replace(/\(/g, '%28')
		.replace(/\)/g, '%29')
		.replace(/\*/g, '%2A')
		.replace(/%20/g, '+');
}

function http_build_query (formdata, numeric_prefix, arg_separator) {
	// http://kevin.vanzonneveld.net
	var value, key, tmp = [];

	var _http_build_query_helper = function (key, val, arg_separator) {
		var k, tmp = [];
		if (val === true) {
			val = "1";
		} else if (val === false) {
			val = "0";
		}
		if (val !== null && typeof(val) === "object") {
			for (k in val) {
				if (val[k] !== null) {
					tmp.push(_http_build_query_helper(key + "[" + k + "]", val[k], arg_separator));
				}
			}
			return tmp.join(arg_separator);
		} else if (typeof(val) !== "function") {
			return urlencode(key) + "=" + urlencode(val);
		} else {
			throw new Error('There was an error processing for http_build_query().');
		}
	};

	if (!arg_separator) {
		arg_separator = "&";
	}
	for (key in formdata) {
		value = formdata[key];
		if (numeric_prefix && !isNaN(key)) {
			key = String(numeric_prefix) + key;
		}
		tmp.push(_http_build_query_helper(key, value, arg_separator));
	}

	return tmp.join(arg_separator);
}

/**
 * Generate signature for an object
 * @method signature
 * @param {Object|String} data The data to sign
 * @param {String} [secret] A secret to use for signature. If null Q/internal/secret used
 * @return {string}
 */
Utils.signature = function (data, secret) {
	secret = secret || Q.Config.get(['Q', 'internal', 'secret'], null);
	if (!secret) {
		secret = generateLocalSecret();
	}
	if (typeof(data) !== 'string') {
		data = http_build_query(ksort(data)).replace(/\+/g, '%20');
	}
	return Q.Crypto.HmacSHA1(data, secret).toString();
};

/**
 * Sign data by adding signature field
 * @method sign
 * @param {object} data The data to sign
 * @param {array} fieldKeys Optionally specify the array key path for the signature field
 * @return {object} The data object is mutated and returned
 */
Utils.sign = function (data, fieldKeys) {
	var secret = Q.Config.get(['Q', 'internal', 'secret'], null);
	if (!secret) {
		secret = generateLocalSecret();
	}
	if (!fieldKeys || !fieldKeys.length) {
		var sf = Q.Config.get(['Q', 'internal', 'sigField'], 'sig');
		fieldKeys = ['Q.'+sf];
	}
	var ref = data;
	for (var i=0, l=fieldKeys.length; i<l-1; ++i) {
		if (!(fieldKeys[i] in ref)) {
			ref[ fieldKeys[i] ] = {};
		}
		ref = ref[ fieldKeys[i] ];
	}
	var key = fieldKeys[fieldKeys.length-1];
	// Remove existing signature before computing, matching PHP unset($ref[$ef]) behavior
	delete ref[key];
	ref[key] = Utils.signature(data, secret);
	return data;
};

/**
 * Validate some signed data.
 * @method validate
 * @param {object} data the signed data to validate
 * @param {array} fieldKeys Optionally specify the array key path for the signature field
 * @return {boolean} Whether the signature is valid. Returns true if secret is empty.
 */
Utils.validate = function(data, fieldKeys) {
	var temp = Q.copy(data, null, 100);
	var secret = Q.Config.get(['Q', 'internal', 'secret'], null);
	if (!secret) {
		secret = generateLocalSecret();
	}
	if (!fieldKeys || !fieldKeys.length) {
		var sf = Q.Config.get(['Q', 'internal', 'sigField'], 'sig');
		fieldKeys = ['Q.'+sf];
	}
	var ref = temp;
	for (var i=0, l=fieldKeys.length; i<l-1; ++i) {
		if (!(fieldKeys[i] in ref)) {
			ref[ fieldKeys[i] ] = {};
		}
		ref = ref[ fieldKeys[i] ];
	}
	var sig = ref[ fieldKeys[fieldKeys.length-1] ];
	delete ref[ fieldKeys[fieldKeys.length-1] ];
	return (sig === Utils.signature(temp, secret));
};

/**
 * express server middleware to validate signature of internal request
 * @method validateRequest
 * @static
 * @param {Object} req
 * @param {Object} res
 * @param {Function} next
 */
Utils.validateRequest = function (req, res, next) {
	// merge in GET data
	if (req.body) Q.extend(req.body, req.query);
	else req.body = req.query;
	// validate signature
	if (Utils.validate(req.body)) {
		next();
	} else {
		console.log(req.body);
		console.log("Request validation failed");
		res.send(JSON.stringify({errors: "Invalid signature"}), 403); // forbidden
	}
};

/**
 * Validates a capability signed by our own server's secret key.
 * The capability must have "startTime", "endTime" in seconds since UNIX epoch,
 * and must also be signed with Q.Utils.sign() or equivalent implementation.
 * @method validateCapability
 * @static
 * @param {Object|null} capability if null, then returns false
 * @param {Array|String} permissions
 * @return {boolean} Whether the signature is valid. Returns true if secret is empty.
 */
Utils.validateCapability = function (capability, permissions) {
	var now = Date.now() / 1000; // seconds, matching PHP time()
	var cp = capability && capability.permissions || [];
	if (!capability
	|| !Utils.validate(capability)
	|| Q.isEmpty(cp)
	|| capability.startTime > now
	|| capability.endTime < now) {
		return false;
	}
	if (typeof permissions === 'string') {
		permissions = [permissions];
	}
	var config = Q.Config.get(['Q', 'capability', 'permissions'], []);
	var search = {};
	cp.forEach(function (p) {
		search[p] = true;
		if (config[p]) {
			// add also long-form permission name
			search[config[p]] = true;
		}
	});
	for (var i=0, l=permissions.length; i<l; ++i) {
		if (!search[permissions[i]]) {
			return false;
		}
	}
	return true;
};

/**
 * Issues an HTTP request and returns a Promise.
 * If a callback is provided, it is called on completion and the Promise is also returned.
 *
 * @method _request
 * @private
 * @param {string} method  HTTP method ('GET', 'POST', etc.)
 * @param {string|array} uri  URL, or [url, ip] to override the resolved IP
 * @param {object|string} [data='']  POST body or query data
 * @param {string} [userAgent]  User-Agent header value
 * @param {object} [header]  Full header override
 * @param {function} [callback]  Optional node-style callback(err, body)
 * @return {Promise<string>}  Resolves with the response body string
 */
function _request(method, uri, data, userAgent, header, callback) {
	var agent = 'Mozilla/5.0 (Windows; U; Windows NT 5.1; en-US; rv:1.8.1.9) Gecko/20071025 Firefox/2.0.0.9';
	method = method.toLowerCase();

	// Flexible argument shifting: (method, uri, [data], [userAgent], [header], [callback])
	if (typeof data === "function") {
		callback = data; data = ''; userAgent = agent;
	} else if (typeof userAgent === "function") {
		callback = userAgent; userAgent = agent;
	} else if (typeof header === "function") {
		callback = header; header = null;
	}

	var ip = null, url;
	if (Q.typeOf(uri) === "array") {
		url = uri[0];
		if (uri[1]) ip = uri[1];
	} else {
		url = uri;
	}

	var urlModule = require('url');
	var parts = urlModule.parse(url);
	var host = parts.host;
	if (!ip) ip = host;

	var request_uri = parts.pathname;
	var port = parts.port ? ":" + parts.port : '';
	var server = parts.protocol + "//" + ip + port + request_uri;

	if (!header) header = { 'user-agent': userAgent || agent, 'host': host };

	if (typeof data !== "string") {
		data = http_build_query(data, '', '&');
	}

	var requestOpts = {
		headers: header,
		uri: server + "?" + data,
		agentOptions: { rejectUnauthorized: false }
	};

	var p = new Promise(function(resolve, reject) {
		require('request')[method](requestOpts, function(err, res, body) {
			if (err) return reject(err);
			if (res.statusCode >= 400) return reject(new Error(body));
			resolve(body);
		});
	});

	// Backward-compat: if a callback was supplied, wire it up
	if (callback) {
		p.then(function(body) { callback(null, body); })
		 .catch(function(err) { callback(err); });
	}

	return p;
}

/**
 * Issues a POST request and returns a Promise.
 * Optionally accepts a node-style callback for backward compatibility.
 *
 * @method post
 * @param {string|array} url
 * @param {object|string} [data='']
 * @param {string} [userAgent]
 * @param {object} [header]
 * @param {function} [callback]  Optional node-style callback(err, body)
 * @return {Promise<string>}
 */
Utils.post = function (url, data, userAgent, header, callback) {
	return _request('POST', url, data, userAgent, header, callback);
};

/**
 * Issues a GET request and returns a Promise.
 * Optionally accepts a node-style callback for backward compatibility.
 *
 * @method get
 * @param {string|array} url
 * @param {object|string} [data='']
 * @param {string} [userAgent]
 * @param {object} [header]
 * @param {function} [callback]  Optional node-style callback(err, body)
 * @return {Promise<string>}
 */
Utils.get = function (url, data, userAgent, header, callback) {
	return _request('GET', url, data, userAgent, header, callback);
};

/**
 * Queries a server externally to the specified handler.
 * Returns a Promise resolving to the response data, and also calls callback if provided.
 *
 * @method queryExternal
 * @param {string} handler
 * @param {object} [data={}]
 * @param {string|array} [url=null]  Defaults to Q/web/appRootUrl
 * @param {object} [headers=null]
 * @param {function} [callback]  Optional node-style callback(err, data)
 * @return {Promise<*>}
 */
Utils.queryExternal = function(handler, data, url, headers, callback) {
	if (typeof data === "function") {
		callback = data; data = {}; url = null;
	} else if (typeof url === "function") {
		callback = url; url = null;
	} else if (typeof headers === "function") {
		callback = headers; headers = null;
	}

	if (typeof data !== "object") {
		var typeErr = new Error("Utils.queryExternal: data has wrong type. Expecting 'object'");
		if (callback) { callback(typeErr); return Promise.reject(typeErr); }
		return Promise.reject(typeErr);
	}

	var query = {}, sig = 'Q.' + Q.Config.get(['Q', 'internal', 'sigField'], 'sig');
	query['Q_ajax'] = 'json';
	query['Q_slotNames'] = 'data';
	query[sig] = Utils.sign(Q.extend({}, data, query))[sig];

	if (!url) url = Q.Config.get(['Q', 'web', 'appRootUrl'], false);
	if (!url) {
		var urlErr = new Error("Root URL is not defined in Q.Utils.queryExternal");
		if (callback) { callback(urlErr); return Promise.reject(urlErr); }
		return Promise.reject(urlErr);
	}

	var servers, tail = "/action.php/" + handler;
	if (Q.typeOf(url) === "array") {
		servers = [url[0] + tail];
		if (url.length > 1) servers.push(url[1]);
	} else {
		servers = url + tail;
	}

	var p = Utils.post(servers, data, query, null, headers)
	.then(function(res) {
		var d;
		try { d = JSON.parse(res); } catch(e) { throw e; }
		if (d.errors) {
			throw new Error(d.errors[0] ? d.errors[0].message : "Unknown error from Utils.post()");
		}
		return (d.slots && d.slots.data) ? d.slots.data : null;
	});

	if (callback) {
		p.then(function(result) { callback(null, result); })
		 .catch(function(err) { callback(err); });
	}

	return p;
};

/**
 * Sends a query to Node.js internal server and returns a Promise.
 * Optionally calls callback for backward compatibility.
 *
 * @method queryInternal
 * @param {string} handler
 * @param {object} [data={}]
 * @param {string|array} [url=null]  Defaults to Q/nodeInternal config
 * @param {function} [callback]  Optional node-style callback(err, data)
 * @return {Promise<*>}
 */
Utils.queryInternal = function(handler, data, url, callback) {
	if (typeof data === "function") {
		callback = data; data = {}; url = null;
	} else if (typeof url === "function") {
		callback = url; url = null;
	}

	if (typeof data !== "object") {
		var typeErr = new Error("'data' has wrong type. Expecting 'object'");
		if (callback) { callback(typeErr); return Promise.reject(typeErr); }
		return Promise.reject(typeErr);
	}

	if (!url) {
		var nodeh = Q.Config.get(['Q', 'nodeInternal', 'host'], null);
		var nodep = Q.Config.get(['Q', 'nodeInternal', 'port'], null);
		url = (nodep && nodeh) ? "http://" + nodeh + ":" + nodep : false;
		if (!url) {
			var urlErr = new Error("nodeInternal server is not defined");
			if (callback) { callback(urlErr); return Promise.reject(urlErr); }
			return Promise.reject(urlErr);
		}
	}

	var server, tail = "/" + handler;
	if (Q.typeOf(url) === "array") {
		server = [url[0] + tail];
		if (url.length > 1) server.push(url[1]);
	} else {
		server = url + tail;
	}

	var p = Utils.post(server, Utils.sign(data))
	.then(function(res) {
		var d;
		try { d = JSON.parse(res); } catch(e) { throw e; }
		if (d.errors) throw d.errors;
		return d.data;
	});

	if (callback) {
		p.then(function(result) { callback(null, result); })
		 .catch(function(err) { callback(err); });
	}

	return p;
};

/**
 * Sends an internal message to PHP and returns a Promise resolving to the response slots.
 *
 * All Safebox Node→PHP communication goes through this method. It:
 *   - Signs the payload with the internal secret
 *   - Encodes the logical HTTP method as Q_method in the POST body, so PHP handlers
 *     can dispatch on it via Q::ifset($req, 'Q_method', Q_Request::method())
 *   - Always sends an HTTP POST (the Q framework's transport is always POST)
 *   - Returns a Promise resolving to the parsed slots object from the PHP response
 *
 * @method sendToPHP
 * @static
 * @param {String} path  Route path, e.g. "Safebox/task" or a URL that starts with "http://" or "https://"
 * @param {Object} data  Payload to sign and send
 * @param {Object} [options={}]
 * @param {String} [options.method='POST']  Logical method, encoded as Q_method in body
 * @param {String} [options.userAgent='Node/Q.Utils'] Specify a custom user agent 
 * @param {Array}  [options.fieldKeys] Key path for the signature field
 * @return {Promise<Object>}  Resolves to response slots object
 */
Utils.sendToPHP = function(path, data, options) {
    if (!path) throw new Q.Exception("Q.Utils.sendToPHP: path must be defined");
    if (!data || typeof data !== 'object') throw new Q.Exception("Q.Utils.sendToPHP: data must be an object");

    options = options || {};
    var method  = (options.method || 'POST').toUpperCase();
    
    // Accept either a full URL or a path to be expanded against appRootUrl.
    var url;
    if (/^https?:\/\//i.test(path)) {
        url = path;
    } else {
        var baseUrl = Q.Config.expect(['Q', 'web', 'appRootUrl']);
        url = baseUrl + '/action.php/' + path;
    }

    var payload = Object.assign({}, data, { Q_method: method });
    var signed  = Utils.sign(payload, options.fieldKeys);

    return _request(method, url, signed, options.userAgent || 'Node/Q.Utils')
    .then(function(body) {
        var parsed;
        try { parsed = JSON.parse(body); } catch(e) {
            throw new Error('Q.Utils.sendToPHP: invalid JSON response from ' + path + ': ' + body);
        }
        if (parsed.errors && parsed.errors.length) {
            var err = parsed.errors[0];
            throw new Error(err && err.message ? err.message : JSON.stringify(err));
        }
        return parsed.slots || parsed;
    });
};

/**
 * Sends a fire-and-forget message to Node.js via the /Q/node endpoint.
 * Data must include "Q/method" so Node can route it to the correct handler.
 *
 * @method sendToNode
 * @param {object} data  Must contain 'Q/method'
 * @param {string|array} [url=null]  Defaults to Q/nodeInternal config + /Q/node
 * @return {boolean}  true if the request was sent, false if no nodeInternal is configured
 * @throws {Q.Exception} if data is not an object or missing Q/method
 */
Utils.sendToNode = function(data, url) {
	if (typeof data !== 'object')
		throw new Q.Exception("The message to send to node must be an object");
	if (!data['Q/method'])
		throw new Q.Exception("'Q/method' is required in the message for sendToNode");

	if (!url) {
		var nodeh = Q.Config.get(['Q', 'nodeInternal', 'host'], null);
		var nodep = Q.Config.get(['Q', 'nodeInternal', 'port'], null);
		url = (nodep && nodeh) ? "http://" + nodeh + ":" + nodep + "/Q/node" : false;
		if (!url) return false;
	}

	// Fire-and-forget: no callback, no Promise returned.
	// The 'request' module handles the HTTP send in the background.
	require('request').post({
		headers: {
			'User-Agent': 'Mozilla/5.0 (Windows; U; Windows NT 5.1; en-US; rv:1.8.1.9) Gecko/20071025 Firefox/2.0.0.9'
		},
		uri: url + "?" + http_build_query(Utils.sign(data))
	});
	return true;
};

/**
 * Create folder for filename if it does not exist.
 * Folder is created with Q/internal/umask config value applied as umask.
 * Returns a Promise and optionally calls callback for backward compatibility.
 *
 * @method preparePath
 * @param {string} filename
 * @param {function} [callback]  Optional node-style callback(err)
 * @return {Promise<void>}
 */
Utils.preparePath = function(filename, callback) {
	var dir = path.dirname(filename.replace('/', Q.DS));

	var p = new Promise(function(resolve, reject) {
		fs.stat(dir, function(err, stats) {
			if (err && err.code !== 'ENOENT') return reject(err);
			if (err) {
				// dir does not exist — create it recursively
				Utils.preparePath(dir)
				.then(function() {
					var mask = process.umask(parseInt(Q.Config.get(['Q', 'internal', 'umask'], "0000"), 8));
					fs.mkdir(dir, function(mkErr) {
						process.umask(mask);
						if (mkErr) reject(mkErr); else resolve();
					});
				})
				.catch(reject);
			} else {
				if (stats.isDirectory()) resolve();
				else reject(new Error("'" + dir + "' is not a directory"));
			}
		});
	});

	if (callback) {
		p.then(function() { callback(null); }).catch(function(err) { callback(err); });
	}

	return p;
};

// ── Shard splitting (internal, unchanged) ────────────────────────────────────

// wheather to write log and which log
var _logging = false;
// Connection name
var _connection = null;
// Table name
var _table = null;
// table name with db and prefix
var _dbTable = null;
// the class for which shard is being split
var _class = null;
// the shard name which is being split
var _shard = null;
// the new shards config
var _shards = null;
// the partition which is being split
var _part = null;
// config for new shards
var _parts = null;
// select criteria
var _where = null;
// log file streams
var _log = [];
// log file name
var _log_file = null;
// we'll monitor closing of files for clean up
var _log_pipe = null;
// config reload timeout
var _timeout = 0;
// we give 0.5 sec to check if the file can be created
var _fileTimeout = 500;
// create new Db_Mysql object to leverage caching
var _dbm = null;
// the class constructor
var _rowClass = null;
// timestamp of select query
var _timestamp = null;

function _setTimeout(message, action, timeout) {
	var time = Math.floor(timeout/1000);
	function _counter() {
		process.stderr.write("Wait "+(time--)+" sec to "+message+"   \r");
		if (time > 0) return setTimeout(_counter, 1000);
		else return null;
	}
	return [setTimeout(action, timeout), _counter()];
}

function _clearTimeout(timeout) {
	clearTimeout(timeout[0]);
	clearTimeout(timeout[1]);
}

function _reset_split() {
	_split_log("Resetting shard split handler and configuration. Please, wait for final confirmation");
	_connection = _table = _dbTable = _class = _shard = _shards = _part = _parts = _where = _log_file = _dbm = _rowClass = _timestamp = null;
	_logging = false; _phase = 0;
	var config = Q.Config.get(['Q', 'internal', 'sharding', 'upcoming'], 'Db/config/upcoming.json');
	Q.Config.clearOnServer(config, function (err) {
		if (err) _split_log("Failed to clear config in file '"+config+"'. Delete the file manually to avoid excessive messaging.", err);
		else {
			_setTimeout("reload updated config", function () {
				_timeout = 0;
				_split_log("Shards split handler is reset and can handle new request");
				_split_log("The file '"+config+"' can be safely deleted");
			}, _timeout);
		}
	});
}

function _split_log() {
	console.log.apply(this, arguments);
}

var _logServer = null;

Utils.listen = function(callback) {
	var server = Q.listen();
	server.attached.express.post('/Db/Shards', function Shards_split_handler (req, res, next) {
		var parsed = req.body;
		if (!parsed || !parsed['Q/method']) return next();
		switch (parsed['Q/method']) {
			case 'split':
				if (Q.Config.get(['Db', 'upcoming', _connection, 'shard'], null) === null) {
					Q.time("Db/Shards/split");
					_log_pipe = new Q.Pipe((function () {
						var i, l = [];
						for (i=1; i<Q.Config.get(['Q', 'internal', 'sharding', 'iterations'], 1); i++) l.push(i);
						return l;
					})(), function () {
						_split_log("All logs processed");
						_log_pipe = null;
						_log = [];
					});
					_connection = parsed.connection;
					_table = parsed.table;
					_dbTable = parsed.dbTable;
					_class = parsed['class'];
					_shard = parsed.shard;
					_shards = JSON.parse(parsed.shards);
					_part = parsed.part;
					_parts = JSON.parse(parsed.parts);
					_where = parsed.where;
					_log = [];
					_dbm = new Db_Mysql(_connection);
					_timeout = 1000 * (Q.Config.get(['Q', 'internal', 'configServer', 'interval'], 60) + Q.Config.get(['Q', 'internal', 'phpTimeout'], 30));
					try {
						_rowClass = Q.require(_class.split('_').join('/'));
					} catch (e) {
						_split_log("Wrong row class supplied '%s', aborting", _class);
						_reset_split();
						res.send({data: false});
						break;
					}
					if (!(_connection && _table && _dbTable && _shards && _class && _part && _parts && _where)) {
						_split_log("Insufficient data supplied for shard split, aborting");
						_reset_split();
						res.send({data: false});
						break;
					} else res.send({data: true});
					_logServer = [
						"http://" + req.info.host + ":" + req.info.port + "/Q/node",
						server.address().address
					];
					Q.Config.setOnServer(
						Q.Config.get(['Q', 'internal', 'sharding', 'upcoming'], 'Db/config/upcoming.json'),
						(new Q.Tree())
							.set(['Db', 'connections', _connection, 'indexes', _table], {})
							.set(['Db', 'upcoming', _connection], {shard: _shard, table: _table, dbTable: _dbTable})
							.set(['Db', 'upcoming', _connection, 'indexes', _table], _parts)
							.set(['Db', 'internal', 'sharding', 'logServer'], _logServer),
						function (err) {
							if (err) {
								_split_log("Failed to write '%s'", Q.Config.get(['Q', 'internal', 'sharding', 'upcoming'], 'Db/config/upcoming.json'));
								_reset_split();
							} else {
								_log_file = Q.Config.get(['Q', 'internal', 'sharding', 'logs'], 'files'+Q.DS+'Db'+Q.DS+'logs') +
										Q.DS+'split_'+_connection+'_'+_table+'_'+_shard;
								Utils.preparePath(_log_file)
								.then(function() {
									_log_file_start(1, function () {
										_split_log("Begin split process for class '"+_class+"', shard '"+_shard+"' ("+_part+")");
										_setTimeout("activate upcoming config", _split, _timeout);
									});
								})
								.catch(function(err) {
									_split_log("Failed to create directory for logs:", err.message);
									_reset_split();
								});
							}
						}, true);
				} else res.send({errors: "Split process for class '"+_class+"', shard '"+_shard+"' ("+_part+") is active"});
				break;
			case 'switch':
				res.send({data: true});
				var i, shardsFile = null,
					baseName = Q.Config.get(['Q', 'internal', 'sharding', 'config'], 'Db/config/shards.json'),
					configFiles = Q.Config.get(['Q', 'configFiles'], []),
					extName = path.extname(baseName);
				if ((i = baseName.lastIndexOf(extName)) >= 0) baseName = baseName.substring(0, i);
				if (!baseName.length) { baseName = 'Db/config/shards'; extName = '.json'; }
				for (i=0; i<configFiles.length; i++) {
					if (configFiles[i].indexOf(baseName) === 0) { shardsFile = configFiles[i]; break; }
				}
				var newShardsFile = baseName+(new Date()).toISOString().replace(/([\-:]|\.\d{3}z$)/gi, '')+extName;
				if (shardsFile) {
					Q.Config.getFromServer(shardsFile, function (err, data) {
						if (err) {
							_split_log("Config file read error ("+shardsFile+").", err.message);
							_split_log("NOTE: platform is not writing to shard '"+_shard+"'!!!");
							_split_log("Update the config file manually and then delete file '%s'", Q.Config.get(["Q", "internal", "sharding", "upcoming"], 'Db/config/upcoming.json'));
							_split_log("New shards:", _shards);
							_split_log("New indexes:", _parts);
						} else _writeShardsConfig(data);
					});
				} else _writeShardsConfig({});

				function _writeShardsConfig(data) {
					var local = new Q.Tree(data);
					local.clear(['Db', 'connections', _connection, 'indexes', _table]);
					var connection = Q.Config.get(['Db', 'connections', _connection], {});
					var indexes = {};
					if (!connection.indexes || !connection.indexes[_table] || !Object.keys(connection.indexes[_table]).length) {
						indexes = _parts;
					} else {
						var tmp = connection.indexes[_table].partition;
						var fields = connection.indexes[_table].fields;
						if (Q.typeOf(tmp) === 'array' && Q.typeOf(_parts.partition) === 'array') {
							tmp = tmp.concat(_parts.partition.slice(1));
							indexes = {partition: tmp.sort(tmp), fields: fields};
						} else {
							if (Q.typeOf(tmp) === 'array') {
								var o = {};
								tmp.forEach(function(val) { o[val] = val; });
								tmp = o;
							}
							Q.extend(tmp, _parts.partition);
							indexes = {partition: ksort(tmp), fields: fields};
						}
					}
					local.set(['Db', 'connections', _connection, 'indexes', _table], indexes);
					connection = local.get(['Db', 'connections', _connection], {});
					if (connection.shards) Q.extend(connection.shards, _shards);
					else connection.shards = _shards;
					Q.Config.setOnServer(newShardsFile, local.getAll(), function (err) {
						if (err) {
							_split_log("Config file write error ("+newShardsFile+").", err.message);
							_split_log("NOTE: platform is not writing to shard '"+_shard+"'!!!");
							_split_log("Update the config files manually and then delete file '%s'", Q.Config.get(["Q", "internal", "sharding", "upcoming"], 'Db/config/upcoming.json'));
							_split_log("New shards:", _shards);
							_split_log("New indexes:", _parts);
						} else {
							Q.Config.clearOnServer('Q/config/bootstrap.json', ['Q', 'configFiles',
								[shardsFile, Q.Config.get(['Q', 'internal', 'sharding', 'upcoming'], 'Db/config/upcoming.json')]
							], function(err, tree) {
								if (err) {
									_split_log("Config file read error (Q/config/bootstrap.json).", err.message);
									_split_log("NOTE: platform is not writing to shard '"+_shard+"'!!!");
									_split_log("Update the config file manually and then delete file '%s'", Q.Config.get(["Q", "internal", "sharding", "upcoming"], 'Db/config/upcoming.json'));
									_split_log("New shards:", _shards);
									_split_log("New indexes:", _parts);
								} else {
									tree = new Q.Tree(tree);
									tree.merge({Q: {configFiles: [newShardsFile]}});
									Q.Config.setOnServer('Q/config/bootstrap.json', tree.getAll(), function(err) {
										if (err) {
											_split_log("Config file write error (Q/config/bootstrap.json).", err.message);
											_split_log("NOTE: platform is not writing to shard '"+_shard+"'!!!");
											_split_log("Update the config file manually and then delete file '%s'", Q.Config.get(["Q", "internal", "sharding", "upcoming"], 'Db/config/upcoming.json'));
											_split_log("New content for 'Q/config/bootstrap.json':", tree.getAll());
										} else {
											_split_log("Finished split process for shard '%s' (%s) in %s", _shard, _part, Q.timeEnd("Db/Shards/split"));
											_reset_split();
										}
									}, true);
								}
							}, true);
						}
					}, true);
				}
				break;
			case 'log':
				res.send({data: true});
				if (_logging) {
					_log[_logging].write(JSON.stringify({
						shards: parsed.shards,
						sql: parsed.sql,
						timestamp: (new Date()).getTime()
					})+'\n', 'utf-8');
				}
				break;
			case 'reset':
				if (!splitting) { res.send({data: false}); break; }
				// falls through to writeLog
			case 'writeLog':
				res.send({data: true});
				function _block_error(err, config) {
					_split_log("Error updating config.", err.message);
					_split_log("Failed block shard '"+_shard+"'. Log file is been written.");
					_split_log("Check and fix error, verify if file '"+config+"' exists and contains split information");
					_split_log("then run 'split.php --log-process' to continue the process");
				}
				if (_logging >= Q.Config.get(['Q', 'internal', 'sharding', 'iterations'], 1)) {
					Q.Config.setOnServer(
						Q.Config.get('Q', 'internal', 'sharding', 'upcoming', 'Db/config/upcoming.json'),
						(new Q.Tree()).set(['Db', 'upcoming', _connection, 'block'], true),
						function (err) {
							if (err) _block_error(err, config);
							else {
								_setTimeout("block writing to shard '"+_shard+"'", function(phase) {
									phase = _logging;
									_dump_log(phase, function () {
										Utils.queryInternal('Db/Shards', {'Q/method': 'switch'}, _logServer)
										.catch(function(err) {
											_split_log("Failed to change config files.", err.message);
											_split_log("Check and fix error, then run 'split.php --reconfigure' to continue the process");
										});
									});
								}, _timeout);
							}
						});
				} else {
					_log_file_start(_logging + 1, function() {
						_dump_log(_logging++, function () {
							Utils.queryInternal('Db/Shards', {'Q/method': 'writeLog'}, _logServer)
							.catch(function(err) {
								_split_log("Failed to start writing log.", err.message);
								_split_log("Check and fix error, then run 'split.php --log-process' to continue the process");
							});
						});
					});
				}
				break;
			default:
				return next();
		}
	});

	server.attached.express.post('/Q/node', function Shards_split_logger(req, res, next) {
		var parsed = req.body;
		if (!parsed || !parsed['Q/method']) return next();
		switch (parsed['Q/method']) {
			case 'Db/Shards/log':
				if (_logging) {
					_log[_logging].write(JSON.stringify({
						shards: parsed.shards,
						sql: parsed.sql,
						timestamp: (new Date()).getTime()
					})+'\n', 'utf-8');
				}
				break;
			default:
				return next();
		}
	});

	if (server.address()) callback && callback();
	else server.once('listening', function () {
		callback && callback(server.address());
	});
};

function _split() {
	if (Q.Config.get(['Db', 'upcoming', _connection, 'shard'], null) === null) {
		_split_log("Splitting cancelled!");
		return;
	}
	_split_log("Start copying old shard '"+_shard+"' ("+_part+")");

	var total = 0, read = 0, count = 0, shards = Object.keys(_shards);
	var batches = {};
	shards.forEach(function(shard) {
		batches[shard] = Q.batcher(function(rows, params, callbacks) {
			if (!rows.length) return;
			_dbm.reallyConnect(function (client) {
				var i, s = [];
				function _escapeRow(row) {
					var key, v = [];
					for (key in row) v.push(client.escape(row[key]));
					return "("+v.join(", ")+")";
				}
				for (i=0; i<rows.length; i++) {
					s.push(_escapeRow(rows[i]));
					var sql = "INSERT INTO "+_rowClass.table().toString()
						.replace('{{prefix}}', _dbm.prefix())
						.replace('{{dbname}}', _dbm.dbname())
						+" ("+Object.keys(rows[0]).join(", ")+") VALUES "+s.join(", ");
					client.query(sql, function(err) {
						process.stderr.write("Processed "+(count/total*100).toFixed(1)+"%\r");
						callback([err]);
					});
				}
			}, shard, _shards[shard]);
		}, {ms: 50, max: 100});
	});
	_logging = 1;
	var child = require('child_process').fork(
		Q.CLASSES_DIR+'/Q/Utils/Split.js',
		[Q.app.DIR, _class, _connection, _dbTable, _shard, _part, JSON.stringify(_parts), _where],
		{cwd: Q.CLASSES_DIR, env: process.env}
	).once('exit', function(code, signal) {
		switch (code) {
			case 0: child = null; return;
			case 99: break;
			default:
				if (signal) _split_log("Child process died unexpectedly on signal '%s'", signal);
				else _split_log("Child process died unexpectedly with code %d", code);
		}
		_split_log("Split process for '"+_shard+"' ("+_part+") failed!");
		child = batches = null;
		_reset_split();
	}).on('message', function (message) {
		var fail = false;
		if (!message.type) throw new Error("Message type is not defined");
		switch (message.type) {
			case 'start':
				Q.time("Db/Shards/copy");
				total = message.count;
				_timestamp = message.timestamp;
				break;
			case 'log':
				_split_log.apply(this, message.content);
				break;
			case 'row':
				batches[message.shard](message.row, function (err) {
					count++;
					if (err) {
						if (fail) return;
						fail = true;
						child.removeAllListeners('message');
						child.removeAllListeners('exit');
						for (var shard in batches) batches[shard].cancel();
						child.kill();
						batches = null;
						_split_log("Error processing rows of table '"+_dbTable+"'.", err.message);
						_split_log("Split process for '"+_shard+"' ("+_part+") failed!");
						_reset_split();
					} else if (count === read) {
						_split_log("Total "+count+" rows from shard '"+_shard+"' ("+_part+") processed in "+Q.timeEnd("Db/Shards/copy"));
						Utils.queryInternal('Db/Shards', {'Q/method': 'writeLog'}, _logServer)
						.catch(function(err) {
							_split_log("Failed to start writing log.", err.message);
							_split_log("Check and fix error, then run 'split.php --log-process' to continue the process");
						});
					}
				});
				break;
			case 'stop':
				read = message.count;
				if (read <= count) {
					for (var shard in batches) batches[shard].cancel();
					_split_log("All rows processed before read finished. Exiting.");
					child.kill();
					batches = null;
					_reset_split();
				}
				break;
			default:
				throw new Error("Message of type '"+message.type+"' is not supported");
		}
	});
}

function _log_file_start(phase, cb) {
	var _t = setTimeout(function() {
		_split_log("Start writing log file '"+_log_file+"' phase "+phase);
		_log[phase].write('# start\n');
		cb && cb();
	}, _fileTimeout);
	_log[phase] = require('fs')
		.createWriteStream(Q.app.DIR+Q.DS+_log_file+'_phase_'+phase+'.log')
		.on('error', function(err) {
			_split_log("Log file error ("+_log_file+", phase "+phase+").", err.message);
			_clearTimeout(_t);
			_reset_split();
		}).on('close', _log_pipe.fill(this.phase));
	_log[phase].phase = phase;
}

var _buffer = '';
function _dump_log(phase, onsuccess) {
	_log[phase].end('# end');
	_split_log("Start processing log file '"+_log_file+"' phase "+phase);
	var log = require('fs')
		.createReadStream(Q.app.DIR+Q.DS+_log_file+'_phase_'+phase+'.log')
		.on('error', function (err) {
			_split_log("Log file read error ("+_log_file+").", err.message);
			_split_log("Check and fix error, verify if file '"+_log_file+"' exists and contains log information");
			_split_log("then run 'split.php --log-process' to continue the process");
			this.removeAllListeners();
		}).on('data', function(data) {
			var lines = (_buffer + data).split("\n"), that = this, failed = false;
			_buffer = lines.pop();
			lines.forEach(function(line, obj) {
				if (failed) return;
				line = line.replace("\r", '');
				if (line[0] !== '#') {
					try {
						obj = JSON.parse(line);
					} catch (e) {
						_split_log("Error parsing log file '"+_log_file+"' phase "+phase, e);
						_split_log("Split process for '"+_shard+"' ("+_part+") failed!");
						that.removeAllListeners();
						_reset_split();
						failed = true;
						return;
					}
					if (_timestamp && obj.timestamp >= _timestamp) {
						var i, shard;
						for (i=0; i<obj.shards.length; i++) {
							shard = obj.shards[i];
							_dbm.reallyConnect(function(client) {
								var sql = obj.sql
									.replace('{{prefix}}', _dbm.prefix())
									.replace('{{dbname}}', _dbm.dbname());
								client.query(sql, function(err) {
									if (failed) return;
									if (err) {
										failed = true;
										_split_log("Error writing from log file.", err.message);
										_split_log("Split process for '"+_shard+"' ("+_part+") failed!");
										that.removeAllListeners();
										_reset_split();
									}
								});
							}, shard, _shards[shard]);
						}
					}
				}
			});
		}).on('end', function () {
			log = null;
			_split_log("Log for phase "+phase+" has been processed");
			onsuccess && onsuccess();
		});
}

/**
 * Used to split ids into one or more segments, in order to store millions
 * of files under a directory, without running into limits of various filesystems
 * on the number of files in a directory.
 * @method splitId
 * @static
 * @param {string} id the id to split
 * @param {integer} [lengths=3]
 * @param {string} [delimiter=path.sep]
 * @param {string} [internalDelimiter='/']
 * @param {RegExp} [checkRegEx]
 * @return {string}
 */
Utils.splitId = function(id, lengths, delimiter, internalDelimiter, checkRegEx) {
	if (checkRegEx === undefined) {
		checkRegEx = new RegExp('^[a-zA-Z0-9\\.\\-\\_]{1,31}$');
	}
	if (checkRegEx) {
		if (!id || !id.match(checkRegEx)) {
			throw new Q.Exception("Wrong value for {{id}}. Expected {{range}}", {
				field: 'id', id: id, range: checkRegEx
			});
		}
	}
	lengths = lengths || 3;
	delimiter = delimiter || path.sep;
	if (internalDelimiter === undefined) internalDelimiter = '/';
	var parts = [];
	if (internalDelimiter) {
		parts = id.split(internalDelimiter);
		id = parts.pop();
	}
	var prefix = parts.length > 0 ? parts.join(delimiter) + delimiter : '';
	var segments = [], pos = 0, len = id.length;
	while (pos < len) { segments.push(id.slice(pos, pos += lengths)); }
	return prefix + segments.join(delimiter);
};

/**
 * Deterministic CIDv1 for raw content (sha2-256, raw codec, base32 encoded).
 * @method cid
 * @static
 * @param {String|Buffer} content
 * @return {String}
 */
Utils.cid = function cid(content) {
	if (content === undefined || content === null) throw new Error("Q.Utils.cid requires content");
	if (!Buffer.isBuffer(content)) content = Buffer.from(String(content), "utf8");
	var digest = crypto.createHash("sha256").update(content).digest();
	var multihash = Buffer.concat([Buffer.from([0x12, 0x20]), digest]);
	var cidBytes = Buffer.concat([Buffer.from([0x01]), Buffer.from([0x55]), multihash]);
	return Utils.base32(cidBytes);
};

/**
 * Base32 encoding (lowercase, CID compatible, no padding).
 * @method base32
 * @static
 * @param {Buffer} buffer
 * @return {String}  Prefixed with 'b'
 */
Utils.base32 = function(buffer) {
	var alphabet = "abcdefghijklmnopqrstuvwxyz234567";
	var bits = 0, value = 0, output = "";
	for (var i = 0; i < buffer.length; i++) {
		value = (value << 8) | buffer[i];
		bits += 8;
		while (bits >= 5) { output += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; }
	}
	if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
	return "b" + output;
};

module.exports = Utils;