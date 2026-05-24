Q.exports(function (Q, root) {
    /**
     * Stop recognition gracefully — flushes pending audio, fires onEnd.
     * @method Q.Speech.Recognition.stop
     * @static
     */
    return function _Q_Speech_Recognition_stop() {
        var R = Q.Speech.Recognition;
        R._autoRestart = false;
        if (R._impl) { R._impl.stop(); return; }
        if (R._rec)  { try { R._rec.stop(); } catch (e) {} }
    };
});
