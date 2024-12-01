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
 *  @param {Array} [options.elements=null] Indicate the HTML elements
 *  @param {Array} [options.titles=null] Indicate the titles corresponding to the elements.
 *  @param {Boolean} [options.dontSnapScroll] Set to true to stop snapping the scroll to each item
 *  @param {Boolean} [options.forceMainThread] Force animation to happen on the main thread
 *  @param {Number}  [options.index] You can specify an index of the item to bring to the front first
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
            var title = titles[i];
            covers.appendChild(Q.element('li', {title: title}, [this]));
        });
        tool.element.appendChild(covers);
    }

    var caption = tool.element.querySelector('.Q_coverflow_caption');
    if (!caption) {
        caption = Q.element('div', {
            "class": "Q_coverflow_caption"
        });
        tool.element.appendChild(caption);
    }
    _updateCaption();
    covers.addEventListener('scroll', _updateCaption);
    function _updateCaption() {
        var rect = covers.getBoundingClientRect();
        var element = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2
        );
        var li = element.closest('li');
        var title;
        if (title = li.getAttribute('title')) {
            caption.innerText = title;
            caption.style.display = 'block';
        } else {
            caption.style.display = 'none';
        }
    }
}, 

{
    elements: [],
    dontSnapScroll: false,
    forceMainThread: false,
    index: null
}

);

})(Q, Q.jQuery);