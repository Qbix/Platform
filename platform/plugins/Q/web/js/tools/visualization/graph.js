(function (Q, $, window, undefined) {
/**
 * @module Q-tools
 */
/**
 * Force-directed node-edge graph using D3 forceSimulation.
 *
 * Uses tool.rendering() + stateChanged() for live updates.
 * Mutations animate via D3's enter/exit transitions and simulation restart:
 *   - New nodes bounce in (easeBackOut overshoot)
 *   - Removed nodes shrink away
 *   - New edges fade in; removed edges fade out
 *   - Simulation rebalances with a configurable alpha kick
 *
 * Node types: person, company (avatar circle), concept (pill), stat (value ring)
 *
 * State shape:
 *   { nodes: [{id, type, label, imageUrl?, value?}],
 *     edges: [{from, to, label?, weight?}] }
 *
 * @class Q/visualization/graph
 * @constructor
 * @param {Object} [options]
 * @param {Object} [options.stream]     Streams.Stream for live update subscription
 * @param {Array}  [options.nodes]
 * @param {Array}  [options.edges]
 * @param {Number} [options.width=800]
 * @param {Number} [options.height=520]
 * @param {Number} [options.nodeRadius=32]
 * @param {true|false|Object} [options.animate=true]
 *   true uses defaults; { duration: N } overrides enter/exit duration
 */
Q.Tool.define('Q/visualization/graph', function (options) {
    var tool  = this;
    var state = tool.state;

    state.nodes = state.nodes || [];
    state.edges = state.edges || [];

    function init() {
        tool.refresh();

        // Efficient update path: _renderGraph runs with D3 transitions
        tool.rendering(['nodes', 'edges'], function () {
            tool._renderGraph();
        });

        // Wire stream events — both durable and live paths
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
    }

    if (typeof d3 !== 'undefined') {
        init();
    } else {
        Q.addScript('{{Q}}/js/d3.min.js', function () {
            if (typeof d3 !== 'undefined') { init(); return; }
            Q.addScript('https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js', init);
        });
    }
}, {
    stream:     null,
    nodes:      [],
    edges:      [],
    width:      800,
    height:     520,
    nodeRadius: 32,
    animate:    true   // true | false | { duration: N }
}, {
    refresh: function () {
        var tool  = this;
        var state = tool.state;
        if (typeof d3 === 'undefined') {
            tool.element.innerHTML = '<div style="color:#f0eee8;padding:2rem;font-family:system-ui">Loading…</div>';
            return;
        }

        if (tool._sim) { tool._sim.stop(); tool._sim = null; }

        tool.element.innerHTML = '';
        tool.element.style.setProperty('--AI-bg',     '#1a1d24');
        tool.element.style.setProperty('--AI-accent', '#5b8ef0');
        tool.element.style.setProperty('--AI-text',   '#f0eee8');
        tool.element.style.setProperty('--AI-border', 'rgba(255,255,255,0.1)');

        var w = state.width, h = state.height;
        var svg = tool._svg = d3.select(tool.element).append('svg')
            .attr('width',   '100%')
            .attr('height',  h)
            .attr('viewBox', '0 0 ' + w + ' ' + h)
            .style('background',   'var(--AI-bg)')
            .style('border-radius','12px');

        svg.append('defs').append('marker')
            .attr('id',           'arrow-' + tool.prefix)
            .attr('viewBox',      '0 -5 10 10')
            .attr('refX',         28)
            .attr('markerWidth',  6)
            .attr('markerHeight', 6)
            .attr('orient',       'auto')
            .append('path')
            .attr('d',    'M0,-5L10,0L0,5')
            .attr('fill', 'var(--AI-border)');

        tool._linkG = svg.append('g').attr('class', 'links');
        tool._nodeG = svg.append('g').attr('class', 'nodes');

        tool._renderGraph();
    },

    _renderGraph: function () {
        var tool  = this;
        var state = tool.state;
        if (!tool._linkG || !tool._nodeG) return;
        if (typeof d3 === 'undefined') return;

        if (tool._sim) tool._sim.stop();

        var enterDur = _dur(state, 400);
        var exitDur  = _dur(state, 300);

        var nodes = state.nodes.slice();
        var edges = state.edges.map(function (e) {
            return { source: e.from, target: e.to, label: e.label || '' };
        });

        // ── Links ───────────────────────────────────────────────────────────
        var link = tool._linkG.selectAll('line')
            .data(edges, function (d) { return d.source + '-' + d.target; });

        link.enter().append('line')
            .attr('stroke',       'var(--AI-border)')
            .attr('stroke-width', 1.5)
            .attr('marker-end',   'url(#arrow-' + tool.prefix + ')')
            .style('opacity', 0)
            .transition().duration(enterDur)
            .style('opacity', 1);

        link.exit().transition().duration(exitDur)
            .style('opacity', 0).remove();

        // ── Nodes ───────────────────────────────────────────────────────────
        var nodeGroup = tool._nodeG.selectAll('g.node')
            .data(nodes, function (d) { return d.id; });

        // Exit: shrink and remove
        nodeGroup.exit()
            .transition().duration(exitDur)
            .attr('transform', function (d) {
                return 'translate(' + (d.x || 0) + ',' + (d.y || 0) + ') scale(0)';
            })
            .remove();

        // Enter: build node graphics
        var enter = nodeGroup.enter().append('g')
            .attr('class', 'node')
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
            );

        var r   = state.nodeRadius;
        enter.each(function (d) {
            var g   = d3.select(this);
            var col = d.type === 'concept' ? 'var(--AI-accent)'
                    : d.type === 'stat'    ? '#e8a020'
                    : '#2a2d38';

            if (d.imageUrl) {
                var clipId = 'clip-' + tool.prefix + '-' + d.id;
                tool._svg.select('defs')
                    .append('clipPath').attr('id', clipId)
                    .append('circle').attr('r', r);
                g.append('circle').attr('r', r)
                    .attr('fill', col)
                    .attr('stroke', 'var(--AI-border)').attr('stroke-width', 2);
                g.append('image')
                    .attr('href', d.imageUrl)
                    .attr('x', -r).attr('y', -r)
                    .attr('width', r * 2).attr('height', r * 2)
                    .attr('clip-path', 'url(#' + clipId + ')');
            } else {
                g.append('circle').attr('r', r)
                    .attr('fill', col)
                    .attr('stroke', 'var(--AI-accent)').attr('stroke-width', 2);
                if (d.type === 'stat') {
                    g.append('text').attr('dy', '0.1em')
                        .attr('text-anchor', 'middle')
                        .attr('fill',        'var(--AI-text)')
                        .attr('font-size',   '1.1rem')
                        .attr('font-weight', '700')
                        .text(d.value || '');
                } else {
                    var lbl = d.label.length > 10 ? d.label.slice(0, 9) + '\u2026' : d.label;
                    g.append('text').attr('dy', '0.35em')
                        .attr('text-anchor', 'middle')
                        .attr('fill',        'var(--AI-text)')
                        .attr('font-size',   '0.75rem')
                        .attr('font-weight', '600')
                        .text(lbl);
                }
            }

            if (d.imageUrl || d.type === 'stat') {
                g.append('text')
                    .attr('dy',           r + 16)
                    .attr('text-anchor',  'middle')
                    .attr('fill',         'var(--AI-text)')
                    .attr('font-size',    '0.72rem')
                    .text(d.label);
            }

            // Bounce-in entry animation
            if (enterDur > 0) {
                g.attr('transform', 'scale(0)')
                    .transition().duration(enterDur)
                    .ease(d3.easeBackOut.overshoot(2))
                    .attr('transform', 'scale(1)');
            }
        });

        // Clean up stale clipPaths from previous renders
        if (tool._svg) {
            var keepIds = nodes.filter(function (n) { return n.imageUrl; })
                .map(function (n) { return 'clip-' + tool.prefix + '-' + n.id; });
            tool._svg.select('defs').selectAll('clipPath').each(function () {
                if (keepIds.indexOf(d3.select(this).attr('id')) < 0) {
                    d3.select(this).remove();
                }
            });
        }

        // ── Force simulation ─────────────────────────────────────────────────
        tool._sim = d3.forceSimulation()
            .force('link',    d3.forceLink().id(function (d) { return d.id; }).distance(120))
            .force('charge',  d3.forceManyBody().strength(-300))
            .force('center',  d3.forceCenter(state.width / 2, state.height / 2))
            .force('collide', d3.forceCollide(r + 10));

        tool._sim.nodes(nodes).on('tick', function () {
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
        // Gentler alpha for updates vs full reset on initial render
        tool._sim.alpha(tool._hasRenderedOnce ? 0.3 : 0.6).restart();
        tool._hasRenderedOnce = true;
    },

    /**
     * Apply a mutation and animate.
     * Calls tool.setState() so rendering() fires on the next animation frame.
     * @param {Object} d  { action: 'set'|'add'|'remove', nodes?, edges? }
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

        tool.stateChanged('nodes,edges');
    },

    Q: {
        beforeRemove: function () {
            if (this._sim) { this._sim.stop(); this._sim = null; }
        }
    }
});

// ── Module helpers ──────────────────────────────────────────────────────────────

function _dur(s, fallback) {
    if (s.animate === false) return 0;
    if (s.animate === true)  return fallback;
    if (s.animate && s.animate.duration != null) return s.animate.duration;
    return fallback;
}

})(Q, Q.jQuery, window);
