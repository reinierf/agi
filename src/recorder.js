// @ts-check

/**
 * Records a game session so it can be replayed exactly, and replays such recordings.
 *
 * Everything that can differ between two runs goes through here:
 * - input events (keys, menu choices, word-group buttons, sounds ending), stamped with the
 *   number of cycles completed when they were queued, and, for events queued while the game
 *   waits for a key inside a cycle (a message window), with that wait and poll;
 * - values from outside the game: the random seed, text typed into get.string/get.num;
 * - the game clock: in which cycles a second passed.
 * After each cycle a hash of the game state is stored. A replay feeds the recorded inputs
 * back in, one cycle at a time, and compares the hashes, so it reports the first cycle
 * where the game behaves differently.
 *
 * A replay also records, so playing on after a replay ends extends the same recording.
 *
 * Not covered: restoring a saved game (it reads localStorage, which isn't recorded).
 */

/**
 * @typedef {object} Recording
 * @property {'agi-recording'} format
 * @property {number} version
 * @property {string} game          game id (folder name)
 * @property {string} created       ISO date
 * @property {number} cycles        number of cycles recorded
 * @property {Array<[number, number, any]|[number, number, any, number, number]>} events
 *   [cycle, type, data], or [cycle, type, data, wait, poll] for an event queued while the
 *   game waited for a key: `wait` counts the waits since the game started (0-based) and
 *   the event is read at the wait's poll number `poll` (1-based)
 * @property {number[]} [waits]     per wait: the number of polls it lasted
 * @property {Record<string, any[]>} values         values per channel, in the order used
 * @property {Array<[number, number]>} clock        [cycle, seconds] for cycles where time passed
 * @property {number[][]} hashes    per cycle: hashes of [state, objects, screen]
 * @property {Record<number, number[]>} [changes]  per cycle with changes: the variables
 *   and flags that changed, as pairs [code, new value]; code < 256 is a variable, 256 + n
 *   is flag n. Used to say which ones differ when a replay fails.
 */

/**
 * @typedef {object} ReplayResult
 * @property {'running'|'passed'|'failed'} status
 * @property {number} cycles        cycles replayed so far
 * @property {number} totalCycles   cycles in the recording
 * @property {number} mismatches    cycles whose state differed
 * @property {{cycle: number, parts: string[], room: number, details: string[]}|null} firstMismatch
 *   details: variables/flags whose change in that cycle differs ("v76: recorded 3, replayed 2")
 * @property {string[]} problems    other problems (recorded values missing, ...)
 */

const HASH_PARTS = ['state', 'objects', 'screen'];

/** @type {Recording} */
let recording = newRecording('');

/** @type {Recording|null} the recording being replayed */
let replay = null;

/** @type {ReplayResult|null} */
let result = null;

let cyclesDone   = 0;
let inCycle      = false; // a cycle is running (see cycleStarted)
let nextEvent    = 0;   // index of the next replay event to inject
let waitsDone    = 0;   // waits for a key that have ended
let waitPolls    = -1;  // polls done in the current wait; -1 when not waiting
/** @type {Record<string, number>} */
let valuePos     = {};
/** @type {Map<number, number>} */
let replayClock  = new Map();

/** @type {Array<(r: ReplayResult) => void>} */
const finishListeners = [];

/** @param {string} game @returns {Recording} */
function newRecording(game) {
    return {
        format: 'agi-recording', version: 1, game, created: new Date().toISOString(),
        cycles: 0, events: [], values: {}, clock: [], hashes: [], changes: {}, waits: [],
    };
}

/** Starts a fresh recording (at game start). */
export function startRecording(/** @type {string} */ game) {
    recording  = newRecording(game);
    cyclesDone = 0;
    waitsDone  = 0;
    waitPolls  = -1;
}

/**
 * Starts replaying `rec` from the first cycle. Call before the game's first cycle.
 * @param {Recording} rec
 */
export function startReplay(rec) {
    if (rec.format !== 'agi-recording' || rec.version !== 1) {
        throw new Error('Not an AGI recording (version 1)');
    }
    replay      = rec;
    nextEvent   = 0;
    valuePos    = {};
    replayClock = new Map(rec.clock);
    result      = {status: 'running', cycles: 0, totalCycles: rec.cycles, mismatches: 0, firstMismatch: null, problems: []};
}

export const isReplaying = () => replay !== null;
export const getCyclesDone = () => cyclesDone;
export const getReplayResult = () => result;

/** @returns {Recording} a copy of the recording so far */
export function getRecording() {
    return JSON.parse(JSON.stringify(recording));
}

/** Calls `fn` with the result when a replay ends. */
export function onReplayFinished(/** @type {(r: ReplayResult) => void} */ fn) {
    finishListeners.push(fn);
}

/** Call when a cycle starts running (after its input was polled). */
export function cycleStarted() {
    inCycle = true;
}

/**
 * Records a live input event. (During a replay, live events are dropped by events.js.)
 * Events queued while a cycle runs (a sound ending at once) are handled before the next
 * cycle, so they are stamped with that cycle.
 * @param {number} type
 * @param {any} data
 */
export function recordEvent(type, data) {
    if (waitPolls >= 0) {
        recording.events.push([cyclesDone, type, data, waitsDone, waitPolls + 1]);
    } else {
        recording.events.push([inCycle ? cyclesDone + 1 : cyclesDone, type, data]);
    }
}

/**
 * Replay: the recorded events that were queued before cycle `cyclesDone` ran, which
 * haven't been injected yet. They are recorded again for the continued recording.
 * @returns {Array<{type: number, data: any}>}
 */
export function takeReplayEvents() {
    /** @type {Array<{type: number, data: any}>} */
    const events = [];
    if (!replay) return events;

    // Events read during a wait are injected by waitPoll().
    while (nextEvent < replay.events.length && replay.events[nextEvent][0] <= cyclesDone && replay.events[nextEvent].length === 3) {
        const event = replay.events[nextEvent++];
        recording.events.push(event);
        events.push({type: event[1], data: event[2]});
    }
    return events;
}

/**
 * Call when the game starts waiting for a key inside a cycle (a message window). Replay:
 * returns the number of polls the wait lasted when it was recorded, so a wait that ends
 * by time ends at the same poll; null when playing live.
 * @returns {number|null}
 */
export function waitBegin() {
    waitPolls = 0;
    if (!replay) return null;
    const polls = replay.waits?.[waitsDone];
    if (polls === undefined) {
        result?.problems.push(`cycle ${cyclesDone}: no recorded length for wait #${waitsDone + 1}`);
        return null;
    }
    return polls;
}

/**
 * Call before each poll of a wait. Replay: returns the recorded events that were queued
 * before this poll (they are recorded again for the continued recording).
 * @returns {Array<{type: number, data: any}>}
 */
export function waitPoll() {
    waitPolls++;
    /** @type {Array<{type: number, data: any}>} */
    const events = [];
    if (!replay) return events;

    // A wait that lasts longer than recorded won't end (its key is missing): stop here.
    const recordedPolls = replay.waits?.[waitsDone];
    if (recordedPolls !== undefined && waitPolls > recordedPolls) {
        result?.problems.push(`cycle ${cyclesDone}: wait #${waitsDone + 1} did not end after ${recordedPolls} polls as recorded`);
        finishReplay();
        return events;
    }

    while (nextEvent < replay.events.length) {
        const event = replay.events[nextEvent];
        if (event.length !== 5 || event[3] !== waitsDone || event[4] > waitPolls) break;
        nextEvent++;
        recording.events.push(event);
        events.push({type: event[1], data: event[2]});
    }
    return events;
}

/** Call when a wait ends. */
export function waitEnd() {
    (recording.waits ??= []).push(waitPolls);
    waitsDone++;
    waitPolls = -1;
}

/**
 * A value from outside the game (random seed, typed text). Recorded when playing,
 * taken from the recording when replaying.
 * @template T
 * @param {string} channel
 * @param {() => T} getLive
 * @returns {T}
 */
export function recordValue(channel, getLive) {
    let value;

    if (replay) {
        const values = replay.values[channel] || [];
        const i      = valuePos[channel] = (valuePos[channel] ?? -1) + 1;
        if (i < values.length) {
            value = values[i];
        } else {
            result?.problems.push(`cycle ${cyclesDone}: no recorded value #${i + 1} for "${channel}"`);
            value = getLive();
        }
    } else {
        value = getLive();
    }

    (recording.values[channel] ||= []).push(value);
    return value;
}

/**
 * Seconds of game time that passed before this cycle.
 * @param {() => number} getLive measured seconds
 */
export function clockSeconds(getLive) {
    const seconds = replay ? (replayClock.get(cyclesDone) ?? 0) : getLive();
    if (seconds) recording.clock.push([cyclesDone, seconds]);
    return seconds;
}

/**
 * Call after each cycle with the hashes of the game state. Replay: compares them with the
 * recording and ends the replay after the last recorded cycle.
 * @param {number[]} hashes
 * @param {number} room
 * @param {number[]} [changes] variables and flags changed in this cycle (see Recording.changes)
 */
export function afterCycle(hashes, room, changes = []) {
    inCycle = false;
    recording.hashes.push(hashes);
    if (changes.length) (recording.changes ??= {})[cyclesDone] = changes;

    if (replay && result) {
        const expected = replay.hashes[cyclesDone];
        if (expected) {
            const parts = HASH_PARTS.filter((_, i) => expected[i] !== hashes[i]);
            if (parts.length > 0) {
                result.mismatches++;
                result.firstMismatch ??= {cycle: cyclesDone, parts, room, details: compareChanges(replay.changes?.[cyclesDone] ?? [], changes)};
            }
        }
        result.cycles = cyclesDone + 1;
    }

    cyclesDone++;
    recording.cycles = cyclesDone;

    if (replay && result && cyclesDone >= replay.cycles) {
        finishReplay();
    }
}

/** Ends the replay and reports the result; the game plays on live. */
function finishReplay() {
    if (!replay || !result) return;
    result.status = result.mismatches === 0 && result.problems.length === 0 ? 'passed' : 'failed';
    replay        = null;
    const r       = result;
    finishListeners.forEach(fn => fn(r));
}

/**
 * Lists the variables and flags whose change in a cycle differs between the recording and
 * the replay.
 * @param {number[]} recorded pairs [code, value]
 * @param {number[]} replayed pairs [code, value]
 */
function compareChanges(recorded, replayed) {
    /** @param {number[]} pairs */
    const toMap = pairs => {
        const m = new Map();
        for (let i = 0; i < pairs.length; i += 2) m.set(pairs[i], pairs[i + 1]);
        return m;
    };
    const a = toMap(recorded);
    const b = toMap(replayed);
    /** @param {number} code */
    const name = code => (code < 256 ? `v${code}` : `f${code - 256}`);
    /** @param {number|undefined} v */
    const show = v => (v === undefined ? 'unchanged' : String(v));

    const details = [];
    for (const code of new Set([...a.keys(), ...b.keys()])) {
        if (a.get(code) !== b.get(code)) {
            details.push(`${name(code)}: recorded ${show(a.get(code))}, replayed ${show(b.get(code))}`);
        }
    }
    return details;
}

/** 32-bit FNV-1a over a sequence of numbers (bytes or small integers). */
export class Hash {
    h = 0x811C9DC5;

    /** @param {number} n */
    add(n) {
        this.h = Math.imul(this.h ^ (n & 0xFF), 0x01000193) >>> 0;
        if (n > 0xFF || n < 0) {
            this.h = Math.imul(this.h ^ ((n >>> 8) & 0xFFFFFF), 0x01000193) >>> 0;
        }
        return this;
    }

    /** @param {ArrayLike<number>} values */
    addAll(values) {
        for (let i = 0; i < values.length; i++) this.add(values[i]);
        return this;
    }

    /**
     * Hashes a buffer 4 bytes at a time (fast enough to hash the screen every cycle).
     * Its length must be a multiple of 4.
     * @param {Uint8Array|Uint8ClampedArray} bytes
     */
    addBuffer(bytes) {
        const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >>> 2);
        let h = this.h;
        for (let i = 0; i < words.length; i++) h = Math.imul(h ^ words[i], 0x01000193);
        this.h = h >>> 0;
        return this;
    }

    /** @param {string} s */
    addString(s) {
        for (let i = 0; i < s.length; i++) this.add(s.charCodeAt(i));
        return this.add(0);
    }
}
