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
        // Remembered so a forced restart (see _armStallWatchdog) can reuse
        // the same lang/source/autoRestart instead of falling back to
        // start.options' bare defaults.
        R._lastStartOptions = o;

        // Wire any on* functions/events from options onto the shared events
        Q.each(['onStart','onEnd','onResult','onError','onSpeechStart','onSpeechEnd','onStall'],
        function (i, name) {
            if (options && options[name]) {
                R[name].set(options[name], 'startCall');
            }
        });

        R._autoRestart = (o.autoRestart !== false);
        // A fresh start() means "we want it running again" -- clear any
        // prior stop() intent so the watchdog armed below doesn't think
        // THIS attempt was the deliberate stop.
        R._stopRequested = false;

        R._log('start() called', { autoRestart: R._autoRestart, source: o.source, lang: o.lang, continuous: o.continuous !== false });

        // Delegate to override implementation if set
        if (R._impl) {
            R._log('delegating to override implementation (R._impl)');
            R._impl.start(o);
            return;
        }

        // Check browser support on first call
        if (R._supported === null) {
            R._supported = !!(root.SpeechRecognition || root.webkitSpeechRecognition);
        }
        if (!R._supported) {
            R._log('not supported in this browser -- start() is a no-op', null, 'error');
            return;
        }

        var SR = root.SpeechRecognition || root.webkitSpeechRecognition;

        if (R._rec) {
            try {
                R._rec.abort();
            } catch (e) {
                // Previously a silent catch(e){} -- an exception here was
                // invisible even though it could leave R._rec in a state
                // the new instance below doesn't fully replace.
                R._log('abort() on previous instance threw', e, 'error');
            }
        }
        var rec = R._rec = new SR();
        rec.lang            = o.lang || 'en-US';
        rec.continuous      = o.continuous !== false;
        rec.interimResults  = o.interimResults !== false;
        rec.maxAlternatives = 1;
        rec._started        = false; // set true by onstart below; watched by _armWatchdog
        rec._lastActivity   = Date.now(); // refreshed by every lifecycle event below; watched by _armStallWatchdog

        rec.onstart = function () {
            rec._started = true;
            rec._lastActivity = Date.now();
            R._log('onstart (engine actually began listening)');
            Q.handle(R.onStart, R);
            // Engine confirmed it's listening -- now watch for it going
            // completely silent afterwards (no onresult/onspeechend/onerror/
            // onend at all), which neither this nor the initial watchdog
            // above would otherwise ever notice.
            R._armStallWatchdog(rec);
        };
        rec.onspeechstart = function () {
            rec._lastActivity = Date.now();
            R._log('onspeechstart');
            Q.handle(R.onSpeechStart, R);
        };
        rec.onspeechend = function () {
            rec._lastActivity = Date.now();
            R._log('onspeechend');
            Q.handle(R.onSpeechEnd, R);
        };
        rec.onerror = function (e) {
            // Logged unconditionally -- previously only visible if a
            // caller happened to wire an onError handler. Real, nameable
            // conditions fire here (no-speech, audio-capture, not-allowed,
            // network, aborted, ...), making this one of the most likely
            // places to find out WHY recognition silently stopped reacting.
            rec._lastActivity = Date.now();
            R._log('onerror', { error: e.error, message: e.message }, 'error');
            Q.handle(R.onError, R, [{ error: e.error }]);
        };
        rec.onend = function () {
            if (rec._stallInterval) {
                clearInterval(rec._stallInterval);
                rec._stallInterval = null;
            }
            var isCurrent   = R._rec === rec;
            var willRestart = R._autoRestart && isCurrent;
            R._log('onend', { autoRestart: R._autoRestart, isCurrentInstance: isCurrent, willRestart: willRestart });
            Q.handle(R.onEnd, R);
            if (willRestart) {
                rec._started = false; // re-armed fresh for THIS restart attempt
                try {
                    rec.start();
                    R._log('onend: restart() call succeeded (not yet confirmed listening -- see watchdog)');
                    R._armWatchdog(rec, 'auto-restart after onend');
                } catch (e) {
                    // This was previously a silent catch(e){} with NOTHING
                    // logged anywhere -- almost certainly where a "just
                    // stops reacting, nothing in console" failure is
                    // actually happening (e.g. an InvalidStateError from
                    // restarting before the engine has fully settled).
                    R._log('onend: restart() THREW -- recognition will stay stopped until start() is called again', e, 'error');
                }
            } else if (R._autoRestart && !isCurrent) {
                // Expected/benign: a newer start() call already replaced
                // R._rec before this stale instance's onend fired. Logged
                // anyway so it's distinguishable from "autoRestart is off".
                R._log('onend: stale instance (a newer one is now R._rec) -- not restarting this one');
            }
        };
        rec.onresult = function (e) {
            // Deliberately terse (fires continuously during normal use,
            // logging full results would flood the console) -- but kept as
            // a 'quiet' marker so the console timeline still shows whether
            // results were arriving right up until the problem started.
            rec._lastActivity = Date.now();
            R._log('onresult', { resultIndex: e.resultIndex, resultCount: e.results.length }, 'quiet');
            Q.handle(R.onResult, R, [e]);
            /* for (var i = e.resultIndex; i < e.results.length; i++) {
                var alt = e.results[i][0];
                Q.handle(R.onResult, R, [{
                    transcript: alt.transcript,
                    isFinal:    e.results[i].isFinal,
                    confidence: alt.confidence,
                    speaker:    null
                }]);
            } */
        };

        try {
            if(o.source instanceof MediaStreamTrack) {
                rec.start(o.source);
            } else {
                rec.start();
            }
            R._log('initial start() call succeeded (not yet confirmed listening -- see watchdog)');
            R._armWatchdog(rec, 'initial start()');
        } catch (e) {
            R._log('initial start() call THREW', e, 'error');
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

/**
 * Shared, timestamped, greppable logger for every speech-recognition
 * lifecycle event. Added specifically to surface a "recognition sometimes
 * just stops reacting, with nothing in console" bug: onend's auto-restart
 * previously swallowed its own start() exception with an empty catch(e){},
 * and onerror only logged anything if a caller happened to wire an
 * onError handler -- both were silent failure points by default.
 * @method Q.Speech.Recognition._log
 * @static
 * @param {String} label
 * @param {Object|Error} [detail]
 * @param {String} [level] 'error' (console.error, for real failures) or
 *   'quiet' (console.debug, for high-frequency events like onresult that
 *   would otherwise flood the console) -- default is a plain console.log.
 */
Q.Speech.Recognition._log = function (label, detail, level) {
    var prefix = '[Q.Speech.Recognition ' + new Date().toISOString() + '] ' + label;
    if (level === 'error') {
        console.error(prefix, detail || '');
    } else if (level === 'quiet') {
        (console.debug || console.log).call(console, prefix, detail || '');
    } else {
        console.log(prefix, detail || '');
    }
};

/**
 * Watchdog for the gap neither _log call site above actually covers: a
 * start()/restart() call that does NOT throw, but after which the engine
 * never actually fires onstart either -- no exception, no error event,
 * nothing at all, which is exactly the "recognition just stops reacting,
 * nothing in console" symptom this logging was added for. Call right
 * after a start()/rec.start() call that didn't throw; if rec._started is
 * still false once the window elapses AND rec is still the live instance
 * (R._rec === rec -- a newer start() superseding it isn't this call's
 * problem to report) and R._stopRequested isn't set (stop.js sets this,
 * so a deliberate stop() a user issues before onstart happens to have
 * fired -- e.g. tapping stop within the watchdog window -- isn't
 * misreported as a silent failure), logs an explicit warning naming the
 * silent gap.
 * @method Q.Speech.Recognition._armWatchdog
 * @static
 * @param {SpeechRecognition} rec
 * @param {String} context Human-readable label for which call site armed this
 */
Q.Speech.Recognition._WATCHDOG_MS = 4000;
Q.Speech.Recognition._armWatchdog = function (rec, context) {
    var R = this;
    setTimeout(function () {
        if (R._rec !== rec) return;     // superseded by a newer instance already
        if (R._stopRequested) return;   // user deliberately stopped it meanwhile
        if (!rec._started) {
            R._log(
                'WATCHDOG: no onstart within ' + R._WATCHDOG_MS + 'ms after ' + context +
                ' -- the start() call itself did not throw, but the engine never confirmed it began listening (no onstart, and presumably no onerror either, or it would have logged separately). Recognition is likely silently stuck.',
                null,
                'error'
            );
        }
    }, R._WATCHDOG_MS);
};

/**
 * Watchdog for the gap the one above doesn't cover either: onstart (and
 * often onspeechstart) fires normally -- the engine genuinely confirms it's
 * listening -- but then NOTHING further ever happens: no onresult, no
 * onspeechend, no onerror, no onend. No exception anywhere, nothing in the
 * console by default. This is the exact "mic button says active, user
 * talks, nothing happens" symptom reported live -- in both a fresh-page-load
 * case (no onresult ever, right from the start) and a works-then-silently-
 * dies-mid-session case (results arrive for a while, then stop cold with no
 * further events at all, unlike the ordinary onspeechend -> onend -> restart
 * cycle visible elsewhere in the same session's logs).
 *
 * Armed fresh every time onstart fires (including after an auto-restart --
 * harmless to re-arm, the previous interval for the same rec is cleared
 * first). Polls periodically rather than using a single timeout, since
 * "idle too long" has to be measured from whichever lifecycle event most
 * recently refreshed rec._lastActivity, not from a fixed start time.
 *
 * On detecting a stall: fires onStall (so UI can tell the user it stopped
 * responding) and then tries to recover WITHOUT waiting on the stuck
 * instance to ever fire its own onend -- abort() is tried first (per spec it
 * should still yield onend, which would trigger the normal auto-restart
 * path), but if even that produces nothing within a short grace period, a
 * brand new instance is started directly via R.start(), reusing the exact
 * options (lang/source/autoRestart) from the original call.
 * @method Q.Speech.Recognition._armStallWatchdog
 * @static
 * @param {SpeechRecognition} rec
 */
Q.Speech.Recognition._STALL_MS = 12000;
Q.Speech.Recognition._armStallWatchdog = function (rec) {
    var R = this;
    if (rec._stallInterval) {
        clearInterval(rec._stallInterval);
    }
    rec._stallInterval = setInterval(function () {
        if (R._rec !== rec || R._stopRequested) {
            clearInterval(rec._stallInterval);
            rec._stallInterval = null;
            return;
        }
        var idleFor = Date.now() - rec._lastActivity;
        if (idleFor < R._STALL_MS) return;

        clearInterval(rec._stallInterval);
        rec._stallInterval = null;
        R._log(
            'WATCHDOG: no activity for ' + idleFor + 'ms after the engine confirmed it was listening -- ' +
            'no onresult/onspeechend/onerror/onend fired since. Recognition is likely silently stuck; ' +
            'notifying via onStall and forcing a restart.',
            null,
            'error'
        );
        Q.handle(R.onStall, R);

        try { rec.abort(); } catch (e) {}
        setTimeout(function () {
            // If abort() worked as specced, onend already fired, cleared
            // R._rec (replaced it with a restarted instance) or left
            // R._stopRequested set -- either way there's nothing to do here.
            if (R._rec !== rec || R._stopRequested) return;
            R._log('WATCHDOG: forced abort() produced no onend -- starting a fresh instance directly', null, 'error');
            R.start(R._lastStartOptions);
        }, 1500);
    }, 3000);
};
