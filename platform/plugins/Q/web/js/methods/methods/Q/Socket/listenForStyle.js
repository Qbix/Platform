Q.exports(function (Q) {
    /**
     * Q plugin's front end code
     *
     * @module Q
     * @class Q.Socket
     */

    /**
     * Starts listening for Q/style socket events.
     * Injects a scoped <style> element targeting a specific DOM element.
     * Payload: { elementId?, selector?, vars?, rules?, css? }
     *
     * elementId: id of the element to scope styles to. Defaults to document.body.
     * selector:  CSS selector scoped within elementId via @scope. Defaults to "*".
     * vars:      object of CSS custom property name → value.
     * rules:     object of CSS property → value (camelCase or kebab-case both work).
     * css:       arbitrary CSS string appended after vars/rules, for pseudo-elements,
     *            @media, @keyframes, etc.
     *
     * Each call replaces the previous Q/style injection for that elementId,
     * so repeated calls are idempotent — the last payload wins.
     *
     * @static
     * @method listenForStyle
     * @param {String} [key] Handler key for Q.Event.set
     */
    return function _Q_Socket_listenForStyle(key) {
        Q.Socket.onEvent('Q/style').set(function (payload) {
            var id = payload.elementId;
            var element = id ? document.getElementById(id) : document.body;
            if (!element) return;

            // Remove previous Q/style injection for this element
            var styleId = 'Q_style_' + (id || 'body');
            var existing = document.getElementById(styleId);
            if (existing) existing.remove();

            var selector = payload.selector || '*';
            var css = '';

            if (id) {
                // @scope scopes rules to descendants of this specific element
                // without adding a class or id to child elements
                css += '@scope (#' + id + ') {\n';
                css += '  ' + selector + ' {\n';
                Q.each(payload.vars  || {}, function (k, v) { css += '    ' + k + ': ' + v + ';\n'; });
                Q.each(payload.rules || {}, function (k, v) { css += '    ' + k + ': ' + v + ';\n'; });
                css += '  }\n}\n';
            } else {
                // No elementId — apply to document.body scope
                css += 'body ' + selector + ' {\n';
                Q.each(payload.vars  || {}, function (k, v) { css += '  ' + k + ': ' + v + ';\n'; });
                Q.each(payload.rules || {}, function (k, v) { css += '  ' + k + ': ' + v + ';\n'; });
                css += '}\n';
            }
            // Arbitrary block for pseudo-elements, @media, @keyframes, etc.
            if (payload.css) css += payload.css;

            var style = document.createElement('style');
            style.id = styleId;
            style.textContent = css;
            document.head.appendChild(style);
        }, key || 'Q');
    };
});
