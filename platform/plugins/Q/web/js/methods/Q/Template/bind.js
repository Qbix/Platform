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
 * insert trusted HTML into content, never attributes.
 *
 * Expressions parse by default against a restricted grammar: identifier-chain
 * paths, number/string/true/false/null literals, boolean operators
 * (!, &&, ||), equality (===, !==, ==, !=), comparison (<, >, <=, >=),
 * arithmetic (+, -, *, /, %), and parentheses. Function calls, [] indexing,
 * new, typeof, this, assignment, template literals, and property access to
 * constructor / __proto__ / prototype are rejected at parse time. Paths
 * resolve against scope only; no window fallback. The parser doubles as the
 * save-time validator for user-authored templates (embeds).
 *
 * Pass options.unsafeEval = true to opt back into the legacy behavior:
 * fast-path identifier walker with window[first] fallback and
 * Function + with(scope) slow path for arbitrary JavaScript. Only use this
 * for first-party templates whose source is trusted. Requires unsafe-eval
 * CSP when the slow path is exercised.
 *
 * @method bind
 * @for Q.Template
 * @param {String} name Name used in errors, e.g. "Q/each".
 * @param {Object} [fields] Lexical values. Defaults to the reactive data store.
 * @param {Object} [options] Session options.
 * @param {Q.Tool} [options.tool=null] Tool whose state and lifecycle to observe.
 * @param {Boolean} [options.live=false] Default for session.watch if omitted.
 * @param {Boolean} [options.unsafeEval=false] Set true to use the legacy
 *   Function-based evaluator with window fallback. Only for trusted
 *   first-party templates.
 * @param {RegExp|Array} [options.embedTemplates] If set, Q/if and Q/each
 *   refuse to render any template="Name" whose name doesn't match. A
 *   RegExp is tested against the name; an Array requires exact match.
 *   Programmatic Q.Template.render calls elsewhere are not gated here.
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

    // -------------------------------------------------------------------
    // Restricted expression evaluator
    // -------------------------------------------------------------------
    // Used when options.unsafeEval is falsy (default). Hand-rolled
    // tokenizer + recursive-descent parser + AST interpreter. Grammar is
    // identical to Q_Embed_Expression.php (PHP side used by the sanitizer
    // at save time); any change here must be mirrored there or an embed
    // that parsed at save time will fail to run.
    //
    // Paths resolve against the lexical scope passed into the interpreter
    // -- there is NO window fallback, NO function calls, NO [] indexing,
    // NO template literals, NO assignment, and NO property access to
    // constructor / __proto__ / prototype (banned in parsePrimary). An
    // identifier chain that walks through a null or undefined value in
    // the middle throws ReferenceError at interpret time; the sanitizer
    // has already rejected unknown roots at save time, so the only
    // intermediate-null case left at render is a value that's truly
    // missing from the current scope.
    //
    // ASTs are cached module-wide, keyed by the already-compiled source
    // string, so repeated evaluation (e.g. once per Q/each row) is cheap.

    var astCache = new Map();

    var BANNED_PROPERTIES = {
        'constructor': 1, '__proto__': 1, 'prototype': 1,
        '__defineGetter__': 1, '__defineSetter__': 1,
        '__lookupGetter__': 1, '__lookupSetter__': 1
    };

    function tokenize(source, name) {
        var tokens = [];
        var i = 0;
        var L = source.length;

        while (i < L) {
            var c = source[i];

            if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
                i++; continue;
            }

            if (c === '"' || c === "'") {
                var quote = c;
                var str = '';
                i++;
                while (i < L && source[i] !== quote) {
                    if (source[i] === '\\' && i + 1 < L) {
                        var next = source[i + 1];
                        str += next === 'n' ? '\n'
                            : next === 't' ? '\t'
                            : next === 'r' ? '\r'
                            : next === '\\' ? '\\'
                            : next === quote ? quote
                            : next;
                        i += 2;
                    } else {
                        str += source[i++];
                    }
                }
                if (i >= L) {
                    throw new SyntaxError(name + ': unclosed string in ' + source);
                }
                i++;
                tokens.push({ type: 'string', value: str });
                continue;
            }

            if (c >= '0' && c <= '9') {
                var start = i;
                while (i < L && source[i] >= '0' && source[i] <= '9') i++;
                if (source[i] === '.' && source[i + 1] >= '0' && source[i + 1] <= '9') {
                    i++;
                    while (i < L && source[i] >= '0' && source[i] <= '9') i++;
                }
                if (source[i] === 'e' || source[i] === 'E') {
                    i++;
                    if (source[i] === '+' || source[i] === '-') i++;
                    while (i < L && source[i] >= '0' && source[i] <= '9') i++;
                }
                tokens.push({ type: 'number', value: parseFloat(source.slice(start, i)) });
                continue;
            }

            if (/[A-Za-z_$]/.test(c)) {
                var is = i;
                while (i < L && /[\w$]/.test(source[i])) i++;
                tokens.push({ type: 'ident', text: source.slice(is, i) });
                continue;
            }

            if (c === '=' && source[i + 1] === '=' && source[i + 2] === '=') {
                tokens.push({ type: 'op', text: '===' }); i += 3; continue;
            }
            if (c === '!' && source[i + 1] === '=' && source[i + 2] === '=') {
                tokens.push({ type: 'op', text: '!==' }); i += 3; continue;
            }
            if (c === '=' && source[i + 1] === '=') {
                tokens.push({ type: 'op', text: '==' }); i += 2; continue;
            }
            if (c === '!' && source[i + 1] === '=') {
                tokens.push({ type: 'op', text: '!=' }); i += 2; continue;
            }
            if (c === '<' && source[i + 1] === '=') {
                tokens.push({ type: 'op', text: '<=' }); i += 2; continue;
            }
            if (c === '>' && source[i + 1] === '=') {
                tokens.push({ type: 'op', text: '>=' }); i += 2; continue;
            }
            if (c === '&' && source[i + 1] === '&') {
                tokens.push({ type: 'op', text: '&&' }); i += 2; continue;
            }
            if (c === '|' && source[i + 1] === '|') {
                tokens.push({ type: 'op', text: '||' }); i += 2; continue;
            }

            if ('<>!+-*/%'.indexOf(c) >= 0) {
                tokens.push({ type: 'op', text: c }); i++; continue;
            }
            if (c === '.' || c === '(' || c === ')') {
                tokens.push({ type: 'punct', text: c }); i++; continue;
            }

            throw new SyntaxError(name + ': unexpected character ' + c + ' in ' + source);
        }

        return tokens;
    }

    function parseExpression(source, name) {
        if (astCache.has(source)) return astCache.get(source);

        var tokens = tokenize(source, name);
        var state = { tokens: tokens, i: 0, name: name, source: source };
        var ast = parseOr(state);

        if (state.i !== tokens.length) {
            var leftover = tokens[state.i];
            throw new SyntaxError(name + ': unexpected ' + leftover.text + ' in ' + source);
        }

        astCache.set(source, ast);
        return ast;
    }

    function matchOp(state, text) {
        var t = state.tokens[state.i];
        if (t && t.type === 'op' && t.text === text) { state.i++; return true; }
        return false;
    }

    function matchAnyOp(state, texts) {
        var t = state.tokens[state.i];
        if (t && t.type === 'op' && texts.indexOf(t.text) >= 0) {
            state.i++;
            return t.text;
        }
        return null;
    }

    function parseOr(state) {
        var left = parseAnd(state);
        while (matchOp(state, '||')) {
            left = { op: '||', left: left, right: parseAnd(state) };
        }
        return left;
    }

    function parseAnd(state) {
        var left = parseEquality(state);
        while (matchOp(state, '&&')) {
            left = { op: '&&', left: left, right: parseEquality(state) };
        }
        return left;
    }

    function parseEquality(state) {
        var left = parseCompare(state);
        var op;
        while ((op = matchAnyOp(state, ['===', '!==', '==', '!=']))) {
            left = { op: op, left: left, right: parseCompare(state) };
        }
        return left;
    }

    function parseCompare(state) {
        var left = parseAdditive(state);
        var op;
        while ((op = matchAnyOp(state, ['<=', '>=', '<', '>']))) {
            left = { op: op, left: left, right: parseAdditive(state) };
        }
        return left;
    }

    function parseAdditive(state) {
        var left = parseMultiplicative(state);
        var op;
        while ((op = matchAnyOp(state, ['+', '-']))) {
            left = { op: op, left: left, right: parseMultiplicative(state) };
        }
        return left;
    }

    function parseMultiplicative(state) {
        var left = parseUnary(state);
        var op;
        while ((op = matchAnyOp(state, ['*', '/', '%']))) {
            left = { op: op, left: left, right: parseUnary(state) };
        }
        return left;
    }

    function parseUnary(state) {
        var op = matchAnyOp(state, ['!', '-']);
        if (op) {
            return { op: 'u' + op, operand: parseUnary(state) };
        }
        return parsePrimary(state);
    }

    function parsePrimary(state) {
        var t = state.tokens[state.i];
        if (!t) {
            throw new SyntaxError(state.name + ': unexpected end of ' + state.source);
        }

        if (t.type === 'number') {
            state.i++;
            return { op: 'lit', value: t.value };
        }
        if (t.type === 'string') {
            state.i++;
            return { op: 'lit', value: t.value };
        }
        if (t.type === 'ident') {
            if (t.text === 'true') { state.i++; return { op: 'lit', value: true }; }
            if (t.text === 'false') { state.i++; return { op: 'lit', value: false }; }
            if (t.text === 'null') { state.i++; return { op: 'lit', value: null }; }
            if (t.text === 'undefined') { state.i++; return { op: 'lit', value: undefined }; }

            var path = [t.text];
            state.i++;
            while (state.tokens[state.i]
                && state.tokens[state.i].type === 'punct'
                && state.tokens[state.i].text === '.') {
                state.i++;
                var nxt = state.tokens[state.i];
                if (!nxt || nxt.type !== 'ident') {
                    throw new SyntaxError(state.name + ': expected identifier after . in ' + state.source);
                }
                if (BANNED_PROPERTIES[nxt.text]) {
                    throw new SyntaxError(state.name + ': property ' + nxt.text + ' is not allowed in ' + state.source);
                }
                path.push(nxt.text);
                state.i++;
            }
            return { op: 'path', path: path };
        }
        if (t.type === 'punct' && t.text === '(') {
            state.i++;
            var inner = parseOr(state);
            var close = state.tokens[state.i];
            if (!close || close.type !== 'punct' || close.text !== ')') {
                throw new SyntaxError(state.name + ': expected ) in ' + state.source);
            }
            state.i++;
            return inner;
        }
        throw new SyntaxError(state.name + ': unexpected ' + t.text + ' in ' + state.source);
    }

    // Walk an AST against a scope and return the computed value. One
    // switch per op; binary ops recurse on left then right so short-
    // circuiting (`&&`, `||`) can stop early. Paths throw ReferenceError
    // on an unknown root OR a null/undefined intermediate; the sanitizer
    // has already ruled out unknown roots at save time so this fires
    // only when a legitimate path has a hole.
    function interpretExpression(ast, values, name) {
        switch (ast.op) {
            case 'lit':
                return ast.value;
            case 'path': {
                var first = ast.path[0];
                if (!(first in values)) {
                    throw new ReferenceError(name + ': unknown name ' + first);
                }
                var value = values[first];
                for (var k = 1; k < ast.path.length; k++) {
                    var part = ast.path[k];
                    if (value == null || !(part in Object(value))) {
                        throw new ReferenceError(name + ': undefined path ' + ast.path.join('.'));
                    }
                    value = value[part];
                }
                if (value === undefined) {
                    throw new ReferenceError(name + ': undefined path ' + ast.path.join('.'));
                }
                return value;
            }
            case 'u!':
                return !interpretExpression(ast.operand, values, name);
            case 'u-':
                return -interpretExpression(ast.operand, values, name);
            case '&&': {
                var l = interpretExpression(ast.left, values, name);
                return l ? interpretExpression(ast.right, values, name) : l;
            }
            case '||': {
                var l2 = interpretExpression(ast.left, values, name);
                return l2 ? l2 : interpretExpression(ast.right, values, name);
            }
            case '===': return interpretExpression(ast.left, values, name) === interpretExpression(ast.right, values, name);
            case '!==': return interpretExpression(ast.left, values, name) !== interpretExpression(ast.right, values, name);
            case '==':  return interpretExpression(ast.left, values, name) ==  interpretExpression(ast.right, values, name);
            case '!=':  return interpretExpression(ast.left, values, name) !=  interpretExpression(ast.right, values, name);
            case '<':   return interpretExpression(ast.left, values, name) <   interpretExpression(ast.right, values, name);
            case '>':   return interpretExpression(ast.left, values, name) >   interpretExpression(ast.right, values, name);
            case '<=':  return interpretExpression(ast.left, values, name) <=  interpretExpression(ast.right, values, name);
            case '>=':  return interpretExpression(ast.left, values, name) >=  interpretExpression(ast.right, values, name);
            case '+':   return interpretExpression(ast.left, values, name) +   interpretExpression(ast.right, values, name);
            case '-':   return interpretExpression(ast.left, values, name) -   interpretExpression(ast.right, values, name);
            case '*':   return interpretExpression(ast.left, values, name) *   interpretExpression(ast.right, values, name);
            case '/':   return interpretExpression(ast.left, values, name) /   interpretExpression(ast.right, values, name);
            case '%':   return interpretExpression(ast.left, values, name) %   interpretExpression(ast.right, values, name);
        }
        throw new Error(name + ': unknown AST node ' + ast.op);
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

                if (!options.unsafeEval) {
                    var ast = parseExpression(code, name);
                    return interpretExpression(ast, values, name);
                }

                // Legacy evaluator (unsafeEval: true).
                // Fast path: identifier chain with window[first] fallback.
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

                // Legacy slow path: Function + with(Proxy).
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

            allowsTemplate: function (templateName) {
                var allowed = options.embedTemplates;
                if (!allowed) return true;
                if (allowed instanceof RegExp) {
                    return allowed.test(templateName);
                }
                if (Array.isArray(allowed)) {
                    for (var i = 0; i < allowed.length; i++) {
                        if (allowed[i] === templateName) return true;
                    }
                    return false;
                }
                return false;
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