(function (Q, $, window, undefined) {
/**
 * @module Q-tools
 */

// Offscreen canvas for measuring text width independent of DOM layout/
// visibility state -- see _fitValueToCard below.
var _measureCtx = null;
function _measureTextWidth(text, font) {
    if (!_measureCtx) {
        _measureCtx = document.createElement('canvas').getContext('2d');
    }
    _measureCtx.font = font;
    return _measureCtx.measureText(text).width;
}
function _fontStringFor(el) {
    var cs = getComputedStyle(el);
    return cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
}

/**
 * Single-metric stat card with optional animated counter.
 *
 * @class Q/card/stat
 * @constructor
 * @param {Object} [options]
 * @param {String|Number} options.value
 * @param {String} [options.unit]          Unit appended to value e.g. "B", "%"
 * @param {String} options.label
 * @param {String|Number} [options.delta]  Change e.g. "+12%" or "-3"
 * @param {Boolean} [options.deltaPositive]
 * @param {String} [options.source]
 * @param {String} [options.url]
 * @param {Boolean} [options.animate=true]
 * @param {Number}  [options.animateMs=800]
 * @param {Q.Event} [options.onRefresh]
 */
Q.Tool.define("Q/card/stat", function () { 
    this.refresh();
},
{
    value: '', unit: '', label: '', delta: '', deltaPositive: null,
    source: '', url: '', animate: true, animateMs: 800,
    onRefresh: new Q.Event()
},
{
    refresh: function () {
        var tool = this, s = tool.state;
        // Coerce string values from stream attributes
        if (s.deltaPositive === 'true')  s.deltaPositive = true;
        if (s.deltaPositive === 'false') s.deltaPositive = false;
        var numeric = parseFloat(String(s.value).replace(/[^0-9.-]/g, ''));
        var hasNumeric = !isNaN(numeric);
        var deltaClass = s.deltaPositive === true  ? 'Q_card_delta_positive'
                       : s.deltaPositive === false ? 'Q_card_delta_negative' : '';
        Q.Template.render('Q/card/stat', {
            value: s.value, unit: s.unit, label: s.label,
            delta: s.delta, deltaClass: deltaClass,
            hasDelta: !!s.delta, source: s.source, url: s.url,
            hasSource: !!(s.source || s.url)
        }, function (err, html) {
            if (err) return;
            tool.element.innerHTML = html;
            if (s.animate && hasNumeric) {
                var $val = $(tool.element).find('.Q_card_value_number');
                var startTime = null;
                function step(ts) {
                    if (!startTime) startTime = ts;
                    var p = Math.min((ts - startTime) / s.animateMs, 1);
                    var eased = 1 - Math.pow(1 - p, 3);
                    var cur = numeric * eased;
                    $val.text((numeric % 1 === 0 ? Math.round(cur).toLocaleString() : cur.toFixed(1)) + (s.unit ? '' : ''));
                    if (p < 1) requestAnimationFrame(step);
                }
                requestAnimationFrame(step);
            }
            tool._fitValueToCard();
            Q.handle(s.onRefresh, tool);
        });
    },

    /**
     * Shrink .Q_card_value_number (and its unit) if the value is wider
     * than the card -- Q_card_value_number's font-size is a plain
     * clamp(min, Nvw, max) with no awareness of the VALUE STRING's own
     * length, so a short value ("61%") and a long one ("39,535,849", an
     * 11-character population figure) get the exact same huge font-size.
     * A number has no spaces, so (unlike the label) it can't line-wrap to
     * avoid overflowing -- it just runs past the card's edge.
     *
     * Measures the FINAL text (state.value/state.unit) via an offscreen
     * canvas rather than reading the live element's current text/width --
     * when animate+hasNumeric, refresh()'s count-up animation is still
     * running at this point (its first requestAnimationFrame callback
     * races this method's own async ResizeObserver callback below, with
     * no guaranteed order), showing a shorter intermediate value that
     * would under-measure and under-shrink the font, letting the full
     * final number overflow anyway once the count finishes.
     *
     * The ResizeObserver itself is still needed for a different reason:
     * refresh() can run before cardEl is even attached to the document
     * (see presentation.js's _showInlineCard), where clientWidth reads 0.
     * @method _fitValueToCard
     */
    _fitValueToCard: function () {
        var tool = this, s = tool.state;
        var numberEl = tool.element.querySelector('.Q_card_value_number');
        var unitEl   = tool.element.querySelector('.Q_card_value_unit');
        var cardEl   = tool.element.querySelector('.Q_card_stat') || tool.element;
        if (!numberEl || !cardEl || typeof ResizeObserver === 'undefined') return;
        if (tool._fitValueObserver) tool._fitValueObserver.disconnect();
        var done = false;
        var ro = tool._fitValueObserver = new ResizeObserver(function () {
            if (done) return;
            var width = cardEl.clientWidth;
            if (!width) return; // not really laid out/attached yet
            done = true;
            ro.disconnect();
            var cs = getComputedStyle(cardEl);
            var available = width - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);
            if (available <= 0) return;
            var gap = parseFloat(getComputedStyle(numberEl.parentNode).gap) || 0;
            var natural = _measureTextWidth(String(s.value), _fontStringFor(numberEl));
            if (unitEl) {
                natural += gap + _measureTextWidth(String(s.unit), _fontStringFor(unitEl));
            }
            if (natural > available) {
                var scale = available / natural;
                numberEl.style.fontSize = (parseFloat(getComputedStyle(numberEl).fontSize) * scale) + 'px';
                if (unitEl) {
                    unitEl.style.fontSize = (parseFloat(getComputedStyle(unitEl).fontSize) * scale) + 'px';
                }
            }
        });
        ro.observe(cardEl);
        // Give up (rather than hang forever observing) if it never gets a
        // real size at all -- e.g. removed before ever being attached.
        setTimeout(function () { if (!done) { done = true; ro.disconnect(); } }, 2000);
    },

    Q: {
        beforeRemove: function () {
            if (this._fitValueObserver) this._fitValueObserver.disconnect();
        }
    }
});

Q.Template.set('Q/card/stat',
    '<div class="Q_card Q_card_stat">'
  + '  <div class="Q_card_value">'
  + '    <span class="Q_card_value_number">{{value}}</span>'
  + '    {{#if unit}}<span class="Q_card_value_unit">{{unit}}</span>{{/if}}'
  + '  </div>'
  + '  {{#if hasDelta}}<div class="Q_card_delta {{deltaClass}}">{{delta}}</div>{{/if}}'
  + '  <div class="Q_card_label">{{label}}</div>'
  + '  {{#if hasSource}}<div class="Q_card_source">'
  + '    {{#if url}}<a href="{{url}}" target="_blank" rel="noopener">{{source}}</a>'
  + '    {{else}}{{source}}{{/if}}'
  + '  </div>{{/if}}'
  + '</div>'
);
})(Q, Q.jQuery, window);
