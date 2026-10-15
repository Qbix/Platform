(function (Q, $, window, undefined) {
/**
 * Q/visualization/graph tool
 *
 * Force-directed node-edge graph using D3 forceSimulation.
 * Nodes repel each other; edges attract connected nodes.
 * The simulation runs continuously — nodes have gentle ambient drift.
 * Mutations (add/remove node or edge) animate with bounce and rebalance.
 *
 * Node types and rendering:
 *   person  — avatar circle (imageUrl) + name label
 *   company — logo circle (imageUrl) + name label
 *   concept — filled pill with label
 *   stat    — value in ring + label below
 *
 * State shape (stored on stream attribute for reconnect):
 *   { nodes: [{id, type, label, imageUrl?, value?}], edges: [{from, to, label?, weight?}] }
 *
 * Receives updates via:
 *   stream.onMessage('Media/presentation/graph/update', handler)
 *   stream.onEphemeral('Media/presentation/graph/update', handler)  ← same handler
 *
 * @module Q
 * @class Q/visualization/graph
 */
Q.Tool.define('Q/visualization/graph', function (options) {
    var tool  = this;
    var state = tool.state;

    // Initial render
    state.nodes = state.nodes || [];
    state.edges = state.edges || [];
    tool.refresh();

    // Wire stream updates — both message (durable) and ephemeral (live) paths
    if (state.stream) {
        if (state.stream.onMessage) {
            state.stream.onMessage('Media/presentation/graph/update', function (msg) {
                var d = {};
                try { d = JSON.parse(msg.fields.instructions || '{}'); } catch (e) {}
                if (d.action) tool.update(d);
            }, tool);
        }
        state.stream.onEphemeral('Media/presentation/graph/update').set(function (e) {
            if (e && e.action) tool.update(e);
        }, tool);
    }
}, {
    // Default options
    stream:   null,
    nodes:    [],
    edges:    [],
    width:    800,
    height:   520,
    nodeRadius: 32
}, {
    refresh: function () {
        var tool  = this;
        var state = tool.state;

        // Require D3
        if (!window.d3) {
            // Match the eventual SVG's own footprint (width:100%, height:
            // state.height) instead of just shrink-wrapping this text --
            // on an uncached page load, D3 can take a while to fetch, and
            // Media/presentation.js's cardSizing measures this card's
            // size before that resolves (its own settle-detection waits
            // for a quiet period, not for this specific async load) --
            // a tiny placeholder footprint here produces a wildly wrong,
            // never-corrected scale once the real graph actually renders.
            tool.element.innerHTML = '<div style="color:#f0eee8;font-family:system-ui;'
                + 'width:100%;height:' + (state.height || 520) + 'px;box-sizing:border-box;'
                + 'display:flex;align-items:center;justify-content:center;'
                + 'background:#1a1d24;border-radius:12px">Loading D3…</div>';
            Q.addScript('{{Q}}/js/d3.min.js', function () { tool.refresh(); });
            return;
        }

        tool.element.innerHTML = '';
        tool.element.style.setProperty('--AI-bg',      '#1a1d24');
        tool.element.style.setProperty('--AI-accent',  '#5b8ef0');
        tool.element.style.setProperty('--AI-text',    '#f0eee8');
        tool.element.style.setProperty('--AI-border',  'rgba(255,255,255,0.1)');

        var w = state.width;
        var h = state.height;

        var svg = d3.select(tool.element)
            .append('svg')
            .attr('width',  '100%')
            .attr('height', h)
            .attr('viewBox', '0 0 ' + w + ' ' + h)
            .style('background', 'var(--AI-bg)')
            .style('border-radius', '12px');

        // Arrow marker for directed edges
        svg.append('defs').append('marker')
            .attr('id',          'arrow-' + tool.prefix)
            .attr('viewBox',     '0 -5 10 10')
            .attr('refX',        28)
            .attr('markerWidth', 6)
            .attr('markerHeight',6)
            .attr('orient',      'auto')
            .append('path')
            .attr('d',    'M0,-5L10,0L0,5')
            .attr('fill', 'var(--AI-border)');

        tool._svg   = svg;
        tool._linkG = svg.append('g').attr('class','links');
        tool._nodeG = svg.append('g').attr('class','nodes');

        tool._renderGraph();
    },

    _renderGraph: function () {
        var tool  = this;
        var state = tool.state;
        // Stop existing simulation before rebuilding — prevents two simulations
        // fighting each other when update() calls _renderGraph again
        if (tool._sim) tool._sim.stop();
        if (!tool._linkG) return; // not yet initialised

        var nodes = state.nodes.slice();
        var edges = state.edges.map(function (e) {
            return { source: e.from, target: e.to, label: e.label || '' };
        });

        // Relative node size: when nodes carry a `value` (market cap,
        // seats won, population, follower count, or the model's own
        // judgment of relative importance when no obvious metric fits the
        // topic -- see messages.schema.json's "graph" viz-type entry),
        // scale circle AREA (not radius) linearly with it -- the standard
        // bubble-chart convention, since humans perceive area as "size",
        // not radius. A node with no value keeps the flat default radius,
        // same as every node did before `value` was wired up to anything.
        var maxValue = 0;
        nodes.forEach(function (n) {
            if (typeof n.value === 'number' && n.value > maxValue) maxValue = n.value;
        });
        var MIN_VALUE_R = state.nodeRadius;
        var MAX_VALUE_R = state.nodeRadius * 2.2;
        var CAP_R       = state.nodeRadius * 2.8;
        function _valueRadius(value) {
            if (!maxValue || typeof value !== 'number' || value <= 0) return state.nodeRadius;
            return MIN_VALUE_R + (MAX_VALUE_R - MIN_VALUE_R) * Math.sqrt(value / maxValue);
        }

        // Links
        var link = tool._linkG.selectAll('line').data(edges, function (d) { return d.source + '-' + d.target; });
        link.enter().append('line')
            .attr('stroke', 'var(--AI-border)')
            .attr('stroke-width', 1.5)
            .attr('marker-end', 'url(#arrow-' + tool.prefix + ')')
            .style('opacity', 0)
            .transition().duration(400)
            .style('opacity', 1);
        link.exit().transition().duration(300).style('opacity',0).remove();

        // Nodes
        var nodeGroup = tool._nodeG.selectAll('g.node').data(nodes, function (d) { return d.id; });

        var enter = nodeGroup.enter().append('g')
            .attr('class','node')
            .style('cursor', 'pointer')
            .call(d3.drag()
                .on('start', function (event, d) {
                    if (!event.active) tool._sim.alphaTarget(0.3).restart();
                    d.fx = d.x; d.fy = d.y;
                })
                .on('drag',  function (event, d) { d.fx = event.x; d.fy = event.y; })
                .on('end',   function (event, d) {
                    if (!event.active) tool._sim.alphaTarget(0);
                    d.fx = null; d.fy = null;
                })
            )
            // Tooltip with the node's FULL label/value -- a circle's own
            // label is often truncated or just too small to read,
            // especially now that size is value-driven rather than
            // uniform (see valueR above). mouseenter/mousemove/mouseleave
            // cover mouse input; click is wired separately below to also
            // cover touch, which has no hover concept at all (those three
            // events never fire from a tap on most browsers).
            .on('mouseenter', function (event, d) {
                console.log('[Q/visualization/graph] mouseenter', d && d.label);
                tool._showTooltip(d, event);
            })
            .on('mousemove',  function (event, d) { tool._moveTooltip(event); })
            .on('mouseleave', function () { tool._hideTooltip(); })
            .on('click', function (event, d) {
                // Tap-to-toggle for touch: stopPropagation keeps this
                // from also reaching the document-level "tap elsewhere
                // dismisses it" listener armed in _ensureTooltip.
                event.stopPropagation();
                if (tool._tooltipFor === d && tool._tooltip && tool._tooltip.style.display !== 'none') {
                    tool._hideTooltip();
                    tool._tooltipFor = null;
                } else {
                    tool._showTooltip(d, event);
                    tool._tooltipFor = d;
                }
            });

        // Draw node based on type. Stores the node's actual rendered
        // radius on d.r (used below by the collide force, and persists
        // across re-renders via D3's by-id data join for nodes that don't
        // re-enter). valueR (from each node's optional `value`) is the
        // starting point for ALL types -- imageUrl/stat nodes use it
        // directly (their label sits below the circle, so nothing needs
        // to fit inside it); person/company (no image) and concept nodes
        // show their label INSIDE the circle, so it's also floored by
        // whatever that label actually needs, to avoid overflowing a
        // bubble a low value would otherwise make too small to read.
        enter.each(function (d) {
            var g      = d3.select(this);
            var valueR = _valueRadius(d.value);
            var col    = d.type === 'concept' ? 'var(--AI-accent)'
                       : d.type === 'stat'    ? '#e8a020'
                       : '#2a2d38';

            if (d.imageUrl) {
                d.r = Math.min(valueR, CAP_R);
                // Clip circle + image
                var clipId = 'clip-' + tool.prefix + '-' + d.id;
                d3.select(tool._svg.node()).select('defs')
                    .append('clipPath').attr('id', clipId)
                    .append('circle').attr('r', d.r);
                g.append('circle').attr('r', d.r)
                    .attr('fill', col).attr('stroke','var(--AI-border)').attr('stroke-width',2);
                g.append('image')
                    .attr('href', d.imageUrl)
                    .attr('x', -d.r).attr('y', -d.r)
                    .attr('width',  d.r * 2).attr('height', d.r * 2)
                    .attr('clip-path', 'url(#' + clipId + ')')
                    // 404/unreachable imageUrl -- hide the browser's
                    // broken-image icon instead of showing it inside the
                    // circle, falling back to the plain fill/stroke circle
                    // underneath (same look a node with no imageUrl at
                    // all already gets).
                    .on('error', function () {
                        d3.select(this).style('display', 'none');
                    });
            } else if (d.type === 'stat') {
                d.r = Math.min(valueR, CAP_R);
                g.append('circle').attr('r', d.r)
                    .attr('fill', col).attr('stroke','var(--AI-accent)').attr('stroke-width',2);
                g.append('text').attr('dy','0.1em')
                    .attr('text-anchor','middle')
                    .attr('fill','var(--AI-text)')
                    .attr('font-size','1.1rem')
                    .attr('font-weight','700')
                    .text(d.value || '');
            } else {
                var font = '600 0.75rem system-ui, sans-serif';

                // Radius comes from value ALONE (capped) -- deliberately
                // NOT also floored by text width. An earlier version did
                // Math.max(valueR, textFit), which let a long label
                // inflate a LOW-value node past its value-driven size --
                // observed rendering "Confederation (Konfederacja)" as
                // the LARGEST circle in a Polish-parties graph purely
                // because its name is the longest in the set, not
                // because of its actual (much smaller) support. A label
                // that doesn't fit the value-driven circle is truncated
                // instead of growing the circle to accommodate it -- see
                // the hover tooltip for the full name.
                d.r = Math.min(valueR, CAP_R);

                g.append('circle').attr('r', d.r)
                    .attr('fill', col).attr('stroke','var(--AI-accent)').attr('stroke-width',2);

                // Trim a character at a time against the actual available
                // width (2r minus padding) rather than estimating
                // chars-per-pixel -- more accurate, and self-correcting
                // if the canvas font metric ever drifts slightly from the
                // rendered SVG font.
                var label     = d.label || '';
                var available = d.r * 2 - 16;
                var displayLabel = label;
                while (displayLabel && _measureTextWidth(displayLabel + '…', font) > available) {
                    displayLabel = displayLabel.slice(0, -1);
                }
                if (displayLabel !== label) displayLabel += '…';

                g.append('text').attr('dy','0.35em')
                    .attr('text-anchor','middle')
                    .attr('fill','var(--AI-text)')
                    .attr('font-size','0.75rem')
                    .attr('font-weight','600')
                    .attr('font-family','system-ui, sans-serif')
                    .text(displayLabel);
            }

            // Label below -- only for imageUrl/stat, where the circle's
            // own content isn't the label itself.
            if (d.imageUrl || d.type === 'stat') {
                g.append('text')
                    .attr('dy', d.r + 16)
                    .attr('text-anchor','middle')
                    .attr('fill','var(--AI-text)')
                    .attr('font-size','0.72rem')
                    .text(d.label);
            }

            // Entry animation
            g.attr('transform','scale(0)')
                .transition().duration(400)
                .ease(d3.easeBackOut.overshoot(2))
                .attr('transform','scale(1)');
        });

        nodeGroup.exit()
            .transition().duration(300)
            .attr('transform','scale(0)')
            .remove();

        // Remove stale clipPaths from previous render to avoid leaking defs
        if (tool._svg) {
            tool._svg.select('defs').selectAll('clipPath').remove();
        }

        // Rebuild simulation with fresh forces each time
        tool._sim = d3.forceSimulation()
            .force('link',   d3.forceLink().id(function (d) { return d.id; }).distance(120))
            .force('charge', d3.forceManyBody().strength(-300))
            .force('center', d3.forceCenter(state.width / 2, (state.height || 520) / 2))
            .force('collide',d3.forceCollide(function (d) {
                // Per-node, not fixed -- circles now vary in size to fit
                // their label (see enter.each above), so a flat collision
                // radius would let bigger ones overlap their neighbors.
                return (d.r || state.nodeRadius || 32) + 10;
            }));

        tool._sim
            .nodes(nodes)
            .on('tick', function () {
                // Clamp every node fully inside the canvas on every tick.
                // Nothing in the force set above constrains position --
                // forceCenter only nudges the AVERAGE of all nodes,
                // weakly, it doesn't pull any individual one back -- so an
                // isolated node (no links to pull it back via forceLink)
                // dragged hard enough could end up past the SVG's own
                // default overflow:hidden viewBox clipping, invisible and
                // ungrabbable. Clamping here runs after the simulation
                // applies a dragged node's fx/fy too, so this also caps
                // the drag itself in real time at the boundary rather than
                // only fixing it up after release.
                nodes.forEach(function (d) {
                    var r = d.r || state.nodeRadius || 32;
                    d.x = Math.max(r, Math.min(state.width - r, d.x));
                    d.y = Math.max(r, Math.min((state.height || 520) - r, d.y));
                });

                tool._linkG.selectAll('line')
                    .attr('x1', function (d) { return d.source.x; })
                    .attr('y1', function (d) { return d.source.y; })
                    .attr('x2', function (d) { return d.target.x; })
                    .attr('y2', function (d) { return d.target.y; });
                tool._nodeG.selectAll('g.node')
                    .attr('transform', function (d) {
                        return 'translate(' + d.x + ',' + d.y + ')';
                    });
            });

        tool._sim.force('link').links(edges);
        tool._sim.alpha(0.5).restart();
    },

    /**
     * Apply a graph mutation (set/add/remove) and animate.
     * @param {Object} d  { action, nodes?, edges? }
     */
    update: function (d) {
        var tool  = this;
        var state = tool.state;

        if (d.action === 'set') {
            state.nodes = d.nodes || [];
            state.edges = d.edges || [];
        } else if (d.action === 'add') {
            (d.nodes || []).forEach(function (n) {
                if (!state.nodes.find(function (x) { return x.id === n.id; })) {
                    state.nodes.push(n);
                }
            });
            (d.edges || []).forEach(function (e) { state.edges.push(e); });
        } else if (d.action === 'remove') {
            var removeIds = (d.nodes || []).map(function (n) { return n.id; });
            state.nodes   = state.nodes.filter(function (n) { return removeIds.indexOf(n.id) < 0; });
            state.edges   = state.edges.filter(function (e) {
                return removeIds.indexOf(e.from) < 0 && removeIds.indexOf(e.to) < 0;
            });
        }

        tool._renderGraph();
    },

    /**
     * Lazily create the single, shared tooltip element for this instance
     * (reused/repositioned for whichever node is hovered, rather than one
     * per node). Appended to document.body, not tool.element, so it
     * always renders at natural size and position regardless of
     * cardSizing's transform:scale() on the card -- an absolutely/fixed
     * positioned descendant of a scaled ancestor would get visually
     * scaled right along with it otherwise.
     * @private
     */
    _ensureTooltip: function () {
        var tool = this;
        if (tool._tooltip) return tool._tooltip;
        var el = document.createElement('div');
        // z-index maxed out (2147483647, the largest valid value) to rule
        // out any stacking-context issue with some other overlay in this
        // app -- cheap insurance, no downside to it being this high for a
        // tooltip that's invisible 99% of the time.
        el.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;'
            + 'display:none;max-width:280px;padding:0.5rem 0.7rem;border-radius:8px;'
            + 'font-family:system-ui,sans-serif;font-size:0.8rem;line-height:1.35;'
            + 'background:#1a1d24;color:#f0eee8;border:1px solid rgba(255,255,255,0.15);'
            + 'box-shadow:0 4px 16px rgba(0,0,0,0.4);word-wrap:break-word;';
        document.body.appendChild(el);
        tool._tooltip = el;
        // Touch has no mouseleave equivalent -- a tap on a node shows the
        // tooltip (see the 'click' handler in _renderGraph), so a tap
        // ANYWHERE ELSE dismisses it, mirroring what mouseleave does for
        // mouse users. The node's own click handler stops propagation,
        // so this never fires for the tap that just opened it. Stored on
        // the tool (not an anonymous inline listener) so beforeRemove can
        // actually remove it -- every graph card is rebuilt fresh (see
        // presentation.js), so without this a document-level listener
        // would accumulate, one more per card, for the rest of the
        // session.
        tool._documentClickListener = function () {
            tool._hideTooltip();
            tool._tooltipFor = null;
        };
        document.addEventListener('click', tool._documentClickListener);
        return el;
    },

    /**
     * Show the shared tooltip near the cursor with a node's FULL label
     * (and value, when set) -- added because a node's own in-circle or
     * below-circle label can be truncated/sized too small to read at a
     * glance, especially now that circle size is value-driven rather than
     * uniform (see _renderGraph's valueR).
     * @private
     * @param {Object} d Node datum
     * @param {MouseEvent} event
     */
    _showTooltip: function (d, event) {
        var el = this._ensureTooltip();
        var text = d.label || '';
        if (typeof d.value === 'number') {
            text += ' (' + d.value + ')';
        }
        el.textContent = text;
        el.style.display = 'block';
        this._moveTooltip(event);
    },

    /** @private */
    _moveTooltip: function (event) {
        var el = this._tooltip;
        if (!el || el.style.display === 'none') return;
        // Offset from the cursor, nudged left/up near the right/bottom
        // viewport edge so it never renders partly off-screen.
        var x = event.clientX + 14;
        var y = event.clientY + 14;
        var vw = window.innerWidth, vh = window.innerHeight;
        var rect = el.getBoundingClientRect();
        if (x + rect.width  > vw) x = event.clientX - rect.width  - 14;
        if (y + rect.height > vh) y = event.clientY - rect.height - 14;
        el.style.left = x + 'px';
        el.style.top  = y + 'px';
    },

    /** @private */
    _hideTooltip: function () {
        if (this._tooltip) this._tooltip.style.display = 'none';
    },

    Q: {
        beforeRemove: function () {
            if (this._sim) this._sim.stop();
            if (this._documentClickListener) {
                document.removeEventListener('click', this._documentClickListener);
            }
            if (this._tooltip && this._tooltip.parentNode) {
                this._tooltip.parentNode.removeChild(this._tooltip);
            }
        }
    }
});

// Measure text width via an offscreen canvas instead of a DOM probe node.
// A DOM probe (appending a real <text>, calling getComputedTextLength(),
// removing it) was observed returning 0 for every node when measured
// while an ancestor is visibility:hidden -- Media/presentation.js's
// _showInlineCard hides percent-sized cards until their size/scale is
// resolved, and that resolution happens to run this tool's constructor
// (and therefore this measurement) while still hidden. Canvas measurement
// is fully independent of DOM visibility or attachment.
var _measureCanvas = null;
function _measureTextWidth(text, font) {
    if (!_measureCanvas) _measureCanvas = document.createElement('canvas');
    var ctx = _measureCanvas.getContext('2d');
    ctx.font = font;
    return ctx.measureText(text || '').width;
}

})(Q, jQuery, window);
