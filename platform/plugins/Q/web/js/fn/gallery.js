(function (Q, $, window, document, undefined) {

/**
 * Q Tools
 * @module Q-tools
 */

/**
 * Plugin creates a gallery of images and/or videos with transitions and intervals
 * @class Q gallery
 * @constructor
 * @param {Object} [options] Options object
 * @param {Array} [options.images] Array of image objects
 * @param {String} [options.images.N.name] Optional name used for CSS classes
 * @param {String} [options.images.N.src] Image URL (passed through Q.url)
 * @param {String} [options.images.N.caption] Optional caption HTML
 * @param {Object} [options.images.N.style] Optional CSS for caption
 * @param {Boolean} [options.images.N.customCaptionPosition] Disable centered caption
 * @param {Object} [options.images.N.interval] Per-image interval override
 * @param {Object} [options.images.N.transition] Per-image transition override
 * @param {Array} [options.videos] Array of video objects
 * @param {Object} [options.transition] Default transition options
 * @param {Object} [options.interval] Default interval options
 * @param {Object} [options.retain] Optional LRU retain limits
 * @param {Number} [options.timeToBuffer=5000] Min ms required before modifying upcoming item
 * @param {Boolean} [options.autoplay=true] Start playback immediately
 * @param {Boolean} [options.transitionToFirst=false] Transition first item
 * @param {Boolean} [options.loop=true] Loop timeline
 * @param {Q.Event} [options.onLoad] Fired when media loads
 * @param {Q.Event} [options.onTransition] Fired when transition begins
 */
Q.Tool.jQuery('Q/gallery', function _Q_gallery(state) {
	state = state || {};
	Q.addStylesheet("{{Q}}/css/tools/gallery.css");

	var $this = this;
	var gallery;
	var imgs = [];
	var caps = [];
	var videos = [];
	var mediaItems = [];
	var lru = { image: [], video: [] };
	var current = -1;
	var previous = -1;
	var tm = null;
	var nextDeadline = null;
	var animTransition = null;
	var animInterval = null;
	var animPreviousInterval = null;

	state.timeToBuffer = state.timeToBuffer || 5000;

	if ($this.css('position') === 'static') {
		$this.css('position', 'relative');
	}
	if (!parseInt($this.css('height'), 10)) {
		$this.css('height', '100%');
	}
	$this.css({ overflow: 'hidden' });

	function rebuildTimeline() {
		mediaItems = [];
		var i;
		for (i = 0; i < state.images.length; i++) {
			mediaItems.push({ type: 'image', index: i, config: state.images[i] });
		}
		for (i = 0; i < state.videos.length; i++) {
			mediaItems.push({ type: 'video', index: i, config: state.videos[i] });
		}
	}

	function markUsed(item) {
		var list = lru[item.type];
		var i;
		for (i = 0; i < list.length; i++) {
			if (list[i] === item.index) {
				list.splice(i, 1);
				break;
			}
		}
		list.unshift(item.index);
	}

	function evict(type) {
		if (!state.retain || state.retain[type] === undefined) return;
		while (lru[type].length > state.retain[type]) {
			var idx = lru[type][lru[type].length - 1];
			if (
				(mediaItems[current] &&
				mediaItems[current].type === type &&
				mediaItems[current].index === idx) ||
				(mediaItems[previous] &&
				mediaItems[previous].type === type &&
				mediaItems[previous].index === idx)
			) {
				break;
			}
			if (type === 'image' && imgs[idx]) {
				imgs[idx].remove();
				if (caps[idx]) caps[idx].remove();
				imgs[idx] = null;
				caps[idx] = null;
			}
			if (type === 'video' && videos[idx]) {
				try { videos[idx].player.pause(); } catch (e) {}
				videos[idx].$element.remove();
				videos[idx] = null;
			}
		}
	}

	var intervals = {
		"": function () {},
		kenburns: function (x, y, params) {
			var item = mediaItems[params.current];
			if (!item.$element || !item.naturalWidth || !item.naturalHeight) return;

			var interval = Q.extend({}, 2, state.interval, 2, item.config.interval);
			var from = Q.extend({}, 2, state.interval.from, 2, interval.from);
			var to = Q.extend({}, 2, state.interval.to, 2, interval.to);

			var iw = item.naturalWidth;
			var ih = item.naturalHeight;

			var z = y;
			var widthFactor = from.width + z * (to.width - from.width);
			var heightFactor = from.height + z * (to.height - from.height);
			var leftFactor = from.left + z * (to.left - from.left);
			var topFactor = from.top + z * (to.top - from.top);

			var w = iw * widthFactor;
			var h = ih * heightFactor;
			var l = iw * leftFactor;
			var t = ih * topFactor;

			var r = w / h;
			var $w = $this.width();
			var $h = $this.height();
			var $r = $w / $h;

			if ($r < r) {
				var smallerW = h * $r;
				l += (w - smallerW) / 2;
				widthFactor = smallerW / iw;
				leftFactor = l / iw;
			} else {
				var smallerH = w / $r;
				t += (h - smallerH) / 2;
				heightFactor = smallerH / ih;
				topFactor = t / ih;
			}

			var width = $w / widthFactor;
			var height = $h / heightFactor;
			var left = -leftFactor * width;
			var top = -topFactor * height;

			item.$element.css({
				left: left + 'px',
				top: top + 'px',
				width: width + 'px',
				height: height + 'px',
				visibility: 'visible'
			});

			if (item.type === 'image' && caps[item.index]) {
				caps[item.index].css('visibility', 'visible');
			}
		}
	};

	var transitions = {
		crossfade: function (x, y, params) {
			var cur = mediaItems[params.current];
			var prev = params.previous >= 0 ? mediaItems[params.previous] : null;

			cur.$element.css({
				display: 'block',
				visibility: 'visible',
				opacity: y
			});
			cur.$element.find('.Q_gallery_caption').css('visibility', 'visible');

			if (cur.type === 'video') {
				try { cur.player.volume(y); } catch (e) {}
			}

			if (!prev) return;

			prev.$element.css({ opacity: 1 - y });

			if (prev.type === 'video') {
				try { prev.player.volume(1 - y); } catch (e) {}
			}

			if (y === 1) {
				if (prev.type === 'video') {
					prev.$element.find('.Q_gallery_caption').css('visibility', 'hidden');
					try { prev.player.pause(); } catch (e) {}
				}
				animPreviousInterval && animPreviousInterval.pause();
				evict(prev.type);
			}
		}
	};

	function preloadNext() {
		if (nextDeadline && Date.now() < nextDeadline - state.timeToBuffer) {
			return;
		}
		if (!state.loop && current + 1 >= mediaItems.length) {
			return;
		}
		var next = mediaItems[(current + 1) % mediaItems.length];
		if (!next) {
			return;
		}
		if (next.type === 'image') loadImage(next.index, function(){});
		if (next.type === 'video') loadVideo(next.index, function(){});
	}


	function loadImage(i, cb) {
		if (imgs[i]) return cb();
		var image = state.images[i] || {};
		var $img = $('<img />')
			.attr('src', Q.url(image.src))
			.css({ position:'absolute', visibility:'hidden', top:0, left:0 })
			.appendTo($this);

		if (image.caption) {
			var cap = $('<div class="Q_gallery_caption" />')
				.html(image.caption)
				.css(image.style || {})
				.appendTo($this);
			if (!image.customCaptionPosition) {
				cap.addClass('Q_gallery_caption_centered');
			}
			caps[i] = cap;
		}

		$img.on('load', function () {
			imgs[i] = $img;
			var m;
			for (var k = 0; k < mediaItems.length; k++) {
				if (mediaItems[k].type === 'image' && mediaItems[k].index === i) {
					m = mediaItems[k];
					break;
				}
			}
			m.$element = $img;
			m.naturalWidth = $img[0].naturalWidth;
			m.naturalHeight = $img[0].naturalHeight;
			Q.handle(state.onLoad, $this, [$img, imgs, state]);
			cb();
		});

		if ($img[0].complete) $img.trigger('load');
	}

	function loadVideo(i, cb) {
		if (videos[i]) return cb();
		Q.Template.render("Q/gallery/video", state.videos[i], function (err, html) {
			if (err) return;
			var $item = $(html).appendTo($this);
			$(".Q_gallery_video", $item).tool("Q/video", {
				url: state.videos[i].src,
				controls: false,
				muted: true
			}).activate(function () {
				var tool = Q.Tool.from($(".Q_video_tool", $item)[0], "Q/video");
				videos[i] = { $element: $item, player: tool.player };

				tool.state.onEnded.set(function () {
					gallery.next(true);
				}, "Q/gallery");

				var m;
				for (var k = 0; k < mediaItems.length; k++) {
					if (mediaItems[k].type === 'video' && mediaItems[k].index === i) {
						m = mediaItems[k];
						break;
					}
				}
				m.$element = $item;
				m.player = tool.player;

				if (current === 0 && state.autoplay) {
					var tries = 0;
					var playTimer = setInterval(function () {
						if (tries++ > 10) return clearInterval(playTimer);
						try {
							m.player.muted(true);
							m.player.play();
						} catch (e) {}
					}, 500);

					m.player.on('play', function () {
						clearInterval(playTimer);
					});
				}

				Q.handle(state.onLoad, $this, [$item, videos, state]);
				cb();
			});
		});
	}

	gallery = {
		next: function (keepGoing) {
			if (nextDeadline && Date.now() < nextDeadline) {
				return;
			}
			previous = current;
			current++;

			if (current >= mediaItems.length) {
				if (!state.loop) {
					return;
				}
				current = 0;
			}

			var item = mediaItems[current];
			markUsed(item);

			Q.handle(state.onTransition, $this, [current, mediaItems, state]);

			var interval = Q.extend({}, 2, state.interval, 2, item.config.interval);
			var transition = Q.extend({}, 2, state.transition, 2, item.config.transition);
			var transitionFn = transitions[transition.type || "crossfade"];

			if (!state.transitionToFirst && previous === -1) {
				transitionFn(1, 1, { current: current, previous: previous });
			} else {
				animTransition = Q.Animation.play(
					transitionFn,
					transition.duration,
					transition.ease,
					{ current: current, previous: previous }
				);
			}

			animPreviousInterval = animInterval;
			animInterval = Q.Animation.play(
				intervals[interval.type || ""],
				interval.duration,
				interval.ease,
				{ current: current, previous: previous }
			);

			nextDeadline = Date.now() + interval.duration;
			preloadNext();

			if (keepGoing) {
				tm = setTimeout(function () {
					nextDeadline = null;
					gallery.next(true);
				}, interval.duration - transition.duration);
			}
		},
		play: function () { this.next(true); },
		pause: function () {
			clearTimeout(tm);
			animTransition && animTransition.pause();
			animInterval && animInterval.pause();
		}
	};

	rebuildTimeline();

	function bootstrap() {
		if (!mediaItems.length) return;

		var first = mediaItems[0];

		function start() {
			state.autoplay ? gallery.play() : gallery.next(false);
		}

		if (first.type === 'image') {
			loadImage(first.index, start);
		} else {
			loadVideo(first.index, start);
		}
	}

	bootstrap();

	$this.data('gallery', gallery);

	$this.on(Q.Pointer.fastclick, ".Q_gallery_volume", function () {
		var $btn = $(this);
		var on = $btn.attr("data-type") === "on";
		var volume = on ? 0 : 1;

		var item = mediaItems[current];
		if (item && item.type === 'video' && item.player) {
			try {
				item.player.volume(volume);
				item.player.muted(!volume);
			} catch (e) {}
		}

		$btn.attr("data-type", volume ? "on" : "off");
	});


	return this;

},
{
	images: [],
	videos: [],
	transition: { duration: 1000, ease: "smooth", type: "crossfade" },
	interval: {
		duration: 2000,
		ease: "smooth",
		type: "",
		from: { left:0, top:0, width:1, height:1 },
		to: { left:0, top:0, width:1, height:1 }
	},
	retain: undefined,
	timeToBuffer: 5000,
	autoplay: true,
	transitionToFirst: false,
	loop: true,
	onLoad: null,
	onTransition: null
},
{
	remove: function () {
		var gallery = $(this).data('gallery');
		if (!gallery) return;

		gallery.pause();

		// cleanup media
		$(this).find(
			".Q_gallery_item, img, video, .Q_gallery_caption"
		).remove();

		$(this).removeData('gallery');
	}
});

Q.Template.set(
	"Q/gallery/video",
	'<div class="Q_gallery_item">' +
	'<div class="Q_gallery_video"></div>' +
	'<div class="Q_gallery_blob"></div>' +
	'<i class="Q_gallery_volume" data-type="off"></i>' +
	'<div class="Q_gallery_caption"><h2>{{title}}</h2><p>{{description}}</p></div>' +
	'</div>'
);

})(Q, Q.jQuery, window, document);
