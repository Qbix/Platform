(function (Q, $, window, undefined) {
/**
 * @module Q-tools
 */
/**
 * Time-series line chart using D3.
 *
 * Uses tool.rendering() for efficient in-place updates.
 * Existing lines morph to new shapes via D3 transitions.
 * New series draw in with stroke-dashoffset animation.
 * Removed series fade out.
 * Axes rescale smoothly when domain changes.
 *
 * @class Q/chart/line
 * @constructor
 * @param {Object} [options]
 * @param {Array}  options.series    [{label, data: [{x, y}, ...], color?}, ...]
 * @param {String} [options.title]
 * @param {String} [options.xLabel]
 * @param {String} [options.yLabel]
 * @param {String} [options.unit]   Appended to Y axis tick labels
 * @param {true|false|Object} [options.animate=true]
 *   true uses default durations; { duration: N } overrides; false skips
 * @param {String} [options.source]
 * @param {String} [options.url]
 * @param {Q.Event} [options.onRender]
 */
Q.Tool.define("Q/chart/line", function () {
    var tool = this;

    function init() {
        tool.refresh();

        // Efficient updates: axes rescale, existing paths morph, new paths draw in
        tool.rendering(['series', '_zoomScale', 'title', 'unit'],
        function (changed) {
            var s = tool.state;
            if (!tool._g || !tool._svg) { tool.refresh(); return; }
            if (typeof s.series === 'string') {
                try { s.series = JSON.parse(s.series); } catch (e) { s.series = []; }
            }
            if (!s.series || !s.series.length) return;

            var allData = [];
            s.series.forEach(function (sr) {
                (sr.data || []).forEach(function (d) { allData.push(d); });
            });

            // Recompute scales from new data
            var xScale = d3.scaleLinear()
                .domain(d3.extent(allData, function (d) { return +d.x; }))
                .range([0, tool._iw]);

            var yMax = d3.max(allData, function (d) { return +d.y; }) * 1.1;
            if (s._zoomScale && s._zoomScale !== 1) yMax = yMax / s._zoomScale;
            var yScale = d3.scaleLinear()
                .domain([0, yMax]).range([tool._ih, 0]);

            var axDur = _dur(s, 400);
            // Transition axes to new scale
            if (tool._xAxisG) {
                tool._xAxisG.transition().duration(axDur)
                    .call(d3.axisBottom(xScale).ticks(6));
            }
            if (tool._yAxisG) {
                tool._yAxisG.transition().duration(axDur)
                    .call(d3.axisLeft(yScale).ticks(5)
                        .tickFormat(function (v) { return v + (s.unit || ''); }));
            }

            var lineGen = d3.line()
                .x(function (d) { return xScale(+d.x); })
                .y(function (d) { return yScale(+d.y); })
                .curve(d3.curveCatmullRom);

            // Index existing paths by series label
            var existingPaths = {};
            tool._g.selectAll('path.Q_chart_line_series').each(function () {
                existingPaths[d3.select(this).attr('data-label')] = d3.select(this);
            });

            // Labels present in new data
            var newLabels = {};
            s.series.forEach(function (sr) { newLabels[sr.label || 'series'] = true; });

            // Fade out and remove gone series
            Object.keys(existingPaths).forEach(function (label) {
                if (!newLabels[label]) {
                    existingPaths[label].transition().duration(300)
                        .style('opacity', 0).remove();
                }
            });

            var morphDur = _dur(s, 600);

            s.series.forEach(function (sr, i) {
                var label = sr.label || 'series';
                var color = sr.color || d3.schemeTableau10[i % 10];
                var newD  = lineGen(sr.data || []);

                if (existingPaths[label]) {
                    // Morph existing path to new shape
                    if (morphDur > 0) {
                        existingPaths[label]
                            .transition().duration(morphDur).ease(d3.easeCubicInOut)
                            .attr('d', newD);
                    } else {
                        existingPaths[label].attr('d', newD);
                    }
                } else {
                    // New series — draw with dashoffset animation
                    var path = tool._g.append('path')
                        .datum(sr.data)
                        .attr('class', 'Q_chart_line_series')
                        .attr('data-label', label)
                        .attr('fill', 'none')
                        .attr('stroke', color)
                        .attr('stroke-width', 2.5)
                        .attr('d', newD);

                    if (morphDur > 0) {
                        var len = path.node().getTotalLength();
                        path.attr('stroke-dasharray', len + ' ' + len)
                            .attr('stroke-dashoffset', len)
                            .transition().duration(morphDur).ease(d3.easeLinear)
                            .attr('stroke-dashoffset', 0);
                    }
                }
            });

            // Store updated scales for highlight/zoom calls
            tool._xScale = xScale;
            tool._yScale = yScale;
        });
    }

    if (typeof d3 !== 'undefined') {
        init();
    } else {
        Q.addScript('{{Q}}/js/d3.min.js', function () {
            if (typeof d3 !== 'undefined') { init(); return; }
            Q.addScript('https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js', init);
        });
    }
},
{
    series:   [],
    title:    '',
    xLabel:   '',
    yLabel:   '',
    unit:     '',
    animate:  true,   // true | false | { duration: N }
    source:   '',
    url:      '',
    onRender: new Q.Event()
},
{
    refresh: function () {
        var tool = this, s = tool.state;
        if (typeof s.series === 'string') {
            try { s.series = JSON.parse(s.series); } catch (e) { s.series = []; }
        }
        if (!s.series || !s.series.length) return;
        if (typeof d3 === 'undefined') return;

        var margin  = tool._margin = { top: 24, right: 20, bottom: 40, left: 50 };
        var width   = tool.element.clientWidth  || 600;
        var height  = tool.element.clientHeight || 320;
        var iw      = tool._iw = width  - margin.left - margin.right;
        var ih      = tool._ih = height - margin.top  - margin.bottom;

        var allData = [];
        s.series.forEach(function (sr) {
            (sr.data || []).forEach(function (d) { allData.push(d); });
        });

        tool.element.innerHTML = '';

        var svg = tool._svg = d3.select(tool.element).append('svg')
            .attr('width', width).attr('height', height)
            .attr('class', 'Q_chart Q_chart_line');

        var g = tool._g = svg.append('g')
            .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

        var xScale = tool._xScale = d3.scaleLinear()
            .domain(d3.extent(allData, function (d) { return +d.x; }))
            .range([0, iw]);

        var yMax = d3.max(allData, function (d) { return +d.y; }) * 1.1;
        if (s._zoomScale && s._zoomScale !== 1) yMax = yMax / s._zoomScale;
        var yScale = tool._yScale = d3.scaleLinear()
            .domain([0, yMax]).range([ih, 0]);

        tool._xAxisG = g.append('g')
            .attr('transform', 'translate(0,' + ih + ')')
            .call(d3.axisBottom(xScale).ticks(6));
        tool._yAxisG = g.append('g')
            .call(d3.axisLeft(yScale).ticks(5)
                .tickFormat(function (v) { return v + (s.unit || ''); }));

        var drawDur = _dur(s, 1000);
        var lineGen = d3.line()
            .x(function (d) { return xScale(+d.x); })
            .y(function (d) { return yScale(+d.y); })
            .curve(d3.curveCatmullRom);

        s.series.forEach(function (sr, i) {
            var color = sr.color || d3.schemeTableau10[i % 10];
            var path  = g.append('path')
                .datum(sr.data)
                .attr('class', 'Q_chart_line_series')
                .attr('data-label', sr.label || 'series')
                .attr('fill', 'none')
                .attr('stroke', color)
                .attr('stroke-width', 2.5)
                .attr('d', lineGen);

            if (drawDur > 0) {
                var len = path.node().getTotalLength();
                path.attr('stroke-dasharray', len + ' ' + len)
                    .attr('stroke-dashoffset', len)
                    .transition().duration(drawDur).ease(d3.easeLinear)
                    .attr('stroke-dashoffset', 0);
            }
        });

        if (s.title) {
            svg.append('text')
                .attr('x', width / 2).attr('y', 16)
                .attr('text-anchor', 'middle')
                .attr('class', 'Q_chart_title')
                .text(s.title);
        }

        Q.handle(s.onRender, tool);
    },

    /** Draw a vertical highlight rule at the given X value */
    highlight: function (elementId) {
        var tool = this;
        if (!tool._g) return;
        tool._g.selectAll('.Q_chart_highlight_rule').remove();
        var x = parseFloat(elementId);
        if (!isNaN(x) && tool._xScale) {
            tool._g.append('line')
                .attr('class',          'Q_chart_highlight_rule')
                .attr('x1', tool._xScale(x)).attr('x2', tool._xScale(x))
                .attr('y1', 0)              .attr('y2', tool._ih || 280)
                .attr('stroke',          '#f59e0b')
                .attr('stroke-width',    2)
                .attr('stroke-dasharray','4 3');
        }
    },

    /** Zoom Y axis: scale > 1 tightens range, scale < 1 loosens */
    zoom: function (scale) {
        var s = this.state;
        s._zoomScale = scale;
        this.stateChanged('_zoomScale');
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
