Q.exports(function (Q, root) {
    /**
     * Override browser SpeechRecognition with a server-side implementation.
     * impl must expose start(options), stop(), abort().
     * It fires the same Q.Speech.Recognition.on* events.
     * Used by the AI plugin to switch to Deepgram/AssemblyAI streaming.
     * @method Q.Speech.Recognition.implement
     * @static
     * @param {Object} impl  Object with start(options), stop(), abort()
     */
    return function _Q_Speech_Recognition_implement(impl) {
        var R = Q.Speech.Recognition;
        if (R._rec) { try { R._rec.abort(); } catch (e) {} R._rec = null; }
        R._impl = impl;
    };
});
