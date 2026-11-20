// @ts-check
// Portions ported from NAGI (c) 2001-2002 Nick Sonneveld, X11 license, see licenses/NAGI-LICENSE.txt
// (ui/agi_text.c, ui/window.c, ui/printf.c, sys/gfx.c)

/**
 * Text on the screen: the text attribute (set.text.attribute), the text cursor, writing
 * characters, clearing rows, and switching between the text screen and graphics.
 *
 * The screen is 40 x 25 text cells of 8 x 8 pixels (screen.js draws them). In graphics
 * mode text can only be black on white or a colour on black; on the text screen any
 * foreground and background (0-7) can be used.
 */

import {state} from './state';
import screen from './screen';
import {renderUpdate} from './objects';
import {inputRedraw} from './input';

// ---- the text attribute (NAGI ui/agi_text.c) ----

/**
 * The text background colour for a colour number: in graphics mode only black (0) or
 * white (0xFF for any other colour); on the text screen always 0.
 * NAGI ui/agi_text.c: calc_text_bg()
 * @param {number} colour
 */
export function calcTextBg(colour) {
    return !state.textMode && colour !== 0 ? 0xFF : 0;
}

/**
 * The attribute byte for a foreground and background. Graphics mode (EGA): any background
 * gives black on white (0x8F; bit 7 inverts the character), otherwise the foreground on
 * black. Text screen: foreground | background << 4.
 * NAGI ui/agi_text.c: text_combine()
 * @param {number} fg @param {number} bg
 */
function textCombine(fg, bg) {
    if (state.textMode) return (fg | (bg << 4)) & 0xFFFF;
    return bg !== 0 ? 0x8F : fg;
}

/**
 * Sets the colours text is written in.
 * NAGI ui/agi_text.c: text_colour()
 * @param {number} fg @param {number} bg
 */
export function textColour(fg, bg) {
    state.textComb = textCombine(fg, bg);
    state.textFG   = fg;
    state.textBG   = calcTextBg(bg);
}

const ATTRIB_MAX = 5;
/** @type {Array<{fg: number, bg: number, comb: number}>} */
const attribList = [];

/** NAGI ui/agi_text.c: text_attrib_push() */
export function textAttribPush() {
    if (attribList.length < ATTRIB_MAX) {
        attribList.push({fg: state.textFG, bg: state.textBG, comb: state.textComb});
    }
}

/** NAGI ui/agi_text.c: text_attrib_pop() */
export function textAttribPop() {
    const a = attribList.pop();
    if (a) {
        state.textFG   = a.fg;
        state.textBG   = a.bg;
        state.textComb = a.comb;
    }
}

// ---- the text cursor and writing (NAGI ui/window.c) ----

/** The text cursor. NAGI sys/chargen.c: chgen_textpos */
export const textPos = {row: 0, col: 0};

/** Column a new line starts at; a message window sets it to its left edge. NAGI: window_col */
let windowCol = 0;

/** @param {number} col */
export function setWindowCol(col) {
    windowCol = col;
}

/** NAGI ui/window.c: goto_row_col() @param {number} row @param {number} col */
export function gotoRowCol(row, col) {
    textPos.row = row;
    textPos.col = col;
}

const PA_MAX = 5;
/** @type {Array<{row: number, col: number}>} */
const posArray = [];

/** NAGI ui/window.c: push_row_col() */
export function pushRowCol() {
    if (posArray.length < PA_MAX) posArray.push({...textPos});
}

/** NAGI ui/window.c: pop_row_col() */
export function popRowCol() {
    const p = posArray.pop();
    if (p) gotoRowCol(p.row, p.col);
}

/**
 * Writes one character at the text cursor in the current attribute and moves on. A line
 * feed or carriage return goes to the next row (not past row 24) at windowCol; backspace
 * clears the cell before the cursor (on the input rows from 22 on, it goes back up a row
 * from column 0).
 * NAGI ui/window.c: window_put_char()
 * @param {string} ch
 */
export function windowPutChar(ch) {
    if (ch === '\b') {
        if (textPos.col !== 0) {
            textPos.col--;
        } else if (textPos.row > 21) {
            textPos.col = 39;
            textPos.row--;
        }
        screen.chClear(textPos.row, textPos.col, textPos.row, textPos.col, state.textBG);
    } else if (ch === '\r' || ch === '\n') {
        if (textPos.row < 24) textPos.row++;
        textPos.col = windowCol;
    } else {
        screen.chPut(textPos.row, textPos.col, ch.charCodeAt(0), state.textComb);
        textPos.col++;
        if (textPos.col > 39) windowPutChar('\r');
    }
}

/**
 * Writes text at the text cursor. NAGI passes the (already wrapped) text as a printf
 * format; a '%' left in it would read arguments that aren't there, so here it is printed.
 * NAGI ui/printf.c: agi_printf()
 * @param {string} text
 */
export function agiPrintf(text) {
    for (const ch of text) windowPutChar(ch);
}

/**
 * Clears the text cells from (upperRow, upperCol) to (lowerRow, lowerCol) to the
 * background of `attrib` (bits 4-7). The cursor doesn't move.
 * NAGI ui/window.c: window_clear()
 * @param {number} upperRow @param {number} upperCol @param {number} lowerRow
 * @param {number} lowerCol @param {number} attrib
 */
export function windowClear(upperRow, upperCol, lowerRow, lowerCol, attrib) {
    screen.chClear(upperRow, upperCol, lowerRow, lowerCol, attrib);
}

/**
 * Clears whole rows. NAGI ui/window.c: window_portion_clear()
 * @param {number} upperRow @param {number} lowerRow @param {number} attrib
 */
export function windowPortionClear(upperRow, lowerRow, attrib) {
    windowClear(upperRow, 0, lowerRow, 39, attrib);
}

/**
 * Clears one row. NAGI ui/window.c: window_line_clear()
 * @param {number} row @param {number} attrib
 */
export function windowLineClear(row, attrib) {
    windowPortionClear(row, row, attrib);
}

// ---- text screen and graphics (NAGI ui/agi_text.c) ----

/**
 * text.screen: clears the screen to the text background and switches to the text screen
 * (objects are no longer updated). The input line isn't redrawn.
 * NAGI ui/agi_text.c: cmd_text_screen()
 */
export function textScreen() {
    state.textMode = true;
    textColour(state.textFG, state.textBG);
    screen.clearScreen();
    windowPortionClear(0, 24, state.textComb);
}

/**
 * graphics, and redrawing the screen after the text screen: the picture, the status line
 * and the input line.
 * NAGI ui/agi_text.c: screen_redraw()
 */
export function screenRedraw() {
    state.textMode = false;
    textColour(state.textFG, state.textBG);
    screen.clearScreen();
    renderUpdate(0, 167, 160, 168);
    // NAGI writes the status line here (status_line_write(); Phase 3, ui/status.c).
    inputRedraw();
}
