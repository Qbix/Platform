Q.exports(function (Q) {
    /**
     * Q plugin's front end code
     *
     * @module Q
     * @class Q.Onboarding
     */

    /**
     * Handles a specific hint event, if it hasn't already occurred.
     * Ignores the "after" instruction of the event, if any.
     * But checks whether elements are visible, otherwise returns false.
     * @static
     * @method handle
     * @param {String} key
     * @param {Function} [callback]
     */
    return function _Q_Onboarding_handle(key, callback) {
        var lsk = Q.Onboarding.prefix + key;
        var event = Q.Onboarding.events[key];
        if (!localStorage[lsk] || !event || event.occurred || event.stopped) {
            return callback && callback(false);
        }
        var appeared = [];
        var visible = false;
        var selectorToAppear = Q.Onboarding.selectors[key].appear;
        var elementsToAppear = document.querySelectorAll(selectorToAppear);
        for (var i=0; i<elementsToAppear.length; ++i) {
            var r = elementsToAppear[i].getBoundingClientRect();
            if (r.width && r.height) {
                visible = true;
                appeared.push(elementsToAppear[i]);
            }
        }
        if (!visible) {
            return false;
        }
        Q.Onboarding.waitToDisappear[key] = false;
        Q.handle(Q.Onboarding.events[key], {}, [appeared, key]);
        callback && callback(true);
    };
});