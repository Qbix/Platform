Q.exports(function (Q) {
	/**
	 * Q plugin's front end code
	 *
	 * @module Q
	 * @class Q.Socket
	 */

	/**
	 * Starts listening for Q/audio socket events.
	 * Plays audio or speaks text via Q.Audio on the client.
	 *
	 * Payload shapes:
	 *
	 *   Play a URL:
	 *   { url, volume?, loop?, fadeIn?, fadeOut? }
	 *
	 *   Speak text via SpeechSynthesis:
	 *   { speak, voice?, rate?, pitch?, volume?, lang? }
	 *
	 *   Stop all audio:
	 *   { stop: true }
	 *
	 * Notes on speech:
	 *   SpeechSynthesis requires a prior user gesture to unlock on iOS Safari.
	 *   The conventional fix is to call window.speechSynthesis.speak(new SpeechSynthesisUtterance(''))
	 *   on any click/tap before attempting real speech. Q.Audio.speak already
	 *   handles this via Q.Audio.loadVoices which primes the synthesis engine.
	 *   Pages that call listenForAudio() should also call Q.Audio.loadVoices()
	 *   inside a user gesture handler (e.g. the same tap that starts the session).
	 *
	 * @static
	 * @method listenForAudio
	 * @param {String} [key] Handler key for Q.Event.set
	 */
	return function _Q_Socket_listenForAudio(key) {
		Q.Socket.onEvent('Q/audio').set(function (payload) {
			if (!payload) return;

			// Stop all current audio
			if (payload.stop) {
				Q.each(Q.Audio.collection, function (url, qa) {
					try { qa.audio.pause(); qa.audio.currentTime = 0; } catch (e) {}
				});
				if (window.speechSynthesis) {
					window.speechSynthesis.cancel();
				}
				return;
			}

			// Speak text via SpeechSynthesis, routed through Q.Audio.speak
			if (payload.speak != null) {
				Q.Audio.speak(payload.speak, {
					voice:  payload.voice  || null,
					rate:   payload.rate   != null ? payload.rate   : 1,
					pitch:  payload.pitch  != null ? payload.pitch  : 1,
					volume: payload.volume != null ? payload.volume : 1,
					lang:   payload.lang   || 'en-US'
				});
				return;
			}

			// Play a URL via Q.Audio.play
			if (payload.url) {
				Q.Audio.play(Q.url(payload.url), {
					volume:  payload.volume  != null ? payload.volume  : 1,
					loop:    payload.loop    || false,
					fadeIn:  payload.fadeIn  || 0,
					fadeOut: payload.fadeOut || 0
				});
			}
		}, key || 'Q');
	};
});
