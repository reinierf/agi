import {CommandMask, COMPLETE_ATTENUATION, NOISE_VOICE} from './soundEmulator';
import {ByteBuffer} from './bytebuffer';

const VOICE_END         = 0xFFFF;
const TICK_MILLISECONDS = 16;

export default class Sound {
    soundEmulator;
    onFinished;
    voicesData     = [];
    nextNoteHandle = [];
    playing        = false;

    constructor(stream) {
        let prevOffset = stream.startPosition + stream.readUint16();
        for (let i = 0; i < 3; i++) {
            const offset = stream.startPosition + stream.readUint16();
            this.voicesData.push(new ByteBuffer(stream.buffer, prevOffset, offset));
            prevOffset = offset;
        }
        this.voicesData.push(new ByteBuffer(stream.buffer, prevOffset, stream.startPosition + stream.length));
    }

    /**
     * @param soundEmulator
     * @param {() => void} onFinished called once if the sound plays to its end, or ends at
     *   once because sound is off; not when it is stopped.
     */
    play(soundEmulator, onFinished) {
        this.onFinished    = onFinished;
        this.soundEmulator = soundEmulator;
        this.playing       = true;

        // With sound off, NAGI's generator ends the sound straight away
        // (sound/sound_gen.c: sndgen_callback returns -1 when flag 9 is clear).
        if (soundEmulator.muted) {
            this.stop(true);
            return;
        }

        for (let i = 0; i < 4; i++) {
            this.voicesData[i].position = 0;
            this.processNote(i);
        }
        this.soundEmulator.activate();
    }

    /**
     * Stops the sound. Does nothing if it isn't playing.
     * @param {boolean} [natural] true when the sound played to its end: calls onFinished
     */
    stop(natural = false) {
        if (!this.playing) return;
        this.playing = false;

        this.soundEmulator.deactivate();
        for (let i = 0; i < 4; i++) {
            this.silenceVoice(i);
        }
        if (natural && this.onFinished) this.onFinished();
    }

    processNote(voiceIndex) {
        // Sound was switched off while playing: the sound ends, as in NAGI.
        if (this.soundEmulator.muted) {
            this.stop(true);
            return;
        }

        const voiceData = this.voicesData[voiceIndex];
        const duration  = voiceData.readUint16();
        if (duration === VOICE_END) {
            this.silenceVoice(voiceIndex);

            let allVoicesFinished = true;
            for (let i = 0; i < 4; i++) {
                const voiceFinished = this.voicesData[i].position === this.voicesData[i].length;
                allVoicesFinished   = allVoicesFinished && voiceFinished;
            }
            allVoicesFinished && this.stop(true);
        } else {
            const getLogger = position => message => console.debug(`${message} in ${voiceIndex === NOISE_VOICE ? 'noise' : `tone`} voice ${voiceIndex} at ${position}`);
            if (voiceIndex === NOISE_VOICE) {
                (voiceData.readUint8() !== 0) && getLogger(voiceData.position - 1)(`Non-empty padding byte`);
                this.soundEmulator.updateNoiseSource(voiceData.readUint8(), getLogger(voiceData.position - 1));
            } else {
                this.soundEmulator.updateToneSource(voiceData.readUint16(), getLogger(voiceData.position - 2));
            }
            this.soundEmulator.updateAttenuator(voiceData.readUint8(), getLogger(voiceData.position - 1));
            this.nextNoteHandle[voiceIndex] = setTimeout(() => {
                this.processNote(voiceIndex);
            }, duration * TICK_MILLISECONDS);
        }
    }

    silenceVoice(voiceIndex) {
        const register = (voiceIndex << 1) | 0x01;
        this.soundEmulator.updateAttenuator(CommandMask.CommandBit | (register << 4) | COMPLETE_ATTENUATION);
        this.nextNoteHandle[voiceIndex] && clearTimeout(this.nextNoteHandle[voiceIndex]);
    }
}
