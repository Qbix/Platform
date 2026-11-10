/**
 * Q.PeerMesh — WebRTC mesh networking layer with server attestation.
 *
 * Provides transparent P2P transport for socket events. Each instance
 * manages a small neighbourhood of WebRTC data-channel peers for one
 * node URL (same granularity as Q.Socket). The seam is at
 * socket.emit / Q.Socket.onEvent, so callers such as Streams.js
 * never need to know a peer was involved.
 *
 * SERVER ATTESTATION (sidecar model):
 *   Durable messages (Streams/post) go through the server, which assigns
 *   an ordinal and signs an envelope: { publisherId, streamName, ordinal,
 *   timestamp, contentHash }. The signature travels as a sidecar field
 *   alongside the message, not inside it. PeerMesh can also relay
 *   messages P2P for low latency; receiving clients apply them
 *   optimistically and confirm when the server-attested version arrives.
 *   Clients verify server signatures using Q.Crypto.verify() (lazily
 *   loaded from Q method files).
 *
 * Ephemeral events (typing, cursors) skip attestation — they're
 * transient and a forged cursor position disappears in seconds.
 *
 * Public API:
 *
 *   var mesh = Q.PeerMesh.forNodeUrl(nodeUrl)
 *   mesh.onMessage.add(fn)           // Q.Event: (event, data, fromPeer)
 *   mesh.attach(qSocket, options)    // wire both directions
 *   mesh.broadcast(event, data)      // gossip to up to gossipFactor peers
 *   mesh.fetch(key, timeout)         // have/want handshake → Promise
 *   mesh.peerCount()                 // number of open data channels
 *
 * Signaling flows through Q.Socket events on the '/Q' namespace:
 *   Server → client  :  'Streams/PeerMesh/join'    {peers:[]}
 *   Server → client  :  'Streams/PeerMesh/offer'   {from, sdp}
 *   Server → client  :  'Streams/PeerMesh/answer'  {from, sdp}
 *   Server → client  :  'Streams/PeerMesh/ice'     {from, candidate}
 *   Server → client  :  'Streams/PeerMesh/leave'   {peerId}
 *   Client → server  :  'Streams/PeerMesh/signal'  {to, type, sdp?, candidate?}
 *
 * Load after Q.js. Depends on Q.Event, Q.each, Q.extend, Q.Socket.
 * Optional: Q.Crypto.verify (for server signature verification).
 *
 * @class Q.PeerMesh
 */
(function (Q) {

var _meshes = {}; // nodeUrl → Q.PeerMesh

/**
 * @constructor
 * @param {String} nodeUrl
 */
Q.PeerMesh = function _Q_PeerMesh(nodeUrl) {
	this.nodeUrl      = nodeUrl;
	this._peers       = {};   // peerId → {conn, channel, ewma, _pings, _probe}
	this._pending     = {};   // msgId  → true  (dedup)
	this._wantCbs     = {};   // key    → {resolve, reject, timer}
	this._intercepted = {};   // eventName → true
	this._serverKey   = null; // server's public key (set via setServerKey or from join)

	/**
	 * Fired when a data-channel message arrives from a peer.
	 * Handlers receive (eventName, data, fromPeerId).
	 * @event onMessage
	 * @type Q.Event
	 */
	this.onMessage = new Q.Event();

	/**
	 * Fired when the count of open peer connections changes.
	 * Handlers receive (count).
	 * @event onPeers
	 * @type Q.Event
	 */
	this.onPeers = new Q.Event();

	this._setupSignaling();
};

var _o = Q.PeerMesh.options = {
	iceServers: [
		{ urls: 'stun:stun.l.google.com:19302' },
		{ urls: 'stun:stun1.l.google.com:19302' }
	],
	maxPeers:      3,    // neighbourhood size
	gossipFactor:  3,    // peers to forward each broadcast to
	gossipTtl:     3,    // hop limit
	pingInterval:  5000, // ms between keep-alive RTT pings
	ewmaAlpha:     0.2,  // weight of each new RTT sample (0.8 kept, 0.2 new)
	swapThreshold: 0.9   // probe RTT must be < worst * threshold to swap in
};

// ─── singleton factory ─────────────────────────────────────────────────────

/**
 * Returns the singleton Q.PeerMesh for a given node URL,
 * creating it on first call.
 * @static
 * @method forNodeUrl
 * @param  {String} nodeUrl
 * @return {Q.PeerMesh}
 */
Q.PeerMesh.forNodeUrl = function (nodeUrl) {
	if (!_meshes[nodeUrl]) {
		_meshes[nodeUrl] = new Q.PeerMesh(nodeUrl);
	}
	return _meshes[nodeUrl];
};

// ─── server attestation ───────────────────────────────────────────────────

/**
 * Set the server's public key for verifying message envelopes.
 * Called automatically from the Streams/PeerMesh/join event if the server
 * provides its key, or can be set manually.
 * @method setServerKey
 * @param {Uint8Array|String} publicKey  Server's ES256 public key (raw or base64)
 */
Q.PeerMesh.prototype.setServerKey = function (publicKey) {
	if (typeof publicKey === 'string') {
		this._serverKey = Q.Data.fromBase64(publicKey);
	} else {
		this._serverKey = publicKey;
	}
};

/**
 * Verify a server-signed message envelope (sidecar).
 * The sidecar contains: { envelope: {...}, signature: '...' }
 * where envelope = { publisherId, streamName, ordinal, timestamp, contentHash }.
 *
 * @method verifyEnvelope
 * @param  {Object} sidecar  The attestation sidecar
 * @param  {String} ciphertext  The message content (to verify contentHash)
 * @return {Q.Promise<Boolean>}
 */
Q.PeerMesh.prototype.verifyEnvelope = function (sidecar, ciphertext) {
	var self = this;
	if (!sidecar || !sidecar.envelope || !sidecar.signature) {
		return Q.Promise.resolve(false);
	}
	if (!self._serverKey) {
		// No server key set — can't verify, treat as unattested
		return Q.Promise.resolve(false);
	}

	// Verify contentHash matches the actual ciphertext
	return Q.Data.digest('SHA-256', Q.Data.toUint8Array(ciphertext))
	.then(function (hash) {
		var actualHash = Q.Data.toHex(hash);
		if (actualHash !== sidecar.envelope.contentHash) {
			return false;
		}

		// Verify the server's signature over the envelope
		// Uses Q.Crypto.verify which lazy-loads from method files
		return Q.Crypto.verify({
			format: 'ES256',
			message: sidecar.envelope,
			types: {
				Envelope: [
					{ name: 'publisherId', type: 'string' },
					{ name: 'streamName',  type: 'string' },
					{ name: 'ordinal',     type: 'uint64' },
					{ name: 'timestamp',   type: 'uint64' },
					{ name: 'contentHash', type: 'bytes32' }
				]
			},
			primaryType: 'Envelope',
			signature: sidecar.signature,
			publicKey: self._serverKey
		});
	});
};

// ─── signaling setup ───────────────────────────────────────────────────────

Q.PeerMesh.prototype._setupSignaling = function () {
	var self = this;
	var url  = this.nodeUrl;

	// Server introduces us to the room — initiate a connection to each peer
	Q.Socket.onEvent('Streams/PeerMesh/join', '/Q', url).add(function (data) {
		// Server may provide its public key for envelope verification
		if (data.serverKey) {
			self.setServerKey(data.serverKey);
		}

		Q.each(data.peers || [], function (i, peerId) {
			if (self._peers[peerId]) return;
			if (Object.keys(self._peers).length < _o.maxPeers) {
				self._initiate(peerId);
			} else {
				self._probe(peerId);
			}
		});
	}, 'Q.PeerMesh');

	// Receive a WebRTC offer from an incoming peer
	Q.Socket.onEvent('Streams/PeerMesh/offer', '/Q', url).add(function (data) {
		self._acceptOffer(data);
	}, 'Q.PeerMesh');

	// Receive a WebRTC answer
	Q.Socket.onEvent('Streams/PeerMesh/answer', '/Q', url).add(function (data) {
		var peer = self._peers[data.from];
		if (peer && peer.conn) {
			peer.conn.setRemoteDescription({ type: 'answer', sdp: data.sdp })
				.catch(function () {});
		}
	}, 'Q.PeerMesh');

	// Receive a trickled ICE candidate
	Q.Socket.onEvent('Streams/PeerMesh/ice', '/Q', url).add(function (data) {
		var peer = self._peers[data.from];
		if (peer && peer.conn && data.candidate) {
			peer.conn.addIceCandidate(new RTCIceCandidate(data.candidate))
				.catch(function () {});
		}
	}, 'Q.PeerMesh');

	// A peer left the room
	Q.Socket.onEvent('Streams/PeerMesh/leave', '/Q', url).add(function (data) {
		self._removePeer(data.peerId);
	}, 'Q.PeerMesh');
};

// ─── connection management ─────────────────────────────────────────────────

Q.PeerMesh.prototype._newConn = function () {
	return new RTCPeerConnection({ iceServers: _o.iceServers });
};

Q.PeerMesh.prototype._initiate = function (peerId) {
	var self    = this;
	var conn    = this._newConn();
	var channel = conn.createDataChannel('q', { ordered: false, maxRetransmits: 0 });
	var peer    = { conn: conn, channel: channel, ewma: Infinity,
	                peerId: peerId, _pings: {}, _probe: false };

	this._peers[peerId] = peer;
	this._bindConn(conn, peerId);
	this._bindChannel(peer);

	conn.createOffer().then(function (offer) {
		return conn.setLocalDescription(offer);
	}).then(function () {
		self._signal({ to: peerId, type: 'offer', sdp: conn.localDescription.sdp });
	}).catch(function () {
		self._removePeer(peerId);
	});
};

Q.PeerMesh.prototype._probe = function (peerId) {
	if (this._peers[peerId]) return;
	var self    = this;
	var conn    = this._newConn();
	var channel = conn.createDataChannel('q', { ordered: false, maxRetransmits: 0 });
	var peer    = { conn: conn, channel: channel, ewma: Infinity,
	                peerId: peerId, _pings: {}, _probe: true };

	this._peers[peerId] = peer;
	this._bindConn(conn, peerId);

	channel.onopen = function () {
		self._pingOnce(peer, function (rtt) {
			self._maybeSwap(peerId, conn, channel, rtt);
		});
	};
	channel.onclose = function () { self._removePeer(peerId); };
	channel.onmessage = function () {};

	conn.createOffer().then(function (offer) {
		return conn.setLocalDescription(offer);
	}).then(function () {
		self._signal({ to: peerId, type: 'offer', sdp: conn.localDescription.sdp });
	}).catch(function () {
		self._removePeer(peerId);
	});
};

Q.PeerMesh.prototype._acceptOffer = function (data) {
	var self    = this;
	var kept    = Object.keys(this._peers).filter(function (id) {
		return !self._peers[id]._probe;
	}).length;
	var asProbe = (kept >= _o.maxPeers);

	var conn = this._newConn();
	var peer = { conn: conn, channel: null, ewma: Infinity,
	             peerId: data.from, _pings: {}, _probe: asProbe };

	this._peers[data.from] = peer;
	this._bindConn(conn, data.from);

	conn.ondatachannel = function (evt) {
		peer.channel = evt.channel;
		if (asProbe) {
			evt.channel.onopen = function () {
				self._pingOnce(peer, function (rtt) {
					self._maybeSwap(data.from, conn, evt.channel, rtt);
				});
			};
			evt.channel.onclose  = function () { self._removePeer(data.from); };
			evt.channel.onmessage = function () {};
		} else {
			self._bindChannel(peer);
		}
	};

	conn.setRemoteDescription({ type: 'offer', sdp: data.sdp }).then(function () {
		return conn.createAnswer();
	}).then(function (answer) {
		return conn.setLocalDescription(answer);
	}).then(function () {
		self._signal({ to: data.from, type: 'answer', sdp: conn.localDescription.sdp });
	}).catch(function () {
		self._removePeer(data.from);
	});
};

Q.PeerMesh.prototype._maybeSwap = function (peerId, conn, channel, rtt) {
	var self    = this;
	var kept    = Object.keys(this._peers).filter(function (id) {
		return !self._peers[id]._probe;
	});

	if (kept.length < _o.maxPeers) {
		var peer  = this._peers[peerId];
		peer.ewma   = rtt;
		peer._probe = false;
		this._bindChannel(peer);
		return;
	}

	var worst = null, worstEwma = -Infinity;
	kept.forEach(function (id) {
		var e = self._peers[id].ewma;
		if (e > worstEwma) { worstEwma = e; worst = id; }
	});

	if (rtt < worstEwma * _o.swapThreshold) {
		this._removePeer(worst);
		var peer  = this._peers[peerId];
		peer.ewma   = rtt;
		peer._probe = false;
		this._bindChannel(peer);
	} else {
		this._removePeer(peerId);
	}
};

// ─── connection and channel binding ───────────────────────────────────────

Q.PeerMesh.prototype._bindConn = function (conn, peerId) {
	var self = this;
	conn.onicecandidate = function (evt) {
		if (evt.candidate) {
			self._signal({ to: peerId, type: 'ice', candidate: evt.candidate });
		}
	};
	conn.onconnectionstatechange = function () {
		var s = conn.connectionState;
		if (s === 'failed' || s === 'disconnected' || s === 'closed') {
			self._removePeer(peerId);
		}
	};
};

Q.PeerMesh.prototype._bindChannel = function (peer) {
	var self = this;
	peer.channel.onopen = function () {
		self._startProbing(peer);
		self.onPeers.handle(self.peerCount());
	};
	peer.channel.onclose = function () {
		self._removePeer(peer.peerId);
	};
	peer.channel.onmessage = function (evt) {
		try { self._onChannelMessage(JSON.parse(evt.data), peer.peerId); } catch (e) {}
	};
};

// ─── RTT probing ───────────────────────────────────────────────────────────

Q.PeerMesh.prototype._startProbing = function (peer) {
	var self = this;
	var seq  = 0;
	peer._pingTimer = setInterval(function () {
		if (!self._peers[peer.peerId] ||
				!peer.channel || peer.channel.readyState !== 'open') {
			clearInterval(peer._pingTimer);
			return;
		}
		var s = seq++;
		peer._pings[s] = Date.now();
		try { peer.channel.send(JSON.stringify({ type: 'ping', seq: s })); } catch (e) {}
	}, _o.pingInterval);
};

Q.PeerMesh.prototype._pingOnce = function (peer, callback) {
	var key  = '__p__';
	var orig = peer.channel.onmessage;
	peer._pings[key] = Date.now();
	peer.channel.onmessage = function (evt) {
		try {
			var msg = JSON.parse(evt.data);
			if (msg.type === 'pong' && msg.seq === key) {
				var rtt = Date.now() - peer._pings[key];
				delete peer._pings[key];
				peer.channel.onmessage = orig;
				callback(rtt);
				return;
			}
		} catch (e) {}
		if (orig) orig.call(peer.channel, evt);
	};
	try { peer.channel.send(JSON.stringify({ type: 'ping', seq: key })); }
	catch (e) { callback(Infinity); }
};

Q.PeerMesh.prototype._removePeer = function (peerId) {
	var peer = this._peers[peerId];
	if (!peer) return;
	clearInterval(peer._pingTimer);
	try { if (peer.channel) peer.channel.close(); } catch (e) {}
	try { if (peer.conn)    peer.conn.close(); }    catch (e) {}
	delete this._peers[peerId];
	this.onPeers.handle(this.peerCount());
};

// ─── data-channel message dispatch ────────────────────────────────────────

Q.PeerMesh.prototype._onChannelMessage = function (msg, fromPeerId) {
	var self = this;

	if (msg.type === 'ping') {
		var peer = this._peers[fromPeerId];
		if (peer && peer.channel && peer.channel.readyState === 'open') {
			try { peer.channel.send(JSON.stringify({ type: 'pong', seq: msg.seq })); }
			catch (e) {}
		}
		return;
	}
	if (msg.type === 'pong') {
		var peer = this._peers[fromPeerId];
		if (peer && (msg.seq in peer._pings)) {
			var rtt = Date.now() - peer._pings[msg.seq];
			delete peer._pings[msg.seq];
			peer.ewma = (peer.ewma === Infinity)
				? rtt
				: (1 - _o.ewmaAlpha) * peer.ewma + _o.ewmaAlpha * rtt;
		}
		return;
	}

	if (!msg.event || !msg.id) return;
	if (this._pending[msg.id]) return;
	this._pending[msg.id] = true;
	setTimeout(function () { delete self._pending[msg.id]; }, 60000);

	// 'have' response
	if (msg.event === 'Streams/PeerMesh/have') {
		var key = msg.data && msg.data.key;
		var cb  = key && this._wantCbs[key];
		if (cb) {
			clearTimeout(cb.timer);
			delete this._wantCbs[key];
			cb.resolve(msg.data.value);
		}
		return;
	}

	// Tag P2P-delivered messages so handlers know attestation status.
	// msg._attested will be false for P2P-delivered messages.
	// Server-delivered messages (via Q.Socket.onEvent) carry the sidecar
	// and are verified separately.
	if (msg.data) {
		msg.data._fromPeer = true;
		msg.data._attested = false;
	}

	this.onMessage.handle(msg.event, msg.data, fromPeerId);

	if (msg.ttl > 1) {
		this._gossip(
			Q.extend({}, msg, { ttl: msg.ttl - 1, hops: (msg.hops || 0) + 1 }),
			fromPeerId
		);
	}
};

// ─── gossip ───────────────────────────────────────────────────────────────

Q.PeerMesh.prototype._gossip = function (msg, excludePeerId) {
	var self = this;
	var eligible = Object.keys(this._peers).filter(function (id) {
		var p = self._peers[id];
		return id !== excludePeerId &&
		       !p._probe &&
		       p.channel && p.channel.readyState === 'open';
	});
	eligible.sort(function (a, b) {
		return (self._peers[a].ewma || Infinity) - (self._peers[b].ewma || Infinity);
	});
	var json = JSON.stringify(msg);
	eligible.slice(0, _o.gossipFactor).forEach(function (id) {
		try { self._peers[id].channel.send(json); } catch (e) {}
	});
};

// ─── signaling ────────────────────────────────────────────────────────────

Q.PeerMesh.prototype._signal = function (data) {
	var qs = Q.Socket.get('/Q', this.nodeUrl);
	if (qs && qs.socket) {
		qs.socket.emit('Streams/PeerMesh/signal', data);
	}
};

// ─── public API ───────────────────────────────────────────────────────────

/**
 * Attaches this mesh to a Q.Socket in both directions:
 *  - Incoming P2P messages fire Q.Socket.onEvent locally
 *  - Outgoing socket.emit for intercepted events routes via data channels
 *    when peers are available, with server fallback.
 *
 * Options:
 *   interceptEphemeral {String[]}  Events to route via P2P only (no server).
 *                                  Default: ['Streams/ephemeral']
 *   accelerateDurable  {String[]}  Events to ALSO broadcast via P2P for
 *                                  low latency, while still going through
 *                                  the server for persistence + attestation.
 *                                  Default: ['Streams/post']
 *
 * For Streams.js:
 *   Q.PeerMesh.forNodeUrl(nodeUrl).attach(socket, {
 *       interceptEphemeral: ['Streams/ephemeral'],
 *       accelerateDurable:  ['Streams/post']
 *   })
 *
 * @method attach
 * @param  {Q.Socket} qSocket
 * @param  {Object}   [options]
 */
Q.PeerMesh.prototype.attach = function (qSocket, options) {
	var self = this;
	options = options || {};
	var ephemeralEvents = options.interceptEphemeral || ['Streams/ephemeral'];
	var durableEvents   = options.accelerateDurable  || [];

	// Incoming P2P messages → fire Q.Socket.onEvent locally
	this.onMessage.add(function (event, data) {
		Q.Socket.onEvent(event).handle(data, { fromPeer: true });
	}, 'Q.PeerMesh.attach');

	// Ephemeral: route via P2P, fall back to server
	if (ephemeralEvents.length) {
		this.interceptEmit(qSocket, ephemeralEvents);
	}

	// Durable: ALSO broadcast via P2P for speed (server still gets it)
	if (durableEvents.length) {
		this._accelerateEmit(qSocket, durableEvents);
	}
};

/**
 * Wraps qSocket.socket.emit for ephemeral events.
 * Routes via data channels when peers are connected; server fallback.
 * @method interceptEmit
 */
Q.PeerMesh.prototype.interceptEmit = function (qSocket, events) {
	var self = this;
	var sio  = qSocket.socket;

	Q.each(events, function (i, name) { self._intercepted[name] = true; });

	if (sio._qPeerMeshWrapped) return;
	sio._qPeerMeshWrapped = true;

	var origEmit = sio.emit.bind(sio);
	sio.emit = function (eventName) {
		if (self._intercepted[eventName] && self._openPeerCount() > 0) {
			var args = Array.prototype.slice.call(arguments, 1);
			self.broadcast(eventName, args[0]);
			return sio;
		}
		return origEmit.apply(sio, arguments);
	};
};

/**
 * For durable events: the original emit still goes to the server
 * (for persistence + attestation), but we ALSO broadcast via P2P
 * for low-latency delivery. Recipients apply P2P version optimistically
 * and confirm with the server-attested version when it arrives.
 * @method _accelerateEmit
 * @private
 */
Q.PeerMesh.prototype._accelerateEmit = function (qSocket, events) {
	var self = this;
	var sio  = qSocket.socket;

	// We need to hook into the emit without replacing it.
	// Use socket.io's outgoing middleware if available,
	// otherwise wrap emit to call both paths.
	if (!sio._qPeerMeshAccelerated) {
		sio._qPeerMeshAccelerated = {};
	}

	Q.each(events, function (i, name) {
		if (sio._qPeerMeshAccelerated[name]) return;
		sio._qPeerMeshAccelerated[name] = true;

		// Listen for the event being emitted and also broadcast via P2P.
		// The server path (original emit) is unchanged — it still goes
		// through. We add a parallel P2P broadcast.
		var origEmit = sio.emit;
		sio.emit = function (eventName) {
			var result = origEmit.apply(sio, arguments);
			// After sending to server, also broadcast via P2P
			if (eventName === name && self._openPeerCount() > 0) {
				var args = Array.prototype.slice.call(arguments, 1);
				var data = args[0];
				if (data) {
					// Mark as P2P-accelerated (not authoritative)
					self.broadcast(eventName, Q.extend({}, data, {
						_accelerated: true
					}));
				}
			}
			return result;
		};
	});
};

/**
 * Broadcasts an event+data to up to gossipFactor peers.
 * @method broadcast
 */
Q.PeerMesh.prototype.broadcast = function (event, data) {
	var id  = (Date.now() % 1e9).toString(36) + Math.random().toString(36).slice(2, 7);
	var msg = { type: 'data', event: event, data: data, id: id,
	            ttl: _o.gossipTtl, hops: 0 };
	this._pending[id] = true;
	var self = this;
	setTimeout(function () { delete self._pending[id]; }, 60000);
	this._gossip(msg, null);
};

/**
 * Issues a have/want request via gossip.
 * @method fetch
 * @return {Promise}
 */
Q.PeerMesh.prototype.fetch = function (key, timeout) {
	var self = this;
	return new Promise(function (resolve, reject) {
		if (self._openPeerCount() === 0) {
			return reject(new Error('Q.PeerMesh: no open peers'));
		}
		var timer = setTimeout(function () {
			delete self._wantCbs[key];
			reject(new Error('Q.PeerMesh: fetch timeout'));
		}, timeout || 5000);
		self._wantCbs[key] = { resolve: resolve, reject: reject, timer: timer };
		self.broadcast('Streams/PeerMesh/want', { key: key });
	});
};

/**
 * Returns the number of peers with an open data channel.
 * @method peerCount
 * @return {Number}
 */
Q.PeerMesh.prototype.peerCount = function () {
	return this._openPeerCount();
};

Q.PeerMesh.prototype._openPeerCount = function () {
	var n = 0;
	Q.each(this._peers, function (id, p) {
		if (!p._probe && p.channel && p.channel.readyState === 'open') n++;
	});
	return n;
};

})(Q);