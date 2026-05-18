Q.exports(function (Q) {
    /**
     * Q plugin's front end code
     *
     * @module Q
     * @class Q.Socket
     */

    /**
     * Starts listening for Q/style event
     * @static
     * @method listenForStyle
     * @param {Object} [options={}] Can be one of the following options
     */
    return function _Q_Socket_listenForStyle(key) {
        Q.Socket.onEvent('Q/style').set(function (payload) {
            var id = payload.elementId; // tool.element.id, set by caller
            var element = id ? document.getElementById(id) : document.body;
            if (!element) return;
            
            // Remove previous Q/style injection for this element
            var styleId = 'Q_style_' + id;
            var existing = document.getElementById(styleId);
            if (existing) existing.remove();
            
            var css = '';
            var selector = payload.selector || '*';
            
            // @scope scopes rules to descendants of element without class/id pollution
            css += '@scope (#' + id + ') {\n';
            css += '  ' + selector + ' {\n';
            Q.each(payload.vars  || {}, function (k, v) { css += '    ' + k + ': ' + v + ';\n'; });
            Q.each(payload.rules || {}, function (k, v) { css += '    ' + k + ': ' + v + ';\n'; });
            css += '  }\n}\n';
            if (payload.css) css += payload.css; // arbitrary block for pseudo-elements etc.
            
            var style = document.createElement('style');
            style.id = styleId;
            style.textContent = css;
            document.head.appendChild(style);
        }, 'Q');
    };
});