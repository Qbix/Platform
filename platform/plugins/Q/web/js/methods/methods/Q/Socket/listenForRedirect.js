Q.exports(function (Q) {
    /**
     * Q plugin's front end code
     *
     * @module Q
     * @class Q.Socket
     */

    /**
     * Starts listening for Q/redirect socket events.
     * Navigates the page, a column, or opens a URL.
     * Payload: { url, target?, column?, replace? }
     *
     * target: "_self" (default), "_blank", "_top", or a named frame.
     * column: if true or a column index, pushes into Q/columns rather
     *   than navigating. Useful for the Intelligence Window opening
     *   an archive search or episode page inside a column without
     *   leaving the presentation.
     * replace: if true, uses history.replaceState instead of navigate,
     *   so the back button doesn't return to the previous state.
     *
     * @static
     * @method listenForRedirect
     * @param {String} [key] Handler key for Q.Event.set
     */
    return function _Q_Socket_listenForRedirect(key) {
        Q.Socket.onEvent('Q/redirect').set(function (payload) {
            if (!payload || !payload.url) return;
            var url = Q.url(payload.url);

            // Column push — stays on the same page, opens content in a column
            if (payload.column != null) {
                var columnIndex = payload.column === true ? null : payload.column;
                var columns = Q.Tool.byName('Q/columns');
                var columnsTool = columns && Q.first(columns);
                if (columnsTool) {
                    columnsTool.push({
                        url:         url,
                        columnIndex: columnIndex
                    });
                    return;
                }
                // Fall through to normal navigation if no columns tool found
            }

            // Blank target — open in new tab/window
            if (payload.target && payload.target !== '_self') {
                window.open(url, payload.target);
                return;
            }

            // Same-page navigation
            if (payload.replace) {
                Q.handle(url, { loadURI: 'replace' });
            } else {
                Q.handle(url);
            }
        }, key || 'Q');
    };
});
