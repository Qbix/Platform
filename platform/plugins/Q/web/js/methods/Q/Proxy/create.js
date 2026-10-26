Q.exports(function (Q) {
	/**
	 * Creates a proxy scope object that transparently forwards calls
	 * across a MessageChannel, WebWorker, or iframe boundary.
	 *
	 * Each function in the original scope is replaced with a stub that
	 * sends { type: "rpc", id, method, args } via the port and returns
	 * a Promise that resolves when the other side responds with
	 * { type: "rpcResult", id, ok, result/error }.
	 *
	 * Because SafeScript auto-awaits every call, code written against
	 * local scope works identically with proxied scope — no code changes
	 * needed. This is the foundation of Q.Safebox.
	 *
	 * For iframes, pass the iframe's contentWindow (or window.parent from
	 * inside the iframe) as port, and set options.targetOrigin to the
	 * expected origin (e.g. "https://example.com"). Messages are filtered
	 * by event.source and event.origin for security.
	 *
	 * @method create
	 * @static
	 * @param {Object} scope The original scope object with functions
	 * @param {MessagePort|Worker|Window} port The communication channel
	 * @param {Object} [options]
	 * @param {Number} [options.timeout=5000] RPC timeout in milliseconds
	 * @param {String} [options.targetOrigin] Set for iframe communication.
	 *   The origin to pass to window.postMessage() and to verify on
	 *   incoming messages. Required when port is a Window.
	 * @return {Object} A proxy scope where each function returns a Promise
	 */
	return function Q_Proxy_create(scope, port, options) {
		options = options || {};
		var timeout = (options.timeout !== undefined) ? options.timeout : 5000;
		var targetOrigin = options.targetOrigin || null;
		var rpcId = 0;
		var pending = {};
		var proxy = {};

		// When targetOrigin is set, port is a Window (iframe/parent).
		// Windows require: send with origin, listen on self, filter by source.
		var isWindow = !!targetOrigin;
		var listenTarget = isWindow ? self : port;

		// Listen for RPC results from the other side
		function onMessage(e) {
			// For window messaging, verify source and origin
			if (isWindow) {
				if (e.source !== port) return;
				if (targetOrigin !== '*' && e.origin !== targetOrigin) return;
			}
			var msg = e.data;
			if (!msg || msg.type !== 'rpcResult') return;
			var p = pending[msg.id];
			if (!p) return;
			delete pending[msg.id];
			clearTimeout(p.timer);
			if (msg.ok) {
				p.resolve(msg.result);
			} else {
				p.reject(new Error(msg.error || 'RPC error'));
			}
		}

		if (listenTarget.addEventListener) {
			listenTarget.addEventListener('message', onMessage);
		} else {
			listenTarget.onmessage = onMessage;
		}

		// If it's a MessagePort, start it
		if (port.start) {
			port.start();
		}

		// Helper to send via the right postMessage signature
		function send(data) {
			if (isWindow) {
				port.postMessage(data, targetOrigin);
			} else {
				port.postMessage(data);
			}
		}

		// Create proxy stubs for each scope function
		Q.each(scope, function (key, val) {
			if (typeof val === 'function') {
				proxy[key] = function Q_Proxy_stub() {
					var args;
					try {
						args = JSON.parse(JSON.stringify(
							Array.prototype.slice.call(arguments)
						));
					} catch (e) {
						args = [];
					}
					var id = ++rpcId;
					return new Promise(function (resolve, reject) {
						var timer = null;
						if (timeout > 0) {
							timer = setTimeout(function () {
								delete pending[id];
								reject(new Error(
									'Q.Proxy: RPC timeout for "' + key + '" (' + timeout + 'ms)'
								));
							}, timeout);
						}
						pending[id] = { resolve: resolve, reject: reject, timer: timer };
						send({
							type: 'rpc',
							id: id,
							method: key,
							args: args
						});
					});
				};
			} else {
				// Non-function values are copied directly (serializable)
				try {
					proxy[key] = JSON.parse(JSON.stringify(val));
				} catch (e) {
					proxy[key] = val;
				}
			}
		});

		proxy.__port = port;
		proxy.__pending = pending;

		/**
		 * Destroy the proxy: reject all pending, remove listener.
		 */
		proxy.destroy = function () {
			Q.each(pending, function (id, p) {
				clearTimeout(p.timer);
				p.reject(new Error('Q.Proxy: destroyed'));
			});
			if (listenTarget.removeEventListener) {
				listenTarget.removeEventListener('message', onMessage);
			}
		};

		return proxy;
	};
});
