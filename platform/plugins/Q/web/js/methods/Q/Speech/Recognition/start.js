Q.exports(function (Q, root) {
    /**
     * Starts speech recognition.
     *
     * Options are merged via Q.extend({}, start.options, options).
     * Q.Event values in options are extended (handlers added), not replaced,
     * so callers can pass { onResult: fn } as a per-call shorthand.
     *
     * The AI plugin overrides the backend by calling:
     *   Q.Speech.Recognition.implement(adapter)
     * All callers see the same interface either way.
     *
     * Must be called inside a user gesture handler on iOS Safari.
     *
     * @method Q.Speech.Recognition.start
     * @static
     * @param {Object} [options]
     * @param {String}  [options.lang='en-US']
     * @param {Boolean} [options.continuous=true]
     * @param {Boolean} [options.interimResults=true]
     * @param {Boolean} [options.autoRestart=true]
     * @param {String}  [options.source='microphone']
     * @param {Function|Q.Event} [options.onResult]
     * @param {Function|Q.Event} [options.onError]
     * @param {Function|Q.Event} [options.onStart]
     * @param {Function|Q.Event} [options.onEnd]
     * @param {Function|Q.Event} [options.onSpeechStart]
     * @param {Function|Q.Event} [options.onSpeechEnd]
     */
    return function _Q_Speech_Recognition_start(options) {
        var R  = Q.Speech.Recognition;
        var o  = Q.extend({}, R.start.options, options);

        // Wire any on* functions/events from options onto the shared events
        Q.each(['onStart','onEnd','onResult','onError','onSpeechStart','onSpeechEnd'],
        function (i, name) {
            if (options && options[name]) {
                R[name].set(options[name], 'startCall');
            }
        });

        R._autoRestart = (o.autoRestart !== false);

        // Delegate to override implementation if set
        if (R._impl) { R._impl.start(o); return; }

        // Check browser support on first call
        if (R._supported === null) {
            R._supported = !!(root.SpeechRecognition || root.webkitSpeechRecognition);
        }
        if (!R._supported) { return; }

        var SR = root.SpeechRecognition || root.webkitSpeechRecognition;

        if (R._rec) { try { R._rec.abort(); } catch (e) {} }
        var rec = R._rec = new SR();
        rec.lang            = o.lang || 'en-US';
        rec.continuous      = o.continuous !== false;
        rec.interimResults  = o.interimResults !== false;
        rec.maxAlternatives = 1;

        rec.onstart       = function () { Q.handle(R.onStart,       R); };
        rec.onspeechstart = function () { Q.handle(R.onSpeechStart, R); };
        rec.onspeechend   = function () { Q.handle(R.onSpeechEnd,   R); };
        rec.onerror       = function (e) {
            Q.handle(R.onError, R, [{ error: e.error }]);
        };
        rec.onend = function () {
            Q.handle(R.onEnd, R);
            if (R._autoRestart && R._rec === rec) {
                try { rec.start(); } catch (e) {}
            }
        };
        rec.onresult = function (e) {
            for (var i = e.resultIndex; i < e.results.length; i++) {
                var alt = e.results[i][0];
                Q.handle(R.onResult, R, [{
                    transcript: alt.transcript,
                    isFinal:    e.results[i].isFinal,
                    confidence: alt.confidence,
                    speaker:    null
                }]);
            }
        };

        try { rec.start(); } catch (e) {
            Q.handle(R.onError, R, [{ error: 'start-failed' }]);
        }
    };
});

// Default options — pre-set persistent handlers here or pass per-call
Q.Speech.Recognition.start.options = {
    lang:           'en-US',
    continuous:     true,
    interimResults: true,
    autoRestart:    true,
    source:         'microphone'
};
