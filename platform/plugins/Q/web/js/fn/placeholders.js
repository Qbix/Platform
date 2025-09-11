(function (Q, $, window, document, undefined) {

/**
 * Q Tools
 * @module Q-tools
 */

/**
 * Activates placeholder effect on any input and textarea elements contained within this jquery.
 * Attribute placeholder must be set for element
 * @class Q placeholders
 * @constructor
 * @param {Object} [options]
 */
Q.Tool.jQuery('Q/placeholders',

function () {
	
	var that = this;
	setTimeout(function () {
		// Sadly, iOS safar doesn't always update computedStyle() correctly
		// on just-inserted HTML, until you give it a tick to process it.
		that.plugin('Q/placeholders', 'setup');
	}, 0);
},

{
	// properties
},

{
	setup: function () {
		
		function manage(event) {
			var $this = $(this);
			var $placeholder = $this.data('Q-placeholder');
			if (!$placeholder) {
				return;
			}
			var p;
			if (p = $this.attr('placeholder')) {
				$placeholder.text(p);
				$this.removeAttr('placeholder');
			}
			if ($this.val()) { //  || event.type === 'keypress' || event.type === 'change'
				$placeholder.hide();
			} else {
				$placeholder.show();
			}
		}
		
		var events = 'keypress keyup change input focus paste blur'
			+ ' Q_refresh Q_refresh_placeholders';
		var namespacedEvents = '';
		Q.each(events.split(' '), function (i, e) {
			namespacedEvents += e + '.Q_placeholders ';
		});
		
		$('input', this)
		.add(this).filter('input,textarea')
		.not('input.Q_leave_alone')
		.not('input[type=file]')
		.not('input[type=hidden]')
		.not('input[type=submit]')
		.add('textarea', this).each(function () {
			var t = this.tagName.toLowerCase();
			if (t !== 'input' && t !== 'textarea') {
				return;
			}
		
			var $this = $(this);
		
			var plch = $this.attr('placeholder');
			if(!(plch)) {
				return;
			}

			if (!$this.is(':visible')) {
				return;
			}
			$this.removeAttr('placeholder');
			var dim = this.cssDimensions();
			var display = $this.css('display');
			if (display === 'inline') {
				display = 'inline-block';
			}
			var cs = this.computedStyle();
			var span = $('<span />').css({
				position: 'relative',
				width: dim.width,
				height: dim.height,
				"vertical-align": Q.getObject("verticalAlign", this.computedStyle('placeholder'))
					|| Q.getObject("verticalAlign", cs) || "middle",
				display: display
			}).addClass('Q_placeholders_container');
			var props = {};
			$this.css({
				width: '100%',
				height: '100%'
			});
			$this.hide(); // to get percentage values, if any, for margins & padding
			Q.each(['left', 'right', 'top', 'bottom'], function (i, pos) {
				props['padding-'+pos] = $this.css('padding-'+pos);
				props['margin-'+pos] = $this.css('margin-'+pos);
				span.css('margin-'+pos, props['margin-'+pos]);
			});
			$this.show();
			var isFocus = $this.is(":focus");
			$this.wrap(span).css('margin', '0');
			// if $this has focus before wrap set focus after wrap, because wrap lose focus
			if (isFocus) { $this.focus(); }
			span = $this.parent();
			span.on(Q.Pointer.fastclick, function() {
				$this.trigger('focus');
			});
			var lineHeight = cs.lineHeight
				? cs.lineHeight
				: (this.getBoundingClientRect().height
					- parseFloat(cs.paddingTop)
					-parseFloat(cs.paddingBottom)) + 'px';
			var $placeholder = $('<div />').text(plch).css({
				'position': 'absolute',
				'left': 0,
				'top': 0,
				'margin': 0,
				'overflow': this.css('overflow'),
				'padding-left': parseInt(props['padding-left'])+3+'px',
				'padding-right': props['padding-right'],
				'padding-top': props['padding-top'],
				'padding-bottom': props['padding-bottom'],
				'border-top': 'solid ' + $this.css('border-top-width') + ' transparent',
				'border-left': 'solid ' + $this.css('border-left-width') + ' transparent',
				'font-family': $this.css('font-family'),
				'font-size': $this.css('font-size'),
				'font-weight': $this.css('font-weight'),
				'line-height': $this.css('line-height'),
				'vertical-align': $this.css('vertical-align'),
				'width': '100%',
				'height': '100%',
				'text-align': $this.css('text-align'),
				'pointer-events': 'none',
				'color': $this.css('color'),
				'opacity': '0.5',
				'box-sizing': 'border-box'
			}).addClass('Q_placeholder').insertAfter($this);
			if (t === 'input') {
				$placeholder.css({
					'white-space': 'nowrap',
					'line-height': lineHeight
				});
			}
			// IE8 workaround
			$placeholder[0].style.fontFamily = cs.fontFamily;
			if ($this.val()) {
				$placeholder.stop().hide();
			}
			$this.on('input change', function () {
				if ($this.val()) {
					$placeholder.stop().hide();
				}
			}).on('focus', function () {
				$placeholder.parent().addClass('Q_focus');
			}).on('blur', function () {
				$placeholder.parent().removeClass('Q_focus');
			});
			$this.data('Q-placeholder', $placeholder);
		}).off('.Q_placeholders')
		.on(namespacedEvents, manage);
	}
}

);

})(Q, Q.jQuery, window, document);
