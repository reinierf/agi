// Portions ported from NAGI (c) 2001-2002 Nick Sonneveld, X11 license, see licenses/NAGI-LICENSE.txt
//
// The PCjr/Tandy sound generator, run in the audio thread (an AudioWorkletProcessor).
// Ported from NAGI:
//   sound/sound_gen.c   reading the notes, the dissolve (fade) and the volume
//   sound/tone_pcm.c    the square-wave and noise generators, 2 dB volume steps
//   sound/pcm_out_sdl.c the mixer: each channel divided by the number of channels
// NAGI writes 44100 samples a second; here the AudioContext's own rate is used, with the
// same arithmetic, so pitch and timing are the same at any rate.
//
// This file is loaded with audioWorklet.addModule() and must not import anything.
//
// Messages from the page (soundEmulator.js):
//   {type: 'play', id, data: Uint8Array, offsets: number[4]}  starts a sound
//   {type: 'stop'}                                           stops it (no 'done')
//   {type: 'muted', muted}                                   flag 9 was cleared or set
// Messages to the page:
//   {type: 'done', id}  the sound ended by itself (its data ran out, or sound was switched
//                       off while it played)

const CHAN_MAX = 4;
const NOISE_CHAN = 3;

const GEN_TONE    = 0;
const GEN_PERIOD  = 1;
const GEN_WHITE   = 2;
const GEN_SILENCE = 3;

// tone_pcm.c
const FB_WNOISE = 0x12000; // bit15.d(16bits) = bit0(out) ^ bit2
const FB_PNOISE = 0x08000;
const NG_PRESET = 0x0f35;
const FREQ_DIV  = 111844;
const MULT      = FREQ_DIV;

// sound_gen.c: dissolve_data_v3, NAGI's default (c_snd_dissolve = 3). Only tone channels
// dissolve. NAGI's v2.9xx table is shorter, but NAGI uses this one unless configured
// otherwise.
const DISSOLVE_DATA = [
    -2, -3, -2, -1,
    0, 0, 0, 0, 0,
    1, 1, 1, 1, 1, 1,
    2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
    3, 3, 3, 3, 3, 3, 3, 3,
    4, 4, 4, 4, 4,
    5, 5, 5, 5, 5,
    6, 6, 6, 6, 6,
    7, 7, 7, 7,
    8, 8, 8, 8,
    9, 9, 9, 9,
    0xA, 0x0A, 0x0A, 0xA,
    0x0B, 0x0B, 0x0B, 0x0B, 0x0B, 0x0B,
    0x0C, 0x0C, 0x0C, 0x0C, 0x0C, 0x0C,
    0x0D,
    -100,
];
const NO_DISSOLVE = 0xFFFF;
const END_OF_DATA = 0xFFFF;

// NAGI's default volume (c_snd_volume = 0x7FFF) and c_snd_read_var = 0: v23 isn't used,
// because most games set it wrongly (see NAGI's nagi.ini).
const SND_VOLUME = 0x7FFF;

/** tone_pcm.c: vol_table_init(). Each step is 2 dB quieter; 0x0F is silence. */
function volTableInit() {
    const table = new Int16Array(16);
    let value = SND_VOLUME;
    for (let i = 0; i < 0xF; i++) {
        table[i] = value; // truncated to s16, as the C cast
        value /= 1.258925411794;
    }
    table[0x0F] = 0;
    return table;
}

/** A channel of the sound data: sound_gen.c's SNDGEN_CHAN. */
class SndgenChan {
    constructor() {
        this.data            = null; // Uint8Array of the whole sound
        this.pos             = 0;    // read position in data
        this.duration        = 0;
        this.avail           = 0;
        this.dissolveCount   = NO_DISSOLVE;
        this.attenuation     = 0x0F;
        this.attenuationCopy = 0x0F;
        this.genType         = GEN_TONE;
        this.freqCount       = 0;
    }
}

/** A tone generator: tone_pcm.c's TONECHAN. */
class ToneChan {
    constructor(agiCh) {
        // tone_pcm_open()
        this.agiCh         = agiCh;
        this.avail         = 1;
        this.noteCount     = 0;
        this.freqCount     = 250;
        this.freqCountPrev = -1;
        this.atten         = 0xF; // silence
        this.genType       = GEN_TONE;
        this.genTypePrev   = -1;
        this.count         = 0;
        this.scale         = 0;
        this.sign          = 0;
        this.noiseState    = 0;
        this.feedback      = 0;
    }
}

class AgiSoundProcessor extends AudioWorkletProcessor {
    /** @param {{processorOptions?: {play?: any}}} options a sound to start with (for tests) */
    constructor(options) {
        super();
        this.volTable  = volTableInit();
        this.channel   = Array.from({length: CHAN_MAX}, () => new SndgenChan());
        this.tones     = [];   // open tone channels; empty when no sound plays
        this.playing   = false; // NAGI sound_state
        this.soundOn   = true;  // flag 9
        this.id        = 0;
        this.chanData  = new Int16Array(128);
        this.mix       = new Int32Array(128);
        this.newTone   = {freqCount: 0, atten: 0xF, type: GEN_TONE};
        this.port.onmessage = e => this.message(e.data);
        if (options?.processorOptions?.play) this.message(options.processorOptions.play);
    }

    message(msg) {
        switch (msg.type) {
            case 'play':  this.sndgenPlay(msg); break;
            case 'stop':  this.sndgenKill(); break;
            case 'muted': this.soundOn = !msg.muted; break;
        }
    }

    // sound_gen.c: sndgen_play()
    sndgenPlay(msg) {
        this.sndgenKill();
        this.id = msg.id;
        for (let i = 0; i < CHAN_MAX; i++) {
            const chan         = this.channel[i];
            chan.data          = msg.data;
            chan.pos           = msg.offsets[i];
            chan.duration      = 0;
            chan.dissolveCount = NO_DISSOLVE;
            chan.avail         = 0xFFFF;
            chan.freqCount     = 0;
            this.tones.push(new ToneChan(i));
        }
        this.playing = true;
    }

    // sound_gen.c: sndgen_kill_thread(), without setting the flag: the page does that.
    sndgenKill() {
        this.playing = false;
        this.tones   = [];
    }

    // sound_gen.c: volume_calc()
    volumeCalc(chan) {
        let al = chan.attenuation;
        if (al !== 0x0F) { // != silence
            if (chan.dissolveCount !== NO_DISSOLVE) {
                const dissolveValue = DISSOLVE_DATA[chan.dissolveCount];
                if (dissolveValue === -100) { // end of list
                    chan.dissolveCount = NO_DISSOLVE;
                    chan.attenuation   = chan.attenuationCopy;
                    al = chan.attenuation;
                } else {
                    chan.dissolveCount++;
                    al += dissolveValue;
                    if (al < 0) al = 0;
                    if (al > 0x0F) al = 0x0F;
                    chan.attenuationCopy = al;
                    al &= 0x0F;
                    // (c_snd_read_var is off: v23 isn't added)
                }
            }
            // NAGI: "if (computer_type == 2) && (al < 8)", applied always
            if (al < 8) al += 2;
        }
        return al;
    }

    /**
     * sound_gen.c: sndgen_callback(). Reads channel `ch`'s next note into `tone`.
     * @returns {number} 0 while there is data, -1 at its end
     */
    sndgenCallback(ch, tone) {
        if (!this.soundOn) return -1;

        const chan = this.channel[ch];
        if (!chan.avail) return -1;

        const data = chan.data;
        while (chan.duration === 0) {
            const p = chan.pos;
            // read the duration of the note (past the data's end counts as its end)
            chan.duration = p + 1 < data.length ? data[p] | (data[p + 1] << 8) : END_OF_DATA;

            // 0: not played; 0xFFFF: the channel's data has finished
            if (chan.duration !== 0 && chan.duration !== END_OF_DATA) {
                // only tone channels dissolve
                if (ch !== NOISE_CHAN) chan.dissolveCount = 0;

                chan.attenuation = data[p + 4] & 0xF;

                if (ch < CHAN_MAX - 1) {
                    chan.freqCount = ((data[p + 2] & 0x3F) << 4) | (data[p + 3] & 0x0F);
                    chan.genType   = GEN_TONE;
                } else {
                    // white noise (1) or periodic (0)
                    chan.genType = (data[p + 3] & 0x04) ? GEN_WHITE : GEN_PERIOD;
                    switch (data[p + 3] & 0x03) {
                        case 0: chan.freqCount = 32; break;
                        case 1: chan.freqCount = 64; break;
                        case 2: chan.freqCount = 128; break;
                        case 3: chan.freqCount = this.channel[2].freqCount * 2; break;
                    }
                }
            }
            chan.pos += 5;
        }

        if (chan.duration !== END_OF_DATA) {
            tone.freqCount = chan.freqCount;
            tone.atten     = this.volumeCalc(chan);
            tone.type      = chan.genType;
            chan.duration--;
            return 0;
        }

        // kill channel
        chan.avail           = 0;
        chan.attenuation     = 0x0F;
        chan.attenuationCopy = 0x0F;
        return -1;
    }

    /**
     * tone_pcm.c: tone_pcm_callback(). Fills `buf` with channel `t`'s samples.
     * @returns {number} 0 if the channel is still going, -1 when it is complete
     */
    tonePcmCallback(t, buf) {
        let len    = buf.length;
        let cur    = 0;
        let retVal = 0;

        while (len > 0) {
            if (t.noteCount <= 0) {
                // get new tone data
                const newTone     = this.newTone;
                newTone.freqCount = 0;
                newTone.atten     = 0xF;
                newTone.type      = GEN_TONE;
                if (t.avail && this.sndgenCallback(t.agiCh, newTone) === 0) {
                    t.atten     = newTone.atten;
                    t.freqCount = newTone.freqCount;
                    t.genType   = newTone.type;
                    // the tone changes 60 times a second
                    t.noteCount = Math.floor(sampleRate / 60);
                } else {
                    t.genType   = GEN_SILENCE;
                    t.noteCount = len;
                    t.avail     = 0;
                    retVal      = -1;
                }
            }

            // write nothing
            if (t.freqCount === 0 || t.atten === 0xF) t.genType = GEN_SILENCE;

            let fillSize = t.noteCount <= len ? t.noteCount : len;
            switch (t.genType) {
                case GEN_TONE:
                    fillSize = this.squareFill(t, buf, cur, fillSize);
                    break;
                case GEN_PERIOD:
                case GEN_WHITE:
                    fillSize = this.noiseFill(t, buf, cur, fillSize);
                    break;
                default:
                    buf.fill(0, cur, cur + fillSize);
                    break;
            }

            t.noteCount -= fillSize;
            cur         += fillSize;
            len         -= fillSize;
        }
        return retVal;
    }

    // tone_pcm.c: square_fill()
    squareFill(t, buf, start, len) {
        if (t.genType !== t.genTypePrev) {
            t.freqCountPrev = -1; // make sure the freq_count is checked
            t.sign          = 1;
            t.genTypePrev   = t.genType;
        }
        if (t.freqCount !== t.freqCountPrev) {
            t.scale         = Math.floor(sampleRate / 2) * t.freqCount;
            t.count         = t.scale;
            t.freqCountPrev = t.freqCount;
        }

        const vol = this.volTable[t.atten];
        for (let i = start, end = start + len; i < end; i++) {
            buf[i] = t.sign ? vol : -vol;
            t.count -= MULT;
            while (t.count <= 0) {
                t.sign ^= 1;
                t.count += t.scale;
            }
        }
        return len;
    }

    // tone_pcm.c: noise_fill()
    noiseFill(t, buf, start, len) {
        if (t.genType !== t.genTypePrev) {
            t.freqCountPrev = -1;
            t.genTypePrev   = t.genType;
        }
        if (t.freqCount !== t.freqCountPrev) {
            t.scale         = Math.floor(sampleRate / 2) * t.freqCount;
            t.count         = t.scale;
            t.freqCountPrev = t.freqCount;
            t.feedback      = t.genType === GEN_WHITE ? FB_WNOISE : FB_PNOISE;
            // reset noise shifter
            t.noiseState    = NG_PRESET;
            t.sign          = t.noiseState & 1;
        }

        const vol = this.volTable[t.atten];
        for (let i = start, end = start + len; i < end; i++) {
            buf[i] = t.sign ? vol : -vol;
            t.count -= MULT;
            while (t.count <= 0) {
                if (t.noiseState & 1) t.noiseState ^= t.feedback;
                t.noiseState >>>= 1;
                t.sign  = t.noiseState & 1;
                t.count += t.scale;
            }
        }
        return len;
    }

    // pcm_out_sdl.c: the SDL audio callback, mixing the open channels.
    process(inputs, outputs) {
        const out = outputs[0][0];
        if (!this.playing || !out) return true;

        const len = out.length;
        if (this.chanData.length !== len) {
            this.chanData = new Int16Array(len);
            this.mix      = new Int32Array(len);
        }
        const mix = this.mix;
        mix.fill(0);

        const numChan = this.tones.length;
        let output = false;
        for (const t of this.tones) {
            if (!t.avail) continue;
            if (this.tonePcmCallback(t, this.chanData) === 0) {
                // divide by number of channels then add to stream
                for (let i = 0; i < len; i++) mix[i] += Math.trunc(this.chanData[i] / numChan);
                output = true;
            } else {
                t.avail = 0;
            }
        }

        for (let i = 0; i < len; i++) out[i] = mix[i] / 32768;
        // Other output channels (stereo) get the same samples.
        for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);

        if (!output) {
            this.sndgenKill();
            this.port.postMessage({type: 'done', id: this.id});
        }
        return true;
    }
}

registerProcessor('agi-sound', AgiSoundProcessor);
