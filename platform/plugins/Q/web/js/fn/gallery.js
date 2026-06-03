(function (Q, $, window, document, undefined) {

/**
 * Drop-in replacement for Q/web/js/fn/gallery.js
 * INSTALL: copy over platform/plugins/Q/web/js/fn/gallery.js
 *
 * Companion lazy-loaded files (REQUIRED for video items, never loaded for
 * image-only galleries):
 *   platform/plugins/Q/web/js/Q/gallery/_internal.js
 *   platform/plugins/Q/web/js/Q/gallery/createRenderer.js
 *
 * WHAT CHANGED VS THE ORIGINAL
 * ----------------------------
 * 1. Images and videos now share ONE ordered timeline (state.items) with a
 *    single cursor, one preload window, one crossfade, one kenburns path.
 *    The old `images`/`videos` options still work: if `items` is absent it is
 *    synthesised as image-items-then-video-items, preserving prior behavior
 *    byte-for-byte for image-only galleries (default interval.type "" = no
 *    kenburns, crossfade transition, preload one ahead, loop, autoplay).
 *
 * 2. Each timeline entry is driven through a small renderer contract:
 *      ensure()        create DOM + start loading; returns a `ready` promise
 *      ready           resolves when the item is displayable
 *      prewarm()       buffer ahead (video: muted warmup; image: ensure)
 *      enter()/exit()  start / pause playback (no-op for images)
 *      setLevel(0..1)  crossfade OPACITY
 *      setAudioLevel(0..1) crossfade VOLUME (video only, when sound is on)
 *      kenburns(z)     apply the ken-burns transform at param z
 *      show()/hide()/destroy()
 *    Image renderers live here (cheap, always loaded). Video renderers are
 *    produced by Q.Gallery.video.createRenderer, loaded on demand via
 *    Q.Method.define the first time a video item is reached or prewarmed.
 *
 * 3. Audio: videos start muted (works on every browser incl. iOS). A gallery
 *    audio button toggles desired sound. Enabling sound happens inside the tap
 *    (a user gesture) so it can unlock; we detect whether audible playback was
 *    actually allowed by inspecting the play() promise, and if it was refused
 *    we keep the video muted and leave the button in a "tap to unmute" state.
 *    When sound is on and not blocked, transitions crossfade volume between the
 *    outgoing and incoming video, clamped so the two sum to maxVolume.
 *
 * 4. New option `player: true` renders a gallery-level play/pause button that
 *    orchestrates the whole timeline; per-video controls stay suppressed.
 *
 * New options (all optional, sensible defaults):
 *   items:        unified ordered list; each { type:'image'|'video', ... }
 *   player:       false  show a gallery-level play/pause button
 *   sound:        false  start with sound desired (still gesture-gated)
 *   maxVolume:    1      ceiling for the audio crossfade (0..1)
 *   preloadAhead: 1      how many upcoming items to warm
 *
 * The runtime-mutation API (addImage/removeImage/setCaption/removeCaption/
 * setTransition/setInterval) is preserved and now operates on the unified
 * timeline; addVideo/addItem are added for symmetry.
 */

// ── lazy video-renderer factory, defined once ──────────────────────────────
Q.Gallery = Q.Gallery || {};
if (!Q.Gallery.video) {
	Q.Gallery.video = { createRenderer: new Q.Method() };
	Q.Method.define(
		Q.Gallery.video,
		"{{Q}}/js/Q/gallery",
		function () { return [Q]; },
		{ require: "_internal" }
	);
}

// ── ken-burns geometry, shared by image (here) and video (createRenderer) ──
function kenburnsGeometry(iw, ih, $w, $h, from, to, z) {
	iw = iw || 1; ih = ih || 1;
	var widthFactor  = from.width  + z*(to.width  - from.width);
	var heightFactor = from.height + z*(to.height - from.height);
	var leftFactor   = from.left   + z*(to.left   - from.left);
	var topFactor    = from.top    + z*(to.top    - from.top);
	var w = iw * widthFactor, h = ih * heightFactor;
	var l = iw * leftFactor,  t = ih * topFactor;
	var r = w/h, $r = $w/$h;
	if ($r < r) {
		var smallerW = h * $r;
		l += (w - smallerW) / 2;
		widthFactor = smallerW / iw;
		leftFactor  = l / iw;
	} else {
		var smallerH = w / $r;
		t += (h - smallerH) / 2;
		heightFactor = smallerH / ih;
		topFactor    = t / ih;
	}
	var width  = $w / widthFactor, height = $h / heightFactor;
	var left   = -leftFactor * width, top = -topFactor * height;
	return { left: left+'px', top: top+'px', width: width+'px', height: height+'px' };
}

// minimal, overridable chrome styling (injected once)
function injectChromeCss() {
	if (document.getElementById('Q_gallery_chrome_css')) return;
	var s = document.createElement('style');
	s.id = 'Q_gallery_chrome_css';
	s.textContent =
		'.Q_gallery_chrome{position:absolute;left:0;bottom:0;z-index:10;display:flex;' +
		'gap:8px;padding:10px;pointer-events:none}' +
		'.Q_gallery_btn{pointer-events:auto;width:40px;height:40px;border-radius:999px;' +
		'display:flex;align-items:center;justify-content:center;cursor:pointer;' +
		'font:600 16px/1 system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.55);' +
		'user-select:none;-webkit-user-select:none}' +
		'.Q_gallery_btn:hover{background:rgba(0,0,0,.75)}' +
		'.Q_gallery_audio[data-state="blocked"]{background:rgba(192,52,40,.85)}';
	document.head.appendChild(s);
}

Q.Tool.jQuery('Q/gallery', function _Q_gallery(state) {
	state = state || {};
	Q.addStylesheet("{{Q}}/css/tools/gallery.css");

	var $this = this, gallery;

	// teardown a previous instance on the same element
	if (gallery = $this.data('gallery')) {
		if (gallery.destroy) gallery.destroy(); else gallery.pause();
		$this.empty();
		if (state === null) return false;
	}

	// ── build the unified timeline ────────────────────────────────────────
	if (!state.items) {
		state.items = [];
		Q.each(state.images || [], function (i, img) {
			state.items.push(Q.extend({ type: 'image' }, img));
		});
		Q.each(state.videos || [], function (i, vid) {
			state.items.push(Q.extend({ type: 'video' }, vid));
		});
	} else {
		Q.each(state.items, function (i, it) {
			if (!it.type) {
				it.type = (it.src && /\.(mp4|webm|ogg)(\?|#|$)/i.test(it.src)
					|| /youtu\.?be|vimeo|twitch|odysee|muse\.ai/i.test(it.src || ''))
					? 'video' : 'image';
			}
		});
	}
	var items = state.items;

	// scheduler state
	var current = -1, previous = -1;
	var R = [];   // resolved renderers, parallel to items
	var RP = [];  // in-flight ensure promises, parallel to items
	var tm = null, scheduledAt = 0, scheduledDelay = 0, remainingDelay = null;
	var pendingGoNext = null, resumePending = null;
	var animTransition, animInterval, animPreviousInterval;
	var paused = false, playing = false, everStarted = false, keepGoingFlag = false;
	var soundOn = !!state.sound;
	var maxVolume = (typeof state.maxVolume === 'number') ? state.maxVolume : 1;
	var preloadAhead = (state.preloadAhead == null) ? 1 : state.preloadAhead;

	// chrome
	var $chrome = null, $playBtn = null, $audioBtn = null;

	var css = { overflow: 'hidden' };
	if ($this.css('position') === 'static') css.position = 'relative';
	if (!parseInt($this.css('height'))) $this.css('height', '100%');
	$this.css(css);

	function deepMerge(base, override) {
		return Q.extend({}, 2, base, 2, override || {});
	}
	function mediaList() {
		// best-effort back-compat array of media jQuery elements for events
		var out = [];
		for (var i = 0; i < R.length; i++) {
			if (R[i] && R[i].$media) out[i] = R[i].$media();
		}
		return out;
	}
	function reindex() {
		for (var i = 0; i < R.length; i++) {
			if (R[i]) R[i].index = i;
		}
	}

	// ── image renderer (inline; cheap; always available) ──────────────────
	function makeImageRenderer(item, index) {
		var $img = null, $cap = null;
		var ensured = false, resolveReady;
		var ready = new Promise(function (r) { resolveReady = r; });

		function createCaption(html, style, customPos, name) {
			var capCss = Q.extend({ visibility: 'hidden' }, style || {});
			$cap = $('<div class="Q_gallery_caption" />').css(capCss).html(html).appendTo($this);
			if (!customPos) $cap.addClass('Q_gallery_caption_centered');
			if (name) $cap.addClass('Q_gallery_caption_' + name);
		}

		var r = {
			type: 'image',
			item: item,
			index: index,
			get ready() { return ready; },
			$media: function () { return $img; },
			$caption: function () { return $cap; },
			ensure: function () {
				if (ensured) return ready;
				ensured = true;
				var image = item;
				if (!image.src) image.src = Q.url('{{Q}}/img/throbbers/transparent.gif');
				var name = image.name ? Q.normalize(image.name) : '';
				$img = $('<img />').attr({
					alt: image.caption || ('image ' + index),
					src: Q.url(image.src)
				}).css({
					visibility: 'hidden', position: 'absolute', top: '0px', left: '0px'
				}).appendTo($this);

				function finalize() {
					Q.handle(state.onLoad, $this, [$img, mediaList(), state]);
					$img.on(Q.Pointer.click, function () {
						Q.handle(state.onInvoke, $this, [$img, r.index, mediaList()]);
					});
					resolveReady(r);
				}
				$img.on('load error', function () { $img.off('load error'); finalize(); });
				if ($img[0].complete) finalize();

				if (image.caption) {
					createCaption(image.caption, image.style, image.customCaptionPosition, name);
				} else {
					$cap = $([]);
				}
				if (name) $img.addClass('Q_gallery_image_' + name);
				return ready;
			},
			prewarm: function () { return r.ensure(); },
			enter: function () {},
			exit: function () {},
			setLevel: function (level) {
				if (!$img) return;
				var $els = $img.add($cap && $cap.length ? $cap : $([]));
				if (level > 0) $els.css({ display: 'block', visibility: 'visible', opacity: level });
				else $els.css({ opacity: 0 });
			},
			setAudioLevel: null, // images carry no audio
			kenburns: function (z, interval) {
				if (!$img || !$img[0]) return;
				interval = interval || deepMerge(state.interval, item.interval);
				if ((interval.type || "") !== 'kenburns') return; // "" type: no transform
				var geom = kenburnsGeometry(
					$img[0].naturalWidth, $img[0].naturalHeight,
					$this.width(), $this.height(),
					interval.from, interval.to, z
				);
				geom.visibility = 'visible';
				$img.css(geom);
				if ($cap && $cap.length) $cap.css('visibility', 'visible');
			},
			show: function () { if ($img) $img.add($cap && $cap.length ? $cap : $([])).css({ display: 'block', visibility: 'visible' }); },
			hide: function () { if ($img) $img.add($cap && $cap.length ? $cap : $([])).css({ display: 'none' }); },
			setCaption: function (html, style, centered) {
				item.caption = html;
				if (style) { item.style = style; item.customCaptionPosition = true; }
				if ($cap && $cap.length) {
					$cap.html(html);
					if (style) $cap.css(style);
					if (centered === false) $cap.removeClass('Q_gallery_caption_centered');
					else if (!style) $cap.addClass('Q_gallery_caption_centered');
				} else if ($img) {
					createCaption(html, style, style ? true : false,
						item.name ? Q.normalize(item.name) : '');
					$cap.css('visibility', r.index === current ? 'visible' : 'hidden');
				}
			},
			removeCaption: function () {
				delete item.caption; delete item.style; delete item.customCaptionPosition;
				if ($cap && $cap.length) { $cap.remove(); $cap = $([]); }
			},
			destroy: function () {
				if ($img) $img.remove();
				if ($cap && $cap.length) $cap.remove();
				$img = $cap = null;
			}
		};
		return r;
	}

	// Degenerate renderer used when a video's companion files fail to load, so
	// the timeline keeps moving instead of hanging on the broken item. Typed
	// 'image' so the scheduler gives it the default interval timer and advances.
	function fallbackRenderer($container) {
		var resolved = Promise.resolve();
		return {
			type: 'image', index: -1, item: {},
			get ready() { return resolved; },
			$media: function () { return $container; },
			ensure: function () { return resolved; },
			prewarm: function () { return resolved; },
			enter: function () {}, exit: function () {},
			setLevel: function () {}, setAudioLevel: null,
			enableAudio: function () { return Promise.resolve(false); },
			mute: function () {}, isBlocked: function () { return false; },
			kenburns: function () {}, show: function () {}, hide: function () {},
			setCaption: function () {}, removeCaption: function () {},
			destroy: function () {
				if (!$container) return;
				try { if (Q.Tool.clear) Q.Tool.clear($container[0]); } catch (e) {}
				$container.remove();
			}
		};
	}

	// ── renderer resolution (lazy for video) ──────────────────────────────
	function getRenderer(index) {
		if (RP[index]) return RP[index];
		var item = items[index] || {};
		if (item.type === 'video') {
			var $container = $('<div class="Q_gallery_item" />').css({
				position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
				display: 'none', overflow: 'hidden'
			}).appendTo($this);
			var p = Promise.resolve(
				Q.Gallery.video.createRenderer.call(gallery, item, $container, index)
			).then(function (renderer) {
				// resolve into whatever slot this promise occupies NOW (splices
				// may have shifted it since creation)
				var i = RP.indexOf(p); if (i < 0) i = index;
				R[i] = renderer; renderer.index = i;
				return renderer;
			}, function (err) {
				if (Q.log) Q.log("Q/gallery: video renderer failed to load", err);
				var fb = fallbackRenderer($container);
				var i = RP.indexOf(p); if (i < 0) i = index;
				R[i] = fb; fb.index = i;
				return fb;
			});
			RP[index] = p;
		} else {
			var ir = makeImageRenderer(item, index);
			ir.index = index;
			R[index] = ir;
			RP[index] = Promise.resolve(ir);
		}
		return RP[index];
	}

	function prewarm(fromIndex) {
		var keep = {};
		keep[current] = true;
		if (previous >= 0) keep[previous] = true;
		for (var d = 1; d <= preloadAhead; d++) {
			var idx = fromIndex + d;
			if (idx >= items.length) {
				if (!state.loop) break;
				idx = idx % items.length;
			}
			keep[idx] = true;
			(function (i) {
				getRenderer(i).then(function (r) { r.prewarm(); });
			})(idx);
		}
		// recycle video renderers outside the keep-set (wrapped indices stay)
		for (var j = 0; j < R.length; j++) {
			if (!R[j] || R[j].type !== 'video') continue;
			if (!keep[j]) { R[j].destroy(); R[j] = null; RP[j] = null; }
		}
	}

	function hideOthers(keepIndex) {
		for (var i = 0; i < R.length; i++) {
			if (i === keepIndex || !R[i]) continue;
			R[i].hide();
			R[i].exit();
		}
	}

	function scheduleNext(delay) {
		clearTimeout(tm);
		var go = pendingGoNext;
		scheduledAt = Q.milliseconds ? Q.milliseconds() : Date.now();
		scheduledDelay = Math.max(0, delay);
		remainingDelay = null;
		tm = setTimeout(function () { if (go) go(); }, scheduledDelay);
	}

	// ── the unified advance ───────────────────────────────────────────────
	function advance(keepGoing) {
		if (paused) return;
		clearTimeout(tm); tm = null;   // supersede any pending cycle timer
		resumePending = null;          // a fresh advance invalidates a deferred one
		previous = current;
		++current;
		if (current >= items.length) {
			if (!state.loop) { current = previous; playing = false; updateChrome(); return; }
			current = 0;
		}
		var idx = current, prevIdx = previous;
		getRenderer(idx).then(function (r) {
			return Promise.resolve(r.ensure()).then(function () { return r.ready; }).then(function () { return r; });
		}).then(function (curR) {
			if (current !== idx) return;   // superseded by a later advance
			if (paused) {                  // paused mid-load: defer to resume()
				resumePending = function () { beginTransition(prevIdx, idx, curR, keepGoing); };
				return;
			}
			beginTransition(prevIdx, idx, curR, keepGoing);
		}).catch(function (e) {
			if (Q.log) Q.log("Q/gallery: advance failed", e);
		});
	}

	function beginTransition(prevIdx, idx, curR, keepGoing) {
		var item = items[idx];
		var t = deepMerge(state.transition, item.transition);
		var prevR = (prevIdx >= 0) ? R[prevIdx] : null;

		Q.handle(state.onTransition, $this, [idx, mediaList(), state]);

		curR.show();
		curR.enter(true); // fresh entry: start the clip at its beginning
		if (curR.type === 'video') applyAudio(curR, idx);

		function ramp(x, y) {
			curR.setLevel(y);
			if (prevR) prevR.setLevel(1 - y);
			if (soundOn) {
				if (curR.setAudioLevel) curR.setAudioLevel(y);
				if (prevR && prevR.setAudioLevel) prevR.setAudioLevel(1 - y);
			}
			if (y === 1) {
				hideOthers(idx);
				animPreviousInterval && animPreviousInterval.pause();
			}
		}

		if (!state.transitionToFirst && prevIdx === -1) {
			curR.setLevel(1);
			beginInterval(idx, prevIdx, curR, t, keepGoing);
			return;
		}
		animTransition = Q.Animation.play(ramp, t.duration, t.ease);
		beginInterval(idx, prevIdx, curR, t, keepGoing);
	}

	function beginInterval(idx, prevIdx, curR, t, keepGoing) {
		var item = items[idx];
		var interval = deepMerge(state.interval, item.interval);

		prewarm(idx);

		keepGoingFlag = !!keepGoing;

		// On-screen length, computed BEFORE the animation so a ken-burns pan can
		// span the whole time (not just the default 2s):
		//   explicit per-item interval.duration wins;
		//   else a video plays for its natural length (when known);
		//   else the gallery default interval.duration.
		var isVideo = (curR.type === 'video');
		var explicit = !!(item.interval && item.interval.duration != null);
		var useTimer = true;
		var displayMs = interval.duration;
		if (!explicit && isVideo) {
			var nd = curR.naturalDuration ? curR.naturalDuration() : 0;
			if (nd > 0) { displayMs = nd; }
			else { useTimer = false; } // unknown / live: wait for the clip to end
		}

		// Only run a per-frame animation when there is actually a ken-burns pan
		// to render. A plain crossfade gallery does ZERO per-frame work between
		// transitions — the difference between idle and a spinning fan.
		animPreviousInterval = animInterval;
		if ((interval.type || "") === 'kenburns') {
			animInterval = Q.Animation.play(function (x, y) {
				curR.kenburns(y, interval); // pass merged interval; no per-frame alloc
			}, displayMs, interval.ease);
		} else {
			animInterval = null;
		}

		// Exactly one advance per cycle, whether the timer fires or the clip ends.
		var advanced = false;
		function goNext() {
			if (advanced || paused) return;
			advanced = true;
			if (curR.clearEndHandler) curR.clearEndHandler();
			advance(keepGoing);
		}
		pendingGoNext = goNext;

		if (keepGoing && items.length > 1 && curR.setEndHandler) {
			curR.setEndHandler(goNext); // natural end, and the no-timer case
		}
		if (keepGoing && items.length > 1) {
			if (useTimer) {
				// cap the transition overlap so a clip shorter than the
				// transition still gets at least half its length on screen
				var overlap = Math.min(t.duration, displayMs / 2);
				scheduleNext(displayMs - overlap);
			} else if (state.videoFallbackMs > 0) {
				// safety net for adapters that report no duration AND never fire
				// onEnded; leave at 0 (default) to let true live streams run
				scheduleNext(state.videoFallbackMs);
			}
		}
	}

	// ── audio orchestration ───────────────────────────────────────────────
	function applyAudio(videoRenderer, idx) {
		if (!soundOn) { videoRenderer.mute && videoRenderer.mute(); return; }
		if (!videoRenderer.enableAudio) return;
		videoRenderer.enableAudio().then(function (ok) {
			if (idx === current) updateChrome(); // reflect blocked state if refused
		});
	}

	function currentVideoRenderer() {
		var r = R[current];
		return (r && r.type === 'video') ? r : null;
	}

	// ── transport / chrome ────────────────────────────────────────────────
	function togglePlay() {
		if (playing && !paused) { gallery.pause(); }
		else if (everStarted) { gallery.resume(); }
		else { gallery.play(); }
		updateChrome();
	}

	function toggleSound() {
		// this handler runs inside a user gesture, so it can unlock audio
		soundOn = !soundOn;
		var r = currentVideoRenderer();
		if (soundOn) {
			if (r && r.enableAudio) r.enableAudio().then(function () { updateChrome(); });
		} else if (r && r.mute) {
			r.mute();
		}
		updateChrome();
	}

	function renderChrome() {
		var hasVideo = false;
		for (var i = 0; i < items.length; i++) if (items[i].type === 'video') { hasVideo = true; break; }
		if (!state.player && !hasVideo) return;
		injectChromeCss();
		$chrome = $('<div class="Q_gallery_chrome" />').appendTo($this);
		if (state.player) {
			$playBtn = $('<div class="Q_gallery_btn Q_gallery_playpause" role="button" tabindex="0" />')
				.appendTo($chrome)
				.on(Q.Pointer.fastclick, function () { togglePlay(); });
		}
		if (hasVideo) {
			$audioBtn = $('<div class="Q_gallery_btn Q_gallery_audio" role="button" tabindex="0" />')
				.appendTo($chrome)
				.on(Q.Pointer.fastclick, function () { toggleSound(); });
		}
		updateChrome();
	}

	function updateChrome() {
		if ($playBtn) $playBtn.text((playing && !paused) ? '❚❚' : '►');
		if ($audioBtn) {
			var r = currentVideoRenderer();
			var blocked = soundOn && r && r.isBlocked && r.isBlocked();
			$audioBtn.attr('data-state', blocked ? 'blocked' : (soundOn ? 'on' : 'off'));
			$audioBtn.text(blocked ? '🔇' : (soundOn ? '🔊' : '🔈'));
			$audioBtn.attr('title', blocked ? 'Tap to unmute' : (soundOn ? 'Mute' : 'Unmute'));
		}
	}

	// ── public gallery object ─────────────────────────────────────────────
	gallery = {
		options: state,
		onLoad: state.onLoad,
		get currentIndex() { return current; },

		play: function () {
			paused = false; playing = true; everStarted = true;
			advance(true);
			updateChrome();
		},
		pause: function () {
			paused = true;
			animTransition && animTransition.pause();
			animInterval && animInterval.pause();
			if (tm) {
				var now = Q.milliseconds ? Q.milliseconds() : Date.now();
				remainingDelay = Math.max(0, scheduledDelay - (now - scheduledAt));
				clearTimeout(tm); tm = null;
			}
			var r = R[current]; if (r) r.exit();
			updateChrome();
		},
		resume: function () {
			if (!paused) return;
			paused = false; playing = true;
			// paused during the first load: run the deferred first frame
			if (resumePending) {
				var f = resumePending; resumePending = null;
				f(); updateChrome();
				return;
			}
			animTransition && animTransition.play();
			animInterval && animInterval.play();
			var cr = R[current];
			if (cr) cr.enter();
			// pause() -> exit() cleared the clip's end handler; restore it
			if (cr && cr.type === 'video' && cr.setEndHandler && pendingGoNext) {
				cr.setEndHandler(pendingGoNext);
			}
			if (remainingDelay != null && keepGoingFlag && pendingGoNext) {
				scheduleNext(remainingDelay);
			}
			updateChrome();
		},
		rewind: function () {
			this.pause();
			current = previous = -1;
			animTransition = animInterval = animPreviousInterval = null;
		},
		next: function (keepGoing) { advance(keepGoing); },

		// Pause and dispose every renderer, including child Q/video tools
		// (videojs players, their intervals and metrics). Called on re-init
		// and on tool removal so nothing leaks.
		destroy: function () {
			this.pause();
			pendingGoNext = null;
			for (var i = 0; i < R.length; i++) {
				if (R[i] && R[i].destroy) { try { R[i].destroy(); } catch (e) {} }
				R[i] = null; RP[i] = null;
			}
		},

		// ── runtime mutation API (operates on the unified timeline) ───────
		addItem: function (item) {
			if (!item.type) item.type = 'image';
			resumePending = null; // a structural change invalidates a deferred frame
			if (item.playAfterMs != null) {
				var self = this, ms = item.playAfterMs;
				setTimeout(function () {
					self.addItem(Q.extend({}, item, { insertAfterCurrent: true, playAfterMs: null }));
				}, ms);
				// best-effort warm for images; videos warm when actually inserted
				if (item.type === 'image' && item.src) { var pre = new Image(); pre.src = Q.url(item.src); }
				return;
			}
			if (item.insertAfterCurrent) {
				var idx = current + 1;
				if (idx >= items.length) {
					items.push(item); R.push(null); RP.push(null);
					getRenderer(items.length - 1).then(function (r) { r.prewarm(); });
				} else {
					items.splice(idx, 0, item);
					R.splice(idx, 0, null);
					RP.splice(idx, 0, null);
					reindex();
					getRenderer(idx).then(function (r) { r.prewarm(); });
				}
			} else {
				items.push(item); R.push(null); RP.push(null);
				getRenderer(items.length - 1).then(function (r) { r.prewarm(); });
			}
		},
		addImage: function (image) { this.addItem(Q.extend({ type: 'image' }, image)); },
		addVideo: function (video) { this.addItem(Q.extend({ type: 'video' }, video)); },

		removeImage: function (index) { this.removeItem(index); },
		removeItem: function (index) {
			if (index < 0 || index >= items.length) return;
			resumePending = null; // a structural change invalidates a deferred frame
			items.splice(index, 1);
			if (R[index]) R[index].destroy();
			R.splice(index, 1);
			RP.splice(index, 1);
			if (current === index) {
				current--;
				if (items.length) advance(keepGoingFlag || state.autoplay);
			} else if (current > index) {
				current--;
			}
			if (previous >= index) previous--;
			reindex();
		},

		setCaption: function (index, html, style, centered) {
			if (!items[index]) return;
			items[index].caption = html;
			if (style) { items[index].style = style; items[index].customCaptionPosition = true; }
			var r = R[index];
			if (r && r.setCaption) r.setCaption(html, style, centered);
		},
		removeCaption: function (index) {
			if (!items[index]) return;
			delete items[index].caption; delete items[index].style;
			delete items[index].customCaptionPosition;
			var r = R[index];
			if (r && r.removeCaption) r.removeCaption();
		},
		setTransition: function (transition) { Q.extend(state.transition, transition); },
		setInterval: function (interval) { Q.extend(state.interval, true, 2, interval); },

		// exposed for the video renderer (single source of truth for kenburns)
		state: state,
		_kenburnsCss: function (mediaEl, $container, from, to, z) {
			var iw = mediaEl.naturalWidth || mediaEl.videoWidth || 1;
			var ih = mediaEl.naturalHeight || mediaEl.videoHeight || 1;
			return kenburnsGeometry(iw, ih, $container.width(), $container.height(), from, to, z);
		},
		_maxVolume: function () { return maxVolume; },
		_soundOn: function () { return soundOn; },
		_updateChrome: function () { updateChrome(); }
	};

	renderChrome();

	if (state.autoplay) {
		gallery.play();
	} else {
		playing = false;
		gallery.next(false); // prime the first frame, do not loop
		updateChrome();
	}

	$this.data('gallery', gallery);
	return this;

},

{
	images: [],
	videos: [],
	items: null,
	transition: { duration: 1000, ease: "smooth", type: "crossfade" },
	interval: {
		duration: 2000, ease: "smooth", type: "",
		from: { left: 0, top: 0, width: 1, height: 1 },
		to:   { left: 0, top: 0, width: 1, height: 1 }
	},
	autoplay: true,
	transitionToFirst: false,
	loop: true,
	player: false,
	sound: false,
	maxVolume: 1,
	preloadAhead: 1,
	videoFallbackMs: 0,
	onLoad: null,
	onTransition: null,
	onInvoke: null
},

{
	remove: function () {
		var g = $(this).data('gallery');
		if (g) { if (g.destroy) g.destroy(); else g.pause(); }
	}
}
);

Q.Template.set("Q/gallery/video",
	`<div class="Q_gallery_item">
		<div class="Q_gallery_video"></div>
		<div class="Q_gallery_blob"></div>
		<i class="Q_gallery_volume" data-type="off"></i>
		<div class="Q_gallery_caption"><h2>{{title}}</h2><p>{{description}}</p></div>
	</div>`
);

})(Q, Q.jQuery, window, document);
