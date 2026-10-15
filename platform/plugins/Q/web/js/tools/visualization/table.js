(function (Q, $, window, undefined) {
/**
 * Q/visualization/table tool
 *
 * Animated data table with add/remove row and column support.
 * Rows slide in from the left on add; slide out on remove.
 * Updated cells flash amber briefly.
 * Column headers are bold; data rows alternate background slightly.
 *
 * All colors use CSS custom properties so Q/style can retheme instantly.
 *
 * Receives updates via:
 *   stream.onMessage('Media/presentation/table/update', handler)
 *   stream.onEphemeral('Media/presentation/table/update', handler)
 *
 * @module Q
 * @class Q/visualization/table
 */
Q.Tool.define('Q/visualization/table', function (options) {
    var tool  = this;
    var state = tool.state;

    // Normalize here (not in each caller) so this tool renders correctly
    // regardless of which of the schema's two documented row shapes a
    // caller hands it -- the AI-proposal path (Media/presentation.js's
    // _showInlineCard), a durable-message replay, or this tool's own
    // stream-driven update() below.
    state.headers = _hasImageRows(state.rows) && state.headers && state.headers.length
        ? [''].concat(state.headers) : (state.headers || []);
    state.rows    = _normalizeRows(state.rows);

    tool.refresh();

    // Wire stream updates
    if (state.stream) {
        if (state.stream.onMessage) {
            state.stream.onMessage('Media/presentation/table/update', function (msg) {
                var d = {};
                try { d = JSON.parse(msg.fields.instructions || '{}'); } catch (e) {}
                if (d.action) tool.update(d);
            }, tool);
        }
        state.stream.onEphemeral('Media/presentation/table/update').set(function (e) {
            if (e && e.action) tool.update(e);
        }, tool);
    }
}, {
    stream:    null,
    headers:   [],
    rows:      [],
    highlight: []
}, {
    refresh: function () {
        var tool  = this;
        var state = tool.state;

        tool.element.style.setProperty('--AI-bg',       '#1a1d24');
        tool.element.style.setProperty('--AI-bg2',      '#22262f');
        tool.element.style.setProperty('--AI-accent',   '#5b8ef0');
        tool.element.style.setProperty('--AI-amber',    '#e8a020');
        tool.element.style.setProperty('--AI-text',     '#f0eee8');
        tool.element.style.setProperty('--AI-border',   'rgba(255,255,255,0.08)');
        tool.element.style.setProperty('--AI-sub',      '#9a9daa');

        var highlight = state.highlight || [];

        // background here (not just on individual rows) matters: this
        // tool's own .Media_presentation_card_screen wrapper is
        // deliberately transparent (see Q/web/css/tools/cards.css -- "the
        // card's own glass bg handles visuals"), a pattern every OTHER
        // card relies on via .Q_card's own solid background. This table's
        // markup never uses .Q_card, so without a background of its own,
        // alternating rows' near-transparent rgba(255,255,255,0.024)
        // tint shows straight through to whatever's behind the page
        // instead of lightening a solid backdrop.
        var html = '<div style="overflow-x:auto;border-radius:10px;border:1px solid var(--AI-border);'
                 + 'background:var(--AI-bg)">'
                 + '<table style="width:100%;border-collapse:collapse;font-family:system-ui;font-size:0.92rem">';

        // Header row
        if (state.headers && state.headers.length) {
            html += '<thead><tr style="background:var(--AI-bg2)">';
            state.headers.forEach(function (h) {
                html += '<th style="padding:0.75rem 1rem;text-align:left;font-weight:700;'
                      + 'color:var(--AI-text);border-bottom:2px solid var(--AI-accent);'
                      + 'white-space:nowrap">' + _escape(h) + '</th>';
            });
            html += '</tr></thead>';
        }

        // Body rows
        html += '<tbody>';
        (state.rows || []).forEach(function (row, ri) {
            var isHighlight = highlight.indexOf(ri) >= 0;
            var bg = isHighlight ? 'rgba(232,160,32,0.12)'
                   : (ri % 2 === 0 ? 'var(--AI-bg)' : 'rgba(255,255,255,0.025)');
            html += '<tr class="Q_vistable_row" data-ri="' + ri + '" '
                  + 'style="background:' + bg + ';border-bottom:1px solid var(--AI-border);'
                  + 'transition:background 0.2s">';
            (row || []).forEach(function (cell) {
                html += '<td style="padding:0.7rem 1rem;color:var(--AI-text);'
                      + (isHighlight ? 'font-weight:600;' : '')
                      + 'vertical-align:top">' + _escape(String(cell)) + '</td>';
            });
            html += '</tr>';
        });
        html += '</tbody></table></div>';

        tool.element.innerHTML = html;

        // Entry animation on each row (skipped for cell-only updates)
        if (!state._skipAnimation) {
            tool.element.querySelectorAll('.Q_vistable_row').forEach(function (tr, i) {
                tr.style.opacity    = '0';
                tr.style.transform  = 'translateX(-16px)';
                tr.style.transition = 'opacity 0.25s, transform 0.25s';
                setTimeout(function () {
                    tr.style.opacity   = '1';
                    tr.style.transform = 'none';
                }, i * 40);
            });
        }
    },

    /**
     * Apply a table mutation and re-render.
     */
    update: function (d) {
        var tool  = this;
        var state = tool.state;

        switch (d.action) {
            case 'set':
                var headers = d.headers || state.headers;
                state.headers   = _hasImageRows(d.rows) && headers && headers.length
                    ? [''].concat(headers) : (headers || []);
                state.rows      = _normalizeRows(d.rows || []);
                state.highlight = d.highlight || [];
                break;
            case 'addRow':
                if (d.rows && d.rows.length) {
                    state.rows = state.rows.concat(_normalizeRows(d.rows));
                }
                break;
            case 'removeRow':
                if (typeof d.rowIndex === 'number') {
                    state.rows.splice(d.rowIndex, 1);
                }
                break;
            case 'addCol':
                if (d.headers && d.headers[0]) state.headers.push(d.headers[0]);
                state.rows.forEach(function (row) { row.push(''); });
                break;
            case 'removeCol':
                if (typeof d.colIndex === 'number') {
                    state.headers.splice(d.colIndex, 1);
                    state.rows.forEach(function (row) { row.splice(d.colIndex, 1); });
                }
                break;
            case 'updateCell':
                if (typeof d.rowIndex === 'number' && typeof d.colIndex === 'number') {
                    if (!state.rows[d.rowIndex]) state.rows[d.rowIndex] = [];
                    state.rows[d.rowIndex][d.colIndex] = d.value || '';
                    // Rebuild HTML but skip the slide-in animation for cell updates
                    state._skipAnimation = true;
                    tool.refresh();
                    state._skipAnimation = false;
                    var rows = tool.element.querySelectorAll('.Q_vistable_row');
                    if (rows[d.rowIndex]) {
                        var cells = rows[d.rowIndex].querySelectorAll('td');
                        if (cells[d.colIndex]) {
                            var cell = cells[d.colIndex];
                            cell.style.background  = 'rgba(232,160,32,0.25)';
                            cell.style.transition  = 'background 0.6s';
                            setTimeout(function () { cell.style.background = ''; }, 700);
                        }
                    }
                    return;
                }
                break;
        }

        tool.refresh();
    },

    Q: { beforeRemove: function () {} }
});

function _escape(str) {
    return String(str)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/**
 * Normalize rows: the schema documents two row shapes -- flat cell
 * arrays (legacy/simple), and {image, cells} objects. Convert the
 * latter to a flat array too, prepending an <img> HTML string as the
 * first cell when a row has an image. Module-scope (not nested in the
 * constructor) so both the constructor and update() can use it.
 */
function _normalizeRows(rows) {
    return (rows || []).map(function (row) {
        if (Array.isArray(row)) return row;
        var cells = row.cells || [];
        if (row.image) {
            var imgHtml = '<img src="' + row.image + '" style="height:36px;width:36px;'
                + 'object-fit:cover;border-radius:4px;vertical-align:middle"'
                + ' onerror="this.style.display=\'none\'">';
            return [imgHtml].concat(cells);
        }
        return cells;
    });
}

/** True if rows are in the {image, cells} object shape, not flat arrays. */
function _hasImageRows(rows) {
    return !!(rows && rows.length && rows[0] && typeof rows[0] === 'object' && !Array.isArray(rows[0]));
}

})(Q, jQuery, window);
