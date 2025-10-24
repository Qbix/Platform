Q.exports(function (Q) {
	/**
	 * Q plugin's front-end code
	 * @module Q
	 * @class Q.Sandbox
	 */

	/**
	 * Runs code safely inside a sandboxed Web Worker.
	 * If `options.name` is provided, a persistent worker is reused.
	 *
	 * @static
	 * @method run
	 * @param {String} code JavaScript source to execute
	 * @param {Object} [context] Variables accessible inside the sandbox
	 * @param {Object} [options] Additional sandbox configuration
	 * @param {String} [options.name] Reuse a persistent sandbox worker under this name
	 * @param {Number} [options.timeout=2000] Timeout in milliseconds before aborting execution
	 * @return {Q.Promise} Resolves with result or rejects on error
	 */
	return function Q_Sandbox_run(code, context, options) {
		context = context || {};
		options = options || {};

		// Persistent runners by name
		if (!Q.Sandbox._runners) Q.Sandbox._runners = {};

		// --- Worker-based sandbox runner ---
		function SandboxRunner(defaults) {
			this.defaults = {
				timeout: (defaults && defaults.timeout) || 2000
			};
			this.worker = null;
			this.url = null;
		}

		SandboxRunner.prototype.createWorker = function () {
			const script = `
				self.onmessage = async function(e) {
					try {
						const { code, context } = e.data;

						// Build an isolated evaluation function
						const safeEval = async (code, ctx) => {
							const keys = Object.keys(ctx || {});
							const values = Object.values(ctx || {});
							const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
							const fn = new AsyncFunction(...keys, '"use strict"; return (async () => { ' + code + ' })()');
							return fn(...values);
						};

						const result = await safeEval(code, context);
						self.postMessage({ ok: true, result });
					} catch (err) {
						self.postMessage({ ok: false, error: String(err && err.message || err) });
					}
				};
			`;

			const blob = new Blob([script], { type: "application/javascript" });
			this.url = URL.createObjectURL(blob);
			this.worker = new Worker(this.url);
			return this.worker;
		};

		SandboxRunner.prototype.run = function (code, ctx, opts) {
			const self = this;
			const worker = this.worker || this.createWorker();
			const timeoutMs = (opts && opts.timeout) || this.defaults.timeout;

			// Deep clone context to avoid prototype pollution / unserializable data
			let safeCtx;
			try {
				safeCtx = JSON.parse(JSON.stringify(ctx));
			} catch (e) {
				console.warn("[Q.Sandbox] Failed to clone context, using shallow copy");
				safeCtx = Object.assign({}, ctx);
			}

			return new Q.Promise(function (resolve, reject) {
				let timer;

				const cleanup = () => {
					clearTimeout(timer);
					if (!opts.name) {
						try {
							URL.revokeObjectURL(self.url);
							worker.terminate();
						} catch {}
					}
				};

				worker.onmessage = function (e) {
					cleanup();
					e.data.ok ? resolve(e.data.result) : reject(e.data.error);
				};

				worker.onerror = function (err) {
					cleanup();
					reject(err.message || String(err));
				};

				timer = setTimeout(function () {
					cleanup();
					reject(new Error("Worker timeout / infinite loop"));
				}, timeoutMs);

				worker.postMessage({ code, context: safeCtx });
			});
		};

		// --- Choose or create a runner ---
		let runner;
		if (options.name) {
			runner = Q.Sandbox._runners[options.name];
			if (!runner) {
				runner = new SandboxRunner(options);
				Q.Sandbox._runners[options.name] = runner;
			}
		} else {
			runner = new SandboxRunner(options);
		}

		// Q.Method will resolve the returned promise automatically
		return runner.run(code, context, options);
	};
});