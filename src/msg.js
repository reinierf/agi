// @ts-check
// Portions ported from NAGI (c) 2001-2002 Nick Sonneveld, X11 license, see licenses/NAGI-LICENSE.txt
// (ui/msg.c, ui/window.c, ui/printf.c, ui/string.c, sys/gfx.c)

/**
 * Message windows (print, print.at, close.window) and display.
 *
 * A message window is a white box with a red border drawn over the picture, with the
 * text in black. It is drawn straight onto the screen; closing it copies the picture
 * buffer back over it. message_box() waits for the player unless flag 15 is set, so it
 * is a generator (see wait.js).
 *
 * Kept apart from the parser and input line, so the later narrator can call or replace
 * messageBox() on its own.
 */

import {FLAG, VAR} from './constants';
import {state} from './state';
import screen from './screen';
import {renderUpdate} from './objects';
import {inventoryObjects} from './resources';
import {userBooleanPoll, waitTicksOrReply} from './wait';
import {HEIGHT_MAX, wordwrap} from './wordwrap';
import {
    agiPrintf, gotoRowCol, popRowCol, pushRowCol, setWindowCol, textAttribPop, textAttribPush, textColour,
} from './text';

/** Pixel rows per text row. */
const LINE_SIZE = 8;

/**
 * NAGI ui/msg.h: MSGSTATE. null stands for NAGI's 0xFFFF ("not set").
 */
export const msgState = {
    /** @type {number|null} width asked for by print.at */
    wantedWidth: /** @type {number|null} */ (null),
    /** @type {{row: number|null, col: number|null}} position asked for by print.at */
    wantedPos: {row: /** @type {number|null} */ (null), col: /** @type {number|null} */ (null)},
    /** The character that makes the next one literal ('\\'; '@' in save/restore). */
    newlineChar: '\\',
    /** A window is on the screen. */
    active: false,
    /** top left of the text (text rows and columns) */
    tpos: {row: 0, col: 0},
    /** bottom row of the text, and the column just right of it */
    tposEdge: {row: 0, col: 0},
    /** text size: widest line and number of lines (set by strWordwrap) */
    tsize: {w: 0, h: 0},
    printedHeight: 0,
    /** the box in picture coordinates: left x and bottom y */
    bgpos: {x: 0, y: 0},
    bgsize: {w: 0, h: 0},
};

// ---- word wrap (wordwrap.js) ----

/**
 * The text of message `msgNo` of logic `logicNo`, or null if there is none.
 * NAGI ui/msg.c: logic_msg()
 * @param {number} msgNo
 * @param {number} [logicNo]
 * @returns {string|null}
 */
export function logicMsg(msgNo, logicNo = state.logicNo) {
    const logic = /** @type {any[]} */ (state.loadedLogics)[logicNo];
    return logic?.messages[msgNo] ?? null;
}

/** Values for the %-codes, from the interpreter state. */
/** @type {import('./wordwrap').WrapLookup} */
const lookup = {
    globalMsg: n => logicMsg(n, 0),
    msg:       n => logicMsg(n),
    object:    n => inventoryObjects[state.variables[n]]?.name,
    string:    n => state.strings[n],
    variable:  n => state.variables[n],
    word:      n => state.parsedWords[n - 1]?.text,
};

/**
 * Wraps `str` to lines of at most `width` characters, filling in %-codes. Sets
 * msgState.tsize to the widest line and the number of lines.
 * NAGI ui/msg.c: str_wordwrap()
 * @param {string|null} str
 * @param {number} width
 * @returns {string}
 */
export function strWordwrap(str, width) {
    const wrapped = wordwrap(str, width, lookup, msgState.newlineChar);
    msgState.tsize.w = wrapped.width;
    msgState.tsize.h = wrapped.height;
    return wrapped.text;
}

// ---- the window ----

/**
 * Fills a rectangle of the picture area on the screen. (x, y) is the bottom left corner
 * in picture coordinates (160 x 168); it is clipped to the picture.
 * NAGI sys/vid_render.c: render_rect(), render_clip(), ega_rect()
 * @param {number} x @param {number} y @param {number} width @param {number} height
 * @param {number} colour
 */
function renderRect(x, y, width, height, colour) {
    if (x >= 160 || x + width - 1 < 0 || y < 0 || y - (height - 1) >= 168) return;
    if (y - height + 1 < 0) height = y + 1;
    if (y >= 168) {
        height -= y - 167;
        y = 167;
    }
    if (x < 0) {
        width += x;
        x = 0;
    }
    if (x + width - 1 >= 160) width = 160 - x;
    screen.fillPicRect(x, y - height + 1, width, height, colour);
}

/**
 * Draws the box of a message window: white with a red line one pixel inside the edge.
 * NAGI sys/gfx.c: gfx_msgbox()
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {number} bg @param {number} line
 */
export function gfxMsgbox(x, y, w, h, bg, line) {
    renderRect(x, y, w, h, bg);
    renderRect(x + 1, y - 1, w - 2, 1, line);         // bottom
    renderRect(x + w - 2, y - 2, 1, h - 4, line);     // right
    renderRect(x + 1, y - h + 2, w - 2, 1, line);     // top
    renderRect(x + 1, y - 2, 1, h - 4, line);         // left
}

/**
 * Removes the message window, if one is open, by copying the picture back over it.
 * NAGI ui/msg.c: cmd_close_window()
 */
export function closeWindow() {
    if (msgState.active) {
        const {x, y} = msgState.bgpos;
        renderUpdate(x, y, msgState.bgsize.w, msgState.bgsize.h);
    }
    state.dialogue  = false; // NAGI msgstate.dialogue_open
    msgState.active = false;
    onClose?.();
}

/**
 * Draws a message window with `str` (closing the one that is open). `width` 0 means the
 * default of 30 columns; print.at's wanted width and position win.
 * NAGI ui/msg.c: message_box_draw()
 * @param {string|null} str
 * @param {number} [row]   with `force`: the height to use (0: as wrapped)
 * @param {number} [width]
 * @param {boolean} [force] use `width` (and `row`) as the window size
 */
export function messageBoxDraw(str, row = 0, width = 0, force = false) {
    if (msgState.active) closeWindow();
    textAttribPush();
    pushRowCol();
    textColour(0, 0x0F); // black on white

    if (msgState.wantedWidth === null && width === 0) width = 30;
    else if (msgState.wantedWidth !== null) width = msgState.wantedWidth;

    let msg;
    for (;;) {
        msg = strWordwrap(str, width);
        msgState.printedHeight = msgState.tsize.h;

        if (force) {
            msgState.tsize.w = width;
            if (row !== 0) msgState.tsize.h = row;
        }

        if (msgState.tsize.h <= HEIGHT_MAX - 1) break;

        // Too long: show this instead (wrapped again).
        str = `Message too verbose:\n\n"${(str ?? '').slice(0, 20)}..."\n\nPress ESC to continue.`;
    }

    const {tsize, tpos, tposEdge} = msgState;
    const top = msgState.wantedPos.row ?? ((HEIGHT_MAX - tsize.h - 1) >> 1) + 1;
    tpos.row     = top + state.playTop;
    tposEdge.row = tsize.h + tpos.row - 1;
    tpos.col     = msgState.wantedPos.col ?? Math.trunc((40 - tsize.w) / 2);

    setWindowCol(tpos.col);
    tposEdge.col = tpos.col + tsize.w;
    gotoRowCol(tpos.row, tpos.col);

    msgState.bgsize.w = tsize.w * 4 + 10;
    msgState.bgsize.h = tsize.h * LINE_SIZE + 10;
    msgState.bgpos.y  = (tposEdge.row - state.playTop + 1) * LINE_SIZE + 4;
    msgState.bgpos.x  = tpos.col * 4 - 5;

    gfxMsgbox(msgState.bgpos.x, msgState.bgpos.y, msgState.bgsize.w, msgState.bgsize.h, 0x0F, 0x04);

    msgState.active = true;
    agiPrintf(msg);
    setWindowCol(0);

    popRowCol();
    textAttribPop();

    state.dialogue = true; // NAGI msgstate.dialogue_open
    onOpen?.(msg);
}

/**
 * Shows a message window and, unless flag 15 is set, waits and closes it:
 * - flag 15 set: the window stays until close.window (or another window, or show.pic);
 *   flag 15 is reset;
 * - v21 = 0: waits for Enter (returns 1) or Esc (returns 0);
 * - v21 > 0: waits v21 half-seconds, or until Enter or Esc; v21 is reset to 0. Other keys
 *   don't close it (NAGI's has_user_reply() only answers Enter and Esc).
 * NAGI ui/msg.c: message_box()
 * @param {string|null} str
 * @returns {Generator<void, 0|1, void>} 1 for Enter (or no wait), 0 for Esc
 */
export function* messageBox(str) {
    messageBoxDraw(str);

    if (state.flags[FLAG.windows_remain]) {
        state.flags[FLAG.windows_remain] = 0;
        return 1;
    }

    /** @type {0|1} */
    let ret = 1;
    if (state.variables[VAR.window_close_time] === 0) {
        ret = yield* userBooleanPoll();
    } else {
        yield* waitTicksOrReply(state.variables[VAR.window_close_time] * 10);
        state.variables[VAR.window_close_time] = 0;
    }

    closeWindow();
    return ret;
}

/**
 * display and display.v: writes a message at a text row and column in the current text
 * attribute, wrapped at 40 columns (lines after the first start at column 0). The text
 * cursor is left where it was.
 * NAGI ui/msg.c: cmd_display(), cmd_display_v()
 * @param {number} row @param {number} col @param {number} msgNo
 */
export function display(row, col, msgNo) {
    pushRowCol();
    gotoRowCol(row, col);
    agiPrintf(strWordwrap(logicMsg(msgNo), 40));
    popRowCol();
}

/**
 * print.at and print.at.v: a message window at a text row and column, `width` wide
 * (0: 30).
 * NAGI ui/msg.c: print_at()
 * @param {number} msgNo @param {number} row @param {number} col @param {number} width
 * @returns {Generator<void, void, void>}
 */
export function* printAt(msgNo, row, col, width) {
    msgState.wantedPos.row = row;
    msgState.wantedPos.col = col;
    msgState.wantedWidth   = width === 0 ? 30 : width;

    yield* messageBox(logicMsg(msgNo));

    msgState.wantedPos.row = null;
    msgState.wantedPos.col = null;
    msgState.wantedWidth   = null;
}

// ---- hooks for the message log and text-to-speech (dialogs.js) ----

/** @type {((text: string) => void)|null} */
let onOpen = null;
/** @type {(() => void)|null} */
let onClose = null;

/**
 * Calls `open` with the (wrapped) text of each window shown, and `close` when it goes.
 * @param {(text: string) => void} open
 * @param {() => void} close
 */
export function onWindow(open, close) {
    onOpen  = open;
    onClose = close;
}

