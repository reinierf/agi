// @ts-check
// Portions ported from NAGI (c) 2001-2002 Nick Sonneveld, X11 license, see licenses/NAGI-LICENSE.txt
// (ui/events.c)

/**
 * The input event queue. Browser key events are turned into AGI events and queued; the
 * interpreter reads them while it waits between cycles (input.js: inputPoll), so no key
 * is lost when a cycle is slow or a message window is open.
 *
 * Event types, as in NAGI:
 *   1  key: an ASCII character, or a special key code (F-keys and Alt+letter are
 *      scan code << 8, Ctrl+letter is 1-26)
 *   2  direction: 0 (stop) to 8, for the arrow keys and numeric keypad
 *   3  controller: a key mapped with set.key (made from a type 1 event when it is read),
 *      or a menu choice
 * and, for this interpreter only:
 *   100 word groups: a word-group button in the debug view (data: "3,204")
 *   101 sound finished: data is the sound's sequence number (logicCommands.js)
 *
 * Live events are recorded (recorder.js). During a replay they are dropped and the
 * recorded ones are injected instead.
 */

import {isReplaying, recordEvent} from './recorder';

/**
 * @typedef {object} AgiEvent
 * @property {number} type
 * @property {any} data
 */

export const EVENT_KEY        = 1;
export const EVENT_DIRECTION  = 2;
export const EVENT_CONTROLLER = 3;
export const EVENT_WORDS      = 100;
export const EVENT_SOUND_DONE = 101;

/** @type {AgiEvent[]} */
let queue = [];

/** Sound-finished events: kept apart so input waiting in `queue` can't hold them up. */
/** @type {AgiEvent[]} */
let soundQueue = [];

// NAGI ui/events.c: dir_map. Directions: 1 up, 2 up-right, 3 right ... 8 up-left.
/** @type {Record<string, number>} */
const DIRECTION_KEYS = {
    ArrowUp: 1, PageUp: 2, ArrowRight: 3, PageDown: 4,
    ArrowDown: 5, End: 6, ArrowLeft: 7, Home: 8,
    Numpad8: 1, Numpad9: 2, Numpad6: 3, Numpad3: 4,
    Numpad2: 5, Numpad1: 6, Numpad4: 7, Numpad7: 8,
};

// NAGI ui/events.c: system_alt_map. PC scan codes for Alt+A to Alt+Z.
const ALT_SCAN_CODES = [30, 48, 46, 32, 18, 33, 34, 35, 23, 36, 37, 38, 50,
    49, 24, 25, 16, 19, 31, 20, 22, 47, 17, 45, 21, 44];

/**
 * Turns a browser keydown into an AGI event, or null if AGI has no use for the key.
 * NAGI ui/events.c: event_key_down(), key_parse(), system_keymap(), event_text_input()
 * @param {KeyboardEvent} e
 * @returns {AgiEvent|null}
 */
export function keyToEvent(e) {
    const {key, code} = e;

    // Keypad 5 / Clear stops ego.
    if (code === 'Numpad5' || key === 'Clear') {
        return {type: EVENT_DIRECTION, data: 0};
    }

    // Direction keys only on the first press, not on key repeat.
    const direction = DIRECTION_KEYS[code] ?? DIRECTION_KEYS[key];
    if (direction !== undefined && !e.ctrlKey && !e.altKey) {
        return e.repeat ? null : {type: EVENT_DIRECTION, data: direction};
    }

    const fKey = /^F(\d+)$/.exec(key);
    if (fKey && +fKey[1] >= 1 && +fKey[1] <= 10) {
        return {type: EVENT_KEY, data: (0x3B + +fKey[1] - 1) << 8};
    }

    const letter = /^Key([A-Z])$/.exec(code);
    if (e.altKey && letter) {
        return {type: EVENT_KEY, data: ALT_SCAN_CODES[letter[1].charCodeAt(0) - 65] << 8};
    }
    if (e.ctrlKey && letter) {
        return {type: EVENT_KEY, data: letter[1].charCodeAt(0) - 65 + 1};
    }
    if (e.ctrlKey || e.altKey || e.metaKey) {
        return null;
    }

    switch (key) {
        case 'Tab':       return {type: EVENT_KEY, data: 0x09};
        case 'Escape':    return {type: EVENT_KEY, data: 0x1B};
        case 'Backspace':
        case 'Delete':    return {type: EVENT_KEY, data: 0x08};
        case 'Enter':     return {type: EVENT_KEY, data: 0x0D};
    }

    // Typed characters: 7-bit ASCII only.
    if (key.length === 1 && key.charCodeAt(0) < 0x80) {
        return {type: EVENT_KEY, data: key.charCodeAt(0)};
    }

    return null;
}

/**
 * Queues a live event (and records it). Ignored during a replay.
 * NAGI ui/events.c: event_write()
 * @param {number} type
 * @param {any} data
 */
export function eventWrite(type, data) {
    if (isReplaying()) return;
    recordEvent(type, data);
    (type === EVENT_SOUND_DONE ? soundQueue : queue).push({type, data});
}

/**
 * Queues a recorded event during a replay.
 * @param {AgiEvent} event
 */
export function eventInject(event) {
    (event.type === EVENT_SOUND_DONE ? soundQueue : queue).push(event);
}

/**
 * Takes the sounds that finished since the last call. In NAGI the sound thread sets the
 * flag whenever the sound ends; here it is set before the next cycle.
 * @returns {AgiEvent[]}
 */
export function takeSoundEvents() {
    const events = soundQueue;
    soundQueue   = [];
    return events;
}

/**
 * Takes the next event off the queue, or null if it is empty.
 * NAGI ui/events.c: event_read()
 * @returns {AgiEvent|null}
 */
export function eventRead() {
    return queue.shift() ?? null;
}

/** True if no event is queued. */
export const eventsEmpty = () => queue.length === 0;

/** Drops all queued events (new.room does this). NAGI ui/events.c: events_clear() */
export function eventsClear() {
    queue = [];
}

/**
 * Reads one event: its key code if it is a key, 0xFFFF for any other event (which is
 * dropped), 0 if the queue is empty.
 * NAGI ui/events.c: char_poll()
 */
export function charPoll() {
    const event = eventRead();
    if (!event) return 0;
    return event.type === EVENT_KEY ? event.data : 0xFFFF;
}

/**
 * Starts listening for keys on `target`. Keys typed into form fields (the game picker,
 * the word-group search box) are left alone.
 * @param {Window} target
 */
export function eventsInit(target) {
    target.addEventListener('keydown', e => {
        const el = /** @type {HTMLElement|null} */ (e.target);
        if (el && el.closest && el.closest('input, textarea, select')) return;

        const event = keyToEvent(e);
        if (!event) return;

        eventWrite(event.type, event.data);
        e.preventDefault(); // no browser shortcuts for keys the game uses (F-keys, Tab, ...)
    });
}
