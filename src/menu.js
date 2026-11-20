// @ts-check
// Portions ported from NAGI (c) 2001-2002 Nick Sonneveld, X11 license, see licenses/NAGI-LICENSE.txt
// (ui/menu.c)

/**
 * The menu bar: set.menu, set.menu.item, submit.menu, enable.item, disable.item,
 * menu.input and allow.menu.
 *
 * menu.input (with flag 14 set) asks for the menu; it opens the next time input is
 * polled, which here is at the start of the next cycle (interpreter.js). The menu names
 * are on a white bar on row 0, the open menu's items in a box below its name. The arrow
 * keys move (Home/End: last/first menu, PgUp/PgDn: first/last item), Enter chooses an
 * enabled item, which sets its controller in the cycle that follows, and Esc closes the
 * menu.
 */

import {FLAG} from './constants';
import {state} from './state';
import {EVENT_CONTROLLER, EVENT_DIRECTION, EVENT_KEY, eventInject} from './events';
import {eventWait} from './wait';
import {gfxMsgbox} from './msg';
import {renderUpdate} from './objects';
import {statusLineWrite} from './status';
import {
    agiPrintf, calcTextBg, gotoRowCol, popRowCol, pushRowCol, setTextShade, textAttribPop, textAttribPush,
    textColour, windowLineClear,
} from './text';

/**
 * @typedef {object} MenuItem
 * @property {string} name
 * @property {number} row
 * @property {number} col
 * @property {boolean} enabled
 * @property {number} control  controller set when it is chosen
 */

/**
 * @typedef {object} Menu
 * @property {string} name
 * @property {number} row
 * @property {number} col
 * @property {boolean} hasItems  NAGI: status (a menu without items can't be opened)
 * @property {MenuItem[]} items
 * @property {number} cur       the item selected when the menu was last left
 */

/** @type {Menu[]} */
let menus = [];
let submitted    = false; // NAGI menu_submit: no changes after submit.menu
let nextInput    = false; // NAGI menu_next_input: menu.input asked for the menu
let menuCol      = 0;
let itemRow      = 0;
let itemCol      = 0;
let menuCur      = 0;     // index of the menu that is open (or was last)
let itemCur      = 0;     // index of its selected item

/** The box of the open menu, in picture coordinates (NAGI menu_calc_size()). */
const box = {x: 0, y: 0, w: 0, h: 0};

/**
 * set.menu: adds a menu to the bar.
 * NAGI ui/menu.c: cmd_set_menu()
 * @param {string} name
 */
export function setMenu(name) {
    if (submitted) return;
    if (menus.length === 0) {
        menuCol = 1;
    } else if (menus[menus.length - 1].items.length === 0) {
        menus[menus.length - 1].hasItems = false;
    }
    menus.push({name, row: 0, col: menuCol, hasItems: true, items: [], cur: 0});
    menuCol += name.length + 1;
    itemRow  = 1;
}

/**
 * set.menu.item: adds an item to the last menu. Its items line up under the menu's name,
 * or end at column 38 if the first one would be too wide there.
 * NAGI ui/menu.c: cmd_set_menu_item()
 * @param {string} name @param {number} control
 */
export function setMenuItem(name, control) {
    if (submitted || menus.length === 0) return;
    const menu = menus[menus.length - 1];
    if (itemRow === 1) {
        itemCol = name.length + menu.col < 0x27 ? menu.col : 0x27 - name.length;
    }
    itemRow++;
    menu.items.push({name, row: itemRow, col: itemCol, enabled: true, control});
}

/** submit.menu: the menu is complete. NAGI ui/menu.c: cmd_submit_menu() */
export function submitMenu() {
    if (menus.length > 0 && menus[menus.length - 1].items.length === 0) {
        menus[menus.length - 1].hasItems = false;
    }
    menuCur   = 0;
    itemCur   = 0;
    submitted = true;
}

/**
 * enable.item and disable.item: every item with this controller.
 * NAGI ui/menu.c: menu_item_set()
 * @param {number} control @param {boolean} enabled
 */
export function menuItemSet(control, enabled) {
    for (const menu of menus) {
        if (!menu.hasItems) continue;
        for (const item of menu.items) {
            if (item.control === control) item.enabled = enabled;
        }
    }
}

/** Enables every item (restart.game and restore.game). NAGI ui/menu.c: menu_enable_all() */
export function menuEnableAll() {
    for (const menu of menus) {
        for (const item of menu.items) item.enabled = true;
    }
}

/** menu.input: open the menu at the next input poll if flag 14 is set. NAGI ui/menu.c: cmd_menu_input() */
export function menuInputRequest() {
    if (state.flags[FLAG.menu_enabled]) nextInput = true;
}

/** True if menu.input asked for the menu. NAGI ui/menu.c: get_menu_requires_input_events() */
export const menuRequested = () => nextInput;

/**
 * Shows the menu and lets the player choose.
 * NAGI ui/menu.c: menu_input()
 * @returns {Generator<void, void, void>}
 */
export function* menuInput() {
    if (!state.menuState || menus.length === 0) return;

    pushRowCol();
    textAttribPush();
    windowLineClear(0, calcTextBg(0x0F));
    for (const menu of menus) menuName(menu, false);

    let si = menuCur;
    let di = itemCur;
    menuDraw(menus[si]);

    /** @param {number} from @param {number} step */
    const nextWithItems = (from, step) => {
        let i = from;
        for (let n = 0; n < menus.length; n++) {
            i = (i + step + menus.length) % menus.length;
            if (menus[i].hasItems) return i;
        }
        return from;
    };

    for (;;) {
        const menu  = menus[si];
        const event = yield* eventWait();

        if (event.type === EVENT_KEY) {
            if (event.data === 0x0D && menu.items[di]?.enabled) {
                eventInject({type: EVENT_CONTROLLER, data: menu.items[di].control});
                menuLeave(si, di);
                return;
            }
            if (event.data === 0x1B) {
                menuLeave(si, di);
                return;
            }
        } else if (event.type === EVENT_DIRECTION) {
            const count = menu.items.length;
            switch (event.data) {
                case 1: // up
                    itemName(menu.items[di], false);
                    di = (di - 1 + count) % count;
                    itemName(menu.items[di], true);
                    break;
                case 2: // PgUp: first item
                    itemName(menu.items[di], false);
                    di = 0;
                    itemName(menu.items[di], true);
                    break;
                case 3: // right
                    menuClear(si, di);
                    si = nextWithItems(si, 1);
                    di = menus[si].cur;
                    menuDraw(menus[si]);
                    break;
                case 4: // PgDn: last item
                    itemName(menu.items[di], false);
                    di = count - 1;
                    itemName(menu.items[di], true);
                    break;
                case 5: // down
                    itemName(menu.items[di], false);
                    di = (di + 1) % count;
                    itemName(menu.items[di], true);
                    break;
                case 6: // End: the last menu
                    menuClear(si, di);
                    si = menus.length - 1;
                    di = menus[si].cur;
                    menuDraw(menus[si]);
                    break;
                case 7: // left
                    menuClear(si, di);
                    si = nextWithItems(si, -1);
                    di = menus[si].cur;
                    menuDraw(menus[si]);
                    break;
                case 8: // Home: the first menu
                    menuClear(si, di);
                    si = 0;
                    di = menus[si].cur;
                    menuDraw(menus[si]);
                    break;
            }
        }

        menuCur = si;
        itemCur = di;
    }
}

/**
 * NAGI ui/menu.c: menu_leave()
 * @param {number} si @param {number} di
 */
function menuLeave(si, di) {
    menuClear(si, di);
    menuCur = si;
    itemCur = di;
    textAttribPop();
    popRowCol();
    if (state.statusLineOn) {
        statusLineWrite();
    } else {
        windowLineClear(0, 0);
    }
    nextInput = false;
}

/**
 * Highlights a menu's name and draws its box and items.
 * NAGI ui/menu.c: menu_draw()
 * @param {Menu} menu
 */
function menuDraw(menu) {
    menuName(menu, true);
    menuCalcSize(menu);
    gfxMsgbox(box.x, box.y, box.w, box.h, 0x0F, 0);
    menu.items.forEach((item, i) => itemName(item, i === menu.cur));
}

/**
 * Closes the menu's box, remembering the selected item.
 * NAGI ui/menu.c: menu_clear()
 * @param {number} si @param {number} di
 */
function menuClear(si, di) {
    menus[si].cur = di;
    menuName(menus[si], false);
    renderUpdate(box.x, box.y, box.w, box.h);
}

/**
 * Draws a menu item, white on black when selected; a disabled one is shaded.
 * NAGI ui/menu.c: menu_item_name(), menu_item_name_invert()
 * @param {MenuItem} item @param {boolean} selected
 */
function itemName(item, selected) {
    if (!item) return;
    if (selected) textColour(0x0F, calcTextBg(0));
    else textColour(0, calcTextBg(0x0F));
    gotoRowCol(item.row, item.col);
    setTextShade(!item.enabled);
    agiPrintf(item.name);
    setTextShade(false);
}

/**
 * Draws a menu's name on the bar, white on black when open; one without items is shaded.
 * NAGI ui/menu.c: menu_name(), menu_name_invert()
 * @param {Menu} menu @param {boolean} selected
 */
function menuName(menu, selected) {
    if (selected) textColour(0x0F, calcTextBg(0));
    else textColour(0, calcTextBg(0x0F));
    gotoRowCol(menu.row, menu.col);
    setTextShade(!menu.hasItems);
    agiPrintf(menu.name);
    setTextShade(false);
}

/**
 * The menu's box: as wide as its first item plus 2 columns, from the row under the bar to
 * the row under the last item.
 * NAGI ui/menu.c: menu_calc_size()
 * @param {Menu} menu
 */
function menuCalcSize(menu) {
    const first = menu.items[0];
    box.h = 8 * (menu.items.length + 2);
    box.w = (((first?.name.length ?? 0) << 2) + 8) & 0xFF;
    box.y = ((menu.items.length + 3 - state.playTop) * 8 - 1) & 0xFF;
    box.x = ((((first?.col ?? 1) - 1) << 2)) & 0xFF;
}
