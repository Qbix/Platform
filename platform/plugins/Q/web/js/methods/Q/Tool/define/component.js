Q.exports(function (Q) {

    /**
     * Registers a Custom Element (Web Component) for a Q tool.
     * Only active when Q.Tool.define.components === true.
     *
     * Equivalent to writing:
     *   <div class="Q_tool Streams_chat_tool" data-streams-chat='{"publisherId":"NYU"}'></div>
     * and having Q.activate() find it. The web component syntax is purely a
     * translation shim — connectedCallback dresses the element and calls Q.activate(this).
     *
     * Attribute → option mapping:
     *   - foo-bar="2"  → nested: options.foo.bar = 2
     *   - fooBar="2"   → flat if schema declares it, else options.fooBar = 2
     *   - baz          → true (bare attribute, no value)
     *
     * Schema is declared as the last element of stateKeys if it's a plain object:
     *   stateKeys = ["editable", { count: Q.Types.Integer, visible: Q.Types.Boolean }]
     * Leaf nodes have a .from(string) method. Branch nodes are plain objects without .from().
     * Without a schema, automagic inference handles bool/int/float/JSON/string.
     *
     * @method Q.Tool.define.component
     * @param {String} name Tool name e.g. "Streams/chat"
     * @param {Function} ctor Tool constructor (already registered)
     */
    return function Q_Tool_define_component(name, ctor) {
        if (typeof customElements === 'undefined') {
            return;
        }

        // "Streams/chat" -> "streams-chat"
        var tagName = name.toLowerCase().replace(/[/_]/g, '-');

        if (customElements.get(tagName)) {
            return;
        }

        // Extract schema from last element of stateKeys if it's a plain object
        var stateKeys = ctor.stateKeys;
        var schema = null;
        if (Array.isArray(stateKeys) && stateKeys.length) {
            var last = stateKeys[stateKeys.length - 1];
            if (Q.isPlainObject(last)) {
                schema = last;
            }
        }

        // attrTypeMap: full-hyphenated-path -> Q.Types.X descriptor
        // attrNameMap: full-hyphenated-path -> key path array into options
        var attrTypeMap = {};
        var attrNameMap = {};
        if (schema) {
            _flattenSchema(schema, [], attrTypeMap, attrNameMap);
        }

        /**
         * Recursively walk schema. Leaf nodes have .from(), branch nodes don't.
         * Keys into the maps are the FULL hyphenated path e.g. "foo-bar-baz"
         * to avoid collisions between keys at different nesting levels.
         */
        function _flattenSchema(node, path, typeMap, nameMap) {
            for (var k in node) {
                if (!node.hasOwnProperty(k)) continue;
                var val = node[k];
                var newPath = path.concat([k]);
                var hyphenPath = newPath.map(_camelToHyphen).join('-');
                if (val && typeof val.from === 'function') {
                    typeMap[hyphenPath] = val;
                    nameMap[hyphenPath] = newPath;
                } else if (Q.isPlainObject(val)) {
                    _flattenSchema(val, newPath, typeMap, nameMap);
                }
            }
        }

        function _camelToHyphen(str) {
            return str.replace(/([A-Z])/g, function(c) {
                return '-' + c.toLowerCase();
            });
        }

        /**
         * Resolve one attribute name+value to { path, value }.
         * Resolution order:
         *   1. Full hyphenated path match in schema (e.g. "foo-bar" -> ["foo","bar"])
         *   2. Hyphen-split into nested path
         *   3. Single segment: flat key preserving original casing
         * Bare attribute (no value) -> true, or type.from('') if schema declares it.
         */
        function _resolveAttr(attrName, attrValue) {
            var lower = attrName.toLowerCase();
            var type = attrTypeMap[lower] || null;
            var path = attrNameMap[lower] || null;

            if (!path) {
                var parts = lower.split('-');
                path = parts.length > 1 ? parts : [attrName];
            }

            var converted;
            if (attrValue === null) {
                // bare attribute
                converted = type ? type.from('') : true;
            } else if (type) {
                converted = type.from(attrValue);
            } else {
                converted = _infer(attrValue);
            }

            return { path: path, value: converted };
        }

        /**
         * Automagic inference when no schema type is declared.
         * Order: "true"/"false" -> Boolean, integer, float, JSON, String.
         */
        function _infer(str) {
            if (str === 'true')  return true;
            if (str === 'false') return false;
            if (str === 'null')  return null;
            if (str === '')      return true;
            if (/^-?\d+$/.test(str)) return parseInt(str, 10);
            if (/^-?\d*\.\d+$/.test(str)) return parseFloat(str);
            if (str[0] === '{' || str[0] === '[') {
                try { return JSON.parse(str); } catch(e) {}
            }
            return str;
        }

        /**
         * Build options object from all non-standard attributes on the element.
         * Skips: id, class, style, slot, and all data-* except the tool's own.
         * The tool's own data-* attribute (e.g. data-streams-chat) is parsed as
         * a raw JSON blob and merged as the base, with individual attrs on top.
         */
        function _attrsToOptions(element) {
            var options = {};
            var skip = { id: 1, 'class': 1, style: 1, slot: 1 };
            var ownDataAttr = 'data-' + tagName;
            var attrs = element.attributes;

            for (var i = 0; i < attrs.length; i++) {
                var attr = attrs[i];
                var aName = attr.name;

                if (skip[aName]) continue;

                // Legacy JSON blob on the tool's own data- attr: merge as base
                if (aName === ownDataAttr) {
                    try {
                        var blob = JSON.parse(attr.value);
                        if (Q.isPlainObject(blob)) {
                            Q.extend(options, blob);
                        }
                    } catch(e) {}
                    continue;
                }

                // Skip other data-* passthrough attributes
                if (aName.slice(0, 5) === 'data-') continue;

                var resolved = _resolveAttr(aName, attr.value === '' ? null : attr.value);
                Q.setObject(resolved.path, resolved.value, options);
            }

            return options;
        }

        // observedAttributes: only schema-declared attrs trigger attributeChangedCallback.
        // Undeclared attrs are still read at connectedCallback time via _attrsToOptions.
        var observedAttrNames = Object.keys(attrTypeMap);

        var ntt = name.split('/').join('_');

        class ToolElement extends HTMLElement {

            connectedCallback() {
                this.classList.add('Q_tool', ntt + '_tool');
                var options = _attrsToOptions(this);
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
                // Fires only for schema-declared attributes after initial connection.
                // Before connection, the change will be picked up by connectedCallback.
                var tool = Q.Tool.from(this, name);
                if (!tool) return;
                var resolved = _resolveAttr(attrName, newVal === '' ? null : newVal);
                var update = {};
                Q.setObject(resolved.path, resolved.value, update);
                tool.setState(update);
            }

            static get observedAttributes() {
                return observedAttrNames;
            }
        }

        try {
            customElements.define(tagName, ToolElement);
        } catch(e) {
            console.warn('Q.Tool: could not register <' + tagName + '>:', e);
        }
    };

});