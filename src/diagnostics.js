// @ts-check

/**
 * Developer diagnostics: which logic commands the game used that this interpreter doesn't
 * implement (or only stubs), and a start-up check of the command functions against NAGI's
 * command table. Shown in the debug panel and printed with AGI.unimplemented().
 */

import {ACTIONS, SAID_OPCODE, TESTS} from './cmdTable';

/**
 * Commands whose JS function exists but does nothing yet. Running one is reported like an
 * unimplemented command, so it shows up when a game relies on it.
 */
const STUBS = new Set([
    'init_disk',
    'hold_key', 'set_pri_base', 'release_key',
    'hide_mouse', 'show_mouse', 'fence_mouse', 'mouse_posn', 'adj_ego_move_to_xy',
]);

/**
 * What the debug panel shows about the last input: the last parse, and the said() test
 * that matched it (if any). `cycle` is the cycle it happened in.
 * @type {{
 *   lastParse: {text: string, words: import('./parser').ParsedWord[], unknownWord: number, cycle: number}|null,
 *   lastSaid: {groups: number[], logicNo: number, cycle: number}|null,
 * }}
 */
/**
 * What the debug panel and tests show about the player's input.
 * lastInput: how the cycle that got the input ended (interpreter.js: noteInputCycle()).
 * @type {{
 *   lastParse: {text: string, words: import('./parser').ParsedWord[], unknownWord: number, cycle: number}|null,
 *   lastSaid: any,
 *   lastInput: any,
 * }}
 */
export const debugInfo = {lastParse: null, lastSaid: null, lastInput: null};

/** Commands logic.js runs itself, without a function in logicCommands.js. */
const HANDLED_IN_LOGIC = new Set(['set_scan_start', 'reset_scan_start']);

/**
 * @typedef {object} UnimplementedEntry
 * @property {'action'|'test'|'stub'} kind
 * @property {number} opcode
 * @property {string} name    NAGI's name for the command
 * @property {number} count   how often it ran
 * @property {number} logicNo logic it first ran in
 * @property {number} room    room (v0) it first ran in
 */

/** @type {Map<string, UnimplementedEntry>} */
export const unimplemented = new Map();

/** @type {Array<() => void>} */
const listeners = [];

/** Calls `fn` whenever a new unimplemented command is seen. */
export function onUnimplemented(/** @type {() => void} */ fn) {
    listeners.push(fn);
}

/**
 * Records that the game ran a command that is missing or a stub.
 * @param {'action'|'test'|'stub'} kind
 * @param {number} opcode
 * @param {number} logicNo
 * @param {number} room
 */
export function reportUnimplemented(kind, opcode, logicNo, room) {
    const name = (kind === 'test' ? TESTS : ACTIONS)[opcode][2];
    const key  = `${kind}:${opcode}`;
    const seen = unimplemented.get(key);

    if (seen) {
        seen.count++;
        return;
    }

    unimplemented.set(key, {kind, opcode, name, count: 1, logicNo, room});
    console.warn(`AGI: ${kind === 'stub' ? 'stub command' : `unimplemented ${kind}`} ${name} ` +
        `[0x${opcode.toString(16)}] in logic ${logicNo}, room ${room}`);
    listeners.forEach(fn => fn());
}

/** @param {string} jsName */
export const isStub = jsName => STUBS.has(jsName);

/** Prints the unimplemented and stub commands seen so far, and returns them. */
export function unimplementedSummary() {
    const rows = [...unimplemented.values()];
    console.table(rows);
    return rows;
}

/**
 * Compares the command functions in logicCommands.js with NAGI's table: lists missing
 * functions, and warns about functions whose parameter count differs from NAGI's argument
 * count. The
 * bytecode is read with NAGI's counts either way; a mismatch means the JS function gets
 * fewer or more arguments than it expects.
 * @param {Record<string, Function>} commands
 * @returns {string[]} the parameter-count mismatches found
 */
export function checkCommandTable(commands) {
    /** @type {string[]} */
    const problems = [];
    /** @type {string[]} */
    const missing = [];

    ACTIONS.forEach(([jsName, argCount, nagiName], opcode) => {
        if (HANDLED_IN_LOGIC.has(jsName)) return;
        const fn = commands[`agi_${jsName}`];
        if (!fn) {
            missing.push(nagiName);
        } else if (fn.length !== argCount) {
            problems.push(`action 0x${opcode.toString(16)} ${nagiName}: agi_${jsName} takes ${fn.length} arguments, NAGI reads ${argCount}`);
        }
    });

    TESTS.forEach(([jsName, argCount, nagiName], opcode) => {
        if (!jsName || opcode === SAID_OPCODE) return;
        const fn = commands[`agi_test_${jsName}`];
        if (!fn) {
            missing.push(nagiName);
        } else if (fn.length !== argCount) {
            problems.push(`test 0x${opcode.toString(16)} ${nagiName}: agi_test_${jsName} takes ${fn.length} arguments, NAGI reads ${argCount}`);
        }
    });

    if (missing.length > 0) {
        console.info(`AGI: commands not implemented (reported when a game runs one): ${missing.join(', ')}`);
    }
    if (problems.length > 0) {
        console.warn(`AGI: command table check found ${problems.length} problem(s):\n  ` + problems.join('\n  '));
    }
    return problems;
}
