Q.exports(function (Q) {
    /**
     * Q plugin's front end code
     *
     * @module Q
     * @class Q.Audio
     */

    /**
     * Can call this to preload data about voices, locales, genders, etc.
     * for common voices, so it can be ready to go when Q.Audio.speak() is called.
     * @method loadVoices
     * @static
     * @param {Function} callback Receives err, data
     */
    return Q.getter(function (callback) {
        Q.request('{{Q}}/js/speech/voices.json', [], function (err, voices) {
            var msg = Q.firstErrorMessage(err, voices);
            if (msg) {
                throw new Q.Error(msg);
            }
            if (typeof voices !== "object") {
                callback.call(this, "Q.Audio.speak: could not get the known voices list", null);
            }
            for (var languageLocale in voices) {
                var lang = languageLocale.split('-')[0];
                if (!voices[lang]) {
                    voices[lang] = voices[languageLocale];
                }
            }
            callback.call(this, err, voices);
        }, {skipNonce: true});
    }, {
        cache: Q.Cache.document('Q.Audio.speak.loadVoices', 1)
    });
});