Q.exports(function (Q) {

	/**
	 * Registers a Custom Element (Web Component) for a Q tool.
	 *
	 * Simplified model:
	 *   - Attributes are parsed as JSON when possible
	 *   - Otherwise treated as strings
	 *   - Bare attributes → true
	 *   - Hyphenated names → nested object paths
	 *
	 * No schema layer — semantics handled by Q.Tool + Q.extend
	 */
	return function Q_Tool_define_component(name, ctor) {
		if (typeof customElements === 'undefined') {
			return;
		}

		var tagName = name.toLowerCase().replace(/[/_]/g, '-');

		if (customElements.get(tagName)) {
			return;
		}

		function _camelToHyphen(str) {
			return str.replace(/([A-Z])/g, function(c) {
				return '-' + c.toLowerCase();
			});
		}

		function _parse(str) {
			try {
				return JSON.parse(str);
			} catch (e) {
				return str;
			}
		}

		function _resolveAttr(attrName, attrValue) {
			var lower = attrName.toLowerCase();
			var parts = lower.split('-');
			var path = parts.length > 1 ? parts : [attrName];

			var converted;
			if (attrValue === null) {
				converted = true;
			} else {
				converted = _parse(attrValue);
			}

			return { path: path, value: converted };
		}

		function _attrsToOptions(element) {
			var options = {};
			var skip = { id: 1, 'class': 1, style: 1, slot: 1 };
			var ownDataAttr = 'data-' + tagName;
			var attrs = element.attributes;

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

				var resolved = _resolveAttr(aName, attr.value === '' ? null : attr.value);
				Q.setObject(resolved.path, resolved.value, options);
			}

			return options;
		}

		/**
		 * Remove original (non-data-*) attributes after compiling into data-*
		 * Leaves canonical data-* and core attributes intact.
		 */
		function _cleanupAttributes(element) {
			var ownDataAttr = 'data-' + tagName;
			var attrs = element.attributes;

			for (var i = attrs.length - 1; i >= 0; i--) {
				var attr = attrs[i];
				var name = attr.name;

				// preserve core + canonical
				if (
					name === ownDataAttr ||
					name === 'id' ||
					name === 'class' ||
					name === 'style' ||
					name === 'slot'
				) continue;

				// preserve other data-* attributes
				if (name.slice(0, 5) === 'data-') continue;

				element.removeAttribute(name);
			}
		}

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

				// cleanup original attributes after compilation
				_cleanupAttributes(this);

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

				var resolved = _resolveAttr(attrName, newVal === '' ? null : newVal);
				var update = {};
				Q.setObject(resolved.path, resolved.value, update);

				tool.setState(update);
			}

			// observe everything (simple + powerful)
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