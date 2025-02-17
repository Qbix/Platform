Q.exports(function (Q) {
    /**
     * Q plugin's front end code
     *
     * @module Q
     * @class Q.Onboarding
     */

    /**
     * Starts an onboarding process
     * @static
     * @method start
     * @param {String} [key] The key under which to store Q.Onboarding.processes
     */
    return function _Q_Onboarding_start(instructions) {
        if (!instructions) {
            return false;
        }
        var selectors = Q.Onboarding.selectors = {};
        var events = Q.Onboarding.events = {};
        var appeared = {};
        Q.each(instructions, function (k) {
            var instr = instructions[k];
            events[k] = new Q.Event(function (targets, k) {
                if (localStorage[lsk]) {
                    events[k].stop(); // mark it as already happened
                } else {
                    Q.Visual.hint(targets, instr.options);
                    localStorage[lsk] = 1;
                }
            }, 'Q.hint');
            selectors[k] = { appear: instr.appear };
            if (instr.untilDisappear) {
                selectors[k].disappear = instr.untilDisappear;
            }
        });
        instructions.intervalId = setInterval(function () {
            for (var k in selectors) {
                var selectorToAppear = selectors[k].appear;
                var selectorToDisappear = selectors[k].disappear || selectors[k].appear;
                var elementsToAppear = document.querySelectorAll(selectorToAppear);
                var targets = [];
                var visible = false;
                for (var i=0; i<elementsToAppear.length; ++i) {
                    var r = elementsToAppear[i].getBoundingClientRect();
                    if (r.width && r.height) {
                        visible = true;
                        targets.push(elementsToAppear[i]);
                    }
                }
                if (!events[k].occurred && visible) {
                    var after = instructions[k].after;
                    if (!after || Q.Onboarding.events[after].stopped) {
                        events[k].handle.call(events[k], targets, k);
                    }
                }
                if (selectorToDisappear !== selectorToAppear) {
                    visible = false;
                    var elementsToDisappear = document.querySelectorAll(selectorToDisappear);
                    for (var i=0; i<elementsToDisappear.length; ++i) {
                        var r = elementsToDisappear[i].getBoundingClientRect();
                        if (r.width && r.height) {
                            visible = true; 
                            break;
                        }
                    }
                }
                if (visible) {
                    appeared[k] = true;
                }
                if (events[k].occurred && !events[k].stopped
                && appeared[k] && !visible) {
                    events[k].stop();
                }
            }
        }, 100);
    };
});