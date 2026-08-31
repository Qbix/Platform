(function (Q, $, window, document, undefined) {

/**
 * @module Q
 */

/**
 * Plays an ordered timeline ("montage") of images and videos with crossfade
 * transitions, optional Ken Burns panning, look-ahead preloading, and an
 * optional play/pause control. Videos are rendered through the Q/video tool,
 * so any backend Q/video supports (mp4, webm, ogg, youtube, vimeo, muse,
 * twitch, odysee, ...) can appear in the timeline. Videos always start muted
 * and expose an unmute control; where the browser permits audible playback the
 * transitions crossfade volume between the outgoing and incoming clip.
 *
 * Image rendering is built in. Video support is loaded on demand the first time
 * a video item is reached or preloaded, so image-only galleries stay lightweight.
 *
 * @class Q gallery
 * @constructor
 * @param {Object} [options]
 *  @param {Array} [options.items] Ordered timeline. Each entry is an object
 *    `{ type:'image'|'video', src, caption, style, interval, transition, ... }`.
 *    If omitted, the timeline is built from `options.images` then
 *    `options.videos`. A missing `type` is inferred from `src`.
 *  @param {Array} [options.images=[]] Image entries (merged into `items`).
 *  @param {Array} [options.videos=[]] Video entries (merged into `items`).
 *  @param {Object} [options.transition] Crossfade settings (overridable per item)
 *    @param {Number} [options.transition.duration=1000] Milliseconds
 *    @param {String} [options.transition.ease="smooth"]
 *    @param {String} [options.transition.type="crossfade"]
 *  @param {Object} [options.interval] On-screen / Ken Burns settings (overridable per item)
 *    @param {Number} [options.interval.duration=2000] Milliseconds an image stays
 *      on screen. For a video, its own length is used unless this (or a clip
 *      window) is set.
 *    @param {String} [options.interval.ease="smooth"]
 *    @param {String} [options.interval.type=""] `""` for none, `"kenburns"` to pan/zoom
 *    @param {Object} [options.interval.from] `{left,top,width,height}` start frame (factors)
 *    @param {Object} [options.interval.to] `{left,top,width,height}` end frame (factors)
 *  @param {Boolean} [options.autoplay=true] Start playing immediately
 *  @param {Boolean} [options.loop=true] Loop back to the first item after the last
 *  @param {Boolean} [options.transitionToFirst=false] Animate into the first item
 *  @param {Boolean} [options.player=false] Show a gallery-level play/pause button
 *    that orchestrates the whole timeline; per-video controls stay suppressed
 *  @param {Boolean} [options.sound=false] Begin with sound desired. Videos still
 *    start muted; where the browser blocks audible playback an unmute control
 *    appears and the user taps to enable sound
 *  @param {Number} [options.maxVolume=1] Ceiling for the audio crossfade (0..1)
 *  @param {Number} [options.preloadAhead=1] How many upcoming items to prepare
 *  @param {Number} [options.videoFallbackMs=0] Advance after this many ms for a
 *    video that reports no duration and never fires `onEnded`; leave 0 to let
 *    true live streams run indefinitely
 *  @param {Q.Event} [options.onLoad] Fires per item as it loads, with
 *    `(element, mediaList, state)`
 *  @param {Q.Event} [options.onTransition] Fires as each item becomes current,
 *    with `(index, mediaList, state)`
 *  @param {Q.Event} [options.onInvoke] Fires when an item is tapped/clicked, with
 *    `(element, index, mediaList)`
 *
 * Per-item fields: any entry may carry its own `transition`, `interval`,
 * `caption`, `style`, and, for videos, `start`/`clipStart`/`clipEnd`, `loop`,
 * and `image` (poster). Insertion timing for {{#crossLink "Q gallery/addItem"}}{{/crossLink}}
 * is controlled with `insertAfterCurrent` and `playAfterMs`.
 *
 * The gallery instance is available at `$(element).data('gallery')` and exposes
 * the methods documented below.
 */

// Shared, page-level holder for the lazily-loaded video support. It carries no
// per-instance state — it is only where the on-demand createRenderer method is
// defined — so it lives in this module's scope rather than on a public
// namespace, built once the first time any gallery on the page needs video.
var videoSupport = null;

// The tool definition follows, so it is the first thing you meet in this file.
// The module-level helpers it leans on are gathered at the bottom: they are
// function declarations, so hoisting makes the order a readability choice
// rather than a load-order constraint. videoSupport is the exception and stays
// above, being a var whose initialiser is not hoisted.

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
	var pendingGoNext = null, resumePending = null, pendingTimers = [], idleHandles = [];
	var domObserver = null, domRemovalTimer = null;
	var animTransition, animInterval, animPreviousInterval;
	var currentPan = null;          // {r, interval, displayMs, easeFn} for rebuilds
	var resizeObserver = null, lastW = 0, lastH = 0;
	var crossfading = false, destroyed = false;
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

		// WAAPI Animation reference for an active kenburns pan.
		var _wapiAnim = null;
		// Cached transform base for the pan, plus the raw nodes the
		// crossfade writes to (so the per-frame path allocates nothing).
		var _base = null, _els = null, _shown = false, _staged = false, _decoded = false;
		var _kf = null;   // cached keyframes, keyed by base + duration + ease

		// Hands the bitmap to the decoder as soon as the bytes are in. Left to
		// itself, the decode is triggered by the first paint, which on a large
		// photo means it lands squarely on the transition frame.
		function decodeAhead() {
			if (_decoded || !$img || !$img[0]) return;
			_decoded = true;
			var el = $img[0];
			if (typeof el.decode !== 'function') return;   // older Safari/Firefox
			try {
				var pr = el.decode();
				if (pr && pr.catch) pr.catch(function () {});
			} catch (e) {}
		}

		// The pan sets an explicit width and height computed from the image's
		// own proportions, and the page must not be allowed to alter either.
		// A site-wide `img { max-width: 100% }` — which ships in Bootstrap,
		// Tailwind's preflight and normalize.css, so it is present on most
		// pages — would clamp that width while leaving the height alone, and
		// the photo would render squashed horizontally, reading as a vertical
		// stretch. max-width constrains the used value regardless of an inline
		// width, so it has to be switched off on the element itself, as
		// !important, since the page's rule may be !important too.
		function neutralizeConstraints(el) {
			var st = el.style;
			st.setProperty('max-width', 'none', 'important');
			st.setProperty('max-height', 'none', 'important');
			st.setProperty('min-width', '0', 'important');
			st.setProperty('min-height', '0', 'important');
			// a global `* { box-sizing: border-box }` plus any border or
			// padding on images would otherwise eat into the computed size
			st.setProperty('box-sizing', 'content-box', 'important');
			st.setProperty('padding', '0', 'important');
			st.setProperty('border', '0', 'important');
			// page rules that crop or letterbox the bitmap inside the box
			st.setProperty('object-fit', 'fill', 'important');
		}

		function els() {
			if (!_els) {
				_els = [$img && $img[0]];
				if ($cap && $cap.length) _els.push($cap[0]);
				_els = _els.filter(Boolean);
			}
			return _els;
		}

		// Fixes the element at a single size for the whole pan, so the pan can
		// be driven by transform alone. width and height are layout properties:
		// animating them costs a style recalc, a layout, a paint and a fresh
		// raster of the full-size bitmap every frame, all on the main thread.
		// A fixed size plus translate3d+scale is compositor-only. The base is
		// the larger of the two endpoints, so the scale never exceeds 1 and the
		// texture is never upscaled.
		function ensureBase(interval) {
			if (!$img || !$img[0]) return null;
			var el = $img[0];
			var iw = el.naturalWidth, ih = el.naturalHeight;
			var cw = $this.width(), ch = $this.height();
			// Never compute — and above all never cache — a base from a size
			// that is not real yet. A gallery built inside a display:none tab,
			// or before its stylesheet lands, measures 0x0 here, and dividing
			// by that yields a zero width and a NaN height that would then be
			// cached for the life of the item. Returning null puts the caller
			// on the per-frame fallback, which self-corrects, and the resize
			// observer restores the compositor path once there is a real size.
			if (!iw || !ih || !cw || !ch) return null;
			// A lazy-loading layer that got in first: src currently points at a
			// placeholder, so naturalWidth/Height describe that and not the
			// photo. Wait for the real bitmap rather than caching a base built
			// from a 1x1 gif.
			if (el.getAttribute('data-lazyload-src')) return null;
			var f = interval.from, t = interval.to;
			var sig = [f.left, f.top, f.width, f.height,
			           t.left, t.top, t.width, t.height].join(',');
			if (_base && _base.iw === iw && _base.ih === ih
			&& _base.cw === cw && _base.ch === ch && _base.sig === sig) {
				return _base;
			}
			var b = kenburnsSetupBase(iw, ih, cw, ch, f, t);
			_base = { baseW: b.baseW, baseH: b.baseH,
			          iw: iw, ih: ih, cw: cw, ch: ch, sig: sig };
			// the one and only layout write for this pan
			el.style.transformOrigin = '0 0';
			el.style.width  = b.baseW + 'px';
			el.style.height = b.baseH + 'px';
			el.style.willChange = 'transform, opacity';
			el.style.backfaceVisibility = 'hidden';
			neutralizeConstraints(el);
			return _base;
		}

		function createCaption(html, style, customPos, name) {
			var capCss = Q.extend({ visibility: 'hidden' }, style || {});
			$cap = $('<div class="Q_gallery_caption" />').css(capCss).html(html).appendTo($this);
			if (!customPos) $cap.addClass('Q_gallery_caption_centered');
			if (name) $cap.addClass('Q_gallery_caption_' + name);
			_els = null;
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
				// A Q/lazyload tool on the page rewrites the src of every image
				// inserted into the DOM, parking the real URL in
				// data-lazyload-src and putting a 1x1 transparent gif in its
				// place until the image scrolls into view. The gallery does its
				// own look-ahead loading and its images are, by definition,
				// where the user is looking, so lazy-loading them buys nothing
				// and costs correctness: the pan would measure the placeholder
				// and size the element to a 1:1 box. The class is the documented
				// way to opt out, and has to be set before insertion.
				}).addClass('Q_no_lazyload').css({
					visibility: 'hidden', position: 'absolute', top: '0px', left: '0px',
					pointerEvents: 'none'
				}).appendTo($this);

				// Do this now, not just when a base is computed. ensureBase
				// declines to produce one whenever the container or the bitmap
				// has no real size yet, and until it succeeds the element would
				// otherwise carry no explicit size at all — leaving a page rule
				// such as `img { width: 100%; height: 100% }` free to size it,
				// which distorts the photo. The element must never be at the
				// mercy of page CSS, base or no base.
				neutralizeConstraints($img[0]);

				function finalize() {
					decodeAhead();
					Q.handle(state.onLoad, $this, [$img, mediaList(), state]);
					$img.on(Q.Pointer.click, function () {
						Q.handle(state.onInvoke, $this, [$img, r.index, mediaList()]);
					});
					resolveReady(r);
				}
				// Stays attached for the life of the element. Anything that
				// swaps the src later — a lazy-loader, a caller reassigning
				// item.src — changes the natural size the pan was built from,
				// so the geometry has to be recomputed rather than left stale.
				$img.on('load', function () {
					if (!_base || !$img || !$img[0]) return;
					if (_base.iw === $img[0].naturalWidth
					&& _base.ih === $img[0].naturalHeight) return;
					r.invalidateBase();
					geometryChanged(r);
				});
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
			/**
			 * Puts the item in front of the compositor before it is needed:
			 * primed at the start of its pan, painted, but fully transparent
			 * and inert. The frame that reveals it then costs an opacity
			 * change rather than a decode plus a first raster of a full-size
			 * photo.
			 */
			stage: function () {
				if (!$img || !$img[0] || _shown || _staged) return;
				decodeAhead();
				var interval = deepMerge(state.interval, item.interval);
				if ((interval.type || "") === 'kenburns') r.kenburns(0, interval);
				var e = els();
				for (var i = 0; i < e.length; i++) {
					e[i].style.opacity = 0;
					e[i].style.display = 'block';
					e[i].style.visibility = 'visible';
				}
				// stays click-through until show() takes the pointer back,
				// so a staged item cannot swallow taps meant for the
				// current one and fire onInvoke with the wrong index
				$img[0].style.pointerEvents = 'none';
				$img[0].style.willChange = 'transform, opacity';
				_staged = true;
			},
			enter: function () {},
			exit: function () {},
			// Runs on every frame of a crossfade, so it touches opacity and
			// nothing else: display and visibility are handled in show(), and
			// writing through raw style avoids rebuilding a jQuery set per
			// frame. Opacity on a promoted layer is a compositor property, so
			// this costs no paint.
			setLevel: function (level) {
				if (!$img) return;
				var e = els();
				for (var i = 0; i < e.length; i++) e[i].style.opacity = level;
				if (level > 0 && !_shown) r.show();
			},
			setAudioLevel: null, // images carry no audio
			// Q.Animation fallback path, and the priming call at z=0. The
			// container size comes from the cached base rather than being
			// re-read here: measuring the container straight after writing
			// styles would force a synchronous layout on every frame.
			kenburns: function (z, interval) {
				if (!$img || !$img[0]) return;
				interval = interval || deepMerge(state.interval, item.interval);
				if ((interval.type || "") !== 'kenburns') return;
				var b = ensureBase(interval);
				if (!b) return;
				var geom = kenburnsGeometry(b.iw, b.ih, b.cw, b.ch,
					interval.from, interval.to, z);
				$img[0].style.transform = kenburnsTransformStr(geom, b.baseW);
			},
			/**
			 * WAAPI kenburns. Every keyframe carries `transform` and nothing
			 * else, which is what lets the compositor run the pan on its own
			 * thread. The ease is baked into sampled offsets and interpolated
			 * linearly between them, so the sample count has to be dense enough
			 * that those straight segments stay below the perceptual threshold;
			 * spaced much beyond 40ms apart the pan starts to look stepped.
			 */
			createKenburnsAnimation: function (interval, durationMs, easeFn) {
				if (!$img || !$img[0]) return null;
				if ((interval.type || "") !== 'kenburns') return null;
				if (typeof $img[0].animate !== 'function') return null;
				var b = ensureBase(interval);
				if (!b) return null;

				var N = Math.max(24, Math.min(150, Math.round(durationMs / 40)));
				// A looping gallery revisits the same item with the same
				// geometry every pass, so sample the ease once and reuse it.
				// This runs synchronously on the transition frame, which is
				// the worst possible moment to be doing arithmetic.
				var key = b.baseW + '/' + b.cw + '/' + b.ch + '/' + b.sig
					+ '/' + N + '/' + durationMs;
				var keyframes;
				if (_kf && _kf.key === key) {
					keyframes = _kf.frames;
				} else {
					keyframes = [];
					for (var i = 0; i <= N; i++) {
						var t = i / N;
						var geom = kenburnsGeometry(b.iw, b.ih, b.cw, b.ch,
							interval.from, interval.to, easeFn(t));
						keyframes.push({
							offset: t,
							transform: kenburnsTransformStr(geom, b.baseW)
						});
					}
					_kf = { key: key, frames: keyframes };
				}

				if (_wapiAnim) { _wapiAnim.cancel(); _wapiAnim = null; }

				_wapiAnim = $img[0].animate(keyframes, {
					duration: durationMs,
					easing: 'linear',
					fill: 'forwards'
				});
				return _wapiAnim;
			},
			invalidateBase: function () { _base = null; _kf = null; },
			/**
			 * Whether this item's pan fills the container at every point along
			 * its sweep. A `to` or `from` frame that reaches past the edge of
			 * the image leaves the element smaller than the container, and the
			 * gallery needs to know: it holds the outgoing item opaque beneath
			 * the incoming one, which is only invisible while the incoming one
			 * actually covers it.
			 */
			coversContainer: function (interval) {
				if (!$img || !$img[0]) return false;
				var b = ensureBase(interval);
				if (!b) return false;
				for (var i = 0; i <= 8; i++) {
					var g = kenburnsGeometry(b.iw, b.ih, b.cw, b.ch,
						interval.from, interval.to, i / 8);
					var l = parseFloat(g.left), t = parseFloat(g.top);
					var w = parseFloat(g.width), h = parseFloat(g.height);
					if (l > 0.5 || t > 0.5
					|| l + w < b.cw - 0.5 || t + h < b.ch - 0.5) return false;
				}
				return true;
			},
			// what container size the current base was measured against, so the
			// gallery can tell whether it is still valid
			baseSize: function () {
				return _base ? { cw: _base.cw, ch: _base.ch } : null;
			},
			// Which of two overlapping items is on top. DOM order alone gets
			// this wrong when the gallery wraps from the last item back to the
			// first, since the incoming element is then the earlier sibling.
			// Kept below the chrome's z-index of 10.
			setStack: function (z) {
				if ($img && $img[0]) $img[0].style.zIndex = z;
				if ($cap && $cap.length) $cap[0].style.zIndex = z;
			},
			show: function () {
				if (!$img) return;
				var e = els();
				for (var i = 0; i < e.length; i++) {
					e[i].style.display = 'block';
					e[i].style.visibility = 'visible';
				}
				$img[0].style.willChange = 'transform, opacity';
				$img[0].style.pointerEvents = '';
				_shown = true; _staged = false;
			},
			hide: function () {
				if (_wapiAnim) { _wapiAnim.cancel(); _wapiAnim = null; }
				if ($img) {
					$img[0].style.transform = '';
					// stop paying for a compositor layer while off-screen
					$img[0].style.willChange = 'auto';
					$img[0].style.pointerEvents = 'none';
					var e = els();
					for (var i = 0; i < e.length; i++) {
						e[i].style.display = 'none';
						e[i].style.zIndex = '';
					}
				}
				_shown = false; _staged = false;
			},
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
				_els = null;
			},
			destroy: function () {
				if (_wapiAnim) { _wapiAnim.cancel(); _wapiAnim = null; }
				if ($img) $img.remove();
				if ($cap && $cap.length) $cap.remove();
				$img = $cap = null;
				_els = null; _base = null; _kf = null; _shown = _staged = _decoded = false;
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
				videoCreateRenderer(gallery, item, $container, index)
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

	// Paint the upcoming items while nothing is animating. Called after a
	// crossfade settles, because hideOthers() has just torn every non-current
	// item back out of the paint tree. Deferred to idle time so the staging
	// raster does not pile onto the frame that just revealed the current item;
	// the timeout keeps it bounded for short intervals, and it is only ever an
	// optimisation, so arriving late costs nothing but the head start.
	function stageAhead(fromIndex) {
		if (typeof requestIdleCallback === 'function') {
			var h = requestIdleCallback(function () {
				idleHandles = idleHandles.filter(function (x) { return x !== h; });
				if (!destroyed) stageNow(fromIndex);
			}, { timeout: 400 });
			idleHandles.push(h);
			return;
		}
		var st = setTimeout(function () {
			pendingTimers = pendingTimers.filter(function (id) { return id !== st; });
			if (!destroyed) stageNow(fromIndex);
		}, 0);
		pendingTimers.push(st);
	}

	function stageNow(fromIndex) {
		for (var d = 1; d <= preloadAhead; d++) {
			var idx = fromIndex + d;
			if (idx >= items.length) {
				if (!state.loop) break;
				idx = idx % items.length;
			}
			if (idx === fromIndex) break;
			var r = R[idx];
			if (r && r.stage) { try { r.stage(); } catch (e) {} }
		}
	}

	// The pan bakes the container's size into a fixed element size and a set of
	// keyframes, so a container that changes size afterwards leaves the current
	// item panning against stale geometry. This matters most at startup, where
	// the first item is routinely laid out before the page has settled.
	function onContainerResize() {
		if (destroyed) return;
		var w = $this.width(), h = $this.height();
		if (!w || !h || (w === lastW && h === lastH)) return;
		lastW = w; lastH = h;
		rebuildPan();
	}

	// Checked on the frame an item is actually painted. ResizeObserver only
	// reports a size that changed, so it says nothing about a base measured
	// against a container that was already wrong. The first item is the one
	// exposed to this, being the only one whose geometry is computed before
	// anything has been painted; every later item is primed by stage() once
	// the page has settled.
	function verifyPanGeometry(r) {
		requestAnimationFrame(function () {
			if (destroyed || !currentPan || currentPan.r !== r) return;
			var w = $this.width(), h = $this.height();
			if (!w || !h) return;
			var b = r.baseSize ? r.baseSize() : null;
			if (b && b.cw === w && b.ch === h) return;   // still valid
			lastW = w; lastH = h;
			rebuildPan();
		});
	}

	// An item's underlying bitmap changed size, so anything derived from the old
	// one is void. Only the item on screen needs its pan rebuilt now; the rest
	// have already dropped their cached geometry.
	function geometryChanged(r) {
		if (destroyed) return;
		if (currentPan && currentPan.r === r) rebuildPan();
	}

	function rebuildPan() {
		for (var i = 0; i < R.length; i++) {
			if (R[i] && R[i].invalidateBase) R[i].invalidateBase();
		}
		if (!currentPan || !currentPan.r) return;
		// rebuild the running pan against the new size, resuming at the same
		// point rather than snapping back to the start
		var at = 0;
		try {
			if (animInterval && typeof animInterval.currentTime === 'number') {
				at = animInterval.currentTime;
			}
		} catch (e) {}
		cancelAnim(animInterval);
		animInterval = null;
		var cp = currentPan;
		if (cp.easeFn && cp.r.createKenburnsAnimation) {
			animInterval = cp.r.createKenburnsAnimation(cp.interval, cp.displayMs, cp.easeFn);
		}
		if (animInterval) {
			try { animInterval.currentTime = Math.min(at, cp.displayMs); } catch (e) {}
			if (paused && animInterval.pause) animInterval.pause();
		} else {
			cp.r.kenburns(0, cp.interval);
		}
	}

	function observeResize() {
		if (typeof ResizeObserver !== 'function') return;   // older Safari
		lastW = $this.width(); lastH = $this.height();
		resizeObserver = new ResizeObserver(function () { onContainerResize(); });
		resizeObserver.observe($this[0]);
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

	function stopAnimations() {
		animTransition && animTransition.pause();
		animInterval && animInterval.pause();
		animPreviousInterval && animPreviousInterval.pause();
		animTransition = animInterval = animPreviousInterval = null;
	}

	function clearPendingTimers() {
		clearTimeout(tm); tm = null;
		for (var i = 0; i < pendingTimers.length; i++) clearTimeout(pendingTimers[i]);
		pendingTimers = [];
		if (typeof cancelIdleCallback === 'function') {
			for (var k = 0; k < idleHandles.length; k++) cancelIdleCallback(idleHandles[k]);
		}
		idleHandles = [];
		clearTimeout(domRemovalTimer); domRemovalTimer = null;
	}

	function disconnectResizeObserver() {
		if (resizeObserver) { try { resizeObserver.disconnect(); } catch (e) {} }
		resizeObserver = null;
	}

	function disconnectDomObserver() {
		if (domObserver) {
			domObserver.disconnect();
			domObserver = null;
		}
		clearTimeout(domRemovalTimer);
		domRemovalTimer = null;
	}

	function observeDomRemoval() {
		Q.ensure('MutationObserver', function () {
			var el = $this[0];
			if (!el) return;
			domObserver = new MutationObserver(function () {
				if (destroyed || el.isConnected) return;
				clearTimeout(domRemovalTimer);
				// defer so a remove+reappend move in the same turn does not destroy
				domRemovalTimer = setTimeout(function () {
					domRemovalTimer = null;
					if (destroyed || el.isConnected) return;
					disconnectDomObserver();
					gallery.destroy();
				}, 0);
			});
			domObserver.observe(document.documentElement, { childList: true, subtree: true });
		});
	}

	// ── the unified advance ───────────────────────────────────────────────
	function advance(keepGoing) {
		if (destroyed || paused || !items.length) return;
		clearTimeout(tm); tm = null;   // supersede any pending cycle timer
		resumePending = null;          // a fresh advance invalidates a deferred one
		// Stop any crossfade still in flight. Left running, it would reach its
		// own completion later and hide every item except the one it was
		// transitioning to — including the item now being faded in.
		if (animTransition) { animTransition.pause(); animTransition = null; }
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
			if (destroyed || current !== idx) return;   // superseded by a later advance
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
		var interval = deepMerge(state.interval, item.interval);

		Q.handle(state.onTransition, $this, [idx, mediaList(), state]);

		crossfading = !!(state.transitionToFirst || prevIdx !== -1);

		// Order matters: prime the start of the pan and the start of the fade,
		// and only then reveal. Revealing first paints one frame with the item
		// fully opaque and untransformed on top of the outgoing one — a hard
		// cut, followed by a fade in from nothing once the ramp's first frame
		// lands.
		// the incoming item goes on top; the outgoing one is forced back to
		// full opacity in case a previous crossfade was interrupted part-way
		// Both renderers must support stacking for the opaque-underlay fade to
		// be safe: if the incoming item cannot be put in front, holding the
		// outgoing one opaque would hide it completely and the transition
		// would land as a cut. A third-party renderer without setStack falls
		// back to the old cross-dissolve.
		// Holding the outgoing item opaque underneath keeps the background from
		// bleeding through the middle of the fade, but it only works while the
		// incoming item actually covers it. A pan whose frame reaches past the
		// edge of the image leaves gaps, the outgoing item shows through them
		// for the length of the fade, and hiding it at the end reads as a pop.
		// Where the incoming item cannot cover, cross-dissolve instead.
		var canStack = !!curR.setStack && (!prevR || !!prevR.setStack);
		var underlay = canStack && !!curR.coversContainer
			&& curR.coversContainer(interval);
		if (prevR && canStack) {
			prevR.setStack(1);
			if (underlay) prevR.setLevel(1); // in case a fade was interrupted
		}
		if (canStack) curR.setStack(2);

		curR.kenburns(0, interval);
		curR.setLevel(crossfading ? 0 : 1);
		curR.show();
		curR.enter(true); // fresh entry: start the clip at its beginning
		if (curR.type === 'video') applyAudio(curR, idx);
		function ramp(x, y) {
			// Only the incoming item's opacity moves. The outgoing one stays
			// fully opaque underneath until the incoming covers it.
			//
			// Fading both at once looks right on paper, since the two
			// opacities sum to exactly 1, but stacked layers composite rather
			// than add: coverage over the background is 1-(1-a)(1-b), which
			// bottoms out at 0.75 when both sit at 0.5. A quarter of the page
			// background would bleed through the middle of every crossfade,
			// darkening the picture and then recovering.
			//
			// Audio does cross both ways, because sound levels really do add.
			curR.setLevel(y);
			if (!underlay && prevR) prevR.setLevel(1 - y);
			if (soundOn) {
				if (curR.setAudioLevel) curR.setAudioLevel(y);
				if (prevR && prevR.setAudioLevel) prevR.setAudioLevel(1 - y);
			}
			if (y === 1) {
				hideOthers(idx);
				animPreviousInterval && animPreviousInterval.pause();
				crossfading = false;
				stageAhead(idx);
			}
		}

		if (!crossfading) {
			// first item, shown outright: it is already primed and at full
			// opacity, so all that is left is to start the pan
			beginInterval(idx, prevIdx, curR, t, keepGoing);
			// no ramp will fire here, so stage the next item directly
			stageAhead(idx);
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

		// Only run an animation when there is actually a ken-burns pan to
		// render. A plain crossfade gallery does ZERO per-frame work between
		// transitions — the difference between idle and a spinning fan.
		//
		// Prefer WAAPI: the ease is baked into sampled keyframe offsets and
		// the compositor interpolates between them at the display's native
		// refresh rate (120 Hz on ProMotion, 90 Hz on Quest, …) with zero
		// JS in the loop. Falls back to Q.Animation (per-frame callback)
		// when the ease name cannot be resolved or WAAPI is unavailable.
		animPreviousInterval = animInterval;
		animInterval = null;
		currentPan = null;
		if ((interval.type || "") === 'kenburns') {
			var easeFn = resolveEaseFn(interval.ease);
			currentPan = { r: curR, interval: interval, displayMs: displayMs, easeFn: easeFn };
			if (easeFn && curR.createKenburnsAnimation) {
				animInterval = curR.createKenburnsAnimation(interval, displayMs, easeFn);
			}
			if (!animInterval) {
				// Fallback: per-frame callback (Q.Animation)
				animInterval = Q.Animation.play(function (x, y) {
					curR.kenburns(y, interval);
				}, displayMs, interval.ease);
			}
		}

		// Exactly one advance per cycle, whether the timer fires or the clip ends.
		var advanced = false;
		function goNext() {
			if (advanced || paused || destroyed) return;
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

		if (currentPan) verifyPanGeometry(curR);
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

		/**
		 * Index of the item currently showing, or -1 before the first one.
		 * @property currentIndex
		 * @type Number
		 */
		get currentIndex() { return current; },

		/**
		 * Start, or restart, automatic playback through the timeline.
		 * @method play
		 */
		play: function () {
			paused = false; playing = true; everStarted = true;
			advance(true);
			updateChrome();
		},
		/**
		 * Pause playback, freezing the current transition, animation and timer.
		 * A video keeps its position so {{#crossLink "Q gallery/resume"}}{{/crossLink}}
		 * continues where it left off.
		 * @method pause
		 */
		pause: function () {
			paused = true;
			animTransition && animTransition.pause();
			animInterval && animInterval.pause();
			animPreviousInterval && animPreviousInterval.pause();
			if (tm) {
				var now = Q.milliseconds ? Q.milliseconds() : Date.now();
				remainingDelay = Math.max(0, scheduledDelay - (now - scheduledAt));
				clearTimeout(tm); tm = null;
			}
			var r = R[current]; if (r) r.exit();
			updateChrome();
		},
		/**
		 * Resume playback after {{#crossLink "Q gallery/pause"}}{{/crossLink}}.
		 * @method resume
		 */
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
			if (crossfading && animPreviousInterval) animPreviousInterval.play();
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
		/**
		 * Pause and reset the cursor to before the first item.
		 * @method rewind
		 */
		rewind: function () {
			this.pause();
			current = previous = -1;
			crossfading = false;
			stopAnimations();
		},
		/**
		 * Advance to the next item.
		 * @method next
		 * @param {Boolean} [keepGoing=false] Whether to keep auto-advancing afterwards
		 */
		next: function (keepGoing) { advance(keepGoing); },

		/**
		 * Pause and dispose every renderer, including child Q/video tools, so
		 * nothing leaks. Called automatically on re-initialisation and on tool removal.
		 * @method destroy
		 */
		destroy: function () {
			if (destroyed) return;
			destroyed = true;
			currentPan = null;
			disconnectResizeObserver();
			disconnectDomObserver();
			this.pause();
			pendingGoNext = null;
			crossfading = false;
			stopAnimations();
			clearPendingTimers();
			for (var i = 0; i < R.length; i++) {
				if (R[i] && R[i].destroy) { try { R[i].destroy(); } catch (e) {} }
				R[i] = null; RP[i] = null;
			}
			$this.removeData('gallery');
		},

		/**
		 * Insert an item into the timeline at runtime, without re-initialising.
		 * @method addItem
		 * @param {Object} item `{ type:'image'|'video', src, caption, ... }`. Timing:
		 *   `insertAfterCurrent:true` plays it next; `playAfterMs:N` inserts it N
		 *   milliseconds from now; with neither it is appended to the end.
		 */
		addItem: function (item) {
			if (!item.type) item.type = 'image';
			resumePending = null; // a structural change invalidates a deferred frame
			if (item.playAfterMs != null) {
				var self = this, ms = item.playAfterMs;
				var timerId = setTimeout(function () {
					pendingTimers = pendingTimers.filter(function (id) { return id !== timerId; });
					if (destroyed) return;
					self.addItem(Q.extend({}, item, { insertAfterCurrent: true, playAfterMs: null }));
				}, ms);
				pendingTimers.push(timerId);
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
		/**
		 * Convenience for {{#crossLink "Q gallery/addItem"}}{{/crossLink}} with type 'image'.
		 * @method addImage
		 * @param {Object} image
		 */
		addImage: function (image) { this.addItem(Q.extend({ type: 'image' }, image)); },
		/**
		 * Convenience for {{#crossLink "Q gallery/addItem"}}{{/crossLink}} with type 'video'.
		 * @method addVideo
		 * @param {Object} video
		 */
		addVideo: function (video) { this.addItem(Q.extend({ type: 'video' }, video)); },

		/**
		 * Alias of {{#crossLink "Q gallery/removeItem"}}{{/crossLink}}.
		 * @method removeImage
		 * @param {Number} index
		 */
		removeImage: function (index) { this.removeItem(index); },
		/**
		 * Remove an item from the timeline. If it is the current item the gallery
		 * advances to the next one.
		 * @method removeItem
		 * @param {Number} index
		 */
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

		/**
		 * Set or replace an item's caption, updating the DOM in place.
		 * @method setCaption
		 * @param {Number} index
		 * @param {String} html Caption HTML
		 * @param {Object} [style] CSS for custom positioning
		 * @param {Boolean} [centered=true] Center the caption when no style is given
		 */
		setCaption: function (index, html, style, centered) {
			if (!items[index]) return;
			items[index].caption = html;
			if (style) { items[index].style = style; items[index].customCaptionPosition = true; }
			var r = R[index];
			if (r && r.setCaption) r.setCaption(html, style, centered);
		},
		/**
		 * Remove an item's caption.
		 * @method removeCaption
		 * @param {Number} index
		 */
		removeCaption: function (index) {
			if (!items[index]) return;
			delete items[index].caption; delete items[index].style;
			delete items[index].customCaptionPosition;
			var r = R[index];
			if (r && r.removeCaption) r.removeCaption();
		},
		/**
		 * Update the crossfade settings; takes effect on the next transition.
		 * @method setTransition
		 * @param {Object} transition Partial `{ duration, ease, type }`
		 */
		setTransition: function (transition) { Q.extend(state.transition, transition); },
		/**
		 * Update the interval / Ken Burns settings; takes effect on the next interval.
		 * @method setInterval
		 * @param {Object} interval Partial `{ duration, ease, type, from, to }`
		 */
		setInterval: function (interval) { Q.extend(state.interval, true, 2, interval); },

		// exposed for the video renderer (single source of truth for kenburns)
		state: state,
		// Backward-compatible: returns layout-property geometry object.
		_kenburnsCss: function (mediaEl, $container, from, to, z) {
			var iw = mediaEl.naturalWidth || mediaEl.videoWidth || 1;
			var ih = mediaEl.naturalHeight || mediaEl.videoHeight || 1;
			return kenburnsGeometry(iw, ih, $container.width(), $container.height(), from, to, z);
		},
		// GPU-accelerated: returns { transform, baseW } for the video
		// renderer to apply via el.style.transform. Uses the media's
		// natural dimensions as the base (uniform scale, never stretches).
		_kenburnsTransform: function (mediaEl, $container, from, to, z, baseW) {
			var iw = mediaEl.naturalWidth || mediaEl.videoWidth || 1;
			var ih = mediaEl.naturalHeight || mediaEl.videoHeight || 1;
			if (!baseW) baseW = iw;
			var cw = $container.width(), ch = $container.height();
			var geom = kenburnsGeometry(iw, ih, cw, ch, from, to, z);
			return {
				transform: kenburnsTransformStr(geom, baseW),
				baseW: baseW
			};
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

	observeResize();
	observeDomRemoval();

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

// ── module-level helpers ──────────────────────────────────────────────────
// Hoisted, so they are in scope throughout the tool defined above.

function videoCreateRenderer(gallery, item, $container, index) {
	if (!videoSupport) {
		videoSupport = { createRenderer: new Q.Method() };
		Q.Method.define(
			videoSupport,
			"{{Q}}/js/Q/gallery",
			function () { return [Q]; },
			{ require: "_internal" }
		);
	}
	return videoSupport.createRenderer.call(gallery, item, $container, index);
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

// ── GPU-friendly ken-burns via transform ──────────────────────────────────
// Converts the layout-property geometry (left/top/width/height) into a
// translate3d+scale transform relative to a fixed "base" size. This moves the
// per-frame work from the layout+paint pipeline to the compositor thread,
// eliminating style-recalc/layout/paint/raster entirely.
//
// Call kenburnsSetupBase once when the item enters, then kenburnsTransformStr
// on every frame.

function kenburnsSetupBase(iw, ih, $w, $h, from, to) {
	// Pick the larger endpoint as the CSS base size so we only ever
	// scale <= 1, which avoids upscaling the rasterised texture.
	var g0 = kenburnsGeometry(iw, ih, $w, $h, from, to, 0);
	var g1 = kenburnsGeometry(iw, ih, $w, $h, from, to, 1);
	var w0 = parseFloat(g0.width), w1 = parseFloat(g1.width);
	var bw = (w0 > w1) ? w0 : w1;
	// Preserve aspect ratio (geometry guarantees width/height == constant
	// after aspect correction, so either endpoint's ratio works).
	var bh = bw * (parseFloat(g0.height) / w0);
	return { baseW: bw, baseH: bh };
}

function kenburnsTransformStr(geom, baseW) {
	var gw = parseFloat(geom.width);
	var gl = parseFloat(geom.left);
	var gt = parseFloat(geom.top);
	var s  = gw / baseW;
	return 'translate3d(' + gl + 'px,' + gt + 'px,0) scale(' + s + ')';
}

// ── WAAPI helpers ─────────────────────────────────────────────────────
// Resolve a Q.Animation ease name (e.g. "smooth") to a JS function
// (t)→t so it can be baked into WAAPI keyframe offsets. Returns null
// when the name can't be resolved, signalling the caller to fall back
// to Q.Animation.
function resolveEaseFn(easeName) {
	if (typeof easeName === 'function') return easeName;
	if (!easeName || easeName === 'linear') return function (t) { return t; };
	var eases = Q.Animation && Q.Animation.ease;
	if (eases && typeof eases[easeName] === 'function') return eases[easeName];
	return null;
}

// Cancel a WAAPI Animation (preferred) or pause a Q.Animation,
// whichever the argument happens to be.
function cancelAnim(anim) {
	if (!anim) return;
	try {
		if (typeof anim.cancel === 'function') anim.cancel();
		else if (anim.pause) anim.pause();
	} catch (e) {}
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

Q.Template.set("Q/gallery/video",
	`<div class="Q_gallery_item">
		<div class="Q_gallery_video"></div>
		<div class="Q_gallery_blob"></div>
		<i class="Q_gallery_volume" data-type="off"></i>
		<div class="Q_gallery_caption"><h2>{{title}}</h2><p>{{description}}</p></div>
	</div>`
);

})(Q, Q.jQuery, window, document);