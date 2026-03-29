Q.exports(function (Q) {

	/**
	 * Registers a Custom Element (Web Component) for a Q tool.
	 *
	 * Model:
	 *   - Attributes are compiled once into data-* (initialization)
	 *   - Then removed (clean DOM)
	 *   - Q.Tool runs normally
	 *   - Later attribute changes are treated as incremental updates
	 *
	 * Notes:
	 *   - Attributes are case-insensitive in HTML; keys are normalized via ctor.options
	 *   - Hyphenated attributes map to nested paths (e.g. publisher-id → publisher.id)
	 *   - Non-hyphen attributes map to top-level keys (case-normalized)
	 *
	 * @class Q.Tool
	 * @method define.component
	 * @static
	 * @param {String} name
	 * @param {Function} [ctor]
	 */
	return function Q_Tool_define_component(name, ctor) {
		if (typeof customElements === 'undefined') {
			return;
		}

		var tagName = name.toLowerCase().replace(/[/_]/g, '-');

		if (customElements.get(tagName)) {
			return;
		}

		function _parse(str) {
			try {
				return JSON.parse(str);
			} catch (e) {
				return str;
			}
		}

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

		function _resolveAttr(attrName, attrValue, defaults) {
			var lower = attrName.toLowerCase();
			var parts = lower.split('-');
			var path;

			if (parts.length > 1) {
				path = parts;
			} else {
				path = [_normalizeKey(attrName, defaults)];
			}

			var value = (attrValue === null)
				? true
				: _parse(attrValue);

			return { path: path, value: value };
		}

		function _attrsToOptions(element, defaults) {
			var options = {};
			var skip = { id: 1, 'class': 1, style: 1, slot: 1 };
			var ownDataAttr = 'data-' + tagName;
			var attrs = element.attributes;

			for (var i = 0; i < attrs.length; i++) {
				var attr = attrs[i];
				var aName = attr.name;

				if (skip[aName]) continue;

				// merge existing canonical data-* if present
				if (aName === ownDataAttr) {
					try {
						var blob = JSON.parse(attr.value);
						if (Q.isPlainObject(blob)) {
							Q.extend(options, blob);
						}
					} catch (e) {}
					continue;
				}

				if (aName.slice(0, 5) === 'data-') continue;

				var resolved = _resolveAttr(
					aName,
					attr.value === '' ? null : attr.value,
					defaults
				);

				Q.setObject(resolved.path, resolved.value, options);
			}

			return options;
		}

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

		class ToolElement extends HTMLElement {

			connectedCallback() {
				var element = this;

				element.classList.add('Q_tool', ntt + '_tool');

				var defaults = (ctor && ctor.options) || {};

				// compile attributes → canonical data-*
				var options = _attrsToOptions(element, defaults);

				if (!Q.isEmpty(options)) {
					element._qUpdating = true;
					element.setAttribute(
						'data-' + tagName,
						JSON.stringify(options)
					);
					element._qUpdating = false;
				}

				// remove original attributes (compile-time only)
				element._qUpdating = true;
				_cleanupAttributes(element);
				element._qUpdating = false;

				// activate Q.Tool
				Q.activate(element);

				// observe runtime attribute changes (incremental updates)
				var observer = new MutationObserver(function (mutations) {
					if (element._qUpdating) return;

					var tool = Q.Tool.from(element, name);
					if (!tool) return;

					for (var i = 0; i < mutations.length; i++) {
						var m = mutations[i];
						if (m.type !== 'attributes') continue;

						var attrName = m.attributeName;

						// ignore canonical + system attrs
						if (
							attrName === ('data-' + tagName) ||
							attrName === 'id' ||
							attrName === 'class' ||
							attrName === 'style' ||
							attrName === 'slot' ||
							attrName.slice(0, 5) === 'data-'
						) continue;

						var val = element.getAttribute(attrName);

						var resolved = _resolveAttr(
							attrName,
							val === '' ? null : val,
							defaults
						);

						var update = {};
						Q.setObject(resolved.path, resolved.value, update);

						tool.setState(update);
					}
				});

				observer.observe(element, { attributes: true });

				element._qObserver = observer;
			}

			disconnectedCallback() {
				if (this.getAttribute('data-Q-retain') !== null) return;

				if (this._qObserver) {
					this._qObserver.disconnect();
					delete this._qObserver;
				}

				Q.Tool.remove(this);
			}
		}

		try {
			customElements.define(tagName, ToolElement);
		} catch (e) {
			console.warn('Q.Tool: could not register <' + tagName + '>:', e);
		}
	};

});