Q.exports(function (Q, root) {
    /**
     * Remove a previously installed implementation, reverting to browser API.
     * @method Q.Speech.Recognition.unimplement
     * @static
     */
    return function _Q_Speech_Recognition_unimplement() {
        var R = Q.Speech.Recognition;
        if (R._impl && typeof R._impl.abort === 'function') {
            try { R._impl.abort(); } catch (e) {}
        }
        R._impl = null;
    };
});
