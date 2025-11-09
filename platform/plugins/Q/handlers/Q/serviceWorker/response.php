<?php

function Q_serviceWorker_response()
{
	header("Content-Type: text/javascript");

	$baseUrl_json = Q::json_encode(Q_Request::baseUrl());
	$serviceWorkerUrl_json = Q::json_encode(Q_Uri::serviceWorkerURL());
	$skipServiceWorkerCaching = json_encode(Q_Config::get("Q", "javascript", 'serviceWorker', 'skipCaching', false));

	echo <<<JS
/************************************************
 * Unified Service Worker for Qbix Platform App
 ************************************************/
var Q = {
	info: {
		baseUrl: $baseUrl_json,
		serviceWorkerUrl: $serviceWorkerUrl_json
	},
	Cache: {
		clearAll: function () {
			caches.keys().then(function (names) {
				for (var i = 0; i < names.length; i++) {
					caches.delete(names[i]);
				}
			});
		}
	},
	ServiceWorker: {
		skipCaching: $skipServiceWorkerCaching
	}
};

(function () {
	// In-memory cookie store managed dynamically
	var cookies = {};

	self.addEventListener('clearCache', function () {
		Q.Cache.clearAll();
	});

	self.addEventListener('fetch', function (event) {
		var url = new URL(event.request.url);
		var parts = url.pathname.split('.');
		var ext = parts[parts.length - 1].toLowerCase();

		// Skip caching logic if configured or cross-origin
		if (Q.ServiceWorker.skipCaching) return;
		if (url.origin !== self.location.origin || ['js', 'css'].indexOf(ext) < 0) return;

		// Don't serve the SW JS itself
		if (url.toString() === Q.info.serviceWorkerUrl) {
			event.respondWith(new Response(
				"// Can't peek at serviceWorker JS, please use Q.ServiceWorker.start()",
				{ headers: { 'Content-Type': 'text/javascript' } }
			));
			return;
		}

		event.respondWith((function () {
			return (async function () {
				var original = event.request;
				var newHeaders = new Headers(original.headers);

				// Determine frame type first
				var frameType = 'unknown';
				if (event.clientId) {
					try {
						var client = await clients.get(event.clientId);
						if (client && typeof client.frameType !== 'undefined') {
							frameType = client.frameType;
						}
					} catch (e) {}
				} else {
					frameType = 'no-client';
				}
				newHeaders.set('Client-Frame-Type', frameType);

				// Attach current cookie map only for nested, unknown, or no-client frames
				var cookiePairs = [];
				for (var k in cookies) {
					if (!cookies.hasOwnProperty(k)) continue;
					var v = cookies[k];
					if (v !== null && v !== '') {
						cookiePairs.push(k + '=' + v);
					}
				}
				var cookieHeader = cookiePairs.join('; ');
				if (cookieHeader && (frameType === 'nested' || frameType === 'unknown' || frameType === 'no-client')) {
					newHeaders.set('Cookie-JS', cookieHeader);
				}

				var init = {
					method: original.method,
					headers: newHeaders,
					mode: original.mode,
					credentials: original.credentials,
					cache: original.cache,
					redirect: original.redirect,
					referrer: original.referrer,
					referrerPolicy: original.referrerPolicy,
					integrity: original.integrity,
					keepalive: original.keepalive,
					signal: original.signal
				};
				if (original.method !== 'GET' && original.method !== 'HEAD') {
					init.body = original.clone().body;
				}
				if (init.mode === 'navigate') {
					return fetch(original);
				}

				var newRequest = new Request(original.url, init);
				var cache = await caches.open('Q');

				// Serve from cache if available
				var cached = await cache.match(original);
				if (cached) {
					console.log('[SW] cache hit:', original.url);
					return cached;
				}

				var response = await fetch(newRequest);
				cache.put(original, response.clone());

				// --- Handle Set-Cookie-JS header ---
				var setCookieHeader = response.headers.get('Set-Cookie-JS');
				if (setCookieHeader) {
					var changed = false;
					var list = setCookieHeader.split(';');
					for (var i = 0; i < list.length; i++) {
						var kv = list[i].trim().split('=');
						var key = kv[0];
						var val = kv.length > 1 ? kv.slice(1).join('=') : '';
						if (key) {
							if (val === '' || val === 'null') {
								if (typeof cookies[key] !== 'undefined') {
									delete cookies[key];
									changed = true;
								}
							} else if (cookies[key] !== val) {
								cookies[key] = val;
								changed = true;
							}
						}
					}
					if (changed) {
						var clientsList = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
						for (var j = 0; j < clientsList.length; j++) {
							var clientObj = clientsList[j];
							clientObj.postMessage({
								type: 'Set-Cookie-JS',
								cookies: cookies
							});
						}
					}
				}

				return response;
			})();
		})());
	});

	// Activate immediately and claim clients
	self.addEventListener('install', function (e) { self.skipWaiting(); });
	self.addEventListener('activate', function (e) { e.waitUntil(clients.claim()); });

	// Handle messages from pages
	self.addEventListener('message', function (event) {
		var data = event.data || {};

		// Manual cache injection
		if (data.type === 'Q.Cache.put' && data.items && data.items.length) {
			caches.open('Q').then(function (cache) {
				for (var i = 0; i < data.items.length; i++) {
					var item = data.items[i];
					var opts = item.headers ? { headers: new Headers(item.headers) } : {};
					cache.put(item.url, new Response(item.content, opts));
					console.log('[SW] cache.put', item.url);
				}
			});
		}

		// Cookie synchronization from clients
		if (data.type === 'Set-Cookie-JS' && data.cookies) {
			var changed = false;
			for (var k in data.cookies) {
				if (!data.cookies.hasOwnProperty(k)) continue;
				var v = data.cookies[k];
				if (v === null || v === '') {
					if (typeof cookies[k] !== 'undefined') {
						delete cookies[k];
						changed = true;
					}
				} else if (cookies[k] !== v) {
					cookies[k] = v;
					changed = true;
				}
			}
			if (changed) {
				console.log('[SW] Cookies updated from message:', data.cookies);
			}
		}
	});
})();
JS;

	echo <<<JS

/************************************************
 * Qbix Platform plugins have added their own code
 * through Q/javascript/serviceWorker/modules
 ************************************************/
JS;

	echo PHP_EOL . PHP_EOL;
	echo Q_ServiceWorker::inlineCode();
	echo PHP_EOL . PHP_EOL;
	echo <<<JS

/************************************************
 * Plugins may add additional code here via
 * "Q/serviceWorker/response" (after)
 ************************************************/
JS;

	echo PHP_EOL . PHP_EOL;
	Q::event("Q/serviceWorker/response", array(), 'after');

	return false;
}