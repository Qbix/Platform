(function (Q, $, window, document, undefined) {

/**
 * Q Tools
 * @module Q-tools
 */

/**
 * Adds a fisheye effect to an element and its children
 * @class Q/fisheye
 * @constructor
 * @param {Object} [options] possible options
 * @param {Boolean} [options.horizontal=false] whether to do fisheye effect in horizontal direction
 * @param {Boolean} [options.vertical=false] whether to do fisheye effect in vertical direction
 * @param {Boolean} [options.useCenters=false] whether to calculate distance to the center
 *      instead of to the element edges
 * @param {Boolean} [options.fillContainer=false] whether to normalize elements
 *      so that they fill the whole container
 * @param {Function} [options.distribution] function mapping distance => scale
*/
Q.Tool.jQuery('Q/fisheye',

function _Q_fisheye(options) {
	var $container = $(this);
	var state = $container.state('Q/fisheye');

	$container
		.addClass('Q_fisheye')
		.on(Q.Pointer.move + '.Q_fisheye', function (e) {
			var x = Q.Pointer.getX(e);
			var y = Q.Pointer.getY(e);

			var scales = [];
			var widths = [];
			var heights = [];

			$container.children().each(function () {
				var $child = $(this);
				var offset = $child.offset();
				var width = $child.outerWidth();
				var height = $child.outerHeight();
				var centerX = offset.left + width / 2;
				var centerY = offset.top + height / 2;

				var d;
				if (state.horizontal && state.vertical) {
					d = Math.sqrt((x - centerX) * (x - centerX) + (y - centerY) * (y - centerY));
				} else if (state.horizontal) {
					d = Math.abs(x - centerX);
				} else if (state.vertical) {
					d = Math.abs(y - centerY);
				} else {
					throw new Q.Error("Q/fisheye: horizontal and vertical can't both be false");
				}

				var scale = state.distribution(d);
				scales.push(scale);
				widths.push(width);
				heights.push(height);
			});

			// normalize if fillContainer is set
			if (state.fillContainer) {
				if (state.horizontal) {
					var totalScaledW = scales.reduce(function (sum, s, i) { return sum + s * widths[i]; }, 0);
					var factorW = $container.innerWidth() / totalScaledW;
					scales = scales.map(function (s) { return s * factorW; });
				}
				if (state.vertical) {
					var totalScaledH = scales.reduce(function (sum, s, i) { return sum + s * heights[i]; }, 0);
					var factorH = $container.innerHeight() / totalScaledH;
					scales = scales.map(function (s) { return s * factorH; });
				}
			}

			// apply transforms
			$container.children().each(function (i) {
				$(this).css({
					transform: 'scale(' + scales[i] + ')',
					transformOrigin: 'center center'
				});
			});
		});
},

{	// default options:
	horizontal: false,
	vertical: true,
	useCenters: false,
	distribution: function (x) {
		// distance decay: closer = bigger
		return Math.pow(0.9, x / 50) * 0.75 + 0.25;
	},
	fillContainer: false
},

{
	remove: function () {
		$(this).removeClass('Q_fisheye').off('.Q_fisheye');
		$(this).children().css('transform', '');
	}
}

);

})(Q, Q.jQuery, window, document);