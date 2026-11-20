// @ts-check
// Portions ported from NAGI (c) 2001-2002 Nick Sonneveld, X11 license, see licenses/NAGI-LICENSE.txt
// (ui/status.c)

/**
 * The status line: score and sound on/off in black on a white row, at the row
 * configure.screen gives (status.line.on / status.line.off).
 */

import {FLAG, VAR} from './constants';
import {state} from './state';
import {
    agiPrintf, gotoRowCol, popRowCol, pushRowCol, textAttribPop, textAttribPush, textColour, windowLineClear,
} from './text';

/**
 * Draws the status line, if it is on. The text cursor and attribute are left as they were.
 * NAGI ui/status.c: status_line_write()
 */
export function statusLineWrite() {
    pushRowCol();
    textAttribPush();

    if (state.statusLineOn) {
        windowLineClear(state.statusLineRow, 0xFF); // white
        textColour(0, 0x0F);

        gotoRowCol(state.statusLineRow, 1);
        agiPrintf(`Score:${state.variables[VAR.score]} of ${state.variables[VAR.max_score]}`);
        gotoRowCol(state.statusLineRow, 30);
        agiPrintf(`Sound:${state.flags[FLAG.sound_on] ? 'on' : 'off'}`);
    }

    textAttribPop();
    popRowCol();
}

/** NAGI ui/status.c: cmd_status_line_on() */
export function statusLineOn() {
    state.statusLineOn = true;
    statusLineWrite();
}

/** NAGI ui/status.c: cmd_status_line_off() */
export function statusLineOff() {
    state.statusLineOn = false;
    windowLineClear(state.statusLineRow, 0);
}
