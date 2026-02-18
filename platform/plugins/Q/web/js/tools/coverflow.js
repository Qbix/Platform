(function (Q, $) {
/**
 * @module Q-tools
 */
    
/**
 * Implements an Apple-style "cover flow" effect based on this demo:
 * https://scroll-driven-animations.style/demos/cover-flow/css/
 * @class Q coverflow
 * @constructor
 * @param {Object}   [options] Override various options for this tool
 *  @param {Array} [options.elements=null] Indicate the HTML elements. The elements may have a "title"
 *    attribute, in which case it is used unless the titles option is specified.
 *  @param {Array} [options.titles=null] Indicate the titles corresponding to the elements.

 *  @param {Boolean} [options.dontSnapScroll] Set to true to stop snapping the scroll to each item
 *  @param {integer}  [options.index] You can specify an index of the item to bring to the front first
 *  @param {Number} [options.scrollOnMouseMove=0] Scroll factor between 0 and 1 when mousemove happens if (not touchscreen)
 *  @param {Number}  [options.index] You can specify an index of the item to bring to the front first
 *  @param {Q.Event} [options.onInvoke] Triggered when the middle item was clicked
 * @return {Q.Tool}
 */
Q.Tool.define("Q/coverflow", function _Q_coverflow(options) {
    var tool = this;
    var state = tool.state;

    if (!state.dontSnapScroll) {
        tool.element.addClass('Q_coverflow_snapping');
    }

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

    // ---- smooth snap re-enable (prevents jitter) ----
    var snapTimer = null;
    function enableSnapSoon() {
        if (state.dontSnapScroll) return;
        clearTimeout(snapTimer);
        snapTimer = setTimeout(function () {
            tool.element.addClass('Q_coverflow_snapping');
        }, 120);
    }
    function disableSnapNow() {
        tool.element.removeClass('Q_coverflow_snapping');
        clearTimeout(snapTimer);
    }

    // ---- caption ----
    var caption = tool.element.querySelector('.Q_coverflow_caption');
    if (!caption) {
        caption = Q.element('div', { "class": "Q_coverflow_caption" });
        tool.element.appendChild(caption);
        $(caption).plugin('Q/textfill');
    }

    var updateCaption = Q.throttle(function _updateCaption() {
        var rect = covers.getBoundingClientRect();
        var element = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2
        );
        if (!element) return;
        var li = element.closest('li');
        if (!li) return;
        var title = li.getAttribute('title');
        if (title) {
            caption.innerText = title;
            caption.style.display = 'block';
        } else {
            caption.style.display = 'none';
        }
        $(caption).plugin('Q/textfill', 'refresh');
    }, 50);

    updateCaption();
    var ival = setInterval(function () {
        if (updateCaption()) clearInterval(ival);
    }, 100);
    setTimeout(updateCaption, 100);

    // ---- coverflow rotation (real Cover Flow effect) ----
    var updateCovers = Q.throttle(function () {
        var rect = covers.getBoundingClientRect();
        var cx = rect.left + rect.width / 2;

        var items = covers.querySelectorAll('li');
        for (var i = 0; i < items.length; i++) {
            var li = items[i];
            var r = li.getBoundingClientRect();
            var itemCx = r.left + r.width / 2;

            var norm = (itemCx - cx) / (rect.width / 2);
            if (norm < -1) norm = -1;
            if (norm > 1) norm = 1;

            var rotateY = norm * 60;           // degrees
            var depth   = (1 - Math.abs(norm)) * 120; // px
            var scale   = 1 + (1 - Math.abs(norm)) * 0.25;

            var img = li.querySelector('img');
            if (!img) continue;

            img.style.transform =
                'perspective(900px) translateZ(' + depth + 'px) ' +
                'rotateY(' + rotateY + 'deg) scale(' + scale + ')';

            li.style.zIndex = Math.round(1000 * (1 - Math.abs(norm)));
        }
    }, 16);

    covers.addEventListener('scroll', function () {
        updateCaption();
        updateCovers();
        enableSnapSoon();
    }, { passive: true });

    // ---- single scroll controller: pointer drag only ----
    if (!state.dragScrollOnlyOnTouchscreens) {
        var slider = covers;
        var isDown = false;
        var startX;
        var startScrollLeft;

        slider.addEventListener("pointerdown", function (e) {
            isDown = true;
            slider.classList.add("active");
            startX = e.pageX;
            startScrollLeft = slider.scrollLeft;
            disableSnapNow();
            slider.setPointerCapture && slider.setPointerCapture(e.pointerId);
        });

        slider.addEventListener("pointerup", function (e) {
            isDown = false;
            slider.classList.remove("active");
            enableSnapSoon();
            slider.releasePointerCapture && slider.releasePointerCapture(e.pointerId);
        });

        slider.addEventListener("pointerleave", function () {
            isDown = false;
            slider.classList.remove("active");
            enableSnapSoon();
        });

        slider.addEventListener("pointermove", function (e) {
            if (!isDown) return;
            e.preventDefault();
            var dx = e.pageX - startX;
            slider.scrollLeft = startScrollLeft - dx;
        }, { passive: false });
    }

}, 
{
    elements: [],
    dontSnapScroll: false,
    index: null,
    dragScrollOnlyOnTouchscreens: false,
    scrollOnMouseMove: 0,   // intentionally ignored to prevent jitter
    scrollerOnMouseMove: false,
    onInvoke: new Q.Event()
});

})(Q, Q.jQuery);