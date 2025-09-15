<?php

function Q_serviceWorker_response()
{
	header("Content-Type: text/javascript");

	$baseUrl_json = Q::json_encode(Q_Request::baseUrl());
	$serviceWorkerUrl_json = Q::json_encode(Q_Uri::serviceWorkerURL());
	$cookies_json = Q::json_encode($_COOKIE); // can be filtered for HttpOnly simulation

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
			caches.keys().then(function(names) {
				for (var name of names) {
					caches.delete(name);
				}
			});
		}
	}
};

(function () {
	// Local cookie store
	var cookies = $cookies_json;

	self.addEventListener('clearCache', function (event) {
		Q.Cache.clearAll();
	});

	self.addEventListener('fetch', function (event) {
		var url = new URL(event.request.url);
		var ext = url.pathname.split('.').pop().toLowerCase();

		// Skip non-same-origin or non-relevant file types
		if (url.origin !== self.location.origin || ['js', 'css'].indexOf(ext) < 0) {
			return;
		}

		if (url.toString() === Q.info.serviceWorkerUrl) {
			return event.respondWith(new Response(
				"// Can't peek at serviceWorker JS, please use Q.ServiceWorker.start()",
				{ headers: {'Content-Type': 'text/javascript'} }
			));
		}

		// Clone request and attach Cookie-JS header
		const original = event.request;
		const cookieHeader = Object.entries(cookies)
			.map(([k, v]) => k + "=" + v).join("; ");

		const newHeaders = new Headers(original.headers);
		newHeaders.set("Cookie-JS", cookieHeader);

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

		const newRequest = new Request(original.url, init);

		event.respondWith(
			caches.open("Q").then(cache => {
				return cache.match(event.request).then(cached => {
					if (cached) {
						console.log("cached: " + event.request.url);
						return cached;
					}
					// Not in cache → go to network
					return fetch(newRequest).then(response => {
						// Save a clone in the cache for future requests
						cache.put(event.request, response.clone());

						// Update local cookie store if server sends Set-Cookie-JS
						const setCookieHeader = response.headers.get("Set-Cookie-JS");
						if (setCookieHeader) {
							setCookieHeader.split(';').forEach(kv => {
								const [k, v] = kv.trim().split('=');
								if (k && v) cookies[k] = v;
							});
						}
						return response;
					});
				});
			})
		);
	});

	self.addEventListener("install", (event) => {
		self.skipWaiting();
	});
	self.addEventListener("activate", (event) => {
		event.waitUntil(clients.claim());
	});

	self.addEventListener('message', function (event) {
		var data = event.data || {};
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

	// Optional extra plugin code
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