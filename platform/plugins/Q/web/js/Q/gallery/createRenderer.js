/**
 * platform/plugins/Q/web/js/Q/gallery/createRenderer.js
 *
 * Lazy-loaded by fn/gallery.js the first time a video item is reached or
 * prewarmed. Produces a renderer that implements the same contract the inline
 * image renderer does, so the scheduler treats images and videos identically.
 *
 * Invoked by fn/gallery.js as: createRenderer.call(gallery, item, $container, index)
 *   `this` is the gallery instance (exposes _kenburnsCss / _maxVolume / _soundOn / state)
 *   `Q`    is the framework (closure constant)
 *   `_`    is _internal.js exports (warmup / enableAudio / setVolume / mute)
 *
 * Each video is an activated Q/video child tool (controls suppressed — the
 * gallery orchestrates transport). All adapters Q/video supports come for free.
 */
Q.exports(function (Q, _) {
	var seq = 0; // page-unique suffix so splices/reuse can't collide ids
	return function createRenderer(item, $container, index) {
		var gallery = this;
		var $ = Q.jQuery;

		var $videoBox = null, videoTool = null;
		var ensured = false, resolveReady, entered = false;
		var ready = new Promise(function (r) { resolveReady = r; });
		var $cap = null;
		var soundEnabled = false, blocked = false;

		function startMs() { return item.start || item.clipStart || 0; }

		function findIntrinsic() {
			// the raw <video> carries intrinsic size for kenburns; iframe has none
			return $videoBox ? $videoBox.find('video')[0] : null;
		}
		function kenburnsTarget() {
			// scale the whole player wrapper so videojs chrome scales with it
			if (!$videoBox) return null;
			return $videoBox.find('.video-js')[0] || findIntrinsic() || $videoBox.find('iframe')[0];
		}

		function createCaption() {
			var capCss = Q.extend({ position: 'absolute', visibility: 'hidden' }, item.style || {});
			$cap = $('<div class="Q_gallery_caption" />').css(capCss).html(item.caption).appendTo($container);
			if (!item.customCaptionPosition) $cap.addClass('Q_gallery_caption_centered');
		}

		var r = {
			type: 'video',
			item: item,
			index: index,
			get ready() { return ready; },
			$media: function () { return $videoBox; },

			ensure: function () {
				if (ensured) return ready;
				ensured = true;

				$videoBox = $('<div class="Q_gallery_video" />').css({
					position: 'absolute', top: 0, left: 0, width: '100%', height: '100%'
				}).appendTo($container);

				if (item.caption) createCaption();

				$videoBox.tool('Q/video', {
					url: item.src,
					controls: false,          // gallery orchestrates; suppress per-video controls
					loop: !!item.loop,
					muted: true,              // silent by default — works everywhere incl. iOS
					autoplay: false,
					playsinline: true,
					image: item.image || item.poster || null
				}, 'gallery_video_' + (++seq)).activate(function () {
					videoTool = this;
					var resolved = false;
					function res() { if (resolved) return; resolved = true; resolveReady(r); }
					try { videoTool.state.onCanPlay.set(res, 'Q/gallery'); } catch (e) {}
					try { videoTool.state.onLoad.set(res, 'Q/gallery'); } catch (e) {}
					setTimeout(res, 6000); // safety net for stubborn adapters
				});

				return ready;
			},

			prewarm: function () {
				return r.ensure().then(function () {
					return _.warmup(videoTool, startMs(), function () { return !entered; });
				});
			},

			// effective on-screen length for the scheduler: the clip's own
			// duration in ms, or 0 when unknown (live / not-yet-loaded)
			naturalDuration: function () {
				var s = startMs();
				// explicit clip window wins; Q/video pauses at clipEnd WITHOUT
				// firing onEnded, so the timer must own the advance for clips
				if (item.clipEnd != null) {
					var clip = item.clipEnd - s;
					return clip > 0 ? Math.round(clip) : 0;
				}
				if (!videoTool || !videoTool.player || !videoTool.player.duration) return 0;
				var d = 0;
				try { d = videoTool.player.duration() || 0; } catch (e) {}
				if (d <= 0) return 0;
				var remaining = Math.round(d * 1000 - s);
				return remaining > 0 ? remaining : 0;
			},
			setEndHandler: function (cb) {
				if (!videoTool) return;
				try {
					videoTool.state.onEnded.set(function () { Q.handle(cb); }, 'Q/gallery/montage');
				} catch (e) {}
			},
			clearEndHandler: function () {
				if (!videoTool) return;
				try { videoTool.state.onEnded.remove('Q/gallery/montage'); } catch (e) {}
			},

			enter: function (fromStart) {
				entered = true; // also tells a pending warmup not to reset us
				if (!videoTool) return;
				if (fromStart) {
					// reset to the clip's start so it never appears mid-clip
					// (e.g. if it went live before warmup finished)
					try {
						var p = videoTool.player, s = startMs() / 1000;
						if (p && p.currentTime) p.currentTime(s > 0 ? s : 0);
					} catch (e) {}
				}
				try { videoTool.play(); } catch (e) {}
			},
			exit: function () {
				entered = false;
				r.clearEndHandler();
				if (!videoTool) return;
				try { videoTool.pause(); } catch (e) {}
			},

			setLevel: function (level) {
				if (!$container) return;
				$container.css({ opacity: level, display: level > 0 ? 'block' : $container.css('display') });
				if ($cap && $cap.length) {
					$cap.css({ opacity: level });
					if (level > 0) $cap.css('visibility', 'visible');
				}
			},

			// crossfade VOLUME — only bites when sound is on and not blocked
			setAudioLevel: function (a) {
				if (!videoTool || !soundEnabled || blocked) return;
				_.setVolume(videoTool, Math.max(0, Math.min(1, a)) * gallery._maxVolume());
			},

			enableAudio: function () {
				if (!videoTool) return Promise.resolve(false);
				// optimistic: let the crossfade ramp volume immediately (from 0);
				// if the browser refuses audible playback, retroactively mute
				soundEnabled = true; blocked = false;
				return _.enableAudio(videoTool).then(function (ok) {
					if (!ok) { soundEnabled = false; blocked = true; }
					return ok;
				});
			},
			mute: function () {
				soundEnabled = false;
				if (videoTool) _.mute(videoTool);
			},
			isBlocked: function () { return blocked; },

			kenburns: function (z, interval) {
				interval = interval || Q.extend({}, 2, gallery.state.interval, 2, item.interval);
				if ((interval.type || "") !== 'kenburns') return;
				var intrinsic = findIntrinsic();
				var target = kenburnsTarget();
				if (!intrinsic || !target) return;       // iframe-only adapters: skip, fills box
				if (!intrinsic.videoWidth) return;        // metadata not in yet
				var geom = gallery._kenburnsCss(intrinsic, $videoBox, interval.from, interval.to, z);
				if (geom) { geom.position = 'absolute'; $(target).css(geom); }
			},

			show: function () { if ($container) $container.css({ display: 'block' }); },
			hide: function () { if ($container) $container.css({ display: 'none' }); },

			setCaption: function (html, style, centered) {
				item.caption = html;
				if (style) { item.style = style; item.customCaptionPosition = true; }
				if ($cap && $cap.length) {
					$cap.html(html);
					if (style) $cap.css(style);
					if (centered === false) $cap.removeClass('Q_gallery_caption_centered');
					else if (!style) $cap.addClass('Q_gallery_caption_centered');
				} else if ($videoBox) {
					createCaption();
				}
			},
			removeCaption: function () {
				delete item.caption; delete item.style; delete item.customCaptionPosition;
				if ($cap && $cap.length) { $cap.remove(); $cap = $([]); }
			},

			destroy: function () {
				try { if (videoTool) Q.Tool.remove(videoTool.element, true, true); } catch (e) {}
				if ($container) $container.remove();
				$videoBox = null; videoTool = null; $container = null;
			}
		};

		return r;
	};
});
