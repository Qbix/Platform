Q.exports(function (Q, root) {
    /**
     * Abort recognition — discards pending audio, fires onEnd.
     * @method Q.Speech.Recognition.abort
     * @static
     */
    return function _Q_Speech_Recognition_abort() {
        var R = Q.Speech.Recognition;
        R._autoRestart = false;
        if (R._impl) { R._impl.abort(); return; }
        if (R._rec)  { try { R._rec.abort(); } catch (e) {} }
    };
});
