/**
 * @module Q-tools
 */

/**
 * Load the shared binding engine and create a binding session. Define the
 * Q.Template.bind Q.Method stub once in Q.minimal.js, pointing to this file.
 * The method always returns a Promise, including after lazy loading.
 *
 * A session resolves expressions against fields, then session.data,
 * then window. Put changing page data in session.data and assign through it.
 * A tool's state is proxied when options.tool is supplied. Writes through
 * tool.state (including nested writes) update @{...}; setState() keeps its
 * existing onStateChanged behavior. Explicit stateChanged() also invalidates
 * bindings in the tool's session. Writes through an old raw object reference
 * are not observable; use stateChanged() for those.
 *
 * ${expr} reads once; @{expr} tracks Proxy reads. ${{expr}} and @{{expr}}
 * insert trusted HTML into content, never attributes. Expression text is
 * trusted application code, compiled with Function (requires unsafe-eval CSP).
 *
 * @method bind
 * @for Q.Template
 * @param {String} name Name used in errors, e.g. "Q/each".
 * @param {Object} [fields] Lexical values. Defaults to the reactive data store.
 * @param {Object} [options] Session options.
 * @param {Q.Tool} [options.tool=null] Tool whose state and lifecycle to observe.
 * @param {Boolean} [options.live=false] Default for session.watch if omitted.
 * @return {Promise} Resolves to a session with data, observe, evaluate,
 *   unwrap, watch, stamp, disposeTree and dispose.
 * @example
 *   Q.Template.bind('my view').then(function (session) {
 *     session.data.page = { title: 'Hello' };
 *     session.watch('page.title', function (value) {
 *       title.textContent = value;
 *     }, null, true);
 *     session.data.page.title = 'Goodbye';
 *   });
 */
Q.exports(function (Q) {
    var proxies = new WeakMap();
    var deps = new WeakMap();
    var active = null;
    var nextId = 0;

    function bucket(target, key) {
        var map = deps.get(target);
        if (!map) deps.set(target, map = new Map());

        var set = map.get(key);
        if (!set) map.set(key, set = new Set());
        return set;
    }

    function observe(object, notify, top) {
        if (!object || typeof object !== 'object') return object;
        if (proxies.has(object)) return proxies.get(object);

        var proxy = new Proxy(object, {
            get: function (target, key, receiver) {
                if (active && typeof key !== 'symbol') {
                    var set = bucket(target, key);
                    set.add(active);
                    active.deps.add(set);
                }
                return observe(
                    Reflect.get(target, key, receiver),
                    notify,
                    top || key
                );
            },

            set: function (target, key, value, receiver) {
                var old = target[key];
                var ok = Reflect.set(
                    target, key, value, receiver
                );

                if (ok && !Object.is(old, value)) {
                    bucket(target, key).forEach(function (effect) {
                        effect.schedule();
                    });

                    if (Array.isArray(target)) {
                        bucket(target, 'length').forEach(
                            function (effect) {
                                effect.schedule();
                            }
                        );
                    }

                    if (notify) notify(top || key);
                }
                return ok;
            },

            deleteProperty: function (target, key) {
                var had = key in target;
                var ok = Reflect.deleteProperty(
                    target, key
                );

                if (had && ok) {
                    bucket(target, key).forEach(
                        function (effect) {
                            effect.schedule();
                        }
                    );
                    if (notify) notify(top || key);
                }
                return ok;
            }
        });

        proxies.set(object, proxy);
        proxies.set(proxy, proxy);
        return proxy;
    }

    var data = observe({});

    function effect(read, write, session) {
        var current = {
            deps: new Set(),
            pending: false,
            stopped: false,

            schedule: function () {
                if (current.stopped || current.pending) return;

                current.pending = true;
                queueMicrotask(function () {
                    current.pending = false;
                    if (!current.stopped) current.run();
                });
            },

            run: function () {
                current.deps.forEach(function (set) {
                    set.delete(current);
                });
                current.deps.clear();

                var previous = active;
                var value;
                active = current;
                try {
                    value = read();
                } finally {
                    active = previous;
                }
                write(value);
            },

            stop: function () {
                current.stopped = true;
                current.deps.forEach(function (set) {
                    set.delete(current);
                });
                current.deps.clear();
                session.effects.delete(current);
            }
        };

        session.effects.add(current);
        current.run();
        return current.stop;
    }

    function compile(input) {
        var output = '';

        for (var i = 0; i < input.length;) {
            var c = input[i];

            if (c === '"' || c === "'") {
                var quote = c;
                var closed = false;
                output += c;
                i++;

                while (i < input.length) {
                    c = input[i++];
                    output += c;

                    if (c === '\\' && i < input.length) {
                        output += input[i++];
                    } else if (c === quote) {
                        closed = true;
                        break;
                    }
                }

                if (!closed) {
                    throw new SyntaxError(
                        'Unclosed string: ' + input
                    );
                }
                continue;
            }

            if (/[A-Za-z_$]/.test(c)) {
                var start = i++;
                while (i < input.length
                    && /[\w$]/.test(input[i])) {
                    i++;
                }

                var word = input.slice(start, i);

                while (input[i] === '-'
                    && /[A-Za-z_$]/.test(
                        input[i + 1] || ''
                    )) {
                    i++;
                    var part = i++;

                    while (i < input.length
                        && /[\w$]/.test(input[i])) {
                        i++;
                    }

                    word += '.' + input.slice(part, i);
                }

                output += word;
                continue;
            }

            if (c === '-'
                && !(/\s/.test(input[i - 1] || '')
                    && /\s/.test(input[i + 1] || ''))
                && !(/[0-9]/.test(input[i + 1] || '')
                    && (i === 0
                        || /[=(,+*/!?:]/.test(
                            input[i - 1] || ''
                        )))) {
                throw new SyntaxError(
                    'Subtraction needs spaces: ' + input
                );
            }

            output += c;
            i++;
        }

        return output;
    }

    function makeSession(name, fields, options) {
        options = options || {};
        var owners = [];

        var session = {
            name: name,
            data: data,
            observe: observe,
            effects: new Set(),
            fields: fields || data,

            scopeOf: function (element) {
                for (var p = element.parentNode;
                    p;
                    p = p.parentNode) {
                    if (p.Q_scope) return p.Q_scope;

                    if (p.Q && p.Q.tool
                        && p.Q.tool.state) {
                        session.useTool(p.Q.tool);
                        var scope =
                            Object.create(data);

                        Object.keys(p.Q.tool.state).forEach(
                            function (key) {
                                Object.defineProperty(
                                    scope,
                                    key,
                                    {
                                        enumerable: true,
                                        get: function () {
                                            return p.Q.tool
                                                .state[key];
                                        }
                                    }
                                );
                            }
                        );

                        return scope;
                    }
                }
                return data;
            },

            useTool: function (owner) {
                if (!owner
                    || owners.indexOf(owner) >= 0) {
                    return;
                }

                owners.push(owner);

                if (!owner.Q_bindReactive) {
                    var suppress = 0;
                    var originalSetState =
                        owner.setState;

                    owner.state = observe(
                        owner.state,
                        function (top) {
                            if (!suppress) {
                                owner.stateChanged(
                                    String(top)
                                );
                            }
                        }
                    );

                    owner.setState = function (updates) {
                        suppress++;
                        try {
                            return originalSetState.call(
                                this, updates
                            );
                        } finally {
                            suppress--;
                        }
                    };

                    owner.Q_bindReactive = true;
                }

                owner.Q.onStateChanged('').set(
                    function () {
                        session.effects.forEach(
                            function (current) {
                                current.schedule();
                            }
                        );
                    },
                    key
                );
                owner.Q.beforeRemove.set(
                    session.dispose, key
                );
            },

            unwrap: function (source) {
                var match =
                    /^\s*([$@])\{([^{}]*)\}\s*$/.exec(
                        source
                    );

                return match
                    ? {
                        expr: match[2],
                        live: match[1] === '@'
                    }
                    : {
                        expr: source,
                        live: false
                    };
            },

            evaluate: function (source, scope) {
                var code = compile(
                    source.trim()
                );
                var values =
                    scope || session.fields;

                if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(
                    code
                ) && !/^(true|false|null|undefined)$/.test(
                    code
                )) {
                    var path = code.split('.');
                    var first = path.shift();
                    var value = first in values
                        ? values[first]
                        : window[first];

                    while (path.length) {
                        var part = path.shift();

                        if (value == null
                            || !(part in Object(value))) {
                            throw new ReferenceError(
                                name
                                + ': undefined path '
                                + code
                            );
                        }
                        value = value[part];
                    }

                    if (value === undefined) {
                        throw new ReferenceError(
                            name
                            + ': undefined path '
                            + code
                        );
                    }
                    return value;
                }

                var context = new Proxy(values, {
                    has: function (_, part) {
                        return part
                            !== Symbol.unscopables;
                    },

                    get: function (target, part) {
                        if (part
                            === Symbol.unscopables) {
                            return undefined;
                        }
                        if (part in target) {
                            return target[part];
                        }
                        if (part in window) {
                            return window[part];
                        }
                        throw new ReferenceError(
                            name
                            + ': unknown name '
                            + String(part)
                        );
                    }
                });

                return Function(
                    'scope',
                    'with (scope) { return ('
                        + code + '); }'
                )(context);
            },

            watch: function (
                source, update, scope, live
            ) {
                var parsed =
                    typeof source === 'function'
                        ? null
                        : session.unwrap(source);

                var read =
                    typeof source === 'function'
                        ? source
                        : function () {
                            return session.evaluate(
                                parsed.expr, scope
                            );
                        };

                if (live === undefined) {
                    live = (parsed && parsed.live)
                        || !!options.live;
                }

                if (live) {
                    return effect(
                        read, update, session
                    );
                }

                update(read());
                return function () {};
            },

            disposeTree: function (root) {
                var walker =
                    document.createTreeWalker(
                        root, NodeFilter.SHOW_ALL
                    );
                var nodes = [root];
                var node;

                while ((node = walker.nextNode())) {
                    nodes.push(node);
                }

                nodes.forEach(function (node) {
                    (node.Q_bindStops || []).forEach(
                        function (stop) {
                            stop();
                        }
                    );
                    node.Q_bindStops = [];
                });
            },

            clear: function (root) {
                session.disposeTree(root);

                Array.prototype.forEach.call(
                    root.children,
                    function (child) {
                        Q.Tool.remove(child, true);
                    }
                );

                root.replaceChildren();
            },

            dispose: function () {
                Array.from(session.effects).forEach(
                    function (current) {
                        current.stop();
                    }
                );

                owners.forEach(function (owner) {
                    owner.Q.onStateChanged('')
                        .remove(key);
                    owner.Q.beforeRemove
                        .remove(key);
                });
                owners = [];
            }
        };

        var key =
            'Q.Template.bind:' + (++nextId);

        if (options.tool) {
            session.useTool(options.tool);
        }
        return session;
    }

    var markers =
        /(@\{\{([^{}]*)\}\}|\$\{\{([^{}]*)\}\}|@\{([^{}]*)\}|\$\{([^{}]*)\})/g;

    function stamp(fragment, scope, session) {
        var walker = document.createTreeWalker(
            fragment,
            NodeFilter.SHOW_ELEMENT
                | NodeFilter.SHOW_TEXT
        );
        var nodes = [];
        var node;

        while ((node = walker.nextNode())) {
            nodes.push(node);
        }

        nodes.forEach(function (node) {
            for (var p = node.parentNode;
                p && p !== fragment;
                p = p.parentNode) {
                if (p.nodeType === 1
                    && /^q-(if|each|else-if|else)$/
                        .test(p.localName)) {
                    return;
                }
            }

            if (node.nodeType
                === Node.TEXT_NODE) {
                var original =
                    node.textContent;
                var match;
                var offset = 0;

                markers.lastIndex = 0;
                if (!markers.test(original)) return;
                markers.lastIndex = 0;

                var replacement =
                    document.createDocumentFragment();

                while ((match =
                    markers.exec(original))) {
                    if (match.index > offset) {
                        replacement.appendChild(
                            document.createTextNode(
                                original.slice(
                                    offset,
                                    match.index
                                )
                            )
                        );
                    }

                    (function (matched) {
                        var raw =
                            matched[2] !== undefined
                            || matched[3] !== undefined;
                        var live =
                            matched[0][0] === '@';
                        var expr =
                            matched[2] !== undefined
                                ? matched[2]
                                : matched[3] !== undefined
                                    ? matched[3]
                                    : matched[4] !== undefined
                                        ? matched[4]
                                        : matched[5];

                        if (!raw) {
                            var text =
                                document.createTextNode(
                                    ''
                                );
                            replacement.appendChild(
                                text
                            );

                            var stop = session.watch(
                                expr,
                                function (value) {
                                    text.textContent =
                                        value == null
                                            ? ''
                                            : String(value);
                                },
                                scope,
                                live
                            );

                            (text.Q_bindStops
                                || (text.Q_bindStops = [])
                            ).push(stop);
                            return;
                        }

                        var begin =
                            document.createComment(
                                'Q-html'
                            );
                        var end =
                            document.createComment(
                                '/Q-html'
                            );

                        replacement.appendChild(
                            begin
                        );
                        replacement.appendChild(
                            end
                        );

                        var current = [];
                        var stop = session.watch(
                            expr,
                            function (html) {
                                current.forEach(
                                    function (node) {
                                        session.disposeTree(
                                            node
                                        );
                                        if (node.nodeType
                                            === 1) {
                                            Q.Tool.remove(
                                                node, true
                                            );
                                        }
                                        node.remove();
                                    }
                                );

                                var template =
                                    document.createElement(
                                        'template'
                                    );
                                template.innerHTML =
                                    html == null
                                        ? ''
                                        : String(html);

                                current = Array.from(
                                    template.content
                                        .childNodes
                                );

                                end.parentNode
                                    .insertBefore(
                                        template.content,
                                        end
                                    );

                                current.forEach(
                                    function (node) {
                                        if (node.nodeType
                                            === 1
                                            && node.isConnected) {
                                            Q.activate(node);
                                        }
                                    }
                                );
                            },
                            scope,
                            live
                        );

                        (end.Q_bindStops
                            || (end.Q_bindStops = [])
                        ).push(stop);
                    })(match);

                    offset =
                        markers.lastIndex;
                }

                if (offset < original.length) {
                    replacement.appendChild(
                        document.createTextNode(
                            original.slice(offset)
                        )
                    );
                }

                node.replaceWith(replacement);
                return;
            }

            if (/^q-(if|each|else-if)$/
                .test(node.localName)) {
                return;
            }

            Array.prototype.forEach.call(
                node.attributes,
                function (attr) {
                    var original = attr.value;

                    if (/[$@]\{\{/.test(
                        original
                    )) {
                        throw new SyntaxError(
                            'Raw HTML cannot be bound '
                            + 'to an attribute'
                        );
                    }
                    if (!/[$@]\{/.test(
                        original
                    )) {
                        return;
                    }

                    var live = /@\{/.test(
                        original
                    );

                    function read() {
                        var whole =
                            /^[$@]\{([^{}]*)\}$/
                                .exec(original);

                        if (whole) {
                            return session.evaluate(
                                whole[1], scope
                            );
                        }

                        return original.replace(
                            /[$@]\{([^{}]*)\}/g,
                            function (_, expr) {
                                var value =
                                    session.evaluate(
                                        expr, scope
                                    );
                                return value == null
                                    ? ''
                                    : String(value);
                            }
                        );
                    }

                    function update(value) {
                        node.setAttribute(
                            attr.name,
                            value == null
                                ? ''
                                : typeof value
                                    === 'object'
                                    ? JSON.stringify(
                                        value
                                    )
                                    : String(value)
                        );
                    }

                    if (live) {
                        var stop = effect(
                            read,
                            update,
                            session
                        );

                        (node.Q_bindStops
                            || (node.Q_bindStops = [])
                        ).push(stop);
                    } else {
                        update(read());
                    }
                }
            );
        });

        return fragment;
    }

    return function Q_Template_bind(
        name, fields, options
    ) {
        var session = makeSession(
            name, fields, options
        );

        session.stamp = function (
            fragment, scope
        ) {
            return stamp(
                fragment,
                scope || session.fields,
                session
            );
        };

        return Promise.resolve(session);
    };
});