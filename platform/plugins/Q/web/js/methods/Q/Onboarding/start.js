Q.exports(function (Q) {
    /**
     * Q plugin's front end code
     *
     * @module Q
     * @class Q.Onboarding
     */

    /**
     * Starts an onboarding process. You can also trigger
     * Q.Onboarding.event manually with Q.handle().
     * @static
     * @method start
     * @param {Object} [instructions] An object of key: instructionObject pairs
     *   where instructionObject has at least "appear" key, with value = CSS selector.
     *   It can also have optional:
     *   "targets" (selector to override what to hint),
     *   "disappear" (selector to override what should disappear before hint event stops)
     *   "after" (key of a hint event that has to stop before this hint starts)
     *   "options" (for options passed to Q.Visual.hint, merged over Q.Onboarding.options.hint)
     *
     */
    return function _Q_Onboarding_start(instructions) {
        if (!instructions) {
            return false;
        }
        if (typeof Q.Onboarding.textName === 'string') {
            Q.Text.get(Q.Onboarding.textName).then(function (text) {
                Q.Onboarding.text = text;
                if (!Q.isEmpty(Q.Onboarding.textPath)) {
                    Q.Onboarding.text = Q.getObject(
                        Q.Onboarding.textPath, Q.Onboarding.text
                    );
                }
            });
        }
        var selectors = Q.Onboarding.selectors;
        var events = Q.Onboarding.events;
        var waitToDisappear = Q.Onboarding.waitToDisappear = {};
        Q.each(instructions, function (k) {
            var instr = instructions[k];
            events[k] = new Q.Event(function (targets, k) {
                var hintTargets = (selectors[k].targets)
                    ? document.querySelectorAll(selectors[k].targets)
                    : targets;
                var lsk = Q.Onboarding.prefix + k;
                if (localStorage[lsk]) {
                    events[k].stop(); // it already occurred before
                } else {
                    var o = Q.extend({}, Q.Onboarding.options.hint, instr.options);
                    if (Q.Onboarding.text[k]) {
                        o.tooltip = Q.extend({
                            text: Q.Onboarding.text && Q.Onboarding.text[k]
                        }, o.tooltip);
                    }
                    o.onHide = Q.extend(o.onHide, {
                        'Q.Onboarding': function () {
                            setTimeout(function () {
                                if (!waitToDisappear[k]) {
                                    // They never appeared, or weren't speciied
                                    // So go to the next hint.
                                    localStorage[Q.Onboarding.prefix + k] = 'stopped';
                                    events[k].stop();
                                    return;
                                }
                            }, Q.Onboarding.interval.afterHintHide || 3000);
                        }
                    });
                    Q.Visual.stopHints(); // stop previous hints
                    Q.Visual.hint(hintTargets, o);
                    localStorage[lsk] = 'occurred';
                }
            }, 'Q.hint');
            selectors[k] = { appear: instr.appear };
            Q.take(instr, ['targets', 'disappear'], selectors[k]);
        });
        Q.Onboarding.intervalId && clearInterval(Q.Onboarding.intervalId);
        Q.Onboarding.intervalId = setInterval(function () {
            for (var k in selectors) {
                var selectorToAppear = selectors[k].appear;
                var selectorToDisappear = selectors[k].disappear || selectors[k].appear;
                var elementsToAppear = document.querySelectorAll(selectorToAppear);
                var appeared = [];
                var visible = false;
                for (var i=0; i<elementsToAppear.length; ++i) {
					var e = elementsToAppear[i];
                    var r = e.getBoundingClientRect();
                    var s = Q.Onboarding.treatAsVisible;
                    var elements = Array.prototype.slice.call(document.querySelectorAll(s));
                    var treatAsVisible = elements.includes(elementsToAppear[i]);
                    if (treatAsVisible || (r.width && r.height && !_isOverlapped(e))) {
                        visible = true;
                        appeared.push(elementsToAppear[i]);
                    }
                }
                if (!events[k].occurred && visible) {
                    var after = instructions[k]?.after;
                    if (typeof after === 'string') {
                        after = [after];
                    }
                    var proceed = false;
                    Q.each(after, function (i, s) {
                        if (Q.Onboarding.events[s].stopped
                        || localStorage[Q.Onboarding.prefix + s] === 'stopped') {
                            proceed = true;
                            return false;
                        }
                    });
                    if (!after || proceed) {
                        Q.Onboarding.waitToDisappear[k] = false;
                        Q.handle(events[k], instructions, [appeared, k]);
                    }
                }
                if (!events[k].occurred || events[k].stopped) {
                    continue;
                }
                if (selectorToDisappear === selectorToAppear) {
                    events[k].stop(); // nothing to wait for
                    continue;
                }
                visible = false;
                var elementsToDisappear = document.querySelectorAll(selectorToDisappear);
                for (var i=0; i<elementsToDisappear.length; ++i) {
					var e = elementsToDisappear[i];
                    var r = e.getBoundingClientRect();
                    var s = Q.Onboarding.treatAsVisible;
                    var elements = Array.prototype.slice.call(document.querySelectorAll(s));
                    var treatAsVisible = elements.includes(elementsToDisappear[i]);
                    if (treatAsVisible || (r.width && r.height && !_isOverlapped(e))) {
                        visible = true;
                        break;
                    }
                }
                if (visible) {
                    waitToDisappear[k] = true;
                }
                if (waitToDisappear[k] && !visible) {
                    localStorage[Q.Onboarding.prefix + k] = 'stopped';
                    events[k].stop();
                    waitToDisappear[k] = false;
                }
            }
        }, 100);
        function _isOverlapped(el) {
			const rect = el.getBoundingClientRect();
			const points = [
				[rect.left, rect.top],
				[rect.right, rect.top],
				[rect.left, rect.bottom],
				[rect.right, rect.bottom],
				[(rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2]
			];

			return !points.every(([x, y]) => document.elementFromPoint(x, y) === el);
		}

    };
});
