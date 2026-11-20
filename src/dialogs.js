// @ts-check

/**
 * Around the message windows (msg.js): every message shown is kept in a log (for the debug
 * panel) and read out by text-to-speech (not during a replay).
 */

import {isReplaying} from './recorder';
import {onWindow} from './msg';
import {state} from './state';

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

/**
 * @param {{say: (s: string) => void, stop: () => void}} tts
 */
export function initDialogs(tts) {
    onWindow(text => {
        const entry = {text, logicNo: state.logicNo};
        messageLog.push(entry);
        if (messageLog.length > 50) messageLog.shift();
        listeners.forEach(fn => fn(entry));
        if (!isReplaying()) tts.say(text.replace(/\n/g, ' '));
    }, () => tts.stop());
}
