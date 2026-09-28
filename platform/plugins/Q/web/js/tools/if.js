/**
 * @module Q-tools
 */

/**
 * Renders the first matching branch of a <q-if> element. Requires
 * Q.Tool.define.components = true. Branch content may be written inline
 * or supplied by a named Q.Template template.
 *
 * A condition can be a JavaScript expression in test, or one or more
 * comparison attributes. In a comparison, person-age names person.age;
 * the value is an expression compared with === by default. Prefix the
 * value with ===, !==, ==, !=, >=, <=, >, or < to choose another operator.
 * Multiple comparison attributes are combined with AND. Use test for
 * conditions needing OR or other JavaScript operators.
 *
 * Hyphens within expression identifiers mean dots: foo-bar means foo.bar.
 * Subtraction requires spaces: foo - bar. A bare condition or ${...} is
 * evaluated once; @{...} reevaluates when observed values change. q-live
 * also makes bare conditions reactive. Changes made through a bound tool's
 * state or setState() are observed; call stateChanged() after changing state
 * through an unobserved reference.
 *
 * <q-else-if> and <q-else> are branch elements inside <q-if>. Give them
 * explicit closing tags, even when they have no inline content. A branch
 * with template="Name" calls Q.Template.render with the current scope as
 * fields. Q.Template can find <template id="Name"> elsewhere in the
 * document or load the named template. Handlebars renders when the branch
 * is entered. ${...} and @{...} in its resulting HTML are then bound.
 *
 * @class Q if
 * @constructor
 * @param {Object} [options] Q tool options. Conditions and templates are
 *   configured with the element attributes documented below.
 * @param {String} [options.test] Corresponds to the test attribute: a
 *   condition expression, optionally wrapped in ${...} or @{...}.
 * @param {String} [options.template] Corresponds to the template attribute:
 *   the name passed to Q.Template.render for the matching branch.
 * @param {Boolean} [options.qLive=false] Corresponds to the q-live
 *   attribute; makes bare branch conditions reactive when present.
 * @return {Q.Tool} The tool; call tool.refresh() to reevaluate and rerender.
 * @example
 *   <q-if person-age=">= 18">
 *     Adult
 *     <q-else-if test="@{person.vip || person.staff}">
 *       Priority
 *     </q-else-if>
 *     <q-else>Other</q-else>
 *   </q-if>
 *
 *   <template id="People/active">
 *     <strong>{{person.name}}</strong>
 *   </template>
 *   <q-if test="@{person.active}" template="People/active">
 *     <q-else template="People/inactive"></q-else>
 *   </q-if>
 */
Q.exports(function (Q) {
    Q.Tool.define('Q/if', function () {
        var tool = this, host = tool.element;
        var branches = [], primary = {
            source: host.getAttribute('test'),
            comparisons: [], template: host.getAttribute('template'),
            body: document.createDocumentFragment()
        };
        branches.push(primary);
        var current = primary, seenElse = false, session, scope, stop,
            selected = -1, generation = 0, removed = false;
        var output = document.createElement('div');
        output.className = 'Q_if_output';
        var reserved = { id: 1, 'class': 1, style: 1, slot: 1,
            test: 1, template: 1, 'q-live': 1 };

        function comparisons(element, exclude) {
            return Array.prototype.filter.call(element.attributes, function (attr) {
                return !exclude[attr.name] && attr.name.slice(0, 5) !== 'data-';
            }).map(function (attr) {
                var text = attr.value.trim();
                var match = /^(===|!==|==|!=|>=|<=|>|<)(?=\s|[$@]\{)/.exec(text);
                var operator = match ? match[0] : '===';
                if (match) text = text.slice(operator.length).trim();
                if (!text) throw new SyntaxError('Empty comparison: ' + attr.name);
                return { left: attr.name.replace(/-/g, '.'), right: text,
                    operator: operator, label: attr.name };
            });
        }
        primary.comparisons = comparisons(host, reserved);
        if (primary.source === null && !primary.comparisons.length) {
            primary.source = 'true';
        }

        // Capture children before Q activates them. A branch element may
        // contain its content or be an empty, explicitly closed marker.
        while (host.firstChild) {
            var node = host.firstChild;
            host.removeChild(node);
            var tag = node.nodeType === 1 ? node.localName : '';
            if (tag !== 'q-else-if' && tag !== 'q-else') {
                current.body.appendChild(node);
                continue;
            }
            if (seenElse) throw new Error('Q/if: branch after q-else');
            if (tag === 'q-else') seenElse = true;
            var branch = {
                source: tag === 'q-else' ? null : node.getAttribute('test'),
                comparisons: tag === 'q-else' ? [] : comparisons(node,
                    reserved),
                template: node.getAttribute('template'),
                body: document.createDocumentFragment()
            };
            if (tag === 'q-else-if' && (branch.source === null) === !branch.comparisons.length) {
                throw new Error('Q/else-if requires either test or comparisons');
            }
            while (node.firstChild) branch.body.appendChild(node.firstChild);
            branches.push(branch);
            current = branch;
        }
        host.appendChild(output);

        function choose() {
            return branches.findIndex(function (branch) {
                if (branch.source !== null) {
                    return !!session.evaluate(session.unwrap(branch.source).expr, scope, 'test');
                }
                if (!branch.comparisons.length) return true; // else
                return branch.comparisons.every(function (c) {
                    var lhs = session.evaluate(c.left, scope, c.label + ' left');
                    var rhs = session.evaluate(session.unwrap(c.right).expr, scope, c.label + ' right');
                    switch (c.operator) {
                        case '===': return lhs === rhs;
                        case '!==': return lhs !== rhs;
                        case '==': return lhs == rhs;
                        case '!=': return lhs != rhs;
                        case '>=': return lhs >= rhs;
                        case '<=': return lhs <= rhs;
                        case '>': return lhs > rhs;
                        case '<': return lhs < rhs;
                    }
                });
            });
        }
        function fieldsForTemplate() {
            var fields = {};
            for (var key in scope) fields[key] = scope[key];
            return fields;
        }
        function render(index, force) {
            if (!force && index === selected) return;
            selected = index;
            var version = ++generation;
            session.clear(output);
            if (index < 0) return;
            var branch = branches[index];
            if (branch.template !== null) {
                Q.Template.render(branch.template, fieldsForTemplate(),
                    { tool: tool }).then(function (html) {
                    if (removed || version !== generation) return;
                    var template = document.createElement('template');
                    template.innerHTML = html;
                    output.appendChild(session.stamp(template.content, scope));
                    Q.activate(output);
                }).catch(function (err) {
                    if (!removed && version === generation) console.error('Q/if template:', err);
                });
            } else {
                output.appendChild(session.stamp(branch.body.cloneNode(true), scope));
                Q.activate(output);
            }
        }
        function isLive() {
            return host.hasAttribute('q-live') && host.getAttribute('q-live') !== 'false'
                || branches.some(function (branch) {
                    return branch.source !== null && session.unwrap(branch.source).live
                        || branch.comparisons.some(function (c) {
                            return session.unwrap(c.right).live;
                        });
                });
        }
        tool.refresh = function () {
            if (session) render(choose(), true);
        };
        tool.Q.beforeRemove.set(function () {
            removed = true;
            ++generation;
            if (stop) stop();
            if (session) session.clear(output);
        });
        Q.Template.bind('Q/if', null, { tool: tool }).then(function (result) {
            if (removed || !host.isConnected) { result.dispose(); return; }
            session = result;
            scope = session.scopeOf(host);
            if (isLive()) {
                stop = session.watch(function () { return choose(); }, function (index) {
                    render(index, false);
                }, scope, true);
            } else {
                render(choose(), false);
            }
        }).catch(function (err) {
            console.error('Q/if binding:', err);
        });
    }, {}, []);
});