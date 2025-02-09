Q.exports(function (Q) {
    /**
     * Q plugin's front end code
     *
     * @module Q
     * @class Q.Audio
     */

    /**
     * @method play
     * Plays the audio as soon as it is available
     * @param {number} [from] The time, in seconds, from which to start.
     * @param {number} [until] The time, in seconds, until which to play.
     * @param {boolean} [removeAfterPlaying=false]
     */
    return function (from, until, removeAfterPlaying) {
        var t = this;
        var a = t.audio;
        from = from || 0;
        if (from > until) {
            throw new Q.Error("Audio.prototype.play: from can't be greater than until");
        }
        if (!a.readyState) {
            return false;
        }
        if (removeAfterPlaying) {
            t.onEnded.set(function () {
                delete Q.Audio.collection[t.src];
                container.removeChild(t.audio);
                t.onEnded.remove('Q.Audio');
            }, 'Q.Audio');
        }
        t.playing = true;
        t.paused = false;
        if (a.currentTime != from) {
            a.currentTime = from;
        }
        if (until) {
            setTimeout(function Q_Audio_play_pause() {
                a.pause();
            }, (until-from)*1000);
        }
        a.play();
        Q.handle(Q.Audio.onPlay, this);
        return t;
    };
});