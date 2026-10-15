Q.exports(function (Q, root) {
    /**
     * Stop recognition gracefully — flushes pending audio, fires onEnd.
     * @method Q.Speech.Recognition.stop
     * @static
     */
    return function _Q_Speech_Recognition_stop() {
        var R = Q.Speech.Recognition;
        R._autoRestart = false;
        // Lets start.js's watchdog (armed after any start()/restart() call
        // that didn't throw, to catch the engine silently never actually
        // beginning to listen) tell "user deliberately stopped it before
        // onstart fired" apart from a real silent failure -- cleared again
        // at the top of the next start() call.
        R._stopRequested = true;
        if (R._log) { R._log('stop() called'); }
        if (R._impl) { R._impl.stop(); return; }
        if (R._rec)  { try { R._rec.stop(); } catch (e) {} }
    };
});
