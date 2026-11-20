// @ts-check
// Portions ported from NAGI (c) 2001-2002 Nick Sonneveld, X11 license, see licenses/NAGI-LICENSE.txt
// (ui/status.c)

/**
 * The status line: score and sound on/off in black on a white row, at the row
 * configure.screen gives (status.line.on / status.line.off). And the inventory screen
 * (the status command).
 */

import {FLAG, VAR} from './constants';
import {state} from './state';
import {
    agiPrintf, gotoRowCol, popRowCol, pushRowCol, screenRedraw, textAttribPop, textAttribPush, textColour,
    textScreen, windowLineClear,
} from './text';
import {inventoryObjects} from './resources';
import {EVENT_DIRECTION, EVENT_KEY} from './events';
import {eventWait} from './wait';
import {inputEditOn} from './input';

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

// ---- the inventory screen (NAGI ui/status.c) ----

/**
 * @typedef {object} InventItem
 * @property {number} num   item number (for v25)
 * @property {string} name
 * @property {number} row
 * @property {number} col
 */

/**
 * The status command: the inventory on the text screen. With flag 13 set the player can
 * pick an item with the arrow keys: Enter puts its number in v25, Esc puts 255 there.
 * Otherwise any key (or other event) returns to the game.
 * NAGI ui/status.c: cmd_status()
 * @returns {Generator<void, void, void>}
 */
export function* cmdStatus() {
    inputEditOn();
    textAttribPush();
    textColour(0, 0x0F);
    textScreen();

    yield* inventory();

    textAttribPop();
    screenRedraw();
}

/**
 * Lists the items carried two to a row (left one at column 1, right one ending at column
 * 38), from row 2, and lets the player choose one if flag 13 is set.
 * NAGI ui/status.c: inventory()
 * @returns {Generator<void, void, void>}
 */
function* inventory() {
    /** @type {InventItem[]} */
    const items = [];
    let row     = 2;
    let current = 0;

    inventoryObjects.forEach((obj, num) => {
        if (state.items[num] !== 0xFF) return;
        if (num === state.variables[VAR.selected_inventory_item]) current = items.length;

        if ((items.length & 1) === 0) {
            items.push({num, name: obj.name, row, col: 1});
        } else {
            items.push({num, name: obj.name, row, col: 39 - obj.name.length});
            row++;
        }
    });
    if (items.length === 0) {
        items.push({num: 0, name: 'nothing', row, col: 16});
    }

    inventDisplay(items, current);

    if (!state.flags[FLAG.inventory_select_enabled]) {
        yield* eventWait();
        return;
    }

    for (;;) {
        const event = yield* eventWait();
        if (event.type === EVENT_KEY) {
            if (event.data === 0x0D) { // Enter
                state.variables[VAR.selected_inventory_item] = items[current].num;
                return;
            }
            if (event.data === 0x1B) { // Esc
                state.variables[VAR.selected_inventory_item] = 0xFF;
                return;
            }
        } else if (event.type === EVENT_DIRECTION) {
            current = inventKey(items, current, event.data);
        }
    }
}

/**
 * NAGI ui/status.c: invent_display()
 * @param {InventItem[]} items @param {number} current
 */
function inventDisplay(items, current) {
    gotoRowCol(0, 11);
    agiPrintf('You are carrying:');

    items.forEach((item, i) => {
        gotoRowCol(item.row, item.col);
        if (i !== current || !state.flags[FLAG.inventory_select_enabled]) {
            textColour(0, 15);
        } else {
            textColour(15, 0); // selected
        }
        agiPrintf(item.name);
    });

    textColour(0, 15);
    if (state.flags[FLAG.inventory_select_enabled]) {
        gotoRowCol(24, 2);
        agiPrintf('Press ENTER to select, ESC to cancel');
    } else {
        gotoRowCol(24, 4);
        agiPrintf('Press a key to return to the game');
    }
}

/**
 * Moves the selection: up and down by a row (two items), left and right by one.
 * NAGI ui/status.c: invent_key(), invent_swap_colour()
 * @param {InventItem[]} items @param {number} current @param {number} direction
 * @returns {number} the new selection
 */
function inventKey(items, current, direction) {
    let next = current;
    switch (direction) {
        case 1: next -= 2; break; // up
        case 3: next++; break;    // right
        case 5: next += 2; break; // down
        case 7: next--; break;    // left
    }
    if (next < 0 || next >= items.length) next = current;

    if (next !== current) {
        textColour(15, 0);
        gotoRowCol(items[next].row, items[next].col);
        agiPrintf(items[next].name);

        textColour(0, 15);
        gotoRowCol(items[current].row, items[current].col);
        agiPrintf(items[current].name);
    }
    return next;
}
