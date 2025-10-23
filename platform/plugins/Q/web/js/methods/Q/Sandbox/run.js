Q.exports(function (Q) {
	/**
	 * Q plugin's front-end code
	 * @module Q
	 * @class Q.Sandbox
	 */

	/**
	 * Runs code safely inside a sandboxed iframe.
	 * If `options.name` is provided, a persistent runner is reused.
	 *
	 * @static
	 * @method run
	 * @param {String} code JavaScript source to execute
	 * @param {Object} [context] Variables accessible inside the sandbox
	 * @param {Object} [options] Additional sandbox configuration
	 * @param {String} [options.name] Reuse a persistent sandbox runner under this name
	 * @param {Number} [options.timeout=2000] Timeout in milliseconds before aborting execution
	 * @param {String} [options.sandbox="allow-scripts"] Sandbox attribute value controlling allowed features
	 * @param {String} [options.style="display:none;"] CSS style applied to the iframe element
	 * @return {Q.Promise} Resolves with result or rejects on error
	 */
	return function Q_Sandbox_run(code, context, options) {
		context = context || {};
		options = options || {};

		// Persistent runners by name
		if (!Q.Sandbox._runners) Q.Sandbox._runners = {};

		function SandboxRunner(defaults) {
			defaults = defaults || {};
			this.defaults = {
				timeout: defaults.timeout || 2000,
				sandbox: defaults.sandbox || "allow-scripts",
				style: defaults.style || "display:none;"
			};
			this.iframe = null;
		}

		SandboxRunner.prototype.createSandbox = function (opts) {
			opts = Q.extend({}, this.defaults, opts || {});
			var iframe = document.createElement("iframe");
			iframe.sandbox = opts.sandbox;
			if (opts.style) iframe.style = opts.style;

			iframe.srcdoc =
				'<!DOCTYPE html><html><body>' +
				'<script>' +
				'window.addEventListener("message",function(e){' +
				' try{' +
				'   var code=e.data.code,ctx=e.data.context;' +
				'   var sandbox=Object.create(null);' +
				'   for(var k in ctx)sandbox[k]=ctx[k];' +
				'   var fn=new Function("sandbox","\\"use strict\\";\\n"+code);' +
				'   var r=fn(sandbox);' +
				'   if(r&&typeof r.then==="function")r.then(function(v){parent.postMessage({ok:true,result:v},"*");})' +
				'     .catch(function(e){parent.postMessage({ok:false,error:String(e)},"*");});' +
				'   else parent.postMessage({ok:true,result:r},"*");' +
				' }catch(e){parent.postMessage({ok:false,error:String(e)},"*");}' +
				'});<\/script></body></html>';

			document.body.appendChild(iframe);
			this.iframe = iframe;
			return iframe;
		};

		SandboxRunner.prototype.runIn = function (iframe, code, ctx, timeoutMs) {
			ctx = ctx || {};
			var self = this;
			return new Q.Promise(function (resolve, reject) {
				var target = iframe.contentWindow;
				if (!target) return reject(new Error("iframe not ready"));
				function listener(ev) {
					if (ev.source === target) {
						window.removeEventListener("message", listener);
						clearTimeout(timer);
						return ev.data.ok ? resolve(ev.data.result) : reject(ev.data.error);
					}
				}
				window.addEventListener("message", listener);
				var timer = setTimeout(function () {
					window.removeEventListener("message", listener);
					reject(new Error("Sandbox timeout / infinite loop"));
				}, timeoutMs || self.defaults.timeout);
				target.postMessage({ code: code, context: ctx }, "*");
			});
		};

		SandboxRunner.prototype.run = function (code, ctx, opts) {
			opts = opts || {};
			var iframe = this.iframe || this.createSandbox(opts);
			var self = this;
			return this.runIn(iframe, code, ctx, opts.timeout).then(function (r) {
				if (!opts.name && iframe.parentNode) iframe.parentNode.removeChild(iframe);
				return r;
			}, function (e) {
				if (!opts.name && iframe.parentNode) iframe.parentNode.removeChild(iframe);
				throw e;
			});
		};

		// choose runner
		var runner;
		if (options.name) {
			runner = Q.Sandbox._runners[options.name];
			if (!runner) {
				runner = new SandboxRunner(options);
				Q.Sandbox._runners[options.name] = runner;
			}
		} else {
			runner = new SandboxRunner(options);
		}

		// return the result (Q.Method will resolve Promises automatically)
		return runner.run(code, context, options);
	};
});
