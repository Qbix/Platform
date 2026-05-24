(function (Q, $, window, undefined) {
/**
 * @module Q-tools
 */
/**
 * Horizontal ranked bar chart.
 *
 * Uses tool.rendering() for efficient in-place updates.
 * Bar widths animate via CSS transition — no JS animation loop.
 * New rows slide in from the left; removed rows slide out to the right.
 *
 * @class Q/chart/bar
 * @constructor
 * @param {Object} [options]
 * @param {Array}  options.items        [{label, value, color?}, ...]
 * @param {String} [options.title]
 * @param {String} [options.unit]       Appended to value labels e.g. "B", "%"
 * @param {true|false|Object} [options.animate=true]
 *   true uses 600ms; { duration: N } overrides; false skips animation
 * @param {String} [options.source]
 * @param {String} [options.url]
 * @param {Q.Event} [options.onRender]
 */
Q.Tool.define("Q/chart/bar", function () {
    var tool = this;
    tool.refresh();

    // Efficient partial updates — CSS transitions do the heavy lifting
    tool.rendering(['items', 'unit', 'title', 'source'],
    function (changed) {
        var s = tool.state;
        if (typeof s.items === 'string') {
            try { s.items = JSON.parse(s.items); } catch (e) { s.items = []; }
        }
        var items  = s.items  || [];
        var maxVal = _maxValue(items);
        var rowsEl = tool.elements && tool.elements.rows;
        // If DOM was never built (e.g. refresh not yet called), fall back
        if (!rowsEl) { tool.refresh(); return; }

        // Update title in-place if it changed
        if ('title' in changed && tool.elements.title) {
            tool.elements.title.textContent = s.title || '';
            tool.elements.title.style.display = s.title ? '' : 'none';
        }

        // Index existing rows by label
        var existing = {};
        rowsEl.querySelectorAll('.Q_chart_bar_row').forEach(function (row) {
            existing[row.dataset.label] = row;
        });

        // Which labels are in the new data
        var seen = {};
        items.forEach(function (item) { seen[item.label] = true; });

        // Slide out rows that are no longer present
        Object.keys(existing).forEach(function (label) {
            if (!seen[label]) {
                var row = existing[label];
                row.style.transition = 'opacity 0.25s, transform 0.25s';
                row.style.opacity    = '0';
                row.style.transform  = 'translateX(20px)';
                setTimeout(function () {
                    if (row.parentNode) row.parentNode.removeChild(row);
                }, 280);
                delete existing[label];
            }
        });

        // Update existing rows or insert new ones (in order)
        items.forEach(function (item, i) {
            var pct    = maxVal > 0 ? (+item.value / maxVal * 100) : 0;
            var valTxt = String(item.value) + (s.unit ? '\u00a0' + s.unit : '');

            if (existing[item.label]) {
                var row   = existing[item.label];
                var fill  = row.querySelector('.Q_chart_bar_fill');
                var valEl = row.querySelector('.Q_chart_bar_value');
                // fill already has transition: width ... — just change the value
                if (fill)  fill.style.width = pct + '%';
                if (fill && item.color) fill.style.background = _safeColor(item.color, '#7c3aed');
                if (valEl) valEl.textContent = valTxt;
                rowsEl.appendChild(row); // re-append maintains visual order
            } else {
                // New row — start invisible and off-left, then slide in
                var newRow  = _makeRow(item, 0, s.unit);
                var newFill = newRow.querySelector('.Q_chart_bar_fill');
                newRow.style.opacity   = '0';
                newRow.style.transform = 'translateX(-20px)';
                rowsEl.appendChild(newRow);
                // Double rAF: first puts element in layout, second starts transition
                requestAnimationFrame(function () {
                    requestAnimationFrame(function () {
                        newRow.style.transition = 'opacity 0.25s, transform 0.25s';
                        newRow.style.opacity    = '1';
                        newRow.style.transform  = 'none';
                        if (newFill) {
                            // Slight delay so entry leads the bar growth
                            setTimeout(function () {
                                newFill.style.width = pct + '%';
                            }, 100);
                        }
                    });
                });
            }
        });
    });
},
{
    items:    [],
    title:    '',
    unit:     '',
    animate:  true,   // true | false | { duration: N }
    source:   '',
    url:      '',
    onRender: new Q.Event()
},
{
    refresh: function () {
        var tool = this, s = tool.state;
        if (typeof s.items === 'string') {
            try { s.items = JSON.parse(s.items); } catch (e) { s.items = []; }
        }
        var items  = s.items  || [];
        var dur    = s.animate === true              ? 600
                   : s.animate && s.animate.duration ? s.animate.duration : 0;
        var maxVal = _maxValue(items);

        var wrapper = document.createElement('div');
        wrapper.className = 'Q_card Q_chart Q_chart_bar';

        var titleEl = document.createElement('div');
        titleEl.className    = 'Q_chart_title';
        titleEl.textContent  = s.title || '';
        titleEl.style.display = s.title ? '' : 'none';
        wrapper.appendChild(titleEl);

        var rows = document.createElement('div');
        rows.className = 'Q_chart_bar_rows';
        wrapper.appendChild(rows);

        if (s.source) {
            var src = document.createElement('div');
            src.className = 'Q_card_source';
            src.innerHTML = s.url
                ? '<a href="' + String(s.url).encodeHTML()
                  + '" target="_blank" rel="noopener">' + String(s.source).encodeHTML() + '</a>'
                : String(s.source).encodeHTML();
            wrapper.appendChild(src);
        }

        tool.element.innerHTML = '';
        tool.element.appendChild(wrapper);
        tool.elements       = tool.elements || {};
        tool.elements.title = titleEl;
        tool.elements.rows  = rows;

        items.forEach(function (item, i) {
            var pct = maxVal > 0 ? (+item.value / maxVal * 100) : 0;
            var row = _makeRow(item, 0, s.unit); // bars start at 0 for grow-in
            rows.appendChild(row);
            var fill = row.querySelector('.Q_chart_bar_fill');
            if (dur > 0) {
                // Stagger each bar so they grow in sequence
                (function (f, targetPct) {
                    setTimeout(function () { f.style.width = targetPct + '%'; }, 30 + i * 60);
                })(fill, pct);
            } else {
                fill.style.width = pct + '%';
            }
        });

        Q.handle(s.onRender, tool);
    },

    /** Spotlight a bar by 0-based index or label substring */
    highlight: function (elementId) {
        var $el = $(this.element);
        $el.find('.Q_highlighted').removeClass('Q_highlighted');
        var idx = parseInt(elementId, 10);
        if (!isNaN(idx)) {
            $el.find('.Q_chart_bar_row').eq(idx).addClass('Q_highlighted');
        } else {
            $el.find('.Q_chart_bar_row').each(function () {
                if ($(this).find('.Q_chart_bar_label').text().toLowerCase()
                           .indexOf(elementId.toLowerCase()) >= 0) {
                    $(this).addClass('Q_highlighted');
                }
            });
        }
    }
});

// ── Module helpers ──────────────────────────────────────────────────────────────

/**
 * Build a single bar row element.
 * The fill div has a permanent CSS transition on width — any subsequent
 * style.width assignment will animate automatically.
 */
function _makeRow(item, pct, unit) {
    var row = document.createElement('div');
    row.className    = 'Q_chart_bar_row';
    row.dataset.label = item.label;

    var labelEl = document.createElement('div');
    labelEl.className   = 'Q_chart_bar_label';
    labelEl.textContent = item.label;

    var track = document.createElement('div');
    track.className = 'Q_chart_bar_track';

    var fill = document.createElement('div');
    fill.className      = 'Q_chart_bar_fill';
    fill.style.width      = pct + '%';
    fill.style.background = _safeColor(item.color, '#7c3aed');
    // Permanent transition — width changes always animate
    fill.style.transition = 'width 500ms cubic-bezier(0.16,1,0.3,1)';
    track.appendChild(fill);

    var valEl = document.createElement('div');
    valEl.className   = 'Q_chart_bar_value';
    valEl.textContent = String(item.value) + (unit ? '\u00a0' + unit : '');

    row.appendChild(labelEl);
    row.appendChild(track);
    row.appendChild(valEl);
    return row;
}

function _maxValue(items) {
    var max = 0;
    (items || []).forEach(function (d) { if (+d.value > max) max = +d.value; });
    return max;
}

function _safeColor(color, fallback) {
    if (!color) return fallback;
    var s = String(color).trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(s))  return s;
    if (/^rgba?\([^)]{0,60}\)$/.test(s)) return s;
    if (/^hsla?\([^)]{0,60}\)$/.test(s)) return s;
    if (/^[a-zA-Z]{1,32}$/.test(s))       return s;
    return fallback;
}

})(Q, Q.jQuery, window);
