(function (Q, $, window, undefined) {

/**
 * Converts a rendered DOM subtree into themed SVG.
 *
 * Two modes, and the distinction matters:
 *
 *   resolveVars: false (default, for inline SVG)
 *     Preserves class names and emits a <style> block that references the
 *     same CSS variables the live tool uses. The SVG re-themes with the page
 *     — switch to dark mode and the mockup follows, with no re-render.
 *
 *   resolveVars: true (for export — email, PDF, standalone files)
 *     Inlines computed values. Self-contained, but frozen to the theme that
 *     was active at render time.
 *
 * The unresolved values come from CSSOM, not getComputedStyle. That matters:
 * getComputedStyle resolves var() before you can see it, so mapping #22c55e
 * back to --color-accent would be guesswork — two variables can resolve to
 * the same colour, and it falls apart entirely on rgba() compositing and
 * gradients. Walking document.styleSheets for matching rules gives us the
 * literal "var(--color-accent)" text instead.
 *
 * @module Q
 * @class Q.Tool
 */

var PROPERTY_MAP = {
	'background-color': 'fill',
	'background': 'fill',
	'color': 'fill',
	'border-color': 'stroke',
	'border-top-color': 'stroke',
	'opacity': 'opacity'
};

var SKIP_TAGS = {
	SCRIPT: true, STYLE: true, LINK: true, META: true,
	TITLE: true, NOSCRIPT: true, TEMPLATE: true
};

var MEDIA_TAGS = { IMG: true, CANVAS: true, VIDEO: true, IFRAME: true, OBJECT: true };

/**
 * Cache of selector -> { property: unresolvedValue } built from CSSOM.
 * Rebuilt when the stylesheet count changes, which is the cheap proxy for
 * "CSS has loaded since we last looked".
 */
var _cssomCache = null;
var _cssomSheetCount = -1;

function buildCSSOM() {
	var sheets = document.styleSheets;
	if (_cssomCache && _cssomSheetCount === sheets.length) {
		return _cssomCache;
	}
	var map = {};
	var warned = false;

	for (var i = 0; i < sheets.length; ++i) {
		var rules;
		try {
			rules = sheets[i].cssRules || sheets[i].rules;
		} catch (e) {
			// Cross-origin stylesheets throw on .cssRules. Fall back to
			// computed values for anything they styled.
			if (!warned) {
				console.warn('Q.Tool.DOMtoSVG: some stylesheets are cross-origin; '
					+ 'those rules fall back to computed values');
				warned = true;
			}
			continue;
		}
		if (!rules) { continue; }

		for (var j = 0; j < rules.length; ++j) {
			var rule = rules[j];
			if (!rule.selectorText || !rule.style) { continue; }
			var selectors = rule.selectorText.split(',');
			for (var k = 0; k < selectors.length; ++k) {
				var sel = selectors[k].trim();
				if (!map[sel]) { map[sel] = {}; }
				for (var prop in PROPERTY_MAP) {
					var value = rule.style.getPropertyValue(prop);
					if (value && value.indexOf('var(') >= 0) {
						map[sel][prop] = value.trim();
					}
				}
			}
		}
	}

	_cssomSheetCount = sheets.length;
	return (_cssomCache = map);
}

/**
 * Find the unresolved (var()-carrying) value for a property on an element,
 * by testing which CSSOM selectors it matches. Later rules win, which
 * approximates cascade order well enough for mockups.
 */
function unresolved(element, property, cssom) {
	var found = null;
	for (var sel in cssom) {
		if (!cssom[sel][property]) { continue; }
		var matches;
		try {
			matches = element.matches(sel);
		} catch (e) {
			continue; // selector we can't evaluate, e.g. ::before
		}
		if (matches) {
			found = cssom[sel][property];
		}
	}
	return found;
}

function isTransparent(color) {
	if (!color) { return true; }
	return color === 'transparent'
		|| color === 'rgba(0, 0, 0, 0)'
		|| /rgba\([^)]*,\s*0\s*\)$/.test(color);
}

function esc(text) {
	return String(text)
		.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function num(value) {
	return Math.round(parseFloat(value) * 100) / 100 || 0;
}

/**
 * Does this element have only text (no element children that render)?
 */
function isTextLeaf(element) {
	if (!element.childNodes.length) { return false; }
	for (var i = 0; i < element.childNodes.length; ++i) {
		var node = element.childNodes[i];
		if (node.nodeType === 1 && !SKIP_TAGS[node.tagName]) {
			return false;
		}
	}
	return element.textContent.trim().length > 0;
}

Q.Tool = Q.Tool || {};

/**
 * Convert a rendered DOM subtree into themed SVG.
 *
 * @method DOMtoSVG
 * @static
 * @param {Element} element Root element to convert
 * @param {Object} [options]
 * @param {Boolean} [options.preserveClasses=true] Keep class names on SVG
 *   elements, so Q.Visual.hint() can target inside the mockup by the same
 *   selectors that style the live tool
 * @param {Boolean} [options.resolveVars=false] Inline computed colours
 *   instead of emitting var() references
 * @param {Number} [options.textBaselineFactor=0.78] Multiplier on font-size
 *   for approximating the text baseline
 * @param {Number} [options.maxDepth=24]
 * @return {Object} { svg, width, height, classes }
 */
Q.Tool.DOMtoSVG = function (element, options) {
	var o = Q.extend({
		preserveClasses: true,
		resolveVars: false,
		textBaselineFactor: 0.78,
		maxDepth: 24
	}, options);

	var root = element.getBoundingClientRect();
	var width = Math.max(1, Math.round(root.width));
	var height = Math.max(1, Math.round(root.height));
	var rtl = getComputedStyle(element).direction === 'rtl';
	var cssom = o.resolveVars ? {} : buildCSSOM();

	var defs = [];
	var body = [];
	var classes = {};
	var clipCount = 0;
	var gradCount = 0;

	function x(rect) {
		return rtl
			? num(root.right - rect.right)
			: num(rect.left - root.left);
	}
	function y(rect) {
		return num(rect.top - root.top);
	}

	/**
	 * Pick the value to emit for a property: the var() reference when we can
	 * find one and we're staying themable, otherwise the computed value.
	 */
	function paint(el, cssProp, computedValue) {
		if (!o.resolveVars) {
			var raw = unresolved(el, cssProp, cssom);
			if (raw) { return raw; }
		}
		return computedValue;
	}

	function classAttr(el) {
		if (!o.preserveClasses || !el.className || typeof el.className !== 'string') {
			return '';
		}
		var names = el.className.trim();
		if (!names) { return ''; }
		names.split(/\s+/).forEach(function (n) { classes[n] = true; });
		return ' class="' + esc(names) + '"';
	}

	function gradient(cs) {
		var image = cs.backgroundImage;
		if (!image || image.indexOf('linear-gradient') < 0) { return null; }
		var stops = image.match(/(rgba?\([^)]+\)|#[0-9a-f]{3,8})/gi);
		if (!stops || stops.length < 2) { return null; }
		var id = 'Q_grad_' + (++gradCount);
		var inner = '';
		for (var i = 0; i < stops.length; ++i) {
			var offset = Math.round((i / (stops.length - 1)) * 100);
			inner += '<stop offset="' + offset + '%" stop-color="' + stops[i] + '"/>';
		}
		// Approximate: vertical unless the declaration says otherwise.
		var horizontal = /to (right|left)|(?:^|\s)(90|270)deg/.test(image);
		defs.push('<linearGradient id="' + id + '" x1="0" y1="0" x2="'
			+ (horizontal ? 1 : 0) + '" y2="' + (horizontal ? 0 : 1) + '">'
			+ inner + '</linearGradient>');
		return 'url(#' + id + ')';
	}

	function shadow(cs) {
		var value = cs.boxShadow;
		if (!value || value === 'none') { return null; }
		var parts = value.match(/(-?\d+(?:\.\d+)?)px/g);
		if (!parts || parts.length < 3) { return null; }
		var id = 'Q_shadow_' + defs.length;
		var dx = parseFloat(parts[0]);
		var dy = parseFloat(parts[1]);
		var blur = parseFloat(parts[2]);
		var color = (value.match(/rgba?\([^)]+\)/) || ['rgba(0,0,0,.18)'])[0];
		defs.push('<filter id="' + id + '" x="-30%" y="-30%" width="160%" height="160%">'
			+ '<feDropShadow dx="' + dx + '" dy="' + dy + '" stdDeviation="'
			+ (blur / 2) + '" flood-color="' + color + '"/></filter>');
		return id;
	}

	/**
	 * Emit the box (background, border, radius) for an element.
	 */
	function box(el, cs, rect, clipId) {
		var bg = cs.backgroundColor;
		var grad = gradient(cs);
		var borderWidth = parseFloat(cs.borderTopWidth) || 0;
		var borderColor = cs.borderTopColor;
		var hasBorder = borderWidth > 0.4 && !isTransparent(borderColor);
		var hasFill = grad || !isTransparent(bg);

		if (!hasFill && !hasBorder) { return; }

		var radius = Math.min(
			parseFloat(cs.borderTopLeftRadius) || 0,
			Math.min(rect.width, rect.height) / 2
		);
		var attrs = ' x="' + x(rect) + '" y="' + y(rect) + '"'
			+ ' width="' + num(rect.width) + '" height="' + num(rect.height) + '"';
		if (radius > 0.5) { attrs += ' rx="' + num(radius) + '"'; }
		attrs += hasFill
			? ' fill="' + paint(el, 'background-color', grad || bg) + '"'
			: ' fill="none"';
		if (hasBorder) {
			attrs += ' stroke="' + paint(el, 'border-color', borderColor) + '"'
				+ ' stroke-width="' + num(borderWidth) + '"';
		}
		var opacity = parseFloat(cs.opacity);
		if (opacity < 1) { attrs += ' opacity="' + num(opacity) + '"'; }

		var filterId = shadow(cs);
		if (filterId) { attrs += ' filter="url(#' + filterId + ')"'; }
		if (clipId) { attrs += ' clip-path="url(#' + clipId + ')"'; }

		body.push('<rect' + classAttr(el) + attrs + '/>');
	}

	/**
	 * Emit the text of a leaf element.
	 */
	function text(el, cs, rect, clipId) {
		var content = el.textContent.trim();
		if (!content) { return; }

		var fontSize = parseFloat(cs.fontSize) || 12;
		var align = cs.textAlign;
		var padLeft = parseFloat(cs.paddingLeft) || 0;
		var padRight = parseFloat(cs.paddingRight) || 0;
		var anchor = 'start';
		var tx = x(rect) + padLeft;

		if (align === 'center') {
			anchor = 'middle';
			tx = x(rect) + rect.width / 2;
		} else if (align === 'right' || (rtl && align !== 'left')) {
			anchor = 'end';
			tx = x(rect) + rect.width - padRight;
		}

		// Vertical centring for single-line boxes reads better than a raw
		// baseline from the top, and matches how the HTML actually looks.
		var lineHeight = parseFloat(cs.lineHeight) || fontSize * 1.4;
		var lines = Math.max(1, Math.round(rect.height / lineHeight));
		var ty = (lines === 1)
			? y(rect) + rect.height / 2 + fontSize * (o.textBaselineFactor - 0.5)
			: y(rect) + (parseFloat(cs.paddingTop) || 0) + fontSize * o.textBaselineFactor;

		var attrs = ' x="' + num(tx) + '" y="' + num(ty) + '"'
			+ ' font-size="' + num(fontSize) + '"'
			+ ' font-family="' + esc(cs.fontFamily) + '"'
			+ ' fill="' + paint(el, 'color', cs.color) + '"';
		if (anchor !== 'start') { attrs += ' text-anchor="' + anchor + '"'; }
		if (parseInt(cs.fontWeight, 10) >= 600) { attrs += ' font-weight="600"'; }
		if (cs.fontStyle === 'italic') { attrs += ' font-style="italic"'; }
		if (rtl) { attrs += ' direction="rtl"'; }
		if (clipId) { attrs += ' clip-path="url(#' + clipId + ')"'; }

		body.push('<text' + classAttr(el) + attrs + '>' + esc(content) + '</text>');
	}

	function media(el, cs, rect) {
		var w = num(rect.width), h = num(rect.height);
		var cx = x(rect) + w / 2, cy = y(rect) + h / 2;
		var r = Math.min(w, h) * 0.18;
		body.push('<rect' + classAttr(el) + ' x="' + x(rect) + '" y="' + y(rect)
			+ '" width="' + w + '" height="' + h + '" rx="3"'
			+ ' fill="' + (o.resolveVars ? cs.backgroundColor : 'var(--color-bg-tertiary, #e5e7eb)') + '"/>');
		// A small aperture glyph, so a placeholder reads as "image" and not
		// as an empty box the layout got wrong.
		body.push('<circle cx="' + num(cx) + '" cy="' + num(cy) + '" r="' + num(r)
			+ '" fill="none" stroke="' + (o.resolveVars ? cs.color : 'var(--color-text-tertiary, #9ca3af)')
			+ '" stroke-width="1.25" opacity=".55"/>');
	}

	function pseudo(el, which, rect) {
		var cs;
		try {
			cs = getComputedStyle(el, which);
		} catch (e) { return; }
		if (!cs || cs.content === 'none' || cs.content === 'normal') { return; }

		var w = parseFloat(cs.width) || 0;
		var h = parseFloat(cs.height) || 0;
		if (!isTransparent(cs.backgroundColor) && w > 0 && h > 0) {
			// Position is approximate — we place it at the element's edge,
			// which covers the common icon and caret cases.
			var px = x(rect) + (which === '::before' ? 0 : rect.width - w);
			body.push('<rect x="' + num(px) + '" y="' + num(y(rect) + (rect.height - h) / 2)
				+ '" width="' + num(w) + '" height="' + num(h) + '"'
				+ ' rx="' + num(Math.min(parseFloat(cs.borderTopLeftRadius) || 0, Math.min(w, h) / 2))
				+ '" fill="' + cs.backgroundColor + '"/>');
		}

		var glyph = cs.content.replace(/^["']|["']$/g, '');
		if (glyph && glyph !== 'none' && glyph.length <= 4) {
			var fontSize = parseFloat(cs.fontSize) || 12;
			var gx = x(rect) + (which === '::before' ? 2 : rect.width - fontSize);
			body.push('<text x="' + num(gx) + '" y="'
				+ num(y(rect) + rect.height / 2 + fontSize * 0.34)
				+ '" font-size="' + num(fontSize) + '" fill="' + cs.color + '">'
				+ esc(glyph) + '</text>');
		}
	}

	function walk(el, depth, clipId) {
		if (depth > o.maxDepth || SKIP_TAGS[el.tagName]) { return; }

		var cs = getComputedStyle(el);
		if (cs.display === 'none' || cs.visibility === 'hidden'
		|| parseFloat(cs.opacity) === 0) {
			return;
		}

		var rect = el.getBoundingClientRect();
		if (rect.width < 0.5 || rect.height < 0.5) { return; }

		if (MEDIA_TAGS[el.tagName]) {
			media(el, cs, rect);
			return;
		}

		box(el, cs, rect, clipId);
		pseudo(el, '::before', rect);

		// Text that overflows should be clipped the same way the HTML clips
		// it. SVG <text> renders regardless of any parent's bounds, so the
		// clip has to be explicit.
		var childClip = clipId;
		if (cs.overflow === 'hidden' || cs.overflow === 'clip'
		|| cs.overflowX === 'hidden' || cs.overflowY === 'hidden') {
			var id = 'Q_clip_' + (++clipCount);
			var radius = Math.min(
				parseFloat(cs.borderTopLeftRadius) || 0,
				Math.min(rect.width, rect.height) / 2
			);
			defs.push('<clipPath id="' + id + '"><rect x="' + x(rect) + '" y="' + y(rect)
				+ '" width="' + num(rect.width) + '" height="' + num(rect.height)
				+ (radius > 0.5 ? '" rx="' + num(radius) : '') + '"/></clipPath>');
			childClip = id;
		}

		if (isTextLeaf(el)) {
			text(el, cs, rect, childClip);
		} else {
			for (var i = 0; i < el.children.length; ++i) {
				walk(el.children[i], depth + 1, childClip);
			}
		}

		pseudo(el, '::after', rect);
	}

	walk(element, 0, null);

	// The <style> block is what lets an inline mockup re-theme with the page.
	var style = '';
	if (o.preserveClasses && !o.resolveVars) {
		var rules = [];
		for (var name in classes) {
			var decl = [];
			for (var sel in cssom) {
				if (sel !== '.' + name) { continue; }
				for (var prop in cssom[sel]) {
					var svgProp = PROPERTY_MAP[prop];
					if (svgProp) {
						decl.push(svgProp + ':' + cssom[sel][prop]);
					}
				}
			}
			if (decl.length) {
				rules.push('.' + name + '{' + decl.join(';') + '}');
			}
		}
		if (rules.length) {
			style = '<style>' + rules.join('') + '</style>';
		}
	}

	var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '
		+ width + ' ' + height + '" width="' + width + '" height="' + height + '"'
		+ (rtl ? ' direction="rtl"' : '')
		+ ' preserveAspectRatio="xMidYMin meet" role="img">'
		+ style
		+ (defs.length ? '<defs>' + defs.join('') + '</defs>' : '')
		+ body.join('')
		+ '</svg>';

	return {
		svg: svg,
		width: width,
		height: height,
		classes: Object.keys(classes)
	};
};

/**
 * Discard the CSSOM cache. Call after loading a stylesheet at runtime.
 * @method DOMtoSVG.refresh
 * @static
 */
Q.Tool.DOMtoSVG.refresh = function () {
	_cssomCache = null;
	_cssomSheetCount = -1;
};

})(Q, Q.jQuery, window);
