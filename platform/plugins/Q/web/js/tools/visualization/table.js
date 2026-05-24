(function (Q, $, window, undefined) {
/**
 * @module Q-tools
 */
/**
 * Animated data table.
 *
 * Uses tool.rendering() for full data updates (staggered row slide-in).
 * Uses targeted DOM methods for incremental mutations:
 *   _addRows()    — slides new rows in from the left
 *   _removeRow()  — slides the row out, then removes
 *   _patchCell()  — flashes the cell amber, no rebuild
 *
 * All colors are CSS custom properties — Q/style events retheme instantly.
 *
 * @class Q/visualization/table
 * @constructor
 * @param {Object} [options]
 * @param {Object} [options.stream]     Streams.Stream for live updates
 * @param {Array}  [options.headers]    Column header strings
 * @param {Array}  [options.rows]       Array of row arrays
 * @param {Array}  [options.highlight]  Row indices to highlight
 * @param {true|false|Object} [options.animate=true]
 *   true uses defaults; { duration: N } overrides; false skips
 */
Q.Tool.define('Q/visualization/table', function (options) {
    var tool  = this;
    var state = tool.state;

    state.headers = state.headers || [];
    state.rows    = state.rows    || [];

    tool.refresh();

    // Full data replacement — staggered slide-in on all rows
    tool.rendering(['rows', 'headers', 'highlight'], function () {
        tool._rebuildBody();
    });

    // Wire stream events
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
    highlight: [],
    animate:   true   // true | false | { duration: N }
}, {
    refresh: function () {
        var tool  = this;
        var state = tool.state;

        // CSS custom properties — rethemeable via Q/style
        tool.element.style.setProperty('--AI-bg',     '#1a1d24');
        tool.element.style.setProperty('--AI-bg2',    '#22262f');
        tool.element.style.setProperty('--AI-accent', '#5b8ef0');
        tool.element.style.setProperty('--AI-amber',  '#e8a020');
        tool.element.style.setProperty('--AI-text',   '#f0eee8');
        tool.element.style.setProperty('--AI-border', 'rgba(255,255,255,0.08)');
        tool.element.style.setProperty('--AI-sub',    '#9a9daa');

        tool.element.innerHTML = '';

        var scroll = document.createElement('div');
        scroll.style.cssText = 'overflow-x:auto;border-radius:10px;border:1px solid var(--AI-border)';
        tool.element.appendChild(scroll);

        var table = document.createElement('table');
        table.style.cssText = 'width:100%;border-collapse:collapse;font-family:system-ui;font-size:0.92rem';
        scroll.appendChild(table);

        // <thead>
        var thead = document.createElement('thead');
        table.appendChild(thead);
        tool.elements = tool.elements || {};
        tool.elements.thead = thead;
        tool._buildHead(thead, state.headers);

        // <tbody>
        var tbody = document.createElement('tbody');
        table.appendChild(tbody);
        tool.elements.tbody = tbody;

        tool._buildRows(tbody, state.rows, state.highlight, false);
    },

    // Build or replace the header row
    _buildHead: function (thead, headers) {
        thead.innerHTML = '';
        if (!headers || !headers.length) return;
        var tr = document.createElement('tr');
        tr.style.background = 'var(--AI-bg2)';
        headers.forEach(function (h) {
            var th = document.createElement('th');
            th.style.cssText = 'padding:0.75rem 1rem;text-align:left;font-weight:700;'
                + 'color:var(--AI-text);border-bottom:2px solid var(--AI-accent);white-space:nowrap';
            th.textContent = h;
            tr.appendChild(th);
        });
        thead.appendChild(tr);
    },

    // Build all rows from scratch with optional stagger animation
    _buildRows: function (tbody, rows, highlight, skipAnim) {
        tbody.innerHTML = '';
        var hl  = highlight || [];
        var dur = skipAnim ? 0 : _dur(this.state, 250);
        (rows || []).forEach(function (row, ri) {
            var tr = _makeRow(row, ri, hl);
            tbody.appendChild(tr);
            if (dur > 0) {
                tr.style.opacity   = '0';
                tr.style.transform = 'translateX(-16px)';
                tr.style.transition = 'opacity ' + dur + 'ms, transform ' + dur + 'ms';
                (function (el) {
                    setTimeout(function () {
                        el.style.opacity   = '1';
                        el.style.transform = 'none';
                    }, ri * 40);
                })(tr);
            }
        });
    },

    // Rebuild body in-place (called by rendering() handler)
    _rebuildBody: function () {
        var tool  = this;
        var state = tool.state;
        var tbody = tool.elements && tool.elements.tbody;
        if (!tbody) { tool.refresh(); return; }

        // Also update headers if they changed
        if (tool.elements.thead) {
            tool._buildHead(tool.elements.thead, state.headers);
        }

        tool._buildRows(tbody, state.rows, state.highlight, false);
    },

    // Slide new rows in at the bottom — no full rebuild
    _addRows: function (newRows) {
        var tool  = this;
        var state = tool.state;
        var tbody = tool.elements && tool.elements.tbody;
        if (!tbody) return;
        var hl  = state.highlight || [];
        var dur = _dur(state, 250);
        newRows.forEach(function (row) {
            var ri = state.rows.length - newRows.length
                   + newRows.indexOf(row);
            var tr = _makeRow(row, ri, hl);
            if (dur > 0) {
                tr.style.opacity    = '0';
                tr.style.transform  = 'translateX(-16px)';
                tr.style.transition = 'opacity ' + dur + 'ms, transform ' + dur + 'ms';
            }
            tbody.appendChild(tr);
            if (dur > 0) {
                requestAnimationFrame(function () {
                    requestAnimationFrame(function () {
                        tr.style.opacity   = '1';
                        tr.style.transform = 'none';
                    });
                });
            }
        });
    },

    // Slide a row out and remove it — no full rebuild
    _removeRow: function (rowIndex) {
        var tool  = this;
        var tbody = tool.elements && tool.elements.tbody;
        if (!tbody) return;
        var rows  = tbody.querySelectorAll('tr');
        var tr    = rows[rowIndex];
        if (!tr) return;
        var dur = _dur(tool.state, 250);
        if (dur > 0) {
            tr.style.transition = 'opacity ' + dur + 'ms, transform ' + dur + 'ms';
            tr.style.opacity    = '0';
            tr.style.transform  = 'translateX(20px)';
            setTimeout(function () {
                if (tr.parentNode) tr.parentNode.removeChild(tr);
            }, dur + 20);
        } else {
            if (tr.parentNode) tr.parentNode.removeChild(tr);
        }
    },

    // Flash a single cell amber — no rebuild
    _patchCell: function (rowIndex, colIndex, value) {
        var tool  = this;
        var tbody = tool.elements && tool.elements.tbody;
        if (!tbody) return;
        var rows = tbody.querySelectorAll('tr');
        var tr   = rows[rowIndex];
        if (!tr) return;
        var tds = tr.querySelectorAll('td');
        var td  = tds[colIndex];
        if (!td) return;
        td.textContent = value;
        td.style.background = 'rgba(232,160,32,0.3)';
        td.style.transition = 'background 0.6s';
        setTimeout(function () { td.style.background = ''; }, 700);
    },

    /**
     * Apply a table mutation.
     * 'set'        — full replace, uses stateChanged → rendering()
     * 'addRow'     — targeted append via _addRows
     * 'removeRow'  — targeted removal via _removeRow
     * 'updateCell' — targeted flash via _patchCell
     * 'addCol'     — full rebuild via stateChanged
     * 'removeCol'  — full rebuild via stateChanged
     */
    update: function (d) {
        var tool  = this;
        var state = tool.state;

        switch (d.action) {
            case 'set':
                state.headers   = d.headers   || state.headers;
                state.rows      = d.rows       || [];
                state.highlight = d.highlight  || [];
                tool.stateChanged('rows,headers,highlight');
                break;

            case 'addRow':
                var newRows = d.rows || [];
                if (!newRows.length) break;
                state.rows = state.rows.concat(newRows);
                tool._addRows(newRows);
                break;

            case 'removeRow':
                if (typeof d.rowIndex !== 'number') break;
                state.rows.splice(d.rowIndex, 1);
                tool._removeRow(d.rowIndex);
                break;

            case 'updateCell':
                if (typeof d.rowIndex !== 'number' || typeof d.colIndex !== 'number') break;
                if (!state.rows[d.rowIndex]) state.rows[d.rowIndex] = [];
                state.rows[d.rowIndex][d.colIndex] = d.value || '';
                tool._patchCell(d.rowIndex, d.colIndex, d.value || '');
                break;

            case 'addCol':
                if (d.headers && d.headers[0]) state.headers.push(d.headers[0]);
                state.rows.forEach(function (row) { row.push(''); });
                tool.stateChanged('rows,headers');
                break;

            case 'removeCol':
                if (typeof d.colIndex !== 'number') break;
                state.headers.splice(d.colIndex, 1);
                state.rows.forEach(function (row) { row.splice(d.colIndex, 1); });
                tool.stateChanged('rows,headers');
                break;
        }
    },

    Q: { beforeRemove: function () {} }
});

// ── Module helpers ──────────────────────────────────────────────────────────────

function _makeRow(row, ri, highlight) {
    var isHl = (highlight || []).indexOf(ri) >= 0;
    var tr = document.createElement('tr');
    tr.className = 'Q_vistable_row';
    tr.dataset.ri = ri;
    tr.style.cssText = 'background:' + (isHl ? 'rgba(232,160,32,0.12)'
                                              : ri % 2 === 0 ? 'var(--AI-bg)'
                                                             : 'rgba(255,255,255,0.025)')
        + ';border-bottom:1px solid var(--AI-border);transition:background 0.2s';
    (row || []).forEach(function (cell) {
        var td = document.createElement('td');
        td.style.cssText = 'padding:0.7rem 1rem;color:var(--AI-text);vertical-align:top'
            + (isHl ? ';font-weight:600' : '');
        td.textContent = String(cell);
        tr.appendChild(td);
    });
    return tr;
}

function _dur(s, fallback) {
    if (s.animate === false) return 0;
    if (s.animate === true)  return fallback;
    if (s.animate && s.animate.duration != null) return s.animate.duration;
    return fallback;
}

})(Q, Q.jQuery, window);
