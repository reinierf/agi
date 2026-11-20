// @ts-check

/**
 * Text-to-speech of message windows (jsyang's addition; Sierra's interpreter had no speech).
 * Off by default. Switch it with the checkbox in the debug panel or AGI.TTS.setEnabled();
 * the choice is kept in localStorage.
 */

const DEFAULT_OPTIONS = {
    name:  'Google UK English Male',
    rate:  1.2,
    pitch: 0,
    index: 0,
};

const ENABLED_KEY = 'tts-enabled';

/** @type {{name?: string, rate?: number, pitch?: number, index?: number}} */
let selected = {};

/** @type {SpeechSynthesisVoice[]} */
const availableVoices = [];

const isNativeTTSSupported = typeof window !== 'undefined' && !!window.speechSynthesis;

let initialised = false;
let enabled     = readEnabled();

function readEnabled() {
    try {
        return localStorage.getItem(ENABLED_KEY) === '1';
    } catch {
        return false;
    }
}

/** Sets up the voice. Only done once TTS is switched on. */
function init() {
    if (!enabled || initialised || !isNativeTTSSupported) return;
    initialised = true;

    try {
        selected = JSON.parse(localStorage.getItem('tts') || '{}') || {};
    } catch {
        selected = {};
    }

    selected.name  = selected.name || DEFAULT_OPTIONS.name;
    selected.rate  = selected.rate || DEFAULT_OPTIONS.rate;
    selected.pitch = selected.pitch || DEFAULT_OPTIONS.pitch;

    const loadVoices = () => {
        availableVoices.length = 0;
        speechSynthesis.getVoices().forEach(v => availableVoices.push(v));
        selectVoiceByName(selected.name);
    };
    speechSynthesis.onvoiceschanged = loadVoices;
    loadVoices(); // some browsers have the voices already and never fire onvoiceschanged
}

/** @param {string|undefined} n  part of a voice name (case-insensitive regular expression) */
function selectVoiceByName(n) {
    if (!isNativeTTSSupported || !n) return;

    const reNameTest      = new RegExp(n, 'i');
    const foundVoiceIndex = availableVoices.findIndex(v => reNameTest.test(v.name));
    const foundVoice      = availableVoices[foundVoiceIndex];

    if (!foundVoice) return;

    selected.name  = foundVoice.name;
    selected.index = foundVoiceIndex;

    localStorage.setItem('tts', JSON.stringify(selected));
}

const stop = () => {
    if (isNativeTTSSupported) speechSynthesis.cancel();
};

/** @param {string} t */
function say(t) {
    if (!enabled || !isNativeTTSSupported) return;

    const utterance  = new SpeechSynthesisUtterance(t);
    utterance.voice  = availableVoices[selected.index ?? 0] ?? null;
    utterance.rate   = selected.rate ?? DEFAULT_OPTIONS.rate;
    utterance.pitch  = selected.pitch ?? DEFAULT_OPTIONS.pitch;
    utterance.volume = 1;

    stop();
    speechSynthesis.speak(utterance);
}

const isEnabled = () => enabled;

/** Switches TTS on or off and remembers the choice. Switching off stops any speech. */
function setEnabled(/** @type {boolean} */ on) {
    enabled = on;
    try {
        localStorage.setItem(ENABLED_KEY, on ? '1' : '0');
    } catch { /* not remembered */ }

    if (on) {
        if (!isNativeTTSSupported) alert('Native text-to-speech functionality not available!');
        init();
    } else {
        stop();
    }
}

const getVoices = () => availableVoices.map(v => v.name);

export default {
    init,
    getVoices,
    selectVoiceByName,
    say,
    stop,
    isEnabled,
    setEnabled,
    isSupported: () => isNativeTTSSupported,
}
