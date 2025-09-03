Q.exports(function (Q) {
	/**
	 * Q plugin's front end code
	 *
	 * @module Q
	 * @class Q
	 */

	/**
	 * Sanitizes a DOM element and removes potentially dangerous tags and attributes.
	 * Use this to clean user-provided HTML before inserting it into the DOM.
	 *
	 * @static
	 * @method sanitize
	 * @param {HTMLElement} container A DOM element (e.g. div) containing the HTML to sanitize.
	 * @param {Function} callback A function to call after sanitization is complete.
	 *   It receives the sanitized container as its only argument.
	 * @param {Object} [options] Optional configuration:
	 *   @param {Array} [options.allowedSrc] Allowed URL prefixes for `src` attributes.
	 *   @param {Array} [options.allowedHref] Allowed URL prefixes for `href` attributes.
	 *   @param {Array} [options.preserveAttributes] Attributes that should not be removed.
	 *   @param {Array} [options.dangerousAttributes] Additional dangerous attributes to remove.
	 *   @param {Boolean} [options.createShadowRoot] Whether this will be used inside a shadow DOM.
	 */
	Q.sanitize = function Q_sanitize(container, callback, options) {
		var dangerousTags = ['script', 'iframe', 'object', 'embed', 'svg', 'math', 'base', 'link'];
		var allowedSrc = (options && options.allowedSrc) || ['data:image/', 'https://', 'http://'];
		var allowedHref = (options && options.allowedHref) || [];
		var preserveAttributes = (options && options.preserveAttributes) || [];
		var customDangerousAttributes = (options && options.dangerousAttributes) || [];

		var dangerousAttributes = [
			'srcdoc', 'sandbox', 'allowfullscreen', 'autofocus'
		].concat(customDangerousAttributes);

		var all = container.querySelectorAll('*');

		for (var i = 0; i < all.length; i++) {
			var element = all[i];
			var tagName = element.tagName.toLowerCase();
			var attrs = element.attributes;

			// Remove entire element if it's a dangerous tag
			if (dangerousTags.includes(tagName)) {
				if (element.parentNode) {
					element.parentNode.removeChild(element);
				}
				continue;
			}

			for (var j = attrs.length - 1; j >= 0; j--) {
				var attr = attrs[j];
				var name = attr.name.toLowerCase();
				var value = (attr.value || '').trim();
				var shouldRemove = false;

				// Remove event handler attributes dynamically
				if (name.startsWith('on')) {
					shouldRemove = true;
				}

				// Remove if explicitly in dangerous attributes
				if (!shouldRemove && dangerousAttributes.includes(name)) {
					shouldRemove = true;
				}

				// Remove javascript: URLs
				if (!shouldRemove && value.toLowerCase().startsWith('javascript:')) {
					shouldRemove = true;
				}

				// Remove suspicious data: URLs (except for images in src)
				if (!shouldRemove && value.toLowerCase().startsWith('data:') && name !== 'src') {
					var dataType = value.substring(5).split(';')[0].split(',')[0];
					if (!dataType.startsWith('image/')) {
						shouldRemove = true;
					}
				}

				// Whitelist-based href handling
				if (name === 'href') {
					if (allowedHref.length === 0) {
						shouldRemove = true;
					} else {
						var allowed = allowedHref.some(prefix => value.toLowerCase().startsWith(prefix));
						if (!allowed) {
							shouldRemove = true;
						}
					}
				}

				// Whitelist-based src handling
				if (name === 'src') {
					var allowed = allowedSrc.some(prefix => value.toLowerCase().startsWith(prefix));
					if (!allowed) {
						shouldRemove = true;
					}
				}

				// Always remove form action
				if (name === 'action') {
					shouldRemove = true;
				}

				// Override with preserve list
				if (preserveAttributes.includes(name)) {
					shouldRemove = false;
				}

				if (shouldRemove) {
					element.removeAttribute(attr.name);
				}
			}

			// Shadow DOM safety for form elements
			if (options && options.createShadowRoot) {
				if (['form', 'input', 'textarea', 'select', 'button'].includes(tagName)) {
					if (!element.hasAttribute('data-shadow-form')) {
						element.setAttribute('data-shadow-form', 'true');
					}
				}
			}
		}

		// Additional cleanup for shadow DOM: remove suspicious scripts from text content
		if (options && options.createShadowRoot) {
			var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
			var node;
			while ((node = walker.nextNode())) {
				var content = node.textContent;
				if (content.toLowerCase().includes('<script') || content.toLowerCase().includes('javascript:')) {
					node.textContent = content.replace(/<script[\s\S]*?<\/script>/gi, '')
					                         .replace(/javascript:/gi, '');
				}
			}
		}

		if (typeof callback === 'function') {
			callback(container);
		}
	};
});