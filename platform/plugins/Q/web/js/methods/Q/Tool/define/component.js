Q.exports(function (Q) {

	/**
	 * Registers a Custom Element (Web Component) for a Q tool.
	 *
	 * This provides a declarative HTML interface for Q.Tool instances.
	 * Attributes are compiled once into the canonical `data-*` format,
	 * then Q.activate() runs the normal Q.Tool lifecycle.
	 *
	 * Attribute rules:
	 *   - Attributes are parsed as JSON when possible
	 *   - Otherwise treated as strings
	 *   - Bare attributes → true
	 *   - Hyphenated names → nested object paths
	 *   - Non-hyphen names → matched (case-insensitive) to tool option keys
	 *
	 * No schema layer — semantics handled by Q.Tool + Q.extend
	 *
	 * @class Q.Tool
	 * @method define.component
	 * @static
	 * @param {String} name
	 *   The Q.Tool name (e.g. "Streams/chat")
	 * @param {Function} [ctor]
	 *   The tool constructor (used to infer option keys)
	 * @return {void}
	 */
	return function Q_Tool_define_component(name, ctor) {
		if (typeof customElements === 'undefined') {
			return;
		}

		var tagName = name.toLowerCase().replace(/[/_]/g, '-');

		if (customElements.get(tagName)) {
			return;
		}

		/**
		 * Attempt to parse JSON, fallback to string
		 * @method _parse
		 * @private
		 * @param {String} str
		 * @return {mixed}
		 */
		function _parse(str) {
			try {
				return JSON.parse(str);
			} catch (e) {
				return str;
			}
		}

		/**
		 * Normalize a key against tool defaults (case-insensitive)
		 * Recovers camelCase from lowercased HTML attributes
		 *
		 * @method _normalizeKey
		 * @private
		 * @param {String} key
		 * @param {Object} defaults
		 * @return {String}
		 */
		function _normalizeKey(key, defaults) {
			if (!defaults) return key;

			var lower = key.toLowerCase();

			for (var k in defaults) {
				if (k.toLowerCase() === lower) {
					return k;
				}
			}

			return key;
		}

		/**
		 * Resolve attribute into path + value
		 *
		 * Rules:
		 *   - hyphen → nested path
		 *   - no hyphen → match tool option key if possible
		 *
		 * @method _resolveAttr
		 * @private
		 * @param {String} attrName
		 * @param {String|null} attrValue
		 * @param {Object} defaults
		 * @return {Object} { path, value }
		 */
		function _resolveAttr(attrName, attrValue, defaults) {
			var lower = attrName.toLowerCase();
			var parts = lower.split('-');
			var path;

			if (parts.length > 1) {
				// nested
				path = parts;
			} else {
				// flat → normalize casing
				path = [_normalizeKey(attrName, defaults)];
			}

			var converted;
			if (attrValue === null) {
				converted = true;
			} else {
				converted = _parse(attrValue);
			}

			return { path: path, value: converted };
		}

		/**
		 * Convert element attributes into options object
		 *
		 * @method _attrsToOptions
		 * @private
		 * @param {HTMLElement} element
		 * @return {Object}
		 */
		function _attrsToOptions(element) {
			var options = {};
			var skip = { id: 1, 'class': 1, style: 1, slot: 1 };
			var ownDataAttr = 'data-' + tagName;
			var attrs = element.attributes;

			// infer defaults from ctor
			var defaults = ctor && ctor.options;

			for (var i = 0; i < attrs.length; i++) {
				var attr = attrs[i];
				var aName = attr.name;

				if (skip[aName]) continue;

				// data-* base JSON
				if (aName === ownDataAttr) {
					try {
						var blob = JSON.parse(attr.value);
						if (Q.isPlainObject(blob)) {
							Q.extend(options, blob);
						}
					} catch(e) {}
					continue;
				}

				if (aName.slice(0, 5) === 'data-') continue;

				var resolved = _resolveAttr(aName, attr.value === '' ? null : attr.value, defaults);
				Q.setObject(resolved.path, resolved.value, options);
			}

			return options;
		}

		/**
		 * Remove original (non-data-*) attributes after compilation
		 *
		 * @method _cleanupAttributes
		 * @private
		 * @param {HTMLElement} element
		 */
		function _cleanupAttributes(element) {
			var ownDataAttr = 'data-' + tagName;
			var attrs = element.attributes;

			for (var i = attrs.length - 1; i >= 0; i--) {
				var attr = attrs[i];
				var name = attr.name;

				if (
					name === ownDataAttr ||
					name === 'id' ||
					name === 'class' ||
					name === 'style' ||
					name === 'slot'
				) continue;

				if (name.slice(0, 5) === 'data-') continue;

				element.removeAttribute(name);
			}
		}

		var ntt = name.split('/').join('_');

		/**
		 * Custom element wrapper for Q.Tool
		 *
		 * @class ToolElement
		 * @extends HTMLElement
		 */
		class ToolElement extends HTMLElement {

			/**
			 * Called when element is inserted into DOM
			 *
			 * Compiles attributes → data-* → activates tool
			 *
			 * @method connectedCallback
			 */
			connectedCallback() {
				this.classList.add('Q_tool', ntt + '_tool');

				var options = _attrsToOptions(this);
				if (!Q.isEmpty(options)) {
					this.setAttribute(
						'data-' + tagName,
						JSON.stringify(options)
					);
				}

				_cleanupAttributes(this);

				Q.activate(this);
			}

			/**
			 * Called when element is removed from DOM
			 *
			 * @method disconnectedCallback
			 */
			disconnectedCallback() {
				if (this.getAttribute('data-Q-retain') !== null) return;
				Q.Tool.remove(this);
			}

			/**
			 * React to attribute changes after activation
			 *
			 * @method attributeChangedCallback
			 * @param {String} attrName
			 * @param {String} oldVal
			 * @param {String} newVal
			 */
			attributeChangedCallback(attrName, oldVal, newVal) {
				if (oldVal === newVal) return;

				var tool = Q.Tool.from(this, name);
				if (!tool) return;

				var defaults = ctor && ctor.options;

				var resolved = _resolveAttr(attrName, newVal === '' ? null : newVal, defaults);
				var update = {};
				Q.setObject(resolved.path, resolved.value, update);

				tool.setState(update);
			}

			/**
			 * Observe all attributes (dynamic updates)
			 *
			 * @property observedAttributes
			 * @static
			 */
			static get observedAttributes() {
				return [];
			}
		}

		try {
			customElements.define(tagName, ToolElement);
		} catch(e) {
			console.warn('Q.Tool: could not register <' + tagName + '>:', e);
		}
	};

});