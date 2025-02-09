Q.exports(function (Q) {
    /**
     * Q plugin's front end code
     *
     * @module Q
     * @class Q.Audio
     */

    /**
     * Loads an audio file and calls the callback when it's ready to play
     * @static
     * @method audio
     * @param {String} url 
     * @param {Function} handler A function to run after the audio is ready to play
     * @param {Object} [options={}] Can be one of the following options
     * @param {boolean} [options.canPlayThrough=true] Whether to wait until the audio can play all the way through before calling the handler.
     */
    return Q.getter(function _Q_audio_load(url, handler, options) {
        url = Q.url(url);
        var audio = Q.Audio.collection[url] || new Q.Audio(url);
        if (options && options.canPlayThrough === false) {
            audio.onCanPlay.add(handler);
        } else {
            audio.onCanPlayThrough.add(handler);
        }
    }, {
        cache: Q.Cache.document('Q.audio', 100)
    });
});