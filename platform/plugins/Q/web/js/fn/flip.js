(function (Q, $, window, document, undefined) {

Q.Tool.jQuery('Q/flip',

function (o) {
	return this.each(function () {
		var $this = $(this);
		if ($this.data('Q_flipping')) return;

		$this.data('Q_flipping', true).addClass('Q_flip_container');

		var frontSide = $this.children('[data-side="front"]').first();
		var backSide  = $this.children('[data-side="back"]').first();

		// fallback if no data-side attributes
		if (!frontSide.length || !backSide.length) {
			frontSide = $($this.children()[0]);
			backSide  = $($this.children()[1]);
			frontSide.attr('data-side', 'front');
			backSide.attr('data-side', 'back');
		}

		// add curl decorations if requested
		function addCurl($side) {
			if ($side.find('.Q_flip_curl').length) return;
			var $curl = $('<div class="Q_flip_curl"></div>');
			$side.addClass('Q_flip_side').append($curl);
		}
		if (o.curl === 'front' || o.curl === 'both') addCurl(frontSide);
		if (o.curl === 'back'  || o.curl === 'both') addCurl(backSide);

		var axis = o.direction === 'v' ? 'X' : 'Y';
		var curSide = frontSide;

		// the animation callback
		function step(x, y) {
			// angle: front→back is 0→180, back→front is -180→0
			var angle = (curSide.is(frontSide) ? 0 : -180) + 180 * y;

			// halfway: swap sides
			if (angle > 90 && curSide.is(frontSide)) {
				frontSide.hide();
				curSide = backSide;
				curSide.css({ transform: `rotate${axis}(-90deg)` }).show();
			}

			curSide.css({ transform: `rotate${axis}(${angle}deg)` });

			// animate curl intensity if present
			curSide.find('.Q_flip_curl').each(function () {
				var intensity = Math.sin(Math.PI * x); // 0→1→0
				$(this).css({
					opacity: 0.3 + 0.7 * intensity,
					transform: `rotate(45deg) skewX(${20 + intensity * 10}deg)`
				});
			});
		}

		// run animation
		Q.Animation.play(step, o.duration, o.ease, 1, {})
			.onComplete.set(function () {
				$this.removeClass('Q_flip_container');
				frontSide.css({ transform: '' }).attr('data-side', 'back').show();
				backSide.css({ transform: '' }).attr('data-side', 'front').show();
				$this.data('Q_flipping', false);
				Q.handle(o.onFinish, $this[0]);
			});
	});
},

{
	direction: 'h',
	duration: 500,
	ease: 'inOutQuintic',
	curl: false, // false | 'front' | 'back' | 'both'
	onFinish: new Q.Event(function () {})
}

);

})(Q, Q.jQuery, window, document);