(function (Q, $, window, undefined) {

/**
 * Themed SVG projections of any tool, from its template and CSS, without
 * activating event handlers or fetching data.
 *
 * Q.Tool.define registers nothing eagerly — it only notes that a mechanical
 * default applies. Nothing is built and DOMtoSVG is not loaded until a
 * mockup is actually requested, because most pages never ask for one.
 *
 * @module Q
 * @class Q.Tool
 */

Q.Tool = Q.Tool || {};

/**
 * Registry parallel to Q.Tool.constructors and Q.Tool.placeholders.
 * @property mockups
 * @type Object
 * @static
 */
Q.Tool.mockups = Q.Tool.mockups || {};

var CONTAINER_ID = 'Q_mockup_container';
var _container = null;

function container(width, themeClass) {
	if (!_container) {
		_container = document.createElement('div');
		_container.id = CONTAINER_ID;
		document.body.appendChild(_container);
	}
	// Off-screen rather than display:none — getComputedStyle needs a real
	// layout, and a hidden element has no box to measure.
	_container.setAttribute('style',
		'position:absolute;left:-99999px;top:0;'
		+ 'width:' + width + 'px;visibility:hidden;pointer-events:none;'
		+ 'contain:layout style;');
	_container.className = themeClass || currentTheme();
	return _container;
}

function currentTheme() {
	var m = (document.documentElement.className || '').match(/(^|\s)(theme-\S+)/);
	return m ? m[2] : '';
}

/**
 * Find the tool's first registered template by name convention.
 */
function templateFor(toolName) {
	var collection = (Q.Template && Q.Template.collection) || {};
	if (collection[toolName]) { return toolName; }
	for (var key in collection) {
		if (key.indexOf(toolName + '/') === 0) { return key; }
	}
	return null;
}

function placeholder(toolName, width, height) {
	var label = toolName.split('/').pop();
	return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + ' ' + height
		+ '" width="' + width + '" height="' + height + '" role="img">'
		+ '<rect x=".5" y=".5" width="' + (width - 1) + '" height="' + (height - 1)
		+ '" rx="6" fill="var(--color-bg-tertiary, #f1f2f4)"'
		+ ' stroke="var(--color-border-light, #e2e4e8)" stroke-dasharray="3 3"/>'
		+ '<text x="' + (width / 2) + '" y="' + (height / 2 + 4)
		+ '" text-anchor="middle" font-size="11"'
		+ ' font-family="ui-monospace, SFMono-Regular, Menlo, monospace"'
		+ ' fill="var(--color-text-tertiary, #9aa1ab)">' + label + '</text></svg>';
}

/**
 * Register or override the SVG renderer for a tool.
 *
 * @method mockup
 * @static
 * @param {String} toolName e.g. "Streams/chat"
 * @param {Object} options
 * @param {Function} [options.render] function (state, width, height) returning
 *   an SVG string. Omit to use the mechanical default.
 * @param {String} [options.template] template name, guessed by convention
 * @param {Number} [options.aspect] width/height ratio, used only as a layout
 *   estimate before a node has ever rendered — measured height always wins
 * @param {Object} [options.streams] which stream types and message types this
 *   tool re-renders for. Doubles as the replay spec for reconstructing state
 *   at a given ordinal.
 */
Q.Tool.mockup = function (toolName, options) {
	Q.Tool.mockups[toolName] = Q.extend({
		aspect: 3 / 2,
		mechanical: !options || !options.render
	}, options);
	return Q.Tool.mockups[toolName];
};

/**
 * Render a mockup. Cached by tool, width, theme and state — the same node at
 * 109px and at 816px are different renders, and dark mode is a third.
 *
 * @method mockup.render
 * @static
 * @param {String} toolName
 * @param {Object} state
 * @param {Number} width
 * @param {Object} [options]
 * @param {Number} [options.height]
 * @param {Boolean} [options.resolveVars=false]
 * @param {Function} callback receives (err, { svg, width, height })
 */
Q.Tool.mockup.render = function (toolName, state, width, options, callback) {
	if (typeof options === 'function') {
		callback = options;
		options = {};
	}
	options = options || {};

	var registered = Q.Tool.mockups[toolName];
	var theme = currentTheme();
	var key = [toolName, width, theme, JSON.stringify(state || {})].join('\t');

	var cache = Q.Tool.mockup.cache;
	var hit = cache && cache.get(key);
	if (hit) {
		return callback(null, hit.subject !== undefined ? hit.subject : hit);
	}

	function done(result) {
		if (cache) { cache.set(key, 0, result, []); }
		callback(null, result);
	}

	var aspect = (registered && registered.aspect) || 3 / 2;
	var height = options.height || Math.round(width / aspect);

	// A custom renderer takes over entirely.
	if (registered && registered.render) {
		var svg;
		try {
			svg = registered.render.call(registered, state || {}, width, height);
		} catch (e) {
			console.warn('Q.Tool.mockup: ' + toolName + ' renderer threw', e);
			return done({ svg: placeholder(toolName, width, height), width: width, height: height });
		}
		if (svg && svg.nodeType) { svg = svg.outerHTML; }
		return done({ svg: svg, width: width, height: height });
	}

	// Mechanical default: render the template, convert, discard.
	var templateName = (registered && registered.template) || templateFor(toolName);
	if (!templateName) {
		return done({ svg: placeholder(toolName, width, height), width: width, height: height });
	}

	Q.Template.render(templateName, state || {}, function (err, html) {
		if (err || !html) {
			return done({ svg: placeholder(toolName, width, height), width: width, height: height });
		}
		var el = container(width, theme);
		el.innerHTML = '<div class="Q_tool ' + Q.normalize(toolName, '_') + '_tool">'
			+ html + '</div>';

		var result;
		try {
			result = Q.Tool.DOMtoSVG(el.firstChild, {
				preserveClasses: true,
				resolveVars: !!options.resolveVars
			});
		} catch (e) {
			console.warn('Q.Tool.mockup: DOMtoSVG failed for ' + toolName, e);
			result = { svg: placeholder(toolName, width, height), width: width, height: height };
		}
		el.innerHTML = '';
		done(result);
	});
};

Q.Tool.mockup.cache = (Q.Cache && Q.Cache.document)
	? new Q.Cache.document('Q.Tool.mockup', 200)
	: null;

/**
 * Drop cached mockups for a tool — call after its CSS arrives late.
 * @method mockup.refresh
 * @static
 */
Q.Tool.mockup.refresh = function (toolName) {
	Q.Tool.DOMtoSVG.refresh();
	if (Q.Tool.mockup.cache) {
		Q.Tool.mockup.cache.each([], function (k) {
			if (!toolName || k.indexOf(toolName + '\t') === 0) {
				Q.Tool.mockup.cache.remove(k);
			}
		});
	}
};

})(Q, Q.jQuery, window);
