Q.exports(function (Q) {
    /**
     * Register a Custom Element for a Q tool. Hyphenated attributes resolve to
     * camelCase keys (publisher-id -> publisherId). A schema may instead declare
     * a nested path (foo-bar -> options.foo.bar).
     *
     * Event attributes such as on-custom-event="App.handlers.changed" require
     * a matching Q.Event in the tool's default options. Q.extend installs the
     * dotted handler path on that event; Q.handle resolves it when it fires.
     */
    return function Q_Tool_define_component(name, ctor) {
        if (typeof customElements === 'undefined') return;

        var tagName = name.toLowerCase().replace(/[/_]/g, '-');
        if (customElements.get(tagName)) return;
        var stateKeys = ctor.stateKeys;
        var last = Array.isArray(stateKeys) && stateKeys[stateKeys.length - 1];
        var schema = Q.isPlainObject(last) ? last : null;
        var attrTypeMap = Object.create(null);
        var attrNameMap = Object.create(null);
        var eventMap = Object.create(null);
        if (schema) flattenSchema(schema, []);

        var defaults = ctor.options || {};
        Object.keys(defaults).forEach(function (key) {
            if (Q.typeOf(defaults[key]) === 'Q.Event') {
                eventMap[camelToHyphen(key)] = key;
            }
        });

        function camelToHyphen(s) {
            return s.replace(/([A-Z])/g, function (c) {
                return '-' + c.toLowerCase();
            });
        }

        function hyphenToCamel(s) {
            return s.replace(/-([a-z])/g, function (_, c) {
                return c.toUpperCase();
            });
        }

        function flattenSchema(node, path) {
            Object.keys(node).forEach(function (key) {
                var val = node[key];
                var next = path.concat(key);
                var attr = next.map(camelToHyphen).join('-');

                if (val && typeof val.from === 'function') {
                    attrTypeMap[attr] = val;
                    attrNameMap[attr] = next;
                } else if (Q.isPlainObject(val)) {
                    flattenSchema(val, next);
                }
            });
        }

        function infer(s) {
            if (s === 'true') return true;
            if (s === 'false') return false;
            if (s === 'null') return null;
            if (s === '') return true;
            if (/^-?\d+$/.test(s)) return parseInt(s, 10);
            if (/^-?\d*\.\d+$/.test(s)) return parseFloat(s);

            if (s[0] === '{' || s[0] === '[') {
                try {
                    return JSON.parse(s);
                } catch (e) {}
            }

            return s;
        }

        function resolve(name, value) {
            var key = name.toLowerCase();
            var path = attrNameMap[key]
                || [key.indexOf('-') < 0 ? key : hyphenToCamel(key)];
            var optionKey = path.length === 1 ? path[0] : null;
            var isEvent = optionKey
                && Q.typeOf(defaults[optionKey]) === 'Q.Event';
            var type = attrTypeMap[key];
            var converted;

            if (isEvent) {
                // Q.extend recognizes this keyed object when its target is a
                // Q.Event. Q.handle resolves the string when the event fires.
                converted = {};
                converted['component:' + key] = value;
            } else {
                converted = type
                    ? type.from(value === null ? '' : value)
                    : value === null ? true : infer(value);
            }

            return {
                path: path,
                value: converted,
                event: isEvent
            };
        }

        function attrsToOptions(element) {
            var options = {};
            var ownDataAttr = 'data-' + tagName;
            var blob = element.getAttribute(ownDataAttr);

            if (blob) {
                try {
                    var parsed = JSON.parse(blob);
                    if (Q.isPlainObject(parsed)) {
                        Q.extend(options, Q.Tool.options.levels, parsed);
                    }
                } catch (e) {}
            }

            Array.prototype.forEach.call(element.attributes, function (attr) {
                var key = attr.name;

                if (key === 'id'
                    || key === 'class'
                    || key === 'style'
                    || key === 'slot'
                    || key.slice(0, 5) === 'data-') {
                    return;
                }

                var resolved = resolve(
                    key,
                    attr.value === '' ? null : attr.value
                );
                Q.setObject(resolved.path, resolved.value, options);
            });

            return options;
        }

        var observed = Object.keys(attrTypeMap).concat(Object.keys(eventMap));
        var ntt = name.replace(/\//g, '_');

        class ToolElement extends HTMLElement {
            connectedCallback() {
                this.classList.add('Q_tool', ntt + '_tool');

                var options = attrsToOptions(this);
                if (!Q.isEmpty(options)) {
                    this.setAttribute(
                        'data-' + tagName,
                        JSON.stringify(options)
                    );
                }

                Q.activate(this);
            }

            disconnectedCallback() {
                if (this.getAttribute('data-Q-retain') !== null) return;
                Q.Tool.remove(this);
            }

            attributeChangedCallback(attrName, oldVal, newVal) {
                if (oldVal === newVal) return;

                var tool = Q.Tool.from(this, name);
                if (!tool) return;

                var resolved = resolve(
                    attrName,
                    newVal === '' ? null : newVal
                );

                if (newVal === null && eventMap[attrName]) {
                    var active = tool.options[eventMap[attrName]];
                    if (Q.typeOf(active) === 'Q.Event') {
                        active.remove('component:' + attrName);
                    }
                    return;
                }

                if (resolved.event) {
                    var event = tool.options[resolved.path[0]];
                    if (Q.typeOf(event) !== 'Q.Event') return;

                    var handlerKey = 'component:' + attrName;
                    event.remove(handlerKey);
                    event.set(resolved.value[handlerKey], handlerKey);
                } else {
                    var update = {};
                    Q.setObject(resolved.path, resolved.value, update);
                    tool.setState(update);
                }
            }

            static get observedAttributes() {
                return observed;
            }
        }

        try {
            customElements.define(tagName, ToolElement);
        } catch (e) {
            console.warn(
                'Q.Tool: could not register <' + tagName + '>:',
                e
            );
        }
    };
});