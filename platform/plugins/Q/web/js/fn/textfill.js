(function (Q, $, window, document, undefined) {

/**
 * Q Tools
 * @module Q-tools
 */

/**
 * Adjusts the font size of the context text until it fills the element's width and height
 * @class Q textfill
 * @constructor
 * @param {Object} [options] options object that contains function parameters
 *   @param {Number} [options.maxFontPixels] Maximum size of text font,
 *   set this if your text container is large and you don't want to have extra large text on page
 *   @param {Number} [options.minFontPixels] Minimum size of text font,
 *   @param {Number} [options.maxLines] Maximum number of lines,
 *   set this if you'd like to have a maximum number of lines.
 *   @param {Number} [options.maxWidth] This allows the element to stretch til maxWidth
 *   @param {Number} [options.maxHeight] This allows the element to stretch til maxHeight
 *   @param {boolean} [options.refreshOnLayout=true] Whether to refresh the textfill on any layout change that affects its container
 *   @param {boolean} [options.fillPadding=false] Whether to have the text extend into the padding as well
 *   @param {boolean} [options.fillParent=false] Whether we should fit the parent of this element instead
 */
Q.Tool.jQuery('Q/textfill',

	function _Q_textfill(options) {

		var $this = $(this);
		$this.plugin('Q/textfill', 'refresh', options);
		
		if (options.refreshOnLayout) {
			$this.state('Q/textfill').layoutEventKey
			= Q.onLayout(this[0]).set(function () {
				$this.plugin('Q/textfill', 'refresh');
			});
		}

	},

	{
		maxFontPixels: 30,
		minFontPixels: 10,
		maxWidth: null,
		maxHeight: null,
		maxLines: null,
		refreshOnLayout: true
	},

	{
		refresh: function (options) {
			var o = Q.extend({}, this.state('Q/textfill'), options);
			var $e, ourText = "";
			this.children(':visible').each(function () {
				var $t = $(this);
				if ($t.text().length > ourText.length) {
					$t.addClass('Q_textfill_child');
					$e = $t;
					ourText = $t.text();
				}
			});
			var $this = $(this);
			var $child = null;
			if (!$e) {
				$child = $e = $('<div />').appendTo(this).css('visibility', 'hidden');
				var cn = $this[0].childNodes;
				for (var i=0; i < cn.length; ++i) {
					if (cn[i].nodeType === 3) { // text node
						$child.append(cn[i]);
						break;
					}
				}
			}
			var fontSize = o.maxFontPixels || ($this.height() + 10);
			var lastGoodFontSize = 0, lastBadFontSize = fontSize, jump;
			var $c = o.fillParent ? $this.parent() : $this;
			if (!$c.length) {
				return false; // it's not part of the DOM yet
			}
			var maxHeight = o.maxHeight || Math.round(o.fillPadding ? $c.innerHeight() : $c.height());
			var maxWidth = o.maxWidth || Math.round(o.fillPadding ? $c.innerWidth() : $c.width());
			var lineHeight = parseInt(document.defaultView.getComputedStyle($c[0], null).getPropertyValue("line-height"));
			var textHeight, textWidth, lines, tooBig;
			$e.addClass('Q_textfill_resizing');
			for (var i=0; i<100; ++i) {
				$e.css('font-size', fontSize + 'px');
				var rect = $e[0].getBoundingClientRect();
				textWidth = Math.floor(rect.width
					+ parseFloat($e.css('margin-left'))
					+ parseFloat($e.css('margin-right')));
				textHeight = Math.floor(rect.height
					+ parseFloat($e.css('margin-top'))
					+ parseFloat($e.css('margin-bottom')));
				if (o.maxLines) {
					lines = Math.round(textHeight/lineHeight);
				}
				tooBig = (textHeight > maxHeight || textWidth > maxWidth
					|| (o.maxLines && lines > o.maxLines))
				if (tooBig) {
					lastBadFontSize = fontSize;
					jump = (lastGoodFontSize - fontSize) / 2;
				} else {
					lastGoodFontSize = fontSize;
					jump = (lastBadFontSize - fontSize) / 2
				}
				if (Math.abs(jump) < 1) {
					break;
				}
				fontSize = Math.floor(fontSize + jump);
				if (fontSize < 3) {
					lastGoodFontSize = 3;
					break; // container is super small
				}
			}
			lastGoodFontSize = Math.max(o.minFontPixels, lastGoodFontSize);
			$e.add(this).css('font-size', lastGoodFontSize + 'px');
			$e.removeClass('Q_textfill_resizing').addClass('Q_textfill_resized');
			if ($child) {
				var cn = $child[0].childNodes;
				for (var i=0; i < cn.length; ++i) {
					if (cn[i].nodeType === 3) { // text node
						$this.append(cn[i]);
						break;
					}
				}
				$child.remove();
			}
			return this;
		},
		
		remove: function () {
			Q.onLayout(this[0]).remove(this.state('Q/textfill').layoutEventKey);
		}
	}

);

})(Q, Q.jQuery, window, document);