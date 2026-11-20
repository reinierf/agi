// @ts-check
// Portions ported from NAGI (c) 2001-2002 Nick Sonneveld, X11 license, see licenses/NAGI-LICENSE.txt
//
// A loaded sound resource. NAGI sound/sound_base.c: sound_load() reads the four channel
// offsets; the notes are played by the sound generator (soundEmulator.js, soundWorklet.js).

/** @typedef {import('./soundEmulator.js').default} SoundEmulator */

const END_OF_DATA = 0xFFFF;
const NOTE_SIZE   = 5;

export default class Sound {
    /** The whole resource. @type {Uint8Array} */
    data;
    /** Where each channel's notes start in `data`. @type {number[]} */
    offsets = [];
    /** How long the sound lasts, in 1/60 s ticks: its longest channel. */
    ticks = 0;
    /** @type {SoundEmulator | null} */
    soundEmulator = null;
    playing = false;

    /** @param {import('./bytebuffer.js').ByteBuffer} stream */
    constructor(stream) {
        this.data = stream.buffer.slice(stream.startPosition, stream.startPosition + stream.length);

        // NAGI sound_base.c: sound_load()
        for (let c = 0; c < 4; c++) {
            this.offsets.push(stream.readUint16());
        }

        for (const offset of this.offsets) {
            let ticks = 0;
            for (let p = offset; p + 1 < this.data.length; p += NOTE_SIZE) {
                const duration = this.data[p] | (this.data[p + 1] << 8);
                if (duration === END_OF_DATA) break;
                ticks += duration;
            }
            this.ticks = Math.max(this.ticks, ticks);
        }
    }

    /**
     * @param {SoundEmulator} soundEmulator
     * @param {() => void} onFinished called once if the sound plays to its end, or ends at
     *   once because sound is off; not when it is stopped.
     */
    play(soundEmulator, onFinished) {
        this.soundEmulator = soundEmulator;
        this.playing       = true;

        const finished = () => {
            this.playing = false;
            onFinished();
        };

        // With sound off, NAGI's generator ends the sound straight away
        // (sound/sound_gen.c: sndgen_callback returns -1 when flag 9 is clear).
        if (soundEmulator.muted) {
            finished();
            return;
        }

        soundEmulator.play(this.data, this.offsets, this.ticks, finished);
        soundEmulator.activate();
    }

    /** Stops the sound. Does nothing if it isn't playing. */
    stop() {
        if (!this.playing) return;
        this.playing = false;
        this.soundEmulator?.stop();
    }
}
