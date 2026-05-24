Q.exports(function (Q, root) {
    /**
     * Q plugin's front end code
     *
     * @module Q
     * @class Q.Speech.Recognition
     */

    /**
     * Starts speech recognition, merging options with Q.Speech.Recognition.start.options.
     *
     * Options are merged via Q.extend({}, Q.Speech.Recognition.start.options, options),
     * so Q.Event values in options are extended (handlers added), not replaced.
     * This means callers can do:
     *
     *   Q.Speech.Recognition.start({
     *       lang: 'en-US',
     *       onResult: function (chunk) { ... },   // added as handler on onResult event
     *       onError:  function (e)     { ... }    // added as handler on onError event
     *   });
     *
     * or pre-set persistent handlers at any time:
     *
     *   Q.Speech.Recognition.start.options.onResult.set(myHandler, 'myKey');
     *
     * The AI plugin overrides the backend by calling:
     *   Q.Speech.Recognition.implement(adapter)
     * All callers see the same interface either way.
     *
     * Must be called inside a user gesture handler on iOS Safari
     * (tap/click), since both getUserMedia and SpeechRecognition require it.
     *
     * @static
     * @method start
     * @param {Object} [options]
     * @param {String}  [options.lang='en-US']
     * @param {Boolean} [options.continuous=true]
     * @param {Boolean} [options.interimResults=true]
     * @param {Boolean} [options.autoRestart=true]   Auto-restart on silence (iOS Safari)
     * @param {String}  [options.source='microphone'] 'microphone' | 'tab'
     * @param {Function|Q.Event} [options.onStart]
     * @param {Function|Q.Event} [options.onEnd]
     * @param {Function|Q.Event} [options.onResult]
     * @param {Function|Q.Event} [options.onError]
     * @param {Function|Q.Event} [options.onSpeechStart]
     * @param {Function|Q.Event} [options.onSpeechEnd]
     */
    return function _Q_Speech_Recognition_load() {
        if (Q.Speech.Recognition._loaded) return;
        Q.Speech.Recognition._loaded = true;

        var SR = root.SpeechRecognition || root.webkitSpeechRecognition;
        if (!SR) {
            Q.Speech.Recognition._supported = false;
            return;
        }
        Q.Speech.Recognition._supported = true;

        var _rec  = null;
        var _impl = null;

        // ── start ──────────────────────────────────────────────────────────

        Q.Speech.Recognition.start = function (options) {
            // Merge: defaults ← persistent options ← call-site options
            // Q.extend handles Q.Event fields by extending their handlers, not replacing
            var o = Q.extend(
                {},
                Q.Speech.Recognition.start.options,
                options
            );

            // Wire any on* functions/events passed in options onto the shared events.
            // This lets callers pass { onResult: fn } as a shorthand.
            var evtNames = ['onStart', 'onEnd', 'onResult', 'onError', 'onSpeechStart', 'onSpeechEnd'];
            Q.each(evtNames, function (i, name) {
                if (options && options[name]) {
                    Q.Speech.Recognition[name].set(options[name], 'startCall');
                }
            });

            Q.Speech.Recognition._autoRestart = (o.autoRestart !== false);

            if (_impl) { _impl.start(o); return; }

            if (_rec) { try { _rec.abort(); } catch (e) {} }
            _rec = new SR();
            _rec.lang            = o.lang || 'en-US';
            _rec.continuous      = o.continuous !== false;
            _rec.interimResults  = o.interimResults !== false;
            _rec.maxAlternatives = 1;

            _rec.onstart       = function () { Q.handle(Q.Speech.Recognition.onStart, Q.Speech.Recognition); };
            _rec.onend         = function () {
                Q.handle(Q.Speech.Recognition.onEnd, Q.Speech.Recognition);
                if (Q.Speech.Recognition._autoRestart) {
                    try { _rec.start(); } catch (e) {}
                }
            };
            _rec.onspeechstart = function () { Q.handle(Q.Speech.Recognition.onSpeechStart, Q.Speech.Recognition); };
            _rec.onspeechend   = function () { Q.handle(Q.Speech.Recognition.onSpeechEnd,   Q.Speech.Recognition); };
            _rec.onerror       = function (e) {
                Q.handle(Q.Speech.Recognition.onError, Q.Speech.Recognition, [{ error: e.error }]);
            };
            _rec.onresult      = function (e) {
                for (var i = e.resultIndex; i < e.results.length; i++) {
                    var alt = e.results[i][0];
                    Q.handle(Q.Speech.Recognition.onResult, Q.Speech.Recognition, [{
                        transcript: alt.transcript,
                        isFinal:    e.results[i].isFinal,
                        confidence: alt.confidence,
                        speaker:    null
                    }]);
                }
            };

            try { _rec.start(); } catch (e) {
                Q.handle(Q.Speech.Recognition.onError, Q.Speech.Recognition, [{ error: 'start-failed' }]);
            }
        };

        /**
         * Default options for start(). Pre-set persistent handlers here or
         * pass them per-call. Q.Event properties are extended, not replaced.
         * @property {Object} Q.Speech.Recognition.start.options
         */
        Q.Speech.Recognition.start.options = {
            lang:            'en-US',
            continuous:      true,
            interimResults:  true,
            autoRestart:     true,
            source:          'microphone',
            onStart:         new Q.Event(),
            onEnd:           new Q.Event(),
            onResult:        new Q.Event(),
            onError:         new Q.Event(),
            onSpeechStart:   new Q.Event(),
            onSpeechEnd:     new Q.Event()
        };

        // ── stop / abort ──────────────────────────────────────────────────

        /**
         * Stop recognition gracefully — flushes pending audio, fires onEnd.
         * @method stop
         */
        Q.Speech.Recognition.stop = function () {
            if (_impl) { _impl.stop(); return; }
            Q.Speech.Recognition._autoRestart = false;
            if (_rec) { try { _rec.stop(); } catch (e) {} }
        };

        /**
         * Abort recognition — discards pending audio, fires onEnd.
         * @method abort
         */
        Q.Speech.Recognition.abort = function () {
            if (_impl) { _impl.abort(); return; }
            Q.Speech.Recognition._autoRestart = false;
            if (_rec) { try { _rec.abort(); } catch (e) {} }
        };

        // ── implement / unimplement ──────────────────────────────────────

        /**
         * Override with a server-side implementation (e.g. Deepgram).
         * impl must expose start(options), stop(), abort().
         * It fires the same Q.Speech.Recognition.on* events.
         * @method implement
         * @param {Object} impl
         */
        Q.Speech.Recognition.implement = function (impl) {
            if (_rec) { try { _rec.abort(); } catch (e) {} _rec = null; }
            _impl = impl;
        };

        /**
         * Remove a previously installed implementation, reverting to browser API.
         * @method unimplement
         */
        Q.Speech.Recognition.unimplement = function () {
            if (_impl && typeof _impl.abort === 'function') {
                try { _impl.abort(); } catch (e) {}
            }
            _impl = null;
        };
    };
});
