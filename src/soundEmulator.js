// @ts-check
// The page side of the sound generator. The sound itself is made in the audio thread by
// soundWorklet.js (a port of NAGI's sound/sound_gen.c and sound/tone_pcm.c); this class
// loads it, starts and stops sounds and passes on whether sound is on (flag 9).
//
// When the audio can't run (the browser keeps the AudioContext suspended until the first
// click or key press, or has no AudioWorklet), a watchdog ends the sound after its length,
// so a game waiting for its flag carries on as it would with sound.

import workletUrl from './soundWorklet.js?url';

// Seconds over which output is faded in or out by silence(), to avoid a click.
const FADE = 0.01;
// One tick of sound data: notes change 60 times a second (NAGI tone_pcm.c).
const TICK_MS = 1000 / 60;
// The watchdog fires this long after a sound should have ended (the audio starts a little
// late), and then every WATCHDOG_RETRY_MS while the worklet is still playing it.
const WATCHDOG_MARGIN_MS = 250;
const WATCHDOG_RETRY_MS  = 100;

export default class SoundEmulator {
    /** @type {AudioContext} */
    audioContext;
    /** @type {AudioWorkletNode | null} */
    node = null;
    /** Messages sent before the worklet had loaded. @type {any[] | null} */
    pending = [];
    /** @type {GainNode} */
    output;
    /** The sound playing: its id and what to call when it ends by itself. */
    current = /** @type {{id: number, onFinished: () => void, timer: any} | null} */ (null);
    nextId = 0;
    /** True while the game is paused (deactivate()): the audio is suspended on purpose. */
    paused = false;
    _muted = false;

    /** @param {AudioContext} audioContext */
    constructor(audioContext) {
        this.audioContext = audioContext;
        this.output       = audioContext.createGain();
        this.output.connect(audioContext.destination);

        if (!audioContext.audioWorklet) {
            console.warn('No AudioWorklet in this browser: sound is off.');
            this.pending = null;
            return;
        }
        audioContext.audioWorklet.addModule(workletUrl).then(() => {
            const node = new AudioWorkletNode(audioContext, 'agi-sound', {
                numberOfInputs:     0,
                numberOfOutputs:    1,
                outputChannelCount: [1],
            });
            node.port.onmessage = e => this.message(e.data);
            node.connect(this.output);
            this.node = node;
            for (const msg of this.pending || []) node.port.postMessage(msg);
            this.pending = null;
        }, e => {
            console.warn('Could not load the sound generator: sound is off.', e);
            this.pending = null;
        });
    }

    /** @param {any} msg */
    post(msg) {
        if (this.node) this.node.port.postMessage(msg);
        else if (this.pending) this.pending.push(msg);
    }

    /** @param {{type: string, id: number}} msg */
    message(msg) {
        if (msg.type === 'done' && this.current && this.current.id === msg.id) this.finish();
    }

    /** The current sound ended by itself. */
    finish() {
        const {onFinished, timer} = /** @type {NonNullable<typeof this.current>} */ (this.current);
        clearTimeout(timer);
        this.current = null;
        onFinished();
    }

    /**
     * Whether the worklet will play (and end) the sound: it is loaded or still loading,
     * and the audio runs or is only suspended because the game is paused.
     */
    audible() {
        return (this.node !== null || this.pending !== null)
            && (this.paused || this.audioContext.state === 'running');
    }

    /**
     * The watchdog: called when the sound should have ended. If the audio can't play it,
     * the sound ends now; otherwise the worklet's 'done' is waited for.
     */
    watchdog() {
        if (!this.current) return;
        if (this.audible()) {
            this.current.timer = setTimeout(() => this.watchdog(), WATCHDOG_RETRY_MS);
        } else {
            this.post({type: 'stop'});
            this.finish();
        }
    }

    /**
     * Starts a sound, stopping any other.
     * @param {Uint8Array} data the sound resource
     * @param {number[]} offsets where each of the 4 channels' data starts in `data`
     * @param {number} ticks the sound's length, for the watchdog
     * @param {() => void} onFinished called once when it ends by itself; not when stopped
     */
    play(data, offsets, ticks, onFinished) {
        this.stop();
        const id = ++this.nextId;
        this.current = {
            id, onFinished,
            timer: setTimeout(() => this.watchdog(), ticks * TICK_MS + WATCHDOG_MARGIN_MS),
        };
        this.post({type: 'muted', muted: this._muted});
        this.post({type: 'play', id, data, offsets});
    }

    /** Stops the sound that is playing, if any, without calling its onFinished. */
    stop() {
        if (!this.current) return;
        clearTimeout(this.current.timer);
        this.current = null;
        this.post({type: 'stop'});
    }

    /** Whether sound is off (flag 9 clear). A sound playing ends at its next note. */
    get muted() {
        return this._muted;
    }

    set muted(muted) {
        if (muted === this._muted) return;
        this._muted = muted;
        this.post({type: 'muted', muted});
        // If the audio isn't running, the sound ends now, as NAGI's would at its next note.
        if (muted && this.current && !this.audible()) {
            this.post({type: 'stop'});
            this.finish();
        }
    }

    /** Resumes the audio (the game runs again, or the player clicked or pressed a key). */
    activate() {
        this.paused = false;
        this.audioContext.resume();
    }

    /** Suspends the audio while the game is paused; a playing sound waits. */
    deactivate() {
        this.paused = true;
        this.audioContext.suspend();
    }

    /** Turns all output off (true) or back on, e.g. while a replay runs at full speed.
     * @param {boolean} on */
    silence(on) {
        const now = this.audioContext.currentTime;
        this.output.gain.cancelScheduledValues(now);
        this.output.gain.setTargetAtTime(on ? 0 : 1, now, FADE);
    }
}
