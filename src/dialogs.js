// @ts-check

/**
 * Messages and questions to the player. Until Phase 3 draws AGI's own message windows,
 * these use the browser's alert() and prompt(), as jsyang's code did.
 *
 * Every message is also kept in a log (for the debug panel), and typed answers go through
 * the recorder so a replay gets the same answers. During a replay nothing is shown.
 */

import {isReplaying, recordValue} from './recorder';

/**
 * @typedef {object} LoggedMessage
 * @property {string} text
 * @property {number} logicNo  logic that printed it
 */

/** @type {LoggedMessage[]} most recent last; at most 50 kept */
export const messageLog = [];

/** @type {Array<(m: LoggedMessage) => void>} */
const listeners = [];

/** Calls `fn` for every message shown. */
export function onMessage(/** @type {(m: LoggedMessage) => void} */ fn) {
    listeners.push(fn);
}

/** @type {{say: (s: string) => void, stop: () => void}|null} */
let speech = null;
/** @type {{muted: boolean}|null} */
let sound  = null;

/**
 * @param {{say: (s: string) => void, stop: () => void}} tts
 * @param {{muted: boolean}} soundEmulator
 */
export function initDialogs(tts, soundEmulator) {
    speech = tts;
    sound  = soundEmulator;
}

/**
 * Shows a message and waits until the player closes it.
 * @param {string} text
 * @param {number} logicNo
 */
export function showMessage(text, logicNo) {
    const entry = {text, logicNo};
    messageLog.push(entry);
    if (messageLog.length > 50) messageLog.shift();
    listeners.forEach(fn => fn(entry));

    if (isReplaying()) return;

    if (sound) sound.muted = true;
    speech?.say(text);
    alert(text);
    speech?.stop();
    if (sound) sound.muted = false;
}

/**
 * Asks the player to type something. Returns null if they cancel.
 * @param {string} text
 * @param {string} [defaultValue]
 * @returns {string|null}
 */
export function askString(text, defaultValue) {
    return recordValue('prompt', () => prompt(text, defaultValue));
}
