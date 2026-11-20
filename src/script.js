// @ts-check
// Portions ported from NAGI (c) 2001-2002 Nick Sonneveld, X11 license, see licenses/NAGI-LICENSE.txt
// (sys/script.c)

/**
 * The script: a log of what the current room loaded and drew (logics, views, pictures,
 * sounds, draw.pic, overlay.pic, add.to.pic, discards), started afresh by new.room. A saved
 * game stores it, and restoring replays it to rebuild the room's picture exactly
 * (persist.js: stateReload()).
 *
 * Each entry is two bytes [type, number], as in NAGI. add.to.pic takes four entries:
 * [5, 0], [view, loop], [cel, x], [y, priority | margin << 4].
 */

import {FLAG} from './constants';
import {state} from './state';

export const SCRIPT = {
    LOAD_LOGIC: 0, LOAD_VIEW: 1, LOAD_PIC: 2, LOAD_SOUND: 3, DRAW_PIC: 4,
    ADD_TO_PIC: 5, DISCARD_PIC: 6, DISCARD_VIEW: 7, OVERLAY_PIC: 8,
};

/** Writing is allowed (off while a game is being restored). NAGI: write_ok */
let writeOk = false;

/** NAGI sys/script.c: script_block() */
export function scriptBlock() {
    writeOk = false;
}

/** NAGI sys/script.c: script_allow() */
export function scriptAllow() {
    writeOk = true;
}

/**
 * Empties the script (new.room, script.size).
 * NAGI sys/script.c: script_new()
 */
export function scriptNew() {
    state.script = [];
}

/**
 * Adds an entry, unless flag 7 blocks the script. More entries than script.size allows
 * is AGI error 11.
 * NAGI sys/script.c: script_write()
 * @param {number} a @param {number} b
 */
export function scriptWrite(a, b) {
    if (state.flags[FLAG.script_buffer_blocked] || !writeOk) return;
    if (state.script.length >= state.scriptSize) {
        throw new Error(`AGI error 11 (script full: ${state.scriptSize} entries)`);
    }
    state.script.push([a & 0xFF, b & 0xFF]);
}

/**
 * script.size: the number of entries the script can hold. Empties it.
 * NAGI sys/script.c: cmd_script_size()
 * @param {number} size
 */
export function scriptSize(size) {
    state.scriptSize = size;
    scriptNew();
}

/** push.script: remembers how long the script is. NAGI sys/script.c: cmd_unknown_171() */
export function pushScript() {
    state.scriptSaved = state.script.length;
}

/** pop.script: drops what was added since push.script. NAGI sys/script.c: cmd_unknown_172() */
export function popScript() {
    state.script.length = Math.min(state.scriptSaved, state.script.length);
}
