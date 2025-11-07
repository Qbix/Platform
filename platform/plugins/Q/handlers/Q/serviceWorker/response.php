<?php

function Q_serviceWorker_response()
{
	header("Content-Type: text/javascript");

	$baseUrl_json = Q::json_encode(Q_Request::baseUrl());
	$serviceWorkerUrl_json = Q::json_encode(Q_Uri::serviceWorkerURL());
	$skipServiceWorkerCaching = json_encode(Q_Config::get("Q", "javascript", 'serviceWorker', 'skipCaching', false));
	$cookies_json = Q::json_encode($_COOKIE); // can be filtered for HttpOnly simulation

	echo <<<JS
/************************************************
 * Unified Service Worker for Qbix Platform App
 ************************************************/
var Q = {
	info: {
		baseUrl: $baseUrl_json,
		serviceWorkerUrl: $serviceWorkerUrl_json,
	},
	Cache: {
		clearAll: function () {
			caches.keys().then(function(names) {
				for (var name of names) {
					caches.delete(name);
				}
			});
		}
	},
	ServiceWorker: {
		skipCaching: $skipServiceWorkerCaching
	}
};

(function () {
	// Local cookie store
	var cookies = $cookies_json;

	self.addEventListener('clearCache', function (event) {
		Q.Cache.clearAll();
	});

	self.addEventListener('fetch', function (event) {
		const url = new URL(event.request.url);
		const ext = url.pathname.split('.').pop().toLowerCase();

		if (Q.info.skipServiceWorkerCaching) return;
		if (url.origin !== self.location.origin || ['js', 'css'].indexOf(ext) < 0) return;

		if (url.toString() === Q.info.serviceWorkerUrl) {
			return event.respondWith(new Response(
				"// Can't peek at serviceWorker JS, please use Q.ServiceWorker.start()",
				{ headers: {'Content-Type': 'text/javascript'} }
			));
		}

		event.respondWith((async () => {
			// --- Build new request with headers ---
			const original = event.request;
			const newHeaders = new Headers(original.headers);

			// Attach simulated cookies
			const cookieHeader = Object.entries(cookies)
				.map(([k, v]) => k + "=" + v).join("; ");
			newHeaders.set("Cookie-JS", cookieHeader);

			// Determine frame type safely before fetch
			let frameType = "unknown";
			if (event.clientId) {
				try {
					const client = await clients.get(event.clientId);
					if (client && typeof client.frameType !== 'undefined') {
						frameType = client.frameType;
					}
				} catch (e) {}
			} else {
				frameType = "no-client";
			}
			newHeaders.set("Client-Frame-Type", frameType);

			const init = {
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
				return fetch(event.request);
			}

			const newRequest = new Request(original.url, init);
			const cache = await caches.open("Q");

			// Serve from cache if available
			const cached = await cache.match(event.request);
			if (cached) {
				console.log("cached: " + event.request.url);
				return cached;
			}

			// Otherwise fetch from network
			const response = await fetch(newRequest);
			cache.put(event.request, response.clone());

			// --- Handle Set-Cookie-JS intelligently ---
			const setCookieHeader = response.headers.get("Set-Cookie-JS");
			if (setCookieHeader) {
				let changed = false;
				setCookieHeader.split(';').forEach(kv => {
					const [k, v] = kv.trim().split('=');
					if (k && v && cookies[k] !== v) {
						cookies[k] = v;
						changed = true;
					}
				});
				if (changed) {
					const clientsList = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
					let hasNested = false;
					let frameTypeSupported = false;
					for (const client of clientsList) {
						if (typeof client.frameType !== 'undefined') {
							frameTypeSupported = true;
							if (client.frameType === 'nested') {
								hasNested = true;
								break;
							}
						}
					}
					if (hasNested || !frameTypeSupported) {
						for (const client of clientsList) {
							client.postMessage({
								type: "Set-Cookie-JS",
								cookies
							});
						}
					} else {
						console.log("[SW] Skipped Set-Cookie-JS broadcast — all top-level clients.");
					}
				}
			}

			return response;
		})());
	});

	self.addEventListener("install", event => self.skipWaiting());
	self.addEventListener("activate", event => event.waitUntil(clients.claim()));

	self.addEventListener('message', function (event) {
		const data = event.data || {};
		if (data.type === 'Q.Cache.put') {
			caches.open('Q').then(function (cache) {
				data.items.forEach(function (item) {
					const options = {};
					if (item.headers) {
						options.headers = new Headers(item.headers);
					}
					cache.put(item.url, new Response(item.content, options));
					console.log("cache.put " + item.url);
				});
			});
		}
		if (data.type === 'Set-Cookie-JS') {
			if (data.key && data.value) {
				cookies[data.key] = data.value;
			}
		}
	});
})();
JS;

	echo <<<JS

/************************************************
 * Qbix Platform plugins have added their own code
 * to this service worker through the config named
 * Q/javascript/serviceWorker/modules
 ************************************************/

JS;

	echo PHP_EOL . PHP_EOL;
	echo Q_ServiceWorker::inlineCode();
	echo PHP_EOL . PHP_EOL;
	echo <<<JS

/************************************************
 * Below, Qbix Platform plugins have a chance to 
 * add their own code to this service worker by
 * adding hooks after  "Q/serviceWorker/response"
 ************************************************/

JS;

	echo PHP_EOL . PHP_EOL;
	Q::event("Q/serviceWorker/response", array(), 'after');

	return false;
}