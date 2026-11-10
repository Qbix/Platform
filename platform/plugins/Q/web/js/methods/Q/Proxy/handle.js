Q.exports(function (Q) {
	/**
	 * Sets up an RPC handler on a port that executes calls on a scope.
	 *
	 * This is the counterpart to Q.Proxy.create(). Call Q.Proxy.handle()
	 * on the main thread with the real scope, and Q.Proxy.create() in the
	 * worker (or vice versa). Together they enable transparent proxying.
	 *
	 * Also works across iframe boundaries. For iframes, pass the iframe's
	 * contentWindow (or window.parent from inside the iframe) as port,
	 * and set options.targetOrigin. Incoming messages are filtered by
	 * event.source and event.origin for security.
	 *
	 * @method handle
	 * @static
	 * @param {Object} scope The real scope object with actual implementations
	 * @param {MessagePort|Worker|Window} port The communication channel
	 * @param {Object} [options]
	 * @param {String} [options.targetOrigin] Set for iframe communication.
	 *   The origin to pass to window.postMessage() and to verify on
	 *   incoming messages. Required when port is a Window.
	 * @return {Object} { stop: Function } — call stop() to remove the handler
	 */
	return function Q_Proxy_handle(scope, port, options) {
		options = options || {};
		var targetOrigin = options.targetOrigin || null;

		// When targetOrigin is set, port is a Window (iframe/parent).
		// Windows require: send with origin, listen on self, filter by source.
		var isWindow = !!targetOrigin;
		var listenTarget = isWindow ? self : port;

		// Helper to send via the right postMessage signature
		function send(data) {
			if (isWindow) {
				port.postMessage(data, targetOrigin);
			} else {
				port.postMessage(data);
			}
		}

		function onMessage(e) {
			// For window messaging, verify source and origin
			if (isWindow) {
				if (e.source !== port) return;
				if (targetOrigin !== '*' && e.origin !== targetOrigin) return;
			}
			var msg = e.data;
			if (!msg || msg.type !== 'rpc') return;

			var fn = scope[msg.method];
			if (typeof fn !== 'function') {
				send({
					type: 'rpcResult',
					id: msg.id,
					ok: false,
					error: 'Unknown method: ' + msg.method
				});
				return;
			}

			Promise.resolve()
			.then(function () {
				return fn.apply(null, msg.args || []);
			})
			.then(function (result) {
				var safeResult;
				try {
					safeResult = JSON.parse(JSON.stringify(
						result === undefined ? null : result
					));
				} catch (err) {
					safeResult = null;
				}
				send({
					type: 'rpcResult',
					id: msg.id,
					ok: true,
					result: safeResult
				});
			})
			.catch(function (err) {
				send({
					type: 'rpcResult',
					id: msg.id,
					ok: false,
					error: (err && err.message) ? err.message : String(err)
				});
			});
		}

		if (listenTarget.addEventListener) {
			listenTarget.addEventListener('message', onMessage);
		} else {
			listenTarget.onmessage = onMessage;
		}

		if (port.start) {
			port.start();
		}

		return {
			stop: function () {
				if (listenTarget.removeEventListener) {
					listenTarget.removeEventListener('message', onMessage);
				}
			}
		};
	};
});
