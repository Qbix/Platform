/**
 * @module Q-tools
 */

/**
 * Repeats the children of <q-each> for an array. Requires
 * Q.Tool.define.components = true. Give the element exactly one collection
 * attribute. Its name becomes the item variable: person="page.people"
 * exposes person and index inside each row. The special name items exposes
 * item and index.
 *
 * Collection attribute values are expressions. A bare expression or
 * ${...} reads the collection once. @{...} observes changes to the
 * collection; q-live makes a bare collection expression reactive. Hyphens
 * within expression identifiers mean dots, so page-people means
 * page.people. Subtraction requires spaces around the minus sign.
 *
 * Inline row content supports ${...} for a one-time value and @{...} for
 * a value that updates when its observed data changes. key="person.id"
 * preserves rows and their child tools when items move. Without key,
 * the row's array index is its identity.
 *
 * Set template="Name" to render each new row with Q.Template.render
 * instead of using inline children. Q.Template can find a
 * <template id="Name"> elsewhere in the document or load the named
 * template. Handlebars receives the item, index, and other current scope
 * fields. It renders once when the row is created; @{...} in the resulting
 * HTML remains reactive. A reused keyed row retains its original
 * Handlebars output.
 *
 * Changes made through a bound tool's state or setState() are observed;
 * call stateChanged() after changing state through an unobserved reference.
 *
 * @class Q each
 * @constructor
 * @param {Object} [options] Q tool options. The collection and row
 *   rendering are configured with the element attributes documented below.
 * @param {String} [options.key] Corresponds to the key attribute: an
 *   expression evaluated for each item to identify its row.
 * @param {String} [options.template] Corresponds to the template attribute:
 *   the name passed to Q.Template.render for each new row.
 * @param {Boolean} [options.qLive=false] Corresponds to the q-live
 *   attribute; makes a bare collection expression reactive when present.
 * @return {Q.Tool} The tool; call tool.refresh() to reread the collection,
 *   or tool.setItems(array) to override it.
 * @example
 *   <q-each person="@{page.people}" key="person.id">
 *     <p>${index}: @{person.name}</p>
 *   </q-each>
 *
 *   <template id="People/row">
 *     <p>{{person.name}}: @{person.score}</p>
 *   </template>
 *   <q-each person="@{page.people}" key="person.id"
 *     template="People/row"></q-each>
 */
Q.exports(function (Q) {
    Q.Tool.define('Q/each', function () {
        var tool = this, host = tool.element;
        var reserved = { id: 1, 'class': 1, style: 1, slot: 1,
            key: 1, template: 1, 'q-live': 1 };
        var declarations = Array.prototype.filter.call(host.attributes, function (attr) {
            return !reserved[attr.name] && attr.name.slice(0, 5) !== 'data-';
        });
        if (declarations.length !== 1) {
            throw new Error('Q/each needs one singular collection attribute');
        }
        var declaration = declarations[0];
        var alias = declaration.name === 'items' ? 'item' : declaration.name;
        if (!/^[a-z][\w]*$/.test(alias)) {
            throw new Error('Q/each: invalid item name ' + alias);
        }
        var keySource = host.getAttribute('key');
        var templateName = host.getAttribute('template');
        var body = document.createDocumentFragment();
        while (host.firstChild) body.appendChild(host.firstChild);
        var output = document.createElement('div');
        output.className = 'Q_each_output';
        host.appendChild(output);
        var session, scope, stop, rows = new Map(), override, removed = false;
        var hasOverride = false;

        function collection() {
            var source = session.unwrap(declaration.value);
            var items = hasOverride ? override
                : session.evaluate(source.expr, scope, '<q-each> ' + declaration.name);
            if (items == null) items = [];
            if (!Array.isArray(items)) throw new TypeError('Q/each needs an array');
            // The Proxy records length and item reads during a live watch.
            return Array.from(items);
        }
        function fieldsForTemplate(rowScope) {
            var fields = {};
            for (var field in rowScope) fields[field] = rowScope[field];
            return fields;
        }
        function reconcile(items) {
            var next = new Map(), seen = new Set();
            items.forEach(function (item, index) {
                var rowScope = Object.create(scope || session.data);
                var id = keySource
                    ? session.evaluate(session.unwrap(keySource).expr, rowScope, 'key')
                    : index;
                rowScope[alias] = session.observe(item);
                rowScope.index = index;
                rowScope.key = id;
                if (seen.has(id)) throw new Error('Q/each: duplicate key ' + id);
                seen.add(id);
                var entry = rows.get(id);
                if (!entry) {
                    var row = document.createElement('div');
                    row.className = 'Q_each_row';
                    row.Q_scope = session.observe(rowScope);
                    entry = { row: row, removed: false };
                    if (templateName !== null) {
                        (function (itemEntry, fields) {
                            Q.Template.render(templateName, fields,
                                { tool: tool }).then(function (html) {
                                if (removed || itemEntry.removed) return;
                                var template = document.createElement('template');
                                template.innerHTML = html;
                                itemEntry.row.appendChild(session.stamp(
                                    template.content, itemEntry.row.Q_scope));
                                Q.activate(itemEntry.row);
                            }).catch(function (err) {
                                if (!removed && !itemEntry.removed)
                                    console.error('Q/each template:', err);
                            });
                        })(entry, fieldsForTemplate(row.Q_scope));
                    } else {
                        row.appendChild(session.stamp(body.cloneNode(true), row.Q_scope));
                    }
                } else {
                    entry.row.Q_scope[alias] = session.observe(item);
                    entry.row.Q_scope.index = index;
                    entry.row.Q_scope.key = id;
                }
                next.set(id, entry);
                output.appendChild(entry.row); // Also moves an existing row into order.
                if (!entry.row.Q_eachActivated) {
                    entry.row.Q_eachActivated = true;
                    Q.activate(entry.row);
                }
            });
            rows.forEach(function (entry, id) {
                if (next.has(id)) return;
                entry.removed = true;
                session.disposeTree(entry.row);
                Q.Tool.remove(entry.row, true);
                entry.row.remove();
            });
            rows = next;
        }
        tool.refresh = function () {
            if (session) reconcile(collection());
        };
        tool.setItems = function (items) {
            hasOverride = true;
            override = session ? session.observe(items) : items;
            tool.refresh();
        };
        tool.Q.beforeRemove.set(function () {
            removed = true;
            if (stop) stop();
            if (session) session.clear(output);
            rows.forEach(function (entry) { entry.removed = true; });
            rows.clear();
        });
        Q.Template.bind('Q/each', null, { tool: tool }).then(function (result) {
            if (removed || !host.isConnected) { result.dispose(); return; }
            session = result;
            scope = session.scopeOf(host);
            if (hasOverride) override = session.observe(override);
            var live = session.unwrap(declaration.value).live
                || host.hasAttribute('q-live') && host.getAttribute('q-live') !== 'false';
            if (live) stop = session.watch(collection, reconcile, scope, true);
            else reconcile(collection());
        }).catch(function (err) {
            console.error('Q/each binding:', err);
        });
    }, {}, []);
});