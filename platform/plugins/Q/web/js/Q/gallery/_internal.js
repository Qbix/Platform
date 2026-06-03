/**
 * platform/plugins/Q/web/js/Q/gallery/_internal.js
 *
 * Shared helpers for the Q/gallery video pipeline. Loaded AT MOST ONCE per
 * page (via the `require: "_internal"` option on Q.Method.define in
 * fn/gallery.js), then handed to createRenderer.js as its second argument `_`.
 *
 * Everything here operates on a Q/video tool instance, going through the
 * tool's player interface so the same code works across the videojs-backed
 * adapters (mp4/webm/ogg/youtube/vimeo). Notes on the custom-iframe adapters:
 *   - muse: player.volume() is 0..100, not 0..1 — handled below.
 *   - twitch: the tool wires muted()/currentTime() but no volume(); volume
 *     ramps are silently skipped (mute/unmute still work).
 *   - odysee: live; warmup/seek are best-effort.
 */
Q.exports(function () {

	function playerOf(videoTool) {
		return videoTool && videoTool.player;
	}

	// muse exposes 0..100; everything else videojs-style 0..1
	function isMuse(videoTool) {
		try {
			var url = videoTool && videoTool.state && videoTool.state.url;
			return !!(url && /muse\.ai/i.test(url));
		} catch (e) { return false; }
	}

	function setVolume(videoTool, v) {
		var p = playerOf(videoTool);
		if (!p || !p.volume) return;
		v = Math.max(0, Math.min(1, v));
		try { p.volume(isMuse(videoTool) ? Math.round(v * 100) : v); } catch (e) {}
	}

	function mute(videoTool) {
		var p = playerOf(videoTool);
		if (!p) return;
		try { p.muted && p.muted(true); } catch (e) {}
		setVolume(videoTool, 0);
	}

	function seek(videoTool, ms) {
		var p = playerOf(videoTool);
		if (!p || !p.currentTime) return;
		try { p.currentTime(ms > 0 ? ms / 1000 : 0); } catch (e) {}
	}

	return {
		setVolume: setVolume,
		mute: mute,

		/**
		 * Prepare a video off-screen: keep it muted and parked at its start.
		 * The <video> carries preload="auto" and Q/video already seeks to the
		 * start position on load, so we deliberately do NOT play here — playing
		 * a hidden clip to "buffer" it decodes frames and spins the CPU for no
		 * visible benefit. The browser's preload is enough; any remaining
		 * buffering happens on the (near-instant) first real play.
		 * @return {Promise} resolves once muted and seeked
		 */
		warmup: function (videoTool, startMs, canPark) {
			return new Promise(function (resolve) {
				var p = playerOf(videoTool);
				if (!p) { resolve(); return; }
				try { p.muted && p.muted(true); } catch (e) {}
				setVolume(videoTool, 0);
				// only reset position if the clip hasn't already gone live
				if (typeof canPark !== 'function' || canPark()) {
					seek(videoTool, startMs || 0);
				}
				resolve();
			});
		},

		/**
		 * Attempt audible playback. MUST be reachable from a user gesture the
		 * first time on locked platforms. Starts at volume 0 (so the caller's
		 * crossfade ramps it up cleanly) and reports whether the browser
		 * actually allowed sound by inspecting the play() promise.
		 * @return {Promise<Boolean>} true if audible playback was permitted
		 */
		enableAudio: function (videoTool) {
			return new Promise(function (resolve) {
				var p = playerOf(videoTool);
				if (!p) { resolve(false); return; }
				try { p.muted && p.muted(false); } catch (e) { resolve(false); return; }
				setVolume(videoTool, 0);

				var pr;
				try { pr = p.play && p.play(); } catch (e) { pr = null; }

				if (pr && typeof pr.then === 'function') {
					pr.then(function () { resolve(true); })
					  .catch(function () { try { p.muted(true); } catch (e) {} resolve(false); });
				} else {
					// iframe proxies often don't return a promise; can't detect.
					// On desktop this is fine; on a locked platform the user
					// simply taps the unmute button again.
					resolve(true);
				}
			});
		}
	};
});
