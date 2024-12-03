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
        covers = Q.element('ul', {
            "class": "Q_coverflow_covers"
        });
        var titles = state.titles || [];
        Q.each(state.elements, function (i) {
            var title = titles[i] || this.title || this.getAttribute('title');
            covers.appendChild(Q.element('li', {title: title}, [this]));
        });
        tool.element.appendChild(covers);
    }
    
    var stoppedWiggling = Q.debounce(function () {
        wiggling = false;
    }, 100);
    var wiggling = false;
    var m = state.scrollOnMouseMove;
    if (m) {
        covers.addEventListener('mousemove', function (e) {
            tool.element.removeClass('Q_coverflow_snapping');
            covers.scrollLeft += e.movementX * m;
            wiggling = true;
            stoppedWiggling();
            // tool.element.addClass('Q_coverflow_snapping');
        });
        covers.addEventListener('scroll', function () {
            if (!wiggling && !state.dontSnapScroll) {
                tool.element.addClass('Q_coverflow_snapping');
            }
        });
    }

    var caption = tool.element.querySelector('.Q_coverflow_caption');
    if (!caption) {
        caption = Q.element('div', {
            "class": "Q_coverflow_caption"
        });
        tool.element.appendChild(caption);
        $(caption).plugin('Q/textfill');
    }
    _updateCaption();
    var ival = setInterval(function () {
        if (_updateCaption()) {
            clearInterval(ival);
        }
    }, 100);
    setTimeout(_updateCaption, 100);
    covers.addEventListener('scroll', _updateCaption);
    function _updateCaption() {
        var rect = covers.getBoundingClientRect();
        var element = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2
        );
        var li = element.closest('li');
        var title;
        if (!li) {
            return false; // probably because nothing has rendered yet
        }
        if (title = li.getAttribute('title')) {
            caption.innerText = title;
            caption.style.display = 'block';
        } else {
            caption.style.display = 'none';
        }
        $(caption).plugin('Q/textfill', 'refresh');
        return true;
    }
}, 

{
    elements: [],
    dontSnapScroll: false,
    index: null,
    scrollOnMouseMove: 0,
    scrollerOnMouseMove: false,
    onInvoke: new Q.Event()
}

);

})(Q, Q.jQuery);