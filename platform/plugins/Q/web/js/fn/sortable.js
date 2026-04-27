(function (Q, $, window, document, undefined) {

/**
 * Q Tools
 * @module Q-tools
 */

Q.Tool.jQuery('Q/sortable', function _Q_sortable(options) {

	var $this = $(this);
	var state = $this.state('Q/sortable');
	var mx, my, gx, gy, tLift, tScroll, scrollFrame, lifted, pressed;
	var $scrolling = null, ost = null, osl = null;

	state.draggable = state.draggable || '*';
	$this.off([Q.Pointer.start, '.Q_sortable']);
	$this.off([Q.Pointer.end, '.Q_sortable']);
	$this.on([Q.Pointer.start, '.Q_sortable'], state.draggable, liftHandler);
	$this.on([Q.Pointer.end, '.Q_sortable'], state.draggable, function () {
		if (tLift) clearTimeout(tLift);
		$this.off(Q.Pointer.move, moveHandler);
		Q.removeEventListener(body, Q.Pointer.move, moveHandler, false);
	});

	$('*', $this).css('-webkit-touch-callout', 'none');
	$this.off('dragstart.Q_sortable');
	$this.on('dragstart.Q_sortable', state.draggable, function () {
		if (state.draggable === '*' && this.parentNode !== $this[0]) {
			return;
		}
		return false;
	});

	state.onCancelClickEventKey = Q.Pointer.onCancelClick.set(
	function (event, extraInfo) {
		if (!extraInfo || !(
			extraInfo.comingFromSortable
			|| extraInfo.comingFromScroll
			|| extraInfo.comingFromPointerMovement
		)) {
			complete(true);
		}
		if (tLift) {
			clearTimeout(tLift);
		}
	});

	function liftHandler(event) {
		if (Q.Pointer.canceledClick
			|| $(event.target).parents('.Q_discouragePointerEvents').length
			|| $(event.target).is('.Q_discouragePointerEvents')) {
			return;
		}
		if (Q.Pointer.which(event) > 1) {
			return;
		}
		pressed = true;
		if (state.draggable === '*' && this.parentNode !== $this[0]) {
			return;
		}
		var $item = $(this);
		_setStyles(this);
		$('body')[0].preventSelections(true);
		this.preventSelections(true);

		$(document)
		.off('keydown.Q_sortable')
		.on('keydown.Q_sortable', function (e) {
			if (lifted && e.keyCode === 27) {
				complete(true, true);
				return false;
			}
		})
		.off([Q.Pointer.cancel, 'Q_sortable'])
		.off([Q.Pointer.leave, 'Q_sortable'])
		.on([Q.Pointer.cancel, 'Q_sortable'], leaveHandler)
		.on([Q.Pointer.leave, 'Q_sortable'], leaveHandler);

		function leaveHandler(event) {
			if (event.target === document) {
				complete(true);
			}
		}

		moveHandler.xStart = mx = Q.Pointer.getX(event);
		moveHandler.yStart = my = Q.Pointer.getY(event);
		var element = this;
		var sl = [], st = [];
		$body.data(dataLifted, $(this));
		$item.off(Q.Pointer.move, moveHandler)
		.on(Q.Pointer.move, moveHandler);
		Q.removeEventListener(body, [Q.Pointer.end, Q.Pointer.cancel], dropHandler);
		Q.removeEventListener(body, Q.Pointer.move, dropHandler);
		Q.addEventListener(body, [Q.Pointer.end, Q.Pointer.cancel], dropHandler, false, true);
		Q.addEventListener(body, Q.Pointer.move, moveHandler, false, true);

		$item.parents().each(function () {
			sl.push(this.scrollLeft);
			st.push(this.scrollTop);
		});
		tLift = setTimeout(function () {
			var efp = Q.Pointer.elementFromPoint(moveHandler.xStart, moveHandler.yStart), i=0, cancel = false;
			$item.parents().each(function () {
				if (this.scrollLeft !== sl[i] || this.scrollTop !== st[i]) {
					cancel = true;
					return false;
				}
				++i;
			});
			if (cancel || !pressed || !(element.contains(efp))) {
				return;
			}
			lift.call(element, event);
		}, Q.info.useTouchEvents ? state.lift.delayTouchscreen : state.lift.delay);
		state.moveHandler = moveHandler;
		state.dropHandler = dropHandler;
	}

	function lift(event) {
		if (tLift) clearTimeout(tLift);

		var $item = $(this);

		if (Q.Pointer.touchCount(event) !== 1) return;

		Q.Pointer.cancelClick(true, event, {
			comingFromSortable: true
		});

		var offset = $item.offset();
		var x = Q.Pointer.getX(event);
		var y = Q.Pointer.getY(event);

		gx = x - offset.left;
		gy = y - offset.top;

		var $placeholder = $item.clone().css({
			opacity: state.placeholderOpacity
		}).insertAfter($item);

		var $dragged = $item.clone().appendTo('body').css({
			position: 'absolute',
			left: x - gx,
			top: y - gy,
			zIndex: state.zIndex,
			opacity: state.draggedOpacity,
			pointerEvents: 'none'
		});

		$item.hide();
		_hideActions();

		// Store current position properties so complete() can restore them.
		$item.data('Q/sortable', {
			$placeholder: $placeholder,
			$dragged: $dragged,
			position: $item.css('position'),
			zIndex:   $item.css('zIndex'),
			left:     $item.css('left'),
			top:      $item.css('top')
		});

		$body.data(dataLifted, $item);

		lifted = true;

		// Fire onLift with $placeholder, $dragged, and the original pointer event.
		// Handlers such as Q/coverflow use this to freeze the ghost appearance and
		// correct its position/grab-offset for 3D-transformed items.
		Q.handle(state.onLift, $this, [$item, {
			event: event,
			$dragged: $dragged,
			$placeholder: $placeholder
		}]);

		// After onLift: if a handler corrected gx/gy via _coverflowGxOverride,
		// apply those values now so move() tracks from the right grab point.
		if (state._coverflowGxOverride !== undefined) {
			gx = state._coverflowGxOverride;
			gy = state._coverflowGyOverride;
		}
	}

	function getTarget(x, y) {
		var element = Q.Pointer.elementFromPoint(x, y);
		var $target = null;
		state.droppable = state.droppable || '*';
		var $jq = (state.droppable === '*')
			? $this.children(state.droppable)
			: $(state.droppable, $this);
		$jq.each(function () {
			if (this.contains(element)) {
				$target = $(this);
				return false;
			}
		});
		return $target;
	}

	function indicate($item, x, y) {
		var $target = getTarget(x, y);
		var data = $item.data('Q/sortable');
		if (!data) {
			return;
		}
		data.$dragged.css('pointerEvents', 'none');
		var element = Q.Pointer.elementFromPoint(x, y);
		var offset = $this.offset();
		if ($(element).closest($this).length
			|| ((x >= offset.left && x <= offset.left + $this.width()
				&& y >= offset.top && y <= offset.top + $this.height()))) {
			data.$dragged.css('pointerEvents', 'none');
		} else {
			data.$dragged.css('pointerEvents', 'auto');
		}

		var $placeholder = data.$placeholder;
		if (!$target) {
			if (state.requireDropTarget) {
				$item.after($placeholder);
			}
			return;
		}
		if ($target.is($placeholder)) {
			return;
		}

		var direction;
		var tr = $target[0].getBoundingClientRect();
		var pr = $placeholder[0].getBoundingClientRect();
		var isBefore = $target[0].isBefore($placeholder[0]);
		var intersectVertically = (tr.bottom >= pr.top && pr.bottom >= tr.top);
		var mw = Math.min(pr.width, tr.width);
		var mh = Math.min(pr.height, tr.height);
		var buffer = state.buffer || 0;
		var condition = isBefore ? (
			intersectVertically
				? x < tr.left + mw - buffer
				: y < tr.top + mh - buffer
		) : (
			intersectVertically
				? x > tr.right - mw + buffer
				: y > tr.bottom - mh + buffer
		);

		// switched: true only when the target just changed (matches original behaviour).
		// In the original this was set inside if(condition); here we compute it up-front
		// so onIndicate receives it, but only when a swap is actually happening.
		var switched = condition ? (data.$prevTarget || false) : false;

		// Fire onIndicate before placement so handlers can return false to suppress
		// the default and do their own placement (e.g. Q/coverflow centre threshold).
		// direction and switched carry the same values they would have in the original
		// post-placement call when condition is true; undefined/false when not.
		var anticipatedDirection = condition
			? (isBefore ? 'before' : 'after')
			: undefined;
		var suppressDefault = (Q.handle(state.onIndicate, $this, [$item, {
			$target: $target,
			$placeholder: $placeholder,
			$dragged: data.$dragged,
			$scrolling: $scrolling,
			direction: anticipatedDirection,
			switched: switched,
			x: x,
			y: y,
			isBefore: isBefore,
			condition: condition
		}]) === false);

		// Perform placement unless a handler suppressed the default.
		// In either case update prevTarget when a swap occurred (condition true),
		// so the next call computes switched correctly.
		if (condition) {
			if (!suppressDefault) {
				if (isBefore) {
					$placeholder.insertBefore($target);
					direction = 'before';
				} else {
					$placeholder.insertAfter($target);
					direction = 'after';
				}
			}
			// prevTarget advances whenever condition is true, regardless of who placed.
			data.$prevTarget = $target;
		}
	}

	function _hideActions() {
		state.actionsContainer = $('.Q_actions_container');
		state.actionsContainerVisibility = state.actionsContainer.css('visibility');
		state.actionsContainer.css('visibility', 'hidden');
	}

	function _restoreActions() {
		if (!state.actionsContainer) return;
		state.actionsContainer.css('visibility', state.actionsContainerVisibility);
		delete state.actionsContainer;
		delete state.actionsContainerVisibility;
	}

	function dropHandler(event) {
		pressed = false;
		$('body')[0].restoreSelections(true);
		if (!lifted) return;
		var $item = $body.data(dataLifted);
		if(Q.isEmpty($item)) return;
		moveHandler.xStart = moveHandler.yStart = null;
		complete(!getTarget(Q.Pointer.getX(event), Q.Pointer.getY(event)) && state.requireDropTarget);
	}

	function complete(revert, pointerDidntEnd) {
		if (!pressed && !lifted) return;

		_restoreActions();
		_restoreStyles();

		Q.Pointer.cancelClick(false, null, {
			comingFromSortable: true
		});
		if (!pointerDidntEnd) {
			Q.Pointer.ended();
		}
		body.restoreSelections(true);

		var $item = $body.data(dataLifted);
		if ($item) {
			$item.off(Q.Pointer.move, moveHandler);
		}
		Q.removeEventListener(body, Q.Pointer.move, moveHandler, false);
		Q.removeEventListener(body, [Q.Pointer.end, Q.Pointer.cancel], dropHandler, false);

		if (tLift) clearTimeout(tLift);
		if (tScroll) clearTimeout(tScroll);
		if (scrollFrame) cancelAnimationFrame(scrollFrame);

		$body.removeData(dataLifted);
		if (!$item) return;

		var data = $item.data('Q/sortable');
		if (!data) return;

		var params = {
			$placeholder: data.$placeholder,
			$dragged: data.$dragged,
			$scrolling: $scrolling
		};

		if (revert) {
			$item.show();
			params.direction = 0;
			params.target = null;
		} else {
			if (data.$placeholder.next()[0] === $item[0]
			|| data.$placeholder.prev()[0] === $item[0]) {
				params.direction = 0;
				params.target = null;
			} else if ($item[0].isBefore(data.$placeholder[0])) {
				params.direction = 1;
				params.target = params.$placeholder.prev()[0];
			} else {
				params.direction = -1;
				params.target = params.$placeholder.next()[0];
			}
		}

		$item.parents().each(function () {
			$(this).off('scroll.Q_sortable');
		});

		lifted = false;
		if (revert && $scrolling) {
			$scrolling.scrollLeft(osl);
			$scrolling.scrollTop(ost);
		}
		$item.css({
			position: data.position,
			zIndex: data.zIndex
		}).css({
			left: data.left,
			top: data.top
		});

		Q.handle(state.beforeDrop, $this, [$item, revert, params]);
		if (!revert) {
			$item.insertAfter(data.$placeholder).show();
		}
		data.$placeholder.hide();
		$item.removeData('Q/sortable');

		Q.handle(state.onDrop, $this, [$item, revert, params]);
		if (!revert) {
			Q.handle(state.onSuccess, $this, [$item, params]);
		}
		if (!data.$placeholder.retain) {
			data.$placeholder.remove();
		}
		if (!data.$dragged.retain) {
			data.$dragged.remove();
		}
		ost = osl = null;
		$scrolling = null;
	}

	function moveHandler(event) {
		var $item = $body.data(dataLifted), x, y;
		if (!$item) return;

		if (!Q.Pointer.started || Q.Pointer.touchCount(event) !== 1) {
			complete(true);
			return;
		}

		mx = x = Q.Pointer.getX(event);
		my = y = Q.Pointer.getY(event);

		if (Q.info.useTouchEvents && lifted) {
			event.preventDefault();
		}

		if (!Q.info.isTouchscreen && !lifted) {
			if ((moveHandler.xStart !== undefined && Math.abs(moveHandler.xStart - x) > state.lift.threshhold)
				|| (moveHandler.yStart !== undefined && Math.abs(moveHandler.yStart - y) > state.lift.threshhold)) {
				lift.call($item[0], event);
			}
		}

		if ((moveHandler.x !== undefined && Math.abs(moveHandler.x - x) > state.scroll.threshhold)
			|| (moveHandler.y !== undefined && Math.abs(moveHandler.y - y) > state.scroll.threshhold)) {
			scrolling($item, x, y);
		}
		moveHandler.x = x;
		moveHandler.y = y;

		if (lifted) {
			move($item, x, y);
			return false;
		}
	}

	var move = Q.throttle(function ($item, x, y) {
		var data = $item.data('Q/sortable');
		if (data) {
			data.$dragged.css({
				left: x - gx,
				top: y - gy
			});
		}
		removeTextSelections();
		indicate($item, x, y);
	}, 25, true);

	var removeTextSelections = Q.throttle(function () {
		var sel = window.getSelection ? window.getSelection() : document.selection;
		if (sel) {
			if (sel.removeAllRanges) {
				sel.removeAllRanges();
			} else if (sel.empty) {
				sel.empty();
			}
		}
	}, 300);

	function scrolling($item, x, y) {
		if (tScroll) clearTimeout(tScroll);
		if (!lifted) return;

		var dx = 0, dy = 0, isWindow = false;
		var beyond = false;

		$item.parents().each(function () {
			var $t = $(this);
			var isBody = $t.is('body');
			var overflow = $t.css('overflow');
			var overflowX = $t.css('overflow-x');
			var overflowY = $t.css('overflow-y');
			var scrollableX = overflowX === 'auto' || overflowX === 'scroll'
				|| (isBody && overflow !== 'visible');
			var scrollableY = overflowY === 'auto' || overflowY === 'scroll'
				|| (isBody && overflow !== 'visible');
			if (!scrollableX && !scrollableY && !isBody) return;

			var rect = this.getBoundingClientRect();
			var dist = state.scroll.distance;
			var distW = isBody
				? window.innerWidth  * state.scroll.distanceWindow
				: rect.width  * dist;
			var distH = isBody
				? window.innerHeight * state.scroll.distanceWindow
				: rect.height * dist;

			if (scrollableX) {
				if (x < rect.left + distW) {
					dx = -state.scroll.speed;
					beyond = (x < rect.left);
				} else if (x > rect.right - distW) {
					dx = state.scroll.speed;
					beyond = (x > rect.right);
				}
			}
			if (scrollableY) {
				if (y < rect.top + distH) {
					dy = -state.scroll.speed;
					beyond = (y < rect.top);
				} else if (y > rect.bottom - distH) {
					dy = state.scroll.speed;
					beyond = (y > rect.bottom);
				}
			}

			if (dx || dy) {
				$scrolling = $t;
				isWindow = isBody;
				osl = (osl === null) ? this.scrollLeft : osl;
				ost = (ost === null) ? this.scrollTop  : ost;
				return false;
			}
		});

		if (!dx && !dy) {
			if (scrollFrame) cancelAnimationFrame(scrollFrame);
			scrolling.accel = 0;
			return;
		}

		var delay = Q.info.useTouchEvents
			? state.scroll.delayTouchscreen
			: state.scroll.delay;
		tScroll = setTimeout(function () {
			function step() {
				scrolling.accel = scrolling.accel || 0;
				scrolling.accel += state.scroll.acceleration;
				scrolling.accel = Math.min(scrolling.accel, 1);
				var $s = isWindow ? $(document.body) : $scrolling;
				if (dx) $s[0].scrollLeft += dx * scrolling.accel;
				if (dy) $s[0].scrollTop  += dy * scrolling.accel;
				move($item, x, y);
				scrollFrame = requestAnimationFrame(step);
			}
			scrollFrame = requestAnimationFrame(step);
		}, beyond ? 0 : delay);
	}

	function _setStyles(elem) {
		if (!elem) return;
		state.prevWebkitUserSelect   = elem.style.webkitUserSelect;
		state.prevWebkitTouchCallout = elem.style.webkitTouchCallout;
		state.prevUserSelect         = elem.style.userSelect;
		state.prevTouchAction        = elem.style.touchAction;
		state.elem = elem;
		elem.style.webkitUserSelect   = 'none';
		elem.style.webkitTouchCallout = 'none';
		elem.style.userSelect         = 'none';
		elem.style.touchAction        = 'none';
	}

	function _restoreStyles() {
		if (!state.elem) return;
		state.elem.style.webkitUserSelect   = state.prevWebkitUserSelect;
		state.elem.style.webkitTouchCallout = state.prevWebkitTouchCallout;
		state.elem.style.userSelect         = state.prevUserSelect;
		state.elem.style.touchAction        = state.prevTouchAction;
		state.prevWebkitUserSelect = state.prevWebkitTouchCallout =
			state.prevUserSelect = state.prevTouchAction = state.elem = null;
	}

},

{
	draggable: '*',
	droppable: '*',
	zIndex: 999999,
	draggedOpacity: 0.8,
	placeholderOpacity: 0.1,
	buffer: 1,
	lift:   { delay: 300, delayTouchscreen: 300, threshhold: 10, zoom: 1.1, animate: 100 },
	scroll: { delay: 300, delayTouchscreen: 300, threshhold: 0, distance: 0.15, distanceWindow: 0.1, speed: 30, acceleration: 0.1 },
	drop:   { duration: 300 },
	requireDropTarget: true,
	onLift:     new Q.Event(),
	onIndicate: new Q.Event(),
	beforeDrop: new Q.Event(),
	onDrop:     new Q.Event(),
	onSuccess:  new Q.Event()
},
{
	remove: function () {
		var $this = $(this);
		var state = $this.state('Q/sortable');
		if (state) {
			if (state.onCancelClickEventKey) {
				Q.Pointer.onCancelClick.remove(state.onCancelClickEventKey);
			}
		}
		$this.off('.Q_sortable');
		$(document).off('keydown.Q_sortable');
		// Abort any in-progress drag cleanly
		var liftedItem = $body.data(dataLifted);
		if (liftedItem && $.contains($this[0], liftedItem[0])) {
			$body.removeData(dataLifted);
			var d = liftedItem.data('Q/sortable');
			if (d) {
				if (!d.$placeholder.retain) d.$placeholder.remove();
				if (!d.$dragged.retain)     d.$dragged.remove();
				liftedItem.show().removeData('Q/sortable');
			}
		}
	}
});

var $body = $('body');
var body = $body[0];
var dataLifted = 'Q/sortable dragging';

})(Q, Q.jQuery, window, document);