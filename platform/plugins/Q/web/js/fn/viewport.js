(function (Q, $, window, document, undefined) {

/**
 * Q Tools
 * @module Q-tools
 */

/**
 * This plugin enables the user to move & scale content inside a container using the mouse
 * and mousewheel, or touches on a touchscreen.
 * @class Q viewport
 * @constructor
 * @param {Object} [options] this object contains function parameters
 *   @param {String} [options.containerClass] any class names to add to the actions container
 *   @default ''
 *   @param {Object} [options.initial] can be used to set initial bounds of content to display inside tool.
 *   @param {Object} [options.initial.x] horizontal midpoint, from 0 to 1
 *   @param {Object} [options.initial.y] vertical midpoint, from 0 to 1
 *   @param {Object} [options.initial.scale] initial scale
 *   @param {Object} [options.initial.width="100%"] the initial width to use, if scale is empty
 *   @param {Object} [options.sensitivity] tunes how fast zooming responds
 *   @param {Number} [options.sensitivity.pinch] exponent applied to the finger-distance ratio
 *     during a pinch. 1 maps finger spread to scale 1:1 (the natural feel). Values below 1
 *     make pinch-zoom slower/less sensitive; values above 1 make it faster.
 *   @default 1
 *   @param {Number} [options.sensitivity.wheel] multiplier on the mousewheel zoom step.
 *     Values below 1 make wheel zoom slower; values above 1 make it faster.
 *   @default 1
 *   @param {Q.Event} [options.onRelease] This event triggering after viewport creation
 *   @default Q.Event()
 *   @param {Q.Event} [options.onScale] Occurs when the user scales the content
 *   @default Q.Event()
 *   @param {Q.Event} [options.onMove] Occurs when user moves the content around
 *   @default Q.Event()
 *   @param {Q.Event} [options.onUpdate] Occurs when the selection changes in any way
 *   @default Q.Event()
 */
Q.Tool.jQuery('Q/viewport',

function _Q_viewport(options) {
	var container, stretcher;
	var position = this.css('position');
	var state = this.addClass('Q_viewport').state('Q/viewport');
	var $this = $(this);
	state.oldCursor = this.css('cursor');
	this.css('cursor', 'move');
	
	if (this[0].tagName.toUpperCase() === 'IMG') {
		if (this[0].complete) {
			_continue.call(this);
		} else {
			this.on('load', _continue.bind(this));
		}
	} else {
		_continue(); // the dimensions should have already been set, don't depend on content
	}
	
	var useZoom = Q.info.isIE(0, 8);
	
	function _continue() {
		var ow = this.outerWidth(true);
		var oh = this.outerHeight(true);
		if (!state.width) { state.width = ow; }
		if (!state.height) { state.height = oh; }
		if ( this.parent('.Q_viewport_stretcher').length ) {
	        stretcher = this.parent();
	        container = stretcher.parent();
	    } else {
			container = $('<span class="Q_viewport_container" />')
			.addClass('Q_viewport_container ' + (options.containerClass || ''));
			var display = this.css('display'); // now that we added the class, get the display style
			container.css({
				'display': (display === 'inline' || display === 'inline-block') ? 'inline-block' : display,
				'zoom': 1,
				'position': position === 'static' ? 'relative' : position,
				'left': position === 'static' ? 0 : this.position().left,
				'top': position === 'static' ? 0 : this.position().top,
				'margin': '0px',
				'padding': '0px',
				'border': '0px solid transparent',
				'float': this.css('float'),
				'z-index': this.css('z-index'),
				'width': state.width + 'px',
				'height': state.height + 'px',
				'overflow': 'hidden',
				'line-height': this.css('line-height'),
				'vertical-align': this.css('vertical-align'),
				'text-align': this.css('text-align')
			})
			.insertAfter(this);
		
			stretcher = $('<div class="Q_viewport_stretcher" />')
			.appendTo(container)
			.append(this);
		}
	
		var initial = state.initial;
		var iw = ow, ih = oh, il = 0, it = 0;
		if (initial && initial.x !== undefined) {
			il -= iw * initial.x - state.width/2;
		}
		if (initial && initial.y !== undefined) {
			it -= ih * initial.y - state.height/2;
		}
	
		stretcher.css({
			'position': 'absolute',
			'overflow': 'visible',
			'padding': '0px',
			'margin': '0px',
			'left': il+'px',
			'top': it+'px',
			'width': ow+0.5+'px',
			'height': oh+0.5+'px',
		});
	
		var s = (initial && initial.scale)
			|| (state.minScale + state.maxScale) / 2
			|| 1;
		state.scale = Math.max(state.minScale, Math.min(state.maxScale, s));
		var off = stretcher.offset();
		scale(state.scale, off.left + ow/2, off.top + oh/2);

		state.$container = container;
		state.$stretcher = stretcher;

		// All gesture state lives in this single object, and the move/end listeners
		// are bound exactly once per gesture. On a touchscreen Q.Pointer.start fires
		// once per finger, so the previous code registered a second move handler when
		// the second finger landed: one handler kept panning off the single-finger
		// grab point (wrong zoom center) while the other scaled, and from the second
		// frame both scaled (zooming roughly twice as fast). Tracking the finger count
		// here and re-anchoring on every 1<->2 transition fixes both.
		var gesture = {
			active: false,    // are the move/end/cancel listeners currently bound
			mode: null,       // 'pan' | 'pinch'
			grab: null,       // {x, y} pointer baseline for panning (page coords)
			pos: null,        // {left, top} stretcher css baseline for panning
			pinchDistance: 0  // finger spacing baseline for the current pinch
		};

		function _touchCount(e) {
			return (Q.info.isTouchscreen && e.touches) ? e.touches.length : 1;
		}

		function _distance(e) {
			var tx0 = Q.Pointer.getX(e, 0), ty0 = Q.Pointer.getY(e, 0);
			var tx1 = Q.Pointer.getX(e, 1), ty1 = Q.Pointer.getY(e, 1);
			return Math.sqrt(
				Math.pow(tx1 - tx0, 2) + Math.pow(ty1 - ty0, 2)
			);
		}

		function _midpoint(e) {
			return {
				x: (Q.Pointer.getX(e, 0) + Q.Pointer.getX(e, 1)) / 2,
				y: (Q.Pointer.getY(e, 0) + Q.Pointer.getY(e, 1)) / 2
			};
		}

		function _beginPan(e) {
			gesture.mode = 'pan';
			gesture.grab = {
				x: Q.Pointer.getX(e),
				y: Q.Pointer.getY(e)
			};
			gesture.pos = {
				left: parseFloat(stretcher.css('left')),
				top: parseFloat(stretcher.css('top'))
			};
		}

		function _beginPinch(e) {
			gesture.mode = 'pinch';
			gesture.pinchDistance = _distance(e);
		}

		function _moveHandler(e) {
			if (Q.Pointer.isPressed(e)) {
				Q.Pointer.cancelClick(true, e, null); // even on the slightest move
			}
			e.preventDefault();

			if (_touchCount(e) > 1) {
				// pinch-zoom
				if (gesture.mode !== 'pinch' || !gesture.pinchDistance) {
					// just transitioned into a two-finger gesture: set the baseline
					// this frame and don't scale yet, so there's no jump
					_beginPinch(e);
					return;
				}
				var mid = _midpoint(e);
				var newDistance = _distance(e);
				var factor = state.scale
					* Math.pow(newDistance / gesture.pinchDistance, (state.sensitivity && state.sensitivity.pinch) || 1);
				scale(factor, mid.x, mid.y);
				gesture.pinchDistance = newDistance;
				return;
			}

			// single-finger / mouse pan
			if (gesture.mode !== 'pan' || !gesture.grab) {
				// first move, or dropped back from a pinch to one finger:
				// re-anchor so the content doesn't jump
				_beginPan(e);
				return;
			}
			if (!Q.info.isTouchscreen
			&& Q.Pointer.which(e) !== Q.Pointer.which.LEFT) {
				return;
			}
			var f = useZoom ? state.scale : 1;
			var newPos = {
				left: gesture.pos.left + (Q.Pointer.getX(e) - gesture.grab.x) / f,
				top: gesture.pos.top + (Q.Pointer.getY(e) - gesture.grab.y) / f
			};
			fixPosition(newPos);
			stretcher.css(newPos);
			Q.handle(state.onMove, $this, [state.selection, state.scale]);
			Q.handle(state.onUpdate, $this, [state.selection, state.scale]);
		}

		function _endHandler(e) {
			var remaining = (Q.info.isTouchscreen && e.touches) ? e.touches.length : 0;
			if (remaining >= 2) {
				// a finger lifted but two or more remain: keep pinching, re-baselined
				_beginPinch(e);
				e.preventDefault();
				return;
			}
			if (remaining === 1) {
				// one finger left after a pinch: keep panning with it, re-anchored
				_beginPan(e);
				e.preventDefault();
				return;
			}
			_teardown();
			e.preventDefault();
		}

		function _cancelHandler(e) {
			_teardown();
			if (e && e.preventDefault) {
				e.preventDefault();
			}
		}

		function _teardown() {
			gesture.active = false;
			gesture.mode = null;
			gesture.grab = gesture.pos = null;
			gesture.pinchDistance = 0;
			Q.removeEventListener(container[0], Q.Pointer.move, _moveHandler, {passive: false});
			Q.removeEventListener(window, Q.Pointer.end, _endHandler, {passive: false});
			Q.removeEventListener(window, Q.Pointer.cancel, _cancelHandler, {passive: false});
		}

		container.on('dragstart', function () {
			return false;
		}).on(Q.Pointer.start, function (e) {
			if (Q.Pointer.canceledClick) {
				return;
			}
			// (re)establish the right baseline for however many fingers are down now
			if (_touchCount(e) > 1) {
				_beginPinch(e);
			} else {
				_beginPan(e);
			}
			// bind the move/end/cancel listeners exactly once for the whole gesture
			if (!gesture.active) {
				gesture.active = true;
				Q.addEventListener(container[0], Q.Pointer.move, _moveHandler, {passive: false});
				Q.addEventListener(window, Q.Pointer.end, _endHandler, {passive: false});
				Q.addEventListener(window, Q.Pointer.cancel, _cancelHandler, {passive: false});
			}
		});

		// this is for ios devices only
		// for some reason photo from camera displayed with bottom gap. Need to process touchstart handler to normalize.
		if (state.initial && state.initial.width && !state.initial.scale) {
			var $img = this;
			$img.width(state.initial.width);
			if (Q.info.isTouchscreen) {
				setTimeout(function () { $img.width("100%") }, 200);
			}
		}

		container.on(Q.Pointer.wheel, function (e) {
			if (Q.Pointer.started) {
				return;
			}
			if (typeof e.deltaY === 'number' && !isNaN(e.deltaY)) {
				scale(
					state.scale - e.deltaY * 0.001 * ((state.sensitivity && state.sensitivity.wheel) || 1),
					Q.Pointer.getX(e),
					Q.Pointer.getY(e)
				);
			}
			return false;
		});
	}
	
	function scale(factor, x, y) {
		if (state.maxScale > 0) {
			factor = Math.min(state.maxScale, factor);
		}
		factor = Math.max(0, state.minScale, factor);
		var cw = container.width();
		var ch = container.height();
		var sw = stretcher.width();
		var sh = stretcher.height();
		var f = useZoom ? state.scale : 1;
		var w = sw*factor/f;
		var h = sh*factor/f;
		if (w < cw || h < ch) { // don't let it get too small
			factor = Math.max(cw / sw * f, ch / sh * f);
		}
		var df = factor / state.scale - 1;
		var left1, top1, css;
		var offset = stretcher.offset();
		left1 = parseFloat(stretcher.css('left')) * f;
		top1 = parseFloat(stretcher.css('top')) * f;
		left1 -= (x - offset.left) * df;
		top1 -= (y - offset.top) * df;
		if (!useZoom) {
			css = { 
				left: left1,
				top: top1,
				transform: 'scale('+factor+')',
				transformOrigin: '0% 0%'
			};
			fixPosition(css);
			for (var k in css) {
				css[Q.info.browser.prefix+k] = css[k];
			}
			stretcher.css(css);
		} else if (!scale.inProgress) {
			scale.inProgress = true;
			css = {
				left: left1 / factor,
				top: top1 / factor,
				zoom: factor
			};
			fixPosition(css);
			stretcher.css(css);
			scale.inProgress = false;
		}
		if (state.scale !== factor) {
			Q.handle(state.onScale, $this, [state.selection, state.scale]);
			Q.handle(state.onUpdate, $this, [state.selection, state.scale]);
		}
		state.scale = factor;
	}
	
	function fixPosition(pos) {
		var s = state.scale;
		var f = useZoom ? s : 1;
		var cw = container.width();
		var ch = container.height();
		var w = stretcher.width()*s/f;
		var h = stretcher.height()*s/f;
		var w2 = cw/f - w;
		var h2 = ch/f - h;
		var left = Math.min(0, Math.max(parseFloat(pos.left), w2+1));
		var top = Math.min(0, Math.max(parseFloat(pos.top), h2+1));
		pos.left = left + 'px';
		pos.top = top + 'px';
		state.selection = {
			left: -left/w,
			top: -top/h,
			width: cw/w,
			height: ch/h
		};
	}
},

{	// default options:
	containerClass: '', // any class names to add to the actions container
	initial: {
		width: '100%'
	},
	scale: 1,
	minScale: null,
	maxScale: 2,
	width: null,
	height: null,
	sensitivity: {
		pinch: 1, // exponent on the finger-distance ratio; 1 = natural 1:1 feel
		wheel: 1  // multiplier on the wheel zoom step; <1 = slower
	},
	onRelease: new Q.Event(),
	onScale: new Q.Event(),
	onMove: new Q.Event(),
	onUpdate: new Q.Event()
},

{
	remove: function () {
		this.css('cursor', this.state('Q/viewport').oldCursor);
	}
}

);

})(Q, Q.jQuery, window, document);