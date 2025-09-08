(function (Q, $) {
/**
 * @module Q-tools
 */

/**
 * Apple-style "cover flow" with cross-browser fallbacks.
 * @class Q coverflow
 * @constructor
 * @param {Object}   [options]
 *  @param {Array} [options.elements=[]] Elements to display. Each may have a "title" attribute.
 *  @param {Array} [options.titles=[]] Titles corresponding to elements.
 *  @param {Boolean} [options.dontSnapScroll=false] Disable scroll snapping.
 *  @param {Boolean} [options.dragScrollOnlyOnTouchscreens=false] Disable drag scroll on desktop.
 *  @param {Number} [options.scrollOnMouseMove=0] Factor (0–1) for scroll by mouse movement.
 *  @param {Q.Event} [options.onInvoke] Fired when the center item is clicked.
 */
Q.Tool.define("Q/coverflow", function _Q_coverflow(options) {
	var tool = this;
	var state = tool.state;

	// -----------------------------------------------------
	// Build DOM
	// -----------------------------------------------------
	var covers = tool.element.querySelector('.Q_coverflow_covers');
	if (!covers) {
		covers = Q.element('ul', { "class": "Q_coverflow_covers" });
		var titles = state.titles || [];
		Q.each(state.elements, function (i) {
			var title = titles[i] || this.title || this.getAttribute('title');
			covers.appendChild(Q.element('li', { title: title }, [this]));
		});
		tool.element.appendChild(covers);
	}

	var caption = tool.element.querySelector('.Q_coverflow_caption');
	if (!caption) {
		caption = Q.element('div', { "class": "Q_coverflow_caption" });
		tool.element.appendChild(caption);
		$(caption).plugin('Q/textfill');
	}

	// -----------------------------------------------------
	// Scroll snapping (native CSS) fallback
	// -----------------------------------------------------
	if (!state.dontSnapScroll) {
		covers.classList.add('Q_coverflow_snapping');
		covers.style.scrollSnapType = "x mandatory";
	}

	// -----------------------------------------------------
	// ScrollTimeline polyfill / native detection
	// -----------------------------------------------------
	if (!('ScrollTimeline' in window)) {
		// load polyfill only if needed
		Q.addScript('{{Q}}/js/polyfills/ScrollTimeline.min.js');
	}

	// -----------------------------------------------------
	// Caption updater
	// -----------------------------------------------------
	function _updateCaption() {
		var rect = covers.getBoundingClientRect();
		var element = document.elementFromPoint(
			rect.left + rect.width / 2,
			rect.top + rect.height / 2
		);
		if (!element) return false;
		var li = element.closest('li');
		if (!li) return false;
		var title = li.getAttribute('title');
		if (title) {
			caption.innerText = title;
			caption.style.display = 'block';
		} else {
			caption.style.display = 'none';
		}
		$(caption).plugin('Q/textfill', 'refresh');
		return true;
	}
	covers.addEventListener('scroll', _updateCaption);
	setTimeout(_updateCaption, 100);

	// -----------------------------------------------------
	// Optional: scroll by mouse movement (desktop only)
	// -----------------------------------------------------
	if (state.scrollOnMouseMove && !Q.isTouchDevice()) {
		var stoppedWiggling = Q.debounce(function () {
			wiggling = false;
		}, 100);
		var wiggling = false;

		covers.addEventListener('mousemove', function (e) {
			covers.classList.remove('Q_coverflow_snapping');
			covers.scrollLeft += e.movementX * state.scrollOnMouseMove;
			wiggling = true;
			stoppedWiggling();
		});

		covers.addEventListener('scroll', function () {
			if (!wiggling && !state.dontSnapScroll) {
				covers.classList.add('Q_coverflow_snapping');
			}
		});
	}

	// -----------------------------------------------------
	// Drag-to-scroll (desktop only unless overridden)
	// -----------------------------------------------------
	if (!state.dragScrollOnlyOnTouchscreens && !Q.isTouchDevice()) {
		var slider = covers;
		var isDown = false, startX, scrollLeft;

		slider.addEventListener("pointerdown", function (e) {
			isDown = true;
			startX = e.pageX - slider.offsetLeft;
			scrollLeft = slider.scrollLeft;
			slider.classList.add("active");
		});
		slider.addEventListener("pointerleave", function () {
			isDown = false;
			slider.classList.remove("active");
		});
		slider.addEventListener("pointerup", function () {
			isDown = false;
			slider.classList.remove("active");
		});
		slider.addEventListener("pointermove", function (e) {
			if (!isDown) return;
			e.preventDefault();
			var x = e.pageX - slider.offsetLeft;
			var walk = (x - startX) * 3; // scroll faster
			slider.scrollLeft = scrollLeft - walk;
		});
	}

	// -----------------------------------------------------
	// Handle click to invoke
	// -----------------------------------------------------
	covers.addEventListener('click', function (e) {
		var rect = covers.getBoundingClientRect();
		var center = document.elementFromPoint(
			rect.left + rect.width / 2,
			rect.top + rect.height / 2
		);
		if (center && center.contains(e.target)) {
			state.onInvoke.handle(e, { target: center });
		}
	});

}, {
	elements: [],
	titles: [],
	dontSnapScroll: false,
	dragScrollOnlyOnTouchscreens: false,
	scrollOnMouseMove: 0,
	onInvoke: new Q.Event()
});

})(Q, Q.jQuery);