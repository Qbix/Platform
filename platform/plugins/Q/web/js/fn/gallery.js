(function (Q, $, window, document, undefined) {

/**
 * Drop-in replacement for Q/web/js/fn/gallery.js
 *
 * Identical to the original except the gallery instance (at $(el).data('gallery'))
 * gains six runtime-mutation methods that let Media/presentation/gallery.js respond
 * to Streams/gallery/* ephemerals without re-initialising the tool and restarting
 * the kenburns animation from the beginning:
 *
 *   gallery.addImage(image)                    insert image without re-init
 *     image.insertAfterCurrent = true          splice right after current (plays next)
 *     image.playAfterMs = N                    schedule insert N ms from now
 *   gallery.removeImage(index)                 remove image without re-init
 *   gallery.setCaption(index, html, style?)    update/create caption in-place
 *   gallery.removeCaption(index)               remove caption in-place
 *   gallery.setTransition(partial)             update crossfade settings live
 *   gallery.setInterval(partial)               update kenburns settings live
 *
 * INSTALL: copy over platform/plugins/Q/web/js/fn/gallery.js
 */

Q.Tool.jQuery('Q/gallery', function _Q_gallery(state) {
	state = state || {};
	Q.addStylesheet("{{Q}}/css/tools/gallery.css");
	var $this = this, imgs=[], caps=[], current, tm, gallery;
	var animTransition, animInterval, animPreviousInterval;

	var intervals = {
		"": function (x, y, params) {},
		kenburns: function (x, y, params) {
			var image = state.images[params.current];
			var img = imgs[params.current];
			if (!img || !img[0]) return;
			var interval = image.interval || {};
			var from = Q.extend({}, 2, state.interval.from, 2, interval.from);
			var to   = Q.extend({}, 2, state.interval.to,   2, interval.to);
			var z = y;
			var widthFactor  = from.width  + z*(to.width  - from.width);
			var heightFactor = from.height + z*(to.height - from.height);
			var leftFactor   = from.left   + z*(to.left   - from.left);
			var topFactor    = from.top    + z*(to.top    - from.top);
			var iw = img[0].naturalWidth  || 1;
			var ih = img[0].naturalHeight || 1;
			var w = iw * widthFactor, h = ih * heightFactor;
			var l = iw * leftFactor,  t = ih * topFactor;
			var r = w/h, $w = $this.width(), $h = $this.height(), $r = $w/$h;
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
			var width  = $w / widthFactor,  height = $h / heightFactor;
			var left   = -leftFactor * width, top   = -topFactor * height;
			img.css({ left: left+'px', top: top+'px', width: width+'px', height: height+'px', visibility: 'visible' });
			caps[params.current] && caps[params.current].css('visibility', 'visible');
		}
	};

	var transitions = {
		crossfade: function (x, y, params) {
			imgs[params.current].add(caps[params.current])
				.css({ display: 'block', visibility: 'visible', opacity: y });
			if (params.previous < 0) return;
			if (y !== 1) {
				imgs[params.previous].add(caps[params.previous]).css({ opacity: 1-y });
			} else {
				for (var i=0; i<imgs.length; ++i) {
					if (i === params.current) continue;
					if (imgs[i]) imgs[i].add(caps[i]).css({ display: 'none' });
				}
			}
			if (y === 1) animPreviousInterval && animPreviousInterval.pause();
		}
	};

	if (gallery = $this.data('gallery')) {
		gallery.pause();
		$this.empty();
		if (state === null) return false;
	}

	current = -1;
	var css = { overflow: 'hidden' };
	if ($this.css('position') === 'static') css.position = 'relative';
	if (!parseInt($this.css('height'))) $this.css('height', '100%');
	$this.css(css);

	function loadImage(index, callback) {
		if (imgs[index]) { Q.handle(callback, this, [index, imgs]); return; }
		var image = state.images[index] || {};
		if (!image.src) image.src = Q.url('{{Q}}/img/throbbers/transparent.gif');
		var name = image.name ? Q.normalize(image.name) : '';
		var $img = $('<img />').attr({
			alt: image.caption || ('image ' + index),
			src: Q.url(image.src)
		}).css({ visibility: 'hidden', position: 'absolute', top: '0px', left: '0px' })
		  .appendTo($this);

		function finalize() {
			imgs[index] = $img;
			Q.handle(state.onLoad, $this, [$img, imgs, state]);
			Q.handle(callback, this, [index, imgs]);
			$img.on(Q.Pointer.click, function () {
				Q.handle(state.onInvoke, $this, [$img, index, imgs]);
			});
		}
		$img.on('load error', function () { $img.off('load error'); finalize(); });
		if ($img[0].complete) finalize();

		if (image.caption) {
			var capCss = Q.extend({ visibility: 'hidden' }, image.style || {});
			var cap = $('<div class="Q_gallery_caption" />')
				.css(capCss).html(image.caption).appendTo($this);
			if (!image.customCaptionPosition) cap.addClass('Q_gallery_caption_centered');
			caps[index] = cap;
			if (name) cap.addClass('Q_gallery_caption_' + name);
		} else {
			caps[index] = $([]);
		}
		if (name) $img.addClass('Q_gallery_image_' + name);
	}

	gallery = {
		options: state,
		onLoad: state.onLoad,
		get currentIndex() { return current; },

		play:   function () { this.next(true); },
		pause:  function () {
			animTransition && animTransition.pause();
			animInterval   && animInterval.pause();
			clearTimeout(tm);
		},
		resume: function () {
			animTransition && animTransition.play();
			animInterval   && animInterval.play();
		},
		rewind: function () {
			this.pause();
			current = -1;
			animTransition = animInterval = null;
		},
		next: function (keepGoing) {
			if (state.images.length) this.images(keepGoing);
			if (state.videos.length) this.videos(keepGoing);
		},

		images: function (keepGoing) {
			var previous = current;
			++current;
			if (current >= state.images.length) {
				if (!state.loop) return;
				current = 0;
			}
			loadImage(current, function () { beginTransition(); });

			function beginTransition() {
				var t = Q.extend({}, 2, state.transition, 2, (state.images[current] || {}).transition);
				var transition = transitions[state.transition.type || ""];
				Q.handle(state.onTransition, $this, [current, imgs, state]);
				if (!state.transitionToFirst && previous === -1) {
					transition(1, 1, { current: current, previous: previous });
					beginInterval();
					return;
				}
				animTransition = Q.Animation.play(transition, t.duration, t.ease,
					{ current: current, previous: previous });
				beginInterval();
			}
			function beginInterval() {
				var t        = Q.extend({}, 2, state.transition, 2, (state.images[current] || {}).transition);
				var interval = Q.extend({}, 2, state.interval,   2, (state.images[current] || {}).interval);
				animPreviousInterval = animInterval;
				animInterval = Q.Animation.play(intervals[interval.type || ""],
					interval.duration, interval.ease, { current: current, previous: previous });
				if (state.images.length > 1) {
					loadImage((current + 1) % state.images.length, null);
				}
				if (keepGoing) {
					tm = setTimeout(function () { gallery.next(keepGoing); },
						interval.duration - t.duration);
				}
			}
		},

		videos: function () {
			Q.each(state.videos, function (index, item) {
				Q.Template.render("Q/gallery/video", item, function (err, html) {
					if (err) return;
					var $videoItem = $(html);
					$this.append($videoItem);
					$(".Q_gallery_video", $videoItem).tool("Q/video", {
						url: item.src, controls: false, loop: false, muted: true
					}, "gallery_video_" + index).activate(function () {
						if (index === 0) {
							var fp = Q.Tool.from($(".Q_video_tool", $videoItem)[0], "Q/video");
							var count = 0;
							var tid = setInterval(function () {
								if (count++ > 10) clearInterval(tid);
								try { fp.player.volume(0); fp.play(); } catch (e) {}
							}, 500);
							fp.state.onPlay.set(function () { clearInterval(tid); }, "Q/gallery");
						}
						this.state.onEnded.set(function () {
							$videoItem.appendTo($this);
							var vt = Q.Tool.from($(".Q_gallery_item:first-child .Q_video_tool", $this)[0], "Q/video");
							vt.player.volume(0);
							try { vt.player.muted(true); } catch (e) {}
							vt.play();
						}, "Q/gallery");
					});
					$(".Q_gallery_volume", $videoItem).on(Q.Pointer.fastclick, function () {
						var vt = Q.Tool.from($(".Q_video_tool", $videoItem)[0], "Q/video");
						var vol = $(this).attr("data-type") === 'on' ? 0 : 1;
						vt.player.volume(vol);
						try { vt.player.muted(!vol); } catch (e) {}
						$(this).attr("data-type", vol ? "on" : "off");
					});
				});
			});
		},

		// ── Runtime mutation API ───────────────────────────────────────────────
		// Mutates state[] and imgs[]/caps[] in-place.
		// The currently-running animation is never interrupted.

		/**
		 * Add an image without re-initialising. Preloads in the background.
		 * Timing is controlled by two options on the image object:
		 *   image.insertAfterCurrent: true  — splice right after the current
		 *       image so it plays next; the running animation is unaffected.
		 *   image.playAfterMs: N            — wait N ms then insert after current.
		 *       Useful for scheduling an image to appear roughly N ms from now
		 *       without knowing how many images will play in between.
		 *   (default, neither set)          — append to end of the rotation.
		 *
		 * @param {Object} image   { src, caption?, style?, interval?, transition?,
		 *                           insertAfterCurrent?, playAfterMs? }
		 */
		addImage: function (image) {
			if (image.playAfterMs != null) {
				// Temporal insert: schedule after N ms, then splice after current
				var self = this;
				setTimeout(function () {
					image = Q.extend({}, image, { insertAfterCurrent: true, playAfterMs: null });
					self.addImage(image);
				}, image.playAfterMs);
				// Preload now so it's ready when the timer fires
				var preload = new Image();
				preload.src = Q.url(image.src);
				return;
			}
			if (image.insertAfterCurrent) {
				// Splice immediately after the currently-showing image
				var idx = current + 1;
				if (idx >= state.images.length) {
					state.images.push(image);
					loadImage(state.images.length - 1, null);
				} else {
					state.images.splice(idx, 0, image);
					imgs.splice(idx, 0, null);
					caps.splice(idx, 0, null);
					loadImage(idx, null);
				}
			} else {
				// Default: append to rotation
				state.images.push(image);
				loadImage(state.images.length - 1, null);
			}
		},

		/**
		 * Remove an image without re-initialising.
		 * If it is the currently-showing image, advances immediately.
		 * @param {Number} index
		 */
		removeImage: function (index) {
			if (index < 0 || index >= state.images.length) return;
			state.images.splice(index, 1);
			if (imgs[index]) imgs[index].remove();
			if (caps[index] && caps[index].length) caps[index].remove();
			imgs.splice(index, 1);
			caps.splice(index, 1);
			if (current === index) {
				current--;
				if (state.images.length) gallery.next(state.autoplay);
			} else if (current > index) {
				current--;
			}
		},

		/**
		 * Set or update the caption for an image in-place.
		 * If the image is already in the DOM, the DOM updates immediately — no flicker.
		 * @param {Number} index
		 * @param {String} html        Caption HTML/text
		 * @param {Object} [style]     CSS object; also disables centering if provided
		 * @param {Boolean} [centered] Default true when no style
		 */
		setCaption: function (index, html, style, centered) {
			if (!state.images[index]) return;
			state.images[index].caption = html;
			if (style) {
				state.images[index].style = style;
				state.images[index].customCaptionPosition = true;
			}
			var visible = (index === current);
			if (caps[index] && caps[index].length) {
				// In DOM already — patch it
				caps[index].html(html);
				if (style) caps[index].css(style);
				if (centered === false) {
					caps[index].removeClass('Q_gallery_caption_centered');
				} else if (!style) {
					caps[index].addClass('Q_gallery_caption_centered');
				}
			} else if (imgs[index]) {
				// Image loaded but caption not yet created
				var capCss = Q.extend(
					{ visibility: visible ? 'visible' : 'hidden' },
					style || {}
				);
				var cap = $('<div class="Q_gallery_caption" />')
					.css(capCss).html(html).appendTo($this);
				if (centered !== false && !style) cap.addClass('Q_gallery_caption_centered');
				caps[index] = cap;
			}
			// Image not loaded yet: state.images[index].caption set above;
			// loadImage() will create the DOM element when it loads.
		},

		/**
		 * Remove the caption for an image in-place.
		 * @param {Number} index
		 */
		removeCaption: function (index) {
			if (!state.images[index]) return;
			delete state.images[index].caption;
			delete state.images[index].style;
			delete state.images[index].customCaptionPosition;
			if (caps[index] && caps[index].length) {
				caps[index].remove();
				caps[index] = $([]);
			}
		},

		/**
		 * Update crossfade transition settings.
		 * Takes effect on the next image transition — current one runs to completion.
		 * @param {Object} transition  Partial: { type?, duration?, ease? }
		 */
		setTransition: function (transition) {
			Q.extend(state.transition, transition);
		},

		/**
		 * Update kenburns interval settings.
		 * Takes effect when the current interval ends naturally.
		 * @param {Object} interval  Partial: { type?, duration?, ease?, from?, to? }
		 */
		setInterval: function (interval) {
			Q.extend(state.interval, true, 2, interval);
		}

	};

	if (state.autoplay) {
		gallery.play();
	} else {
		gallery.next(false);
	}

	$this.data('gallery', gallery);
	return this;

},
{
	images: [],
	videos: [],
	transition: { duration: 1000, ease: "smooth", type: "crossfade" },
	interval: {
		duration: 2000, ease: "smooth", type: "",
		from: { left: 0, top: 0, width: 1, height: 1 },
		to:   { left: 0, top: 0, width: 1, height: 1 }
	},
	autoplay: true,
	transitionToFirst: false,
	loop: true,
	onLoad: null,
	onTransition: null,
	onInvoke: null
},
{
	remove: function () { $(this).data('gallery').pause(); }
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
