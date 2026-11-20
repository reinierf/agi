// @ts-check
// Portions ported from NAGI (c) 2001-2002 Nick Sonneveld, X11 license, see licenses/NAGI-LICENSE.txt
// (agi_string.c, ui/string.c)

/**
 * Typing a line of text on the screen: get.string, get.num, and the save/restore dialogs.
 * The player types at the text cursor; Enter keeps the text, Esc cancels.
 */

import {state} from './state';
import {BACKSPACE, agiPrintf, gotoRowCol, popRowCol, pushRowCol, textPos, windowClear, windowPutChar} from './text';
import {inputEditOff, inputEditOn, inputEditStatus, inputRedraw} from './input';
import {logicMsg, strWordwrap} from './msg';
import {charWait} from './wait';

/** Most characters in a string, plus one. NAGI agi.h: STRING_SIZE */
export const STRING_SIZE = 40;

/** Where the edited text starts. NAGI agi_string.c: stredit_pos */
const streditPos = {row: 0, col: 0};

/**
 * Draws `str` from `offset` characters in, after clearing the edit area from there.
 * NAGI agi_string.c: stredit_disp2()
 * @param {string} str @param {number} dispSize @param {number} offset
 */
function streditDisp2(str, dispSize, offset) {
    windowClear(streditPos.row, streditPos.col + offset, streditPos.row, streditPos.col + dispSize - 1, state.textBG);
    agiPrintf(str.slice(offset));
}

/**
 * Redraws the edited text. If it is longer than the edit area, only its end is shown
 * (`percent` of the area), after a left arrow.
 * NAGI agi_string.c: stredit_disp()
 * @param {string} strEdit @param {number} strSize @param {number} dispSize @param {number} percent
 * @returns {number} index in strEdit of the first character shown
 */
function streditDisp(strEdit, strSize, dispSize, percent) {
    let dispStart = 0;
    if (strSize > dispSize && strEdit.length >= dispSize) {
        dispStart = strEdit.length - Math.trunc((percent * dispSize) / 100);
    }

    gotoRowCol(streditPos.row, streditPos.col);
    if (dispStart === 0) {
        streditDisp2(strEdit, dispSize, 0);
    } else {
        windowPutChar('\x1B'); // the font's left arrow
        streditDisp2(strEdit.slice(dispStart), dispSize, 1);
    }
    return dispStart;
}

/**
 * Lets the player edit `str` at the text cursor: at most strSize - 1 characters, shown in
 * dispSize columns (scrolling if longer). Backspace deletes, Ctrl+C or Ctrl+X clears.
 * NAGI agi_string.c: string_edit()
 * @param {string} str @param {number} strSize @param {number} dispSize
 * @returns {Generator<void, {key: number, text: string}, void>} key is 0x0D (Enter: text is
 *   the edited string) or 0x1B (Esc: text is `str` unchanged)
 */
export function* stringEdit(str, strSize, dispSize) {
    let strEdit = str;
    streditPos.row = textPos.row;
    streditPos.col = textPos.col;

    let dispStart = streditDisp(strEdit, strSize, dispSize, 75);

    for (;;) {
        inputEditOff(); // show the cursor
        const key = yield* charWait();
        inputEditOn();  // and take it off again

        // NAGI keeps the key in a char: special keys (F-keys: code << 8) become 0.
        const ch = key & 0xFF;
        switch (ch) {
            case 0x03: // Ctrl+C
            case 0x18: // Ctrl+X
                strEdit   = '';
                dispStart = 0;
                streditDisp(strEdit, strSize, dispSize, 0);
                break;

            case 0x08: // backspace
                if (strEdit.length > 0) strEdit = strEdit.slice(0, -1);
                if (strEdit.length > dispStart) {
                    windowPutChar(BACKSPACE);
                } else {
                    dispStart = streditDisp(strEdit, strSize, dispSize, 90);
                }
                break;

            case 0x0D: // Enter
                return {key: 0x0D, text: strEdit};

            case 0x1B: // Esc
                return {key: 0x1B, text: str};

            default:
                // A 0 would end the C string here; nothing to add.
                if (ch !== 0 && strEdit.length < strSize - 1) {
                    strEdit += String.fromCharCode(ch);
                    if (strEdit.length - dispStart < dispSize) {
                        windowPutChar(String.fromCharCode(ch));
                    } else {
                        dispStart = streditDisp(strEdit, strSize, dispSize, 20);
                    }
                }
        }
    }
}

/**
 * get.string: shows a prompt at a text row and column (row 25 or more: where the text
 * cursor is) and lets the player type at most `maxLen` characters into string `strNo`.
 * The string is emptied first; Esc leaves it empty.
 * NAGI agi_string.c: cmd_get_string()
 * @param {number} strNo @param {number} msgNo @param {number} row @param {number} col
 * @param {number} maxLen
 * @returns {Generator<void, void, void>}
 */
export function* getString(strNo, msgNo, row, col, maxLen) {
    const editWasOff = inputEditStatus();
    pushRowCol();
    inputEditOn();

    let len = maxLen + 1;
    if (len > STRING_SIZE) len = STRING_SIZE;

    state.strings[strNo] = '';
    if (row < 25) gotoRowCol(row, col);

    agiPrintf(strWordwrap(logicMsg(msgNo), 64));
    // At most maxLen characters, as Sierra's interpreter: NAGI's string_edit() is called
    // here with STRING_SIZE, which lets the player type up to 39 and scrolls, but SQ1's
    // name prompt (maxLen 18) stops at 18 in ScummVM (checked by the owner, 2026-11-20),
    // as NAGI's older string_edit_old() did. With strSize = len the text never scrolls.
    const {text} = yield* stringEdit('', len, len);
    state.strings[strNo] = text;

    popRowCol();
    if (editWasOff) inputEditOff();
}

/**
 * get.num: shows a prompt on the input line and lets the player type up to 3 characters;
 * their number (digits after leading spaces, up to the first other character) goes into
 * a variable.
 * NAGI agi_string.c: cmd_get_num()
 * @param {number} msgNo @param {number} varNo
 * @returns {Generator<void, void, void>}
 */
export function* getNum(msgNo, varNo) {
    inputEditOn();
    gotoRowCol(state.inputLinePos, 0);
    agiPrintf(strWordwrap(logicMsg(msgNo), 40));
    inputEditOff();
    const {text} = yield* stringEdit('', 4, 4);
    inputRedraw();

    state.variables[varNo] = stringToInt(text) & 0xFF;
}

/**
 * NAGI ui/string.c: string_to_int()
 * @param {string} s
 */
export function stringToInt(s) {
    let i = 0;
    while (s[i] === ' ') i++;
    let n = 0;
    while (i < s.length && s[i] >= '0' && s[i] <= '9') n = (n * 10 + s.charCodeAt(i++) - 48) & 0xFFFF;
    return n;
}
