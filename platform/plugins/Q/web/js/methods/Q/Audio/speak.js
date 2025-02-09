Q.exports(function (Q, root) {
    /**
     * Q plugin's front end code
     *
     * @module Q
     * @class Q.Audio
     */

    /**
     * Speak text in various browsers.
     * @method speak
     * @static
     * @param {String|Array} text Pass the string of text to speak, or an array of
     *  [textSource, pathArray] to the string loaded with Q.Text.get() 
     * @param {Object} [options] An optional hash of options for Q.Audio.speak:
     * @param {String} [options.gender="female"] the voice in which will be speech the text.
     * @param {Number} [options.rate=1] the speaking rate of the SpeechSynthesizer object, from 0.1 to 1.
     * @param {Number} [options.pitch=1] the speaking pitch of the SpeechSynthesizer object, from 0.1 to 1.9.
     * @param {Number} [options.volume=1] the volume height of speech (0.1 - 1).
     * @param {Number} [options.locale="en-US"] a 5 character code that specifies the language that should be used to synthesize the text.
     * @param {Q.Event|function} [options.onStart] This gets called when the speaking has begun
     * @param {Q.Event|function} [options.onEnd] This gets called when the speaking has finished
     * @param {Q.Event|function} [options.onSpeak] This gets called when the system called speak(), whether or not it worked
     */
    Q.Audio.speak = function (text, options) {
        var TTS = root.TTS; // cordova
        var SS = root.speechSynthesis; //browsers
        var o = Q.extend({}, Q.Audio.speak.options, 10, options);

        if (o.mute) {
            return;
        }

        o.locale = o.locale ||  Q.Text.languageLocale;
        if (Q.isArrayLike(text)) {
            var source = text[0];
            var pathArray = text[1];
            Q.Text.get(source, function (err, content) {
                var text = Q.getObject(pathArray, content);
                if (text) {
                    _proceed(text);
                }
            });
        } else {
            _proceed(text);
        }
        function _chooseVoice(text, voicesList, knownVoices) {
            var language = o.locale.split('-')[0].toLowerCase();
            var gender = o.gender;
            var voice = null;
            var toggled = false;
            function _switchGender(gender) {
                return (gender == "female") ? "male" : "female"
            }
            function _search() {
                var result = null;
                var av = Q.getObject([gender, o.locale], knownVoices)
                    || Q.getObject([gender, language], knownVoices);
                if (!av) {
                    var prefix = language + '-';
                    Q.each(knownVoices[gender], function (key) {
                        if (key.toLowerCase().startsWith(prefix)) {
                            av = this;
                            return false;
                        }
                    });
                }
                av = av || [];
                if (typeof av !== "object" || !av.length){
                    return {error: "Q.Audio.speak: no such known voice"};
                }
                for (var i = 0; i < av.length; i++){
                    for (var j = 0; j < voicesList.length; j++){
                        if (av[i] == voicesList[j].name){
                            result = j;
                            break;
                        }
                    }
                    if (typeof result === "number") {
                        break;
                    }
                }
                if (result === null && toggled){
                    return {error: "Q.Audio.speak: no voice support in this device for this language"};
                } else if (result === null) {
                    var previousGender = gender;
                    gender = _switchGender(gender);
                    toggled = true;
                    console.info("%cQ.Audio.speak: no '%s' voice found for this device, switches to '%s'", 'color: Green', previousGender.toUpperCase(), gender.toUpperCase());
                    return _search();
                } else {
                    return result;
                }
            }
            if (gender != "male" && gender != "female") {
                gender = o.gender = "female";
            }
            voice = _search();
            if (typeof voice !== 'number'){
                var voiceError = Q.getObject("error", voice);
                console.warn(voiceError);
                return false;
            }
            return voice;
        }
        function _proceed(text) {
            if (typeof text !== "string") {
                throw new Q.Error("Q.Audio.speak: the text for speech must be a string");
            }
            text = text.interpolate(Q.text);

            if (root.TTS) {
                TTS.speak({
                    text: text,
                    locale: o.locale,
                    rate: o.rate
                }).then(function () {
                    // Text succesfully spoken
                }, function (reason) {
                    console.warn("Q.Audio.speak: " + reason);
                });
            } else if (SS) {
                if (SS.speaking) {
                    SS.cancel();
                }
                Q.Audio.loadVoices(function (err, voices) {
                    var u = new SpeechSynthesisUtterance(text.replace(/<[^>]+>/g, ''));
                    var voicesList = SS.getVoices();
                    var chosenVoice = _chooseVoice(u.text, voicesList, voices);
                    if (chosenVoice === false) {
                        return;
                    }
                    u.voice = voicesList[chosenVoice];
                    u.rate = o.rate;
                    u.pitch = o.pitch;
                    u.volume = o.volume;
                    u.onstart = function () {
                        Q.handle(o.onStart, [u]);
                    };
                    u.onend = function () {
                        Q.handle(o.onEnd, [u]);
                    };
                    SS.speak(u);
                    Q.handle(o.onSpeak);
                });
            }
        }
    };
});