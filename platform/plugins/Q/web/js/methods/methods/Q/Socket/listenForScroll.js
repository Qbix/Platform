Q.exports(function (Q) {
    /**
     * Q plugin's front end code
     *
     * @module Q
     * @class Q.Socket
     */

    /**
     * Starts listening for Q/scroll socket events.
     * Scrolls a specific element to a position.
     * Payload: { elementId?, selector?, top?, left?, behavior? }
     *
     * elementId targets document.getElementById(elementId).
     * selector targets document.querySelector(selector) as fallback.
     * top/left are pixel values or percentage strings e.g. "50%".
     * behavior is "smooth" (default), "instant", or "auto".
     *
     * @static
     * @method listenForScroll
     * @param {String} [key] Handler key for Q.Event.set
     */
    return function _Q_Socket_listenForScroll(key) {
        Q.Socket.onEvent('Q/scroll').set(function (payload) {
            if (!payload) return;
            var element;
            if (payload.elementId) {
                element = document.getElementById(payload.elementId);
            } else if (payload.selector) {
                element = document.querySelector(payload.selector);
            } else {
                element = document.scrollingElement || document.documentElement;
            }
            if (!element) return;

            function resolve(value, total, current) {
                if (typeof value !== 'string') {
                    return value != null ? parseFloat(value) : undefined;
                }
                var isRelative = (value.charAt(0) === '+' || value.charAt(0) === '-');
                var pct = value.slice(-1) === '%';
                var num = parseFloat(value); // parseFloat handles +/- prefix
                if (isNaN(num)) return undefined;
                var abs = pct ? (total * num / 100) : num;
                return isRelative ? (current + abs) : abs;
            }

            var options = { behavior: payload.behavior || 'smooth' };
            var top  = resolve(payload.top,  element.scrollHeight, element.scrollTop);
            var left = resolve(payload.left, element.scrollWidth,  element.scrollLeft);
            if (top  != null) options.top  = top;
            if (left != null) options.left = left;

            // scrollTo({ behavior: 'smooth' }) not supported iOS Safari < 15.4
            // Feature-detect and fall back to a simple rAF-based scroll
            try {
                element.scrollTo(options);
                // Test if smooth scrolling actually worked by checking support
                if (options.behavior === 'smooth'
                && !CSS.supports('scroll-behavior', 'smooth')
                && typeof element.scrollTo === 'function') {
                    throw new Error('no smooth');
                }
            } catch (e) {
                // Polyfill: linear scroll over ~300ms
                var startTop  = element.scrollTop;
                var startLeft = element.scrollLeft;
                var endTop    = options.top  != null ? options.top  : startTop;
                var endLeft   = options.left != null ? options.left : startLeft;
                var startTime = null;
                var duration  = 300;
                function step(ts) {
                    if (!startTime) startTime = ts;
                    var p = Math.min((ts - startTime) / duration, 1);
                    var ease = p < 0.5 ? 2*p*p : -1+(4-2*p)*p; // ease-in-out
                    element.scrollTop  = startTop  + (endTop  - startTop)  * ease;
                    element.scrollLeft = startLeft + (endLeft - startLeft) * ease;
                    if (p < 1) requestAnimationFrame(step);
                }
                requestAnimationFrame(step);
            }
        }, key || 'Q');
    };
});
