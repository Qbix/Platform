/**
 * Q.Embed — client-side runtime for the declarative action layer.
 *
 * Wires:
 *   - <q-each selectable> / <q-each multiselectable> row-click selection,
 *     with .Q_selected CSS class and a per-q-each Set of selected keys.
 *   - <button data-action="name">, <q-submit>, or any element with
 *     data-action, dispatching the collected state to a host endpoint.
 *
 * Trust model: no author code runs on the client. Action names are fixed
 * registry lookups against Q/Embed/actions; selection state is tracked on
 * the DOM; the one dynamic dispatch (fireAction's POST) carries nothing
 * except the name, the selection map, and a plain copy of the enclosing
 * Q_scope. Q_Embed_Sanitizer::sanitize rejects unknown action names and
 * dangling data-action-target references at SAVE time, so by the time
 * code in this file runs, every attribute it reads has already passed
 * the server-side whitelist. This module is the renderer-side
 * counterpart; it never has to re-validate what the sanitizer already
 * ruled on, and the server dispatcher at /action.php/Q/embedAction
 * re-checks the action name one more time in case the registry changed
 * since save.
 *
 * Return shapes (see Q.Embed._applyResult):
 *   {redirect: "<url>"}                       top-level navigate
 *   {postMessage: true, payload: {...}}       bubble to parent via
 *                                             Q.Users.Embed.sendEvent
 *   {inline: true, payload: {...}}            merge into the embed's
 *                                             reactive page object so
 *                                             @{...} bindings update
 *                                             in place
 */
(function (Q) {
    "use strict";

    Q.Embed = Q.Embed || {};

    // qeach-element.id -> Set of selected keys
    Q.Embed.selections = Object.create(null);

    // Host code registers client-side action handlers here. Returning a
    // falsy value from a handler proceeds with the server-side dispatch;
    // returning { handled: true } suppresses it.
    Q.Embed.handlers = Object.create(null);

    /**
     * Bind row-selection behavior to a <q-each> element that declared
     * selectable or multiselectable. Called by the Q/each tool after
     * each reconcile. Idempotent.
     *
     * @method initSelection
     * @param {Element} qEachElement
     */
    Q.Embed.initSelection = function (qEachElement) {
        var mode = qEachElement.hasAttribute('multiselectable') ? 'multi'
            : qEachElement.hasAttribute('selectable') ? 'single'
            : null;
        if (!mode) return;
        if (qEachElement._Q_Embed_selectionBound) return;
        qEachElement._Q_Embed_selectionBound = true;

        // An id is required for data-action-target referencing. If the
        // author didn't provide one, assign a stable one so programmatic
        // callers can still read selections.
        if (!qEachElement.id) {
            qEachElement.id = '_qeach_' + Math.random().toString(36).slice(2, 10);
        }
        var id = qEachElement.id;
        if (!Q.Embed.selections[id]) {
            Q.Embed.selections[id] = new Set();
        }
        var set = Q.Embed.selections[id];

        qEachElement.addEventListener('click', function (e) {
            var row = e.target.closest ? e.target.closest('.Q_each_row') : null;
            if (!row || !qEachElement.contains(row)) return;
            var key = row.Q_scope && row.Q_scope.key;
            if (key === undefined || key === null) return;

            if (set.has(key)) {
                set.delete(key);
                row.classList.remove('Q_selected');
            } else {
                if (mode === 'single') {
                    set.clear();
                    var prev = qEachElement.querySelectorAll('.Q_selected');
                    for (var i = 0; i < prev.length; i++) {
                        prev[i].classList.remove('Q_selected');
                    }
                }
                set.add(key);
                row.classList.add('Q_selected');
            }
        }, false);
    };

    /**
     * Collect the current selection state as a {qeachId: [key,...]} map.
     * If targetId is provided, returns only that q-each's selection in
     * the same shape (single-key entry). Returns a plain object; arrays
     * preserve insertion order.
     *
     * @method collectSelections
     * @param {String} [targetId]
     * @return {Object}
     */
    Q.Embed.collectSelections = function (targetId) {
        var out = Object.create(null);
        if (targetId) {
            var set = Q.Embed.selections[targetId];
            out[targetId] = set ? Array.from(set) : [];
            return out;
        }
        for (var id in Q.Embed.selections) {
            out[id] = Array.from(Q.Embed.selections[id]);
        }
        return out;
    };

    /**
     * Fire an action from a clicked element. Reads data-action and
     * optional data-action-target; collects selections; calls the
     * registered client-side handler if one exists; then (unless the
     * handler returned { handled: true }) posts to the server endpoint.
     *
     * @method fireAction
     * @param {Element} el
     * @param {Object} [opts]
     * @param {String} [opts.endpoint='/action.php/Q/embedAction'] POST target
     * @param {Function} [opts.onResult] receives (err, result)
     */
    Q.Embed.fireAction = function (el, opts) {
        opts = opts || {};
        var name = el.getAttribute('data-action');
        if (!name) return;
        var target = el.getAttribute('data-action-target') || null;
        var selections = Q.Embed.collectSelections(target);

        var ctx = {
            name: name,
            selections: selections,
            // scope is resolved by Q.Template.bind's session.scopeOf; for
            // now the publisherId/streamName come from the embed tool's
            // state if available.
            scope: Q.Embed._scopeFor(el)
        };

        // Local handler first.
        var handler = Q.Embed.handlers[name];
        if (typeof handler === 'function') {
            var short = handler(ctx, el);
            if (short && short.handled) {
                if (typeof opts.onResult === 'function') opts.onResult(null, short);
                return;
            }
        }

        // Server dispatch.
        var endpoint = opts.endpoint || '/action.php/Q/embedAction';
        if (typeof Q.request !== 'function') {
            // No Q.request available (minimal bundle) -- fire a fetch and
            // let the caller handle the response.
            fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(ctx),
                credentials: 'same-origin'
            }).then(function (r) { return r.json(); })
              .then(function (result) {
                  Q.Embed._applyResult(result, el);
                  if (typeof opts.onResult === 'function') opts.onResult(null, result);
              })
              .catch(function (err) {
                  if (typeof opts.onResult === 'function') opts.onResult(err);
              });
            return;
        }
        Q.request(endpoint, ctx, function (err, result) {
            if (err) {
                if (typeof opts.onResult === 'function') opts.onResult(err);
                return;
            }
            Q.Embed._applyResult(result, el);
            if (typeof opts.onResult === 'function') opts.onResult(null, result);
        });
    };

    /**
     * Apply a server-side action result per its returnShape.
     *
     * The dispatcher at /action.php/Q/embedAction always normalizes the
     * handler's return to one of three shapes, so this switch covers the
     * whole protocol:
     *   - redirect: assign to window.location (iframe navigates; the
     *     parent sees a new load event and can observe through
     *     Q.Users.Embed.onReady).
     *   - postMessage: emit as an 'embed:action' event. If the host page
     *     loaded Q.Users.Embed, delivery goes through its sendEvent
     *     (which carries origin/generation checks on the parent side).
     *     Otherwise we fall back to a raw postMessage to window.parent
     *     with targetOrigin '*' -- acceptable because this message is
     *     information, not a trust decision.
     *   - inline: merge payload keys into the enclosing Streams/embed
     *     tool's reactive page object. A top-level "page" key replaces
     *     fields of the page root; any other keys merge at the root.
     *     Writes land on the Proxy, so every @{...} binding that depends
     *     on a changed path re-evaluates automatically.
     */
    Q.Embed._applyResult = function (result, el) {
        if (!result) return;
        if (result.redirect) {
            try { window.location = result.redirect; } catch (e) {}
            return;
        }
        if (result.postMessage) {
            try {
                if (Q.Users && Q.Users.Embed && typeof Q.Users.Embed.sendEvent === 'function') {
                    Q.Users.Embed.sendEvent('embed:action', result.payload || {});
                } else if (window.parent && window.parent !== window) {
                    window.parent.postMessage({
                        type: 'Q.Users.Embed.event',
                        payload: { name: 'embed:action', data: result.payload || {} }
                    }, '*');
                }
            } catch (e) {}
            return;
        }
        if (result.inline && result.payload) {
            // Merge payload keys into the observed page object of the
            // enclosing Streams/embed tool. The session's Proxy will
            // propagate the writes to any @{...} bindings. When the
            // payload names "page", it replaces top-level page fields;
            // otherwise its keys merge at the page root.
            var tool = Q.Tool && Q.Tool.from ? Q.Tool.from(el, 'Streams/embed') : null;
            if (tool && tool.Q_embed_page) {
                var merge = result.payload.page || result.payload;
                for (var k in merge) {
                    tool.Q_embed_page[k] = merge[k];
                }
            } else if (tool && tool.state) {
                for (var k2 in result.payload) tool.state[k2] = result.payload[k2];
                if (typeof tool.stateChanged === 'function') tool.stateChanged();
            }
        }
    };

    /**
     * Resolve the scope visible at a given DOM element. Walks up looking
     * for a Q_scope marker on an ancestor (set by Q/each row creation).
     */
    Q.Embed._scopeFor = function (el) {
        for (var p = el; p; p = p.parentNode) {
            if (p.Q_scope) {
                // Copy enumerable own keys only; avoid leaking the
                // reactive proxy itself.
                var out = {};
                for (var k in p.Q_scope) out[k] = p.Q_scope[k];
                return out;
            }
        }
        return {};
    };

    /**
     * Bind the delegated click handler that catches data-action /
     * <q-submit> elements. Call once per embed root. Idempotent.
     *
     * @method bindActions
     * @param {Element} root
     */
    Q.Embed.bindActions = function (root) {
        if (root._Q_Embed_actionsBound) return;
        root._Q_Embed_actionsBound = true;
        root.addEventListener('click', function (e) {
            var el = e.target.closest ? e.target.closest('[data-action],q-submit') : null;
            if (!el || !root.contains(el)) return;
            // <q-submit> without an explicit data-action defaults to "submit".
            if (el.localName === 'q-submit' && !el.getAttribute('data-action')) {
                el.setAttribute('data-action', 'submit');
            }
            e.preventDefault();
            Q.Embed.fireAction(el);
        }, false);
    };

})(window.Q || (window.Q = {}));
