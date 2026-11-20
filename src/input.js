// @ts-check
// Portions ported from NAGI (c) 2001-2002 Nick Sonneveld, X11 license, see licenses/NAGI-LICENSE.txt
// (ui/cmd_input.c, ui/controller.c)

/**
 * The player's input line and input polling: reads queued key events, steers ego, sets
 * controllers, and edits the input line. Enter hands the line to the parser.
 *
 * Kept separate from the parser (parser.js) and from message printing, so each can be
 * called or replaced on its own.
 */

import {EVENT_CONTROLLER, EVENT_DIRECTION, EVENT_KEY, EVENT_WORDS, eventRead, takeSoundEvents} from './events';
import {debugInfo} from './diagnostics';
import {soundFinished} from './logicCommands';
import {getCyclesDone} from './recorder';
import {FLAG, VAR} from './constants';
import {MT} from './objects';
import {state} from './state';
import {agiPrintf, BACKSPACE, gotoRowCol, windowLineClear, windowPutChar} from './text';
import {strWordwrap} from './msg';
import {parse} from './parser';
import {wordsTokData} from './resources';

const SCREEN_COLUMNS = 40;

/**
 * Turns a key event into a controller event if the key was mapped with set.key. The first
 * mapping made for a key wins.
 * NAGI ui/controller.c: control_key_map()
 * @param {import('./events').AgiEvent|null} event
 */
function controlKeyMap(event) {
    if (event && event.type === EVENT_KEY) {
        const controller = state.keysForControllers[event.data];
        if (controller !== undefined) {
            return {type: EVENT_CONTROLLER, data: controller};
        }
    }
    return event;
}

/**
 * Processes queued events until the queue is empty or the player has entered a command
 * (flag 2); later events stay queued for the next cycle.
 * NAGI ui/cmd_input.c: input_poll()
 */
export function inputPoll() {
    for (const event of takeSoundEvents()) {
        soundFinished(event.data);
    }

    let event = controlKeyMap(eventRead());

    while (event && !state.flags[FLAG.input_received]) {
        switch (event.type) {
            case EVENT_KEY:
                // v19 is a byte, so special keys (code << 8) store 0, as in NAGI.
                state.variables[VAR.key_pressed] = event.data;
                if (state.allowInput) {
                    inputPutChar(event.data);
                }
                break;
            case EVENT_DIRECTION: {
                const ego = state.gameObjects[0];
                // Pressing the direction ego is already walking in stops it.
                state.variables[VAR.ego_dir] = event.data === ego.direction ? 0 : event.data;
                if (!state.programControl) {
                    ego.motion = MT.NORM;
                }
                break;
            }
            case EVENT_CONTROLLER:
                state.controllers[event.data] = 1;
                break;
            case EVENT_WORDS: // a word-group button (debug view in playerCommandSystem.js)
                storeWords(String(event.data).split(',').map(g => ({group: +g, text: g})), 0);
                break;
        }
        event = controlKeyMap(eventRead());
    }
}

/**
 * Stores parsed words for said(), sets v9 for an unknown word, and sets flag 2 if any
 * word was stored.
 * @param {import('./parser').ParsedWord[]} words
 * @param {number} unknownWord
 */
export function storeWords(words, unknownWord) {
    state.parsedWords = words;
    if (unknownWord) {
        state.variables[VAR.unknown_word_no] = unknownWord;
    }
    if (words.length > 0) {
        state.flags[FLAG.input_received] = 1;
    }
}

/**
 * Parses a line of text and stores the result.
 * NAGI ui/parse.c: parse()
 * @param {string} text
 */
export function parseText(text) {
    const {words, unknownWord} = parse(wordsTokData, text);
    storeWords(words, unknownWord);
    debugInfo.lastParse = {text, words, unknownWord, cycle: getCyclesDone()};
}

/**
 * Adds a key to the input line: backspace deletes, Enter parses the line.
 * NAGI ui/cmd_input.c: input_put_char()
 * @param {number} key
 */
function inputPutChar(key) {
    let max = state.dialogue ? 36 : SCREEN_COLUMNS - (state.strings[0] || '').length;
    if (state.cursorChar) max--;
    if (state.variables[VAR.max_input_len] < max) max = state.variables[VAR.max_input_len];

    switch (key) {
        case 0x08: // backspace
            if (state.inputLine.length > 0) {
                state.inputLine = state.inputLine.slice(0, -1);
                inputRedraw();
            }
            break;
        case 0x0A:
            break;
        case 0x0D: // enter
            if (state.inputLine.length > 0) {
                state.inputPrev = state.inputLine;
                parseText(state.inputLine);
                state.inputLine = '';
                inputRedraw();
            }
            break;
        default:
            // NAGI stores the low byte of any other key, so special keys (F-keys,
            // Alt+letter) that no set.key maps would put a 0 in the line; skip those.
            if (max > state.inputLine.length && key !== 0 && key <= 0xFF) {
                state.inputLine += String.fromCharCode(key);
                inputRedraw();
            }
    }
}

/**
 * cancel.line: clears the input line.
 * NAGI ui/cmd_input.c: cmd_cancel_line()
 */
export function cancelLine() {
    while (state.inputLine.length > 0) {
        inputPutChar(0x08);
    }
}

/**
 * echo.line: completes the input line with the rest of the previous command.
 * NAGI ui/cmd_input.c: cmd_echo_line(), input_echo()
 */
export function echoLine() {
    if (state.allowInput && state.inputLine.length < state.inputPrev.length) {
        state.inputLine += state.inputPrev.slice(state.inputLine.length);
        inputRedraw();
    }
}

/**
 * Draws the input line: the prompt (string 0, with its %-codes filled in), the typed text
 * and the cursor character, in the current text attribute. The text cursor is left on
 * the input line, as in NAGI.
 * NAGI ui/cmd_input.c: input_redraw(), input_edit_off()
 */
export function inputRedraw() {
    if (!state.allowInput) return;

    inputEditOn();
    windowLineClear(state.inputLinePos, state.textBG);
    gotoRowCol(state.inputLinePos, 0);
    agiPrintf(strWordwrap(state.strings[0] ?? '', SCREEN_COLUMNS));
    agiPrintf(state.inputLine);
    inputEditOff();
}

/**
 * Clears the input line from the screen (prevent.input).
 * NAGI ui/cmd_input.c: cmd_prevent_input()
 */
export function inputClear() {
    inputEditOn();
    windowLineClear(state.inputLinePos, 0);
}

/** The cursor character is on the screen. NAGI ui/cmd_input.c: input_edit_disabled */
let inputEditDisabled = false;

/**
 * Takes the cursor character off the screen: a backspace at the text cursor.
 * NAGI ui/cmd_input.c: input_edit_on()
 */
export function inputEditOn() {
    if (inputEditDisabled) {
        inputEditDisabled = false;
        if (state.cursorChar) windowPutChar(BACKSPACE);
    }
}

/**
 * Puts the cursor character at the text cursor (which moves past it).
 * NAGI ui/cmd_input.c: input_edit_off()
 */
export function inputEditOff() {
    if (!inputEditDisabled) {
        inputEditDisabled = true;
        if (state.cursorChar) windowPutChar(String.fromCharCode(state.cursorChar));
    }
}

/** True while the cursor character is shown. NAGI ui/cmd_input.c: input_edit_status() */
export const inputEditStatus = () => inputEditDisabled;
