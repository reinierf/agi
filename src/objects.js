// @ts-check
// Portions ported from NAGI (c) 2001-2002 Nick Sonneveld, X11 license, see licenses/NAGI-LICENSE.txt
// (view/obj_base.c, view/obj_motion.c, view/obj_motion_cmd.c, view/obj_cycle.c, view/obj_loop.c,
//  view/obj_position.c, view/obj_priority.c, view/obj_proximity.c, view/obj_block.c,
//  view/obj_picbuff.c, view/obj_blit.c, view/obj_update.c, view/obj_drawerase.c,
//  view/view_base.c, picture/pic_add.c, sys/vid_render.c, logic/logic_eval.c)

/**
 * Animated objects (AGI "views on screen"): their state, the commands that change it, how
 * they move, change loop and cel and collide each cycle, and how they are drawn.
 *
 * Like NAGI, objects are drawn into the picture buffer itself (state.picBuffer: per pixel
 * the priority in the high nibble, the colour in the low nibble). Before an object is drawn,
 * the area under it is saved; erasing puts it back. Objects that update every cycle and
 * objects that don't are kept in two lists, each drawn in order of their y position (or
 * fixed priority), so nearer objects cover farther ones. Only the parts of the picture
 * that changed are copied to the screen (renderUpdate).
 */

import {state} from './state';
import {FLAG, palette, VAR} from './constants';
import {agiRand} from './rng';
import {SCRIPT, scriptWrite} from './script';

const PIC_WIDTH  = 160;
const PIC_HEIGHT = 168;

/** Object flags. NAGI agi.h: O_* */
export const O = {
    DRAWN:         0x0001,
    BLOCKIGNORE:   0x0002,
    PRIFIXED:      0x0004,
    HORIZONIGNORE: 0x0008,
    UPDATE:        0x0010,
    CYCLE:         0x0020,
    ANIMATE:       0x0040,
    BLOCK:         0x0080,
    WATER:         0x0100,
    OBJIGNORE:     0x0200,
    REPOS:         0x0400,
    LAND:          0x0800,
    SKIPUPDATE:    0x1000,
    LOOPFIXED:     0x2000,
    MOTIONLESS:    0x4000,
};

/** Motion types. NAGI agi.h: MT_* */
export const MT = {NORM: 0, WANDER: 1, FOLLOW: 2, MOVE: 3, EGO: 4};

/** Cel cycling types. NAGI agi.h: CY_* */
export const CY = {NORM: 0, END: 1, REVEND: 2, REV: 3};

const DRAWN_ANIMATE_UPDATE = O.DRAWN | O.ANIMATE | O.UPDATE;

/**
 * One animated object. Field names follow NAGI's VIEW struct (agi.h).
 * `u` holds the 6 bytes that NAGI's struct shares between motion types (a C union):
 * move.x (2 bytes), move.y (2), move.step_size, move.flag; follow.step_size, follow.flag,
 * follow.count; wander_count; loop_flag. They overlap exactly as in NAGI.
 * @typedef {object} AgiObject
 * @property {number} num
 * @property {number} stepTime
 * @property {number} stepCount
 * @property {number} x
 * @property {number} y
 * @property {number} viewNo
 * @property {boolean} hasView   NAGI: view_data != 0
 * @property {number} loop
 * @property {number} loopTotal
 * @property {number} cel
 * @property {number} celTotal
 * @property {number} celPrevWidth
 * @property {number} celPrevHeight
 * @property {number} xPrev
 * @property {number} yPrev
 * @property {number} xSize
 * @property {number} ySize
 * @property {number} stepSize
 * @property {number} cycleTime
 * @property {number} cycleCount
 * @property {number} direction
 * @property {number} motion
 * @property {number} cycle
 * @property {number} priority
 * @property {number} flags
 * @property {number[]} u
 */

/** @param {number} num @returns {AgiObject} */
export function newObject(num) {
    return {
        num, stepTime: 0, stepCount: 0, x: 0, y: 0, viewNo: 0, hasView: false,
        loop: 0, loopTotal: 0, cel: 0, celTotal: 0, celPrevWidth: 0, celPrevHeight: 0,
        xPrev: 0, yPrev: 0, xSize: 0, ySize: 0, stepSize: 0, cycleTime: 0, cycleCount: 0,
        direction: 0, motion: MT.NORM, cycle: CY.NORM, priority: 0, flags: 0,
        u: [0, 0, 0, 0, 0, 0],
    };
}

// --- The shared bytes (NAGI's union). Little-endian like NAGI on a PC. -----------------

/** @param {number} n */
const s16 = n => ((n & 0xFFFF) << 16) >> 16;
/** @param {AgiObject} v */
const moveX = v => s16(v.u[0] | (v.u[1] << 8));
/** @param {AgiObject} v */
const moveY = v => s16(v.u[2] | (v.u[3] << 8));
/** @param {AgiObject} v @param {number} n */
const setMoveX = (v, n) => { v.u[0] = n & 0xFF; v.u[1] = (n >> 8) & 0xFF; };
/** @param {AgiObject} v @param {number} n */
const setMoveY = (v, n) => { v.u[2] = n & 0xFF; v.u[3] = (n >> 8) & 0xFF; };
// move.step_size = u[4], move.flag = u[5]
// follow.step_size = u[0], follow.flag = u[1], follow.count = u[2]
// wander_count = u[0], loop_flag = u[0]

// --- Helpers ----------------------------------------------------------------------------

/** NAGI sys/error.c: set_agi_error(). The original interpreter stops the game. */
function agiError(/** @type {number} */ code, /** @type {number} */ num) {
    throw new Error(`AGI error ${code} (${num})`);
}

const objects = () => /** @type {AgiObject[]} */ (state.gameObjects);
const ego     = () => objects()[0];

/** @param {AgiObject} v */
function celOf(v) {
    return state.loadedViews[v.viewNo].loops[v.loop].cels[v.cel];
}

/** @param {AgiObject} v @param {number} mask */
const isSet = (v, mask) => (v.flags & mask) === mask;

/** @param {number} no */
const setFlag = no => { state.flags[no] = 1; };
/** @param {number} no */
const resetFlag = no => { state.flags[no] = 0; };

// --- Priority table (NAGI view/obj_picbuff.c, view/obj_base.c) --------------------------

/** Priority by y position: 4 above y 48, then a new priority every 12 lines. */
const priTable = new Uint8Array(172);
let priorityOrig = true;

/** NAGI view/obj_picbuff.c: table_init() */
function tableInit() {
    priTable.fill(4, 0, 48);
    for (let pri = 5, y = 48; pri < 15; pri++, y += 12) {
        priTable.fill(pri, y, y + 12);
    }
}
tableInit();

/**
 * Where an object with a fixed priority goes in the drawing order.
 * NAGI view/obj_base.c: gen_sort_pos()
 * @param {number} pri
 */
function genSortPos(pri) {
    if (priorityOrig) return (pri - 5) * 12 + 0x30;

    let y = 0xA7;
    while (priTable[y] >= pri) {
        y--;
        if (y < 0) return -1; // NAGI's guard; the original doesn't check
    }
    return y;
}

// --- Drawing ---------------------------------------------------------------------------

/**
 * @typedef {object} Blit
 * @property {AgiObject} v
 * @property {number} x
 * @property {number} y        top row
 * @property {number} xSize
 * @property {number} ySize
 * @property {Uint8Array} buffer saved picture under the object
 */

/** @type {Blit[]} objects that update every cycle, in drawing order */
let updatedList = [];
/** @type {Blit[]} objects that don't, in drawing order */
let staticList  = [];

/**
 * Copies part of the picture buffer to the screen. `y` is the bottom row; the area goes
 * `height` rows up from there.
 * NAGI sys/vid_render.c: render_update(), render_clip(), ega_update()
 * @param {number} x @param {number} y @param {number} width @param {number} height
 */
export function renderUpdate(x, y, width, height) {
    if (x >= PIC_WIDTH || x + width - 1 < 0 || y < 0 || y - (height - 1) >= PIC_HEIGHT) return;
    if (y - height + 1 < 0) height = y + 1;
    if (y >= PIC_HEIGHT) {
        height -= y - (PIC_HEIGHT - 1);
        y = PIC_HEIGHT - 1;
    }
    if (x < 0) {
        width += x;
        x = 0;
    }
    if (x + width > PIC_WIDTH) width = PIC_WIDTH - x;

    // The picture starts at text row window_row_min (configure.screen) on the screen.
    // NAGI sys/gfx.c: gfx_update()
    const top  = state.playTop * 8;
    const pb   = state.picBuffer;
    const data = state.frameData.data;
    for (let row = y - height + 1; row <= y && top + row < 200; row++) {
        for (let col = x; col < x + width; col++) {
            const rgb = palette[pb[row * PIC_WIDTH + col] & 0x0F];
            const i   = ((top + row) * PIC_WIDTH + col) * 8;
            data[i]     = data[i + 4] = (rgb >>> 16) & 0xFF;
            data[i + 1] = data[i + 5] = (rgb >>> 8) & 0xFF;
            data[i + 2] = data[i + 6] = rgb & 0xFF;
            data[i + 3] = data[i + 7] = 255;
        }
    }
}

/** NAGI view/obj_base.c: blit_new() @param {AgiObject} v @returns {Blit} */
function blitNew(v) {
    return {v, x: v.x, y: v.y - v.ySize + 1, xSize: v.xSize, ySize: v.ySize, buffer: new Uint8Array(v.xSize * v.ySize)};
}

/** NAGI view/obj_blit.c: blit_save() @param {Blit} b */
function blitSave(b) {
    for (let row = 0; row < b.ySize; row++) {
        const start = (b.y + row) * PIC_WIDTH + b.x;
        b.buffer.set(state.picBuffer.subarray(start, start + b.xSize), row * b.xSize);
    }
}

/** NAGI view/obj_blit.c: blit_restore() @param {Blit} b */
function blitRestore(b) {
    for (let row = 0; row < b.ySize; row++) {
        state.picBuffer.set(b.buffer.subarray(row * b.xSize, (row + 1) * b.xSize), (b.y + row) * PIC_WIDTH + b.x);
    }
}

/**
 * Draws an object's cel into the picture buffer, behind anything of higher priority.
 * Pixels on a control line (priority 0-2) keep the control priority; whether the object
 * shows there depends on the first non-control priority below it.
 * NAGI view/obj_blit.c: obj_blit()
 * @param {AgiObject} v
 */
function objBlit(v) {
    const view = state.loadedViews[v.viewNo];
    let cel    = view.loops[v.loop].cels[v.cel];
    const mirror = cel.mirrored;
    if (mirror) cel = view.loops[cel.mirroredLoop].cels[v.cel];

    const pb      = state.picBuffer;
    const height  = cel.height;
    const width   = cel.width;
    const viewPri = (v.priority << 4) & 0xFF;
    let invisible = true;

    for (let cy = 0; cy < height; cy++) {
        const rowStart = (v.y - height + 1 + cy) * PIC_WIDTH + v.x;
        for (let cx = 0; cx < width; cx++) {
            const col = cel.pixelData[cy * width + (mirror ? width - 1 - cx : cx)];
            if (col === cel.transparentColor) continue;

            const i = rowStart + cx;
            let pri = pb[i] & 0xF0;

            if (pri <= 0x20) {
                // On a control line: look down for the first real priority.
                let t  = i;
                let ch = 0;
                while (t < 0x6860 && ch <= 0x20) {
                    t += PIC_WIDTH;
                    ch = pb[t] & 0xF0;
                }
                if (ch > viewPri) pri = 0xFF;
            } else if (pri > viewPri) {
                pri = 0xFF;
            } else {
                pri = viewPri;
            }

            if (pri !== 0xFF) {
                pb[i] = pri | col;
                invisible = false;
            }
        }
    }

    if (v.num === 0) {
        if (invisible) setFlag(FLAG.ego_hidden);
        else resetFlag(FLAG.ego_hidden);
    }
}

/**
 * Builds a drawing list from the objects that pass `filter`, sorted by y (or fixed
 * priority); ties keep table order.
 * NAGI view/obj_base.c: blitlist_build()
 * @param {(v: AgiObject) => boolean} filter
 * @returns {Blit[]}
 */
function blitlistBuild(filter) {
    const chosen = objects().filter(filter);
    const sort   = chosen.map(v => (v.flags & O.PRIFIXED ? genSortPos(v.priority) : v.y));
    const list   = [];

    for (let n = 0; n < chosen.length; n++) {
        let next = -1;
        let cur  = 255;
        for (let d = 0; d < chosen.length; d++) {
            if (sort[d] < cur) {
                next = d;
                cur  = sort[d];
            }
        }
        if (next === -1) break; // NAGI asserts here
        sort[next] = 255;
        list.push(blitNew(chosen[next]));
    }
    return list;
}

/** @param {AgiObject} v */
const isUpdated = v => (v.flags & DRAWN_ANIMATE_UPDATE) === DRAWN_ANIMATE_UPDATE;
/** @param {AgiObject} v */
const isStatic  = v => (v.flags & DRAWN_ANIMATE_UPDATE) === (O.DRAWN | O.ANIMATE);

/** NAGI view/obj_base.c: blitlist_draw() @param {Blit[]} list */
function blitlistDraw(list) {
    for (const b of list) {
        blitSave(b);
        objBlit(b.v);
    }
}

/** NAGI view/obj_base.c: blitlist_erase() @param {Blit[]} list */
function blitlistErase(list) {
    for (let i = list.length - 1; i >= 0; i--) blitRestore(list[i]);
    list.length = 0;
}

/**
 * Shows the objects in the list on screen and notes which didn't move.
 * NAGI view/obj_base.c: blitlist_update()
 * @param {Blit[]} list
 */
function blitlistUpdate(list) {
    for (let i = list.length - 1; i >= 0; i--) {
        const v = list[i].v;
        objCelUpdate(v);
        if (v.stepCount === v.stepTime) {
            if (v.x === v.xPrev && v.y === v.yPrev) {
                v.flags |= O.MOTIONLESS;
            } else {
                v.xPrev = v.x;
                v.yPrev = v.y;
                v.flags &= ~O.MOTIONLESS;
            }
        }
    }
}

/** NAGI view/obj_update.c: blists_erase() */
export function blistsErase() {
    blitlistErase(updatedList);
    blitlistErase(staticList);
}

/** NAGI view/obj_update.c: blists_draw() */
export function blistsDraw() {
    staticList = blitlistBuild(isStatic);
    blitlistDraw(staticList);
    updatedList = blitlistBuild(isUpdated);
    blitlistDraw(updatedList);
}

/** NAGI view/obj_update.c: blists_update() */
function blistsUpdate() {
    blitlistUpdate(staticList);
    blitlistUpdate(updatedList);
}

/**
 * Copies the area an object covered and now covers to the screen.
 * NAGI view/obj_picbuff.c: obj_cel_update()
 * @param {AgiObject} v
 */
function objCelUpdate(v) {
    if (!state.picVisible) return;

    const prevH = v.celPrevHeight;
    const prevW = v.celPrevWidth;
    v.celPrevHeight = v.ySize;
    v.celPrevWidth  = v.xSize;

    let y, y2, h1, h2;
    if (v.y < v.yPrev) {
        y = v.yPrev; y2 = v.y; h1 = prevH; h2 = v.ySize;
    } else {
        y = v.y; y2 = v.yPrev; h1 = v.ySize; h2 = prevH;
    }
    let h = (y2 - h2 > y - h1) ? h1 : y - y2 + h2;

    let x, x2, w1, w2;
    if (v.x > v.xPrev) {
        x = v.xPrev; x2 = v.x; w1 = prevW; w2 = v.xSize;
    } else {
        x = v.x; x2 = v.xPrev; w1 = v.xSize; w2 = prevW;
    }
    let w = (x2 + w2 < x + w1) ? w1 : w2 + x2 - x;

    if (x + w > 161) w = 161 - x;
    if (1 < h - y) h = y + 1;

    renderUpdate(x, y, w, h);
}

/** Clears the drawing lists without restoring anything (a new game). */
export function resetBlitLists() {
    updatedList = [];
    staticList  = [];
}

// --- View, loop and cel (NAGI view/view_base.c) ----------------------------------------

/** NAGI view/view_base.c: obj_view_set() @param {AgiObject} v @param {number} num */
export function objViewSet(v, num) {
    const view = state.loadedViews[num];
    if (!view) agiError(0x3, num);

    v.hasView   = true;
    v.viewNo    = num;
    v.loopTotal = view.loops.length;
    objLoopSet(v, v.loop >= v.loopTotal ? 0 : v.loop);
}

/** NAGI view/view_base.c: obj_loop_set() @param {AgiObject} v @param {number} loopNo */
export function objLoopSet(v, loopNo) {
    if (!v.hasView) agiError(6, v.num);
    if (loopNo > v.loopTotal) agiError(5, v.num);
    if (loopNo === v.loopTotal) {
        console.warn(`AGI: set.loop just out of range on object ${v.num}`);
        loopNo = v.loopTotal - 1;
    }

    // obj_loop_data()
    v.loop     = loopNo;
    v.celTotal = state.loadedViews[v.viewNo].loops[loopNo].cels.length;
    if (v.cel >= v.celTotal) v.cel = 0;

    objCelSet(v, v.cel);
}

/** NAGI view/view_base.c: obj_cel_set() @param {AgiObject} v @param {number} celNo */
export function objCelSet(v, celNo) {
    if (!v.hasView) agiError(0xA, v.num);
    if (v.celTotal <= celNo) agiError(8, v.num);

    // obj_cel_data()
    v.cel = celNo;
    const cel = celOf(v);
    v.xSize = cel.width;
    v.ySize = cel.height;

    if (v.x + v.xSize > PIC_WIDTH) {
        v.flags |= O.REPOS;
        v.x = PIC_WIDTH - v.xSize;
    }
    if (v.y - v.ySize < -1) {
        v.flags |= O.REPOS;
        v.y = v.ySize - 1;
        if (v.y <= state.horizon && !(v.flags & O.HORIZONIGNORE)) v.y = state.horizon + 1;
    }
}

// --- Position checks (NAGI view/obj_picbuff.c, view/obj_proximity.c, view/obj_block.c) ---

/**
 * Checks the line under the object for control lines and water, sets its priority from
 * its y position (unless fixed), and for ego sets flag 0 (on water) and flag 3 (on a
 * signal line). Returns false if the object may not stand here.
 * NAGI view/obj_picbuff.c: obj_chk_control()
 * @param {AgiObject} v
 */
function objChkControl(v) {
    if (!(v.flags & O.PRIFIXED)) v.priority = priTable[v.y];

    let control = true;
    let water   = false;
    let signal  = false;

    if (v.priority !== 0x0F) {
        water = true;
        const start = v.y * PIC_WIDTH + v.x;
        check: {
            for (let i = 0; i < v.xSize; i++) {
                const pri = state.picBuffer[start + i] & 0xF0;
                if (pri === 0) { // obstacle
                    control = false;
                    break check;
                }
                if (pri !== 0x30) { // not water
                    water = false;
                    if (pri === 0x10) { // conditional obstacle
                        if (!(v.flags & O.BLOCKIGNORE)) {
                            control = false;
                            break check;
                        }
                    } else if (pri === 0x20) {
                        signal = true;
                    }
                }
            }

            if (!water) {
                if (v.flags & O.WATER) control = false;
            } else if (v.flags & O.LAND) {
                control = false;
            }
        }
    }

    if (v.num === 0) {
        state.flags[FLAG.ego_touching_signal_line] = signal ? 1 : 0;
        state.flags[FLAG.ego_on_water]             = water ? 1 : 0;
    }
    return control;
}

/**
 * True if the object's baseline touches (or crossed) another object's baseline.
 * NAGI view/obj_proximity.c: obj_chk_contact()
 * @param {AgiObject} v
 */
function objChkContact(v) {
    if (v.flags & O.OBJIGNORE) return false;

    for (const c of objects()) {
        if ((c.flags & (O.DRAWN | O.ANIMATE)) !== (O.DRAWN | O.ANIMATE)) continue;
        if (c.flags & O.OBJIGNORE) continue;
        if (v.num === c.num) continue;
        if (v.x + v.xSize < c.x) continue;
        if (c.x + c.xSize < v.x) continue;

        if (v.y === c.y) return true;
        if (v.y > c.y && v.yPrev < c.yPrev) return true;
        if (v.y < c.y && v.yPrev > c.yPrev) return true;
    }
    return false;
}

/** NAGI view/obj_picbuff.c: obj_chk_walk_area() @param {AgiObject} v */
function objChkWalkArea(v) {
    if (v.x < 0) return false;
    if (v.x + v.xSize > PIC_WIDTH) return false;
    if (v.y - v.ySize < -1) return false;
    if (v.y > 167) return false;
    if (!(v.flags & O.HORIZONIGNORE) && v.y <= state.horizon) return false;
    return true;
}

/**
 * Moves the object in a spiral until it is in the walking area, touches no other object
 * and isn't on a control line it may not stand on.
 * NAGI view/obj_picbuff.c: obj_pos_shuffle()
 * @param {AgiObject} v
 */
function objPosShuffle(v) {
    if (v.y <= state.horizon && !(v.flags & O.HORIZONIGNORE)) v.y = state.horizon + 1;

    if (objChkWalkArea(v) && !objChkContact(v) && objChkControl(v)) return;

    let dir   = 0;
    let count = 1;
    let size  = 1;

    while (!objChkWalkArea(v) || objChkContact(v) || !objChkControl(v)) {
        switch (dir) {
            case 0: // left
                v.x--;
                if (--count === 0) { dir = 1; count = size; }
                break;
            case 1: // down
                v.y++;
                if (--count === 0) { dir = 2; size++; count = size; }
                break;
            case 2: // right
                v.x++;
                if (--count === 0) { dir = 3; count = size; }
                break;
            case 3: // up
                v.y--;
                if (--count === 0) { dir = 0; size++; count = size; }
                break;
        }
    }
}

/** NAGI view/obj_block.c: block_chk_pos() @param {number} x @param {number} y */
function blockChkPos(x, y) {
    return state.blockX1 < x && state.blockX2 > x && state.blockY1 < y && state.blockY2 > y;
}

// --- Motion (NAGI view/obj_motion.c) -----------------------------------------------------

const X_DIR_MULT = [0, 0, 1, 1, 1, 0, -1, -1, -1];
const Y_DIR_MULT = [0, -1, -1, 0, 1, 1, 1, 0, -1];

/** @param {number} disp @param {number} step */
function move172d(disp, step) {
    if (-step >= disp) return 0;
    if (step <= disp) return 2;
    return 1;
}

const DIR_TABLE = [8, 1, 2, 7, 0, 3, 6, 5, 4];

/**
 * The direction from (x, y) towards (newX, newY); 0 when within one step.
 * NAGI view/obj_motion.c: move16ed()
 */
function move16ed(/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ newX, /** @type {number} */ newY, /** @type {number} */ stepSize) {
    return DIR_TABLE[move172d(newX - x, stepSize) + move172d(newY - y, stepSize) * 3];
}

/**
 * Updates the direction of every object that moves this cycle (wander, follow, move.obj).
 * NAGI view/obj_motion.c: objs_dir_calc()
 */
export function objsDirCalc() {
    for (const v of objects()) {
        if (isUpdated(v) && v.stepCount === 1) objMotionUpdate(v);
    }
}

/** NAGI view/obj_motion.c: obj_motion_update() @param {AgiObject} v */
function objMotionUpdate(v) {
    switch (v.motion) {
        case MT.WANDER: objWanderUpdate(v); break;
        case MT.FOLLOW: objFollowUpdate(v); break;
        case MT.EGO:
        case MT.MOVE:   objMoveUpdate(v); break;
    }

    if (!state.blockState) {
        v.flags &= ~O.BLOCK;
    } else if (!(v.flags & O.BLOCKIGNORE) && v.direction !== 0) {
        objChkBlock(v);
    }
}

/**
 * An object may not cross the edge of the block set with block(): stops it if its next
 * step would.
 * NAGI view/obj_motion.c: obj_chk_block()
 * @param {AgiObject} v
 */
function objChkBlock(v) {
    const inside = blockChkPos(v.x, v.y);
    const x      = v.x + v.stepSize * X_DIR_MULT[v.direction];
    const y      = v.y + v.stepSize * Y_DIR_MULT[v.direction];

    if (inside === blockChkPos(x, y)) {
        v.flags &= ~O.BLOCK;
    } else {
        v.flags |= O.BLOCK;
        v.direction = 0;
        if (v.num === 0) state.variables[VAR.ego_dir] = 0;
    }
}

/**
 * Moves every updated object one step (when its step time comes), keeps it on screen,
 * notes which edge it touched (v2 for ego, v4/v5 for others) and undoes the step if it
 * hit another object or a control line.
 * NAGI view/obj_motion.c: objs_step_update()
 */
function objsStepUpdate() {
    state.variables[VAR.object_edge_code]     = 0;
    state.variables[VAR.object_touching_edge] = 0;
    state.variables[VAR.ego_edge_code]        = 0;

    for (const v of objects()) {
        if (!isUpdated(v)) continue;

        if (v.stepCount > 1) {
            v.stepCount--;
            continue;
        }

        v.stepCount = v.stepTime;
        let border  = 0;
        const xOrig = v.x;
        const yOrig = v.y;

        if (!(v.flags & O.REPOS)) {
            v.x += v.stepSize * X_DIR_MULT[v.direction];
            v.y += v.stepSize * Y_DIR_MULT[v.direction];
        }

        if (v.x < 0) {
            v.x    = 0;
            border = 4; // left edge
        } else if (v.x + v.xSize > PIC_WIDTH) {
            v.x    = PIC_WIDTH - v.xSize;
            border = 2; // right edge
        }

        if (v.y - v.ySize < -1) {
            v.y    = v.ySize - 1;
            border = 1; // top
        } else if (v.y > 167) {
            v.y    = 167;
            border = 3; // bottom edge
        } else if (!(v.flags & O.HORIZONIGNORE) && state.horizon >= v.y) {
            v.y    = state.horizon + 1;
            border = 1; // horizon
        }

        if (objChkContact(v) || !objChkControl(v)) {
            v.x    = xOrig;
            v.y    = yOrig;
            border = 0;
            objPosShuffle(v);
        }

        if (border !== 0) {
            if (v.num === 0) {
                state.variables[VAR.ego_edge_code] = border;
            } else {
                state.variables[VAR.object_touching_edge] = v.num;
                state.variables[VAR.object_edge_code]     = border;
            }
            if (v.motion === MT.MOVE) objMoveStop(v);
        }

        v.flags &= ~O.REPOS;
    }
}

/** NAGI view/obj_motion.c: obj_move_update() @param {AgiObject} v */
function objMoveUpdate(v) {
    v.direction = move16ed(v.x, v.y, moveX(v), moveY(v), v.stepSize);
    if (v.num === 0) state.variables[VAR.ego_dir] = v.direction;
    if (v.direction === 0) objMoveStop(v);
}

/** NAGI view/obj_motion.c: obj_move_stop() @param {AgiObject} v */
function objMoveStop(v) {
    v.stepSize = v.u[4];
    if (v.motion !== MT.EGO) setFlag(v.u[5]);
    v.motion = MT.NORM;
    if (v.num === 0) {
        state.programControl               = false;
        state.variables[VAR.ego_dir] = 0;
    }
}

/** NAGI view/obj_motion.c: get_rand_dir() */
const getRandDir = () => agiRand() % 9;

/** NAGI view/obj_motion.c: obj_wander_update() @param {AgiObject} v */
function objWanderUpdate(v) {
    const count = v.u[0];
    v.u[0] = (count - 1) & 0xFF;

    if (count === 0 || (v.flags & O.MOTIONLESS)) {
        v.direction = getRandDir();
        if (v.num === 0) state.variables[VAR.ego_dir] = v.direction;
        while (v.u[0] < 6) v.u[0] = agiRand() % 0x33;
    }
}

/** NAGI view/obj_motion.c: obj_follow_update() @param {AgiObject} v */
function objFollowUpdate(v) {
    const e     = ego();
    const egoX  = e.x + Math.trunc(e.xSize / 2);
    const viewX = v.x + Math.trunc(v.xSize / 2);
    const dirNew = move16ed(viewX, v.y, egoX, e.y, v.u[0]);

    if (dirNew === 0) {
        v.direction = 0;
        v.motion    = MT.NORM;
        setFlag(v.u[1]);
        return;
    }

    if (v.u[2] !== 0xFF && (v.flags & O.MOTIONLESS)) {
        do {
            v.direction = getRandDir();
        } while (v.direction === 0);

        const dist = ((Math.abs(v.y - e.y) + Math.abs(viewX - egoX)) >> 1) + 1;
        if (dist <= v.stepSize) {
            v.u[2] = v.stepSize;
        } else {
            do {
                v.u[2] = agiRand() % 8;
            } while (v.u[2] < v.stepSize);
        }
    } else {
        if (v.u[2] === 0xFF) v.u[2] = 0;
        if (v.u[2] !== 0) {
            v.u[2] = v.u[2] > v.stepSize ? v.u[2] - v.stepSize : 0;
        } else {
            v.direction = dirNew;
        }
    }
}

// --- Cel cycling (NAGI view/obj_loop.c) -------------------------------------------------

/** NAGI view/obj_loop.c: obj_loop_update() @param {AgiObject} v */
function objLoopUpdate(v) {
    if (v.flags & O.SKIPUPDATE) {
        v.flags &= ~O.SKIPUPDATE;
        return;
    }

    let c     = v.cel;
    const max = v.celTotal - 1;

    switch (v.cycle) {
        case CY.NORM:
            c++;
            if (c > max) c = 0;
            break;
        case CY.END:
            if (c < max) {
                c++;
                if (c !== max) break;
            }
            setFlag(v.u[0]);
            v.flags &= ~O.CYCLE;
            v.direction = 0;
            v.cycle     = CY.NORM;
            break;
        case CY.REVEND:
            if (c !== 0) {
                c--;
                if (c !== 0) break;
            }
            setFlag(v.u[0]);
            v.flags &= ~O.CYCLE;
            v.direction = 0;
            v.cycle     = CY.NORM;
            break;
        case CY.REV:
            c = c !== 0 ? c - 1 : max;
            break;
    }

    objCelSet(v, c);
}

// --- The per-cycle update (NAGI view/obj_base.c: objtable_update) -----------------------

const RIGHT = 0, LEFT = 1, DOWN = 2, UP = 3, IGNORE = 4;
const LOOP_SMALL = [IGNORE, IGNORE, RIGHT, RIGHT, RIGHT, IGNORE, LEFT, LEFT, LEFT, RIGHT];
const LOOP_LARGE = [IGNORE, UP, RIGHT, RIGHT, RIGHT, DOWN, LEFT, LEFT, LEFT, RIGHT];

/**
 * Once per cycle, after logic 0: picks each moving object's loop from its direction,
 * advances cels, moves objects, and redraws them.
 * Views with more than 4 loops don't change loop by themselves (AGI v2, NAGI's L_FOUR).
 * NAGI view/obj_base.c: objtable_update()
 */
export function objtableUpdate() {
    let touched = 0;

    for (const v of objects()) {
        if (!isUpdated(v)) continue;
        touched++;

        let newLoop = IGNORE;
        if (!(v.flags & O.LOOPFIXED)) {
            if (v.loopTotal === 2 || v.loopTotal === 3) newLoop = LOOP_SMALL[v.direction];
            else if (v.loopTotal === 4) newLoop = LOOP_LARGE[v.direction];
        }
        if (v.stepCount === 1 && newLoop !== IGNORE && v.loop !== newLoop) {
            objLoopSet(v, newLoop);
        }

        if ((v.flags & O.CYCLE) && v.cycleCount !== 0) {
            v.cycleCount--;
            if (v.cycleCount === 0) {
                objLoopUpdate(v);
                v.cycleCount = v.cycleTime;
            }
        }
    }

    if (touched) {
        blitlistErase(updatedList);
        objsStepUpdate();
        updatedList = blitlistBuild(isUpdated);
        blitlistDraw(updatedList);
        blitlistUpdate(updatedList);
        ego().flags &= ~(O.LAND | O.WATER);
    }
}

// --- Drawing and erasing single objects (NAGI view/obj_drawerase.c, view/obj_update.c) --

/** NAGI view/obj_drawerase.c: obj_draw() @param {number} num */
export function objDraw(num) {
    const v = objects()[num];
    if (!v.hasView) agiError(0x14, num);

    if (!(v.flags & O.DRAWN)) {
        v.flags |= O.UPDATE;
        objPosShuffle(v);
        v.celPrevHeight = v.ySize;
        v.celPrevWidth  = v.xSize;
        v.xPrev = v.x;
        v.yPrev = v.y;
        blitlistErase(updatedList);
        v.flags |= O.DRAWN;
        updatedList = blitlistBuild(isUpdated);
        blitlistDraw(updatedList);
        objCelUpdate(v);
        v.flags &= ~O.SKIPUPDATE;
    }
}

/** NAGI view/obj_drawerase.c: obj_erase() @param {number} num */
function objErase(num) {
    const v = objects()[num];
    if (!(v.flags & O.DRAWN)) return;

    blitlistErase(updatedList);
    const wasStatic = !(v.flags & O.UPDATE);
    if (wasStatic) blitlistErase(staticList);

    v.flags &= ~O.DRAWN;

    if (wasStatic) {
        staticList = blitlistBuild(isStatic);
        blitlistDraw(staticList);
    }
    updatedList = blitlistBuild(isUpdated);
    blitlistDraw(updatedList);
    objCelUpdate(v);
}

/** NAGI view/obj_update.c: obj_stop_update() @param {AgiObject} v */
function objStopUpdate(v) {
    if (v.flags & O.UPDATE) {
        blistsErase();
        v.flags &= ~O.UPDATE;
        blistsDraw();
    }
}

/** NAGI view/obj_update.c: obj_start_update() @param {AgiObject} v */
function objStartUpdate(v) {
    if (!(v.flags & O.UPDATE)) {
        blistsErase();
        v.flags |= O.UPDATE;
        blistsDraw();
    }
}

/**
 * Resets every object for a new room (part of NAGI new_room.c: new_room()).
 */
export function objectsNewRoom() {
    for (const v of objects()) {
        v.flags &= ~(O.ANIMATE | O.DRAWN);
        v.flags |= O.UPDATE;
        v.hasView    = false;
        v.stepTime   = 1;
        v.stepCount  = 1;
        v.cycleCount = 1;
        v.cycleTime  = 1;
        v.stepSize   = 1;
    }

    const e = ego();
    if (e.motion === MT.EGO) {
        e.motion = MT.NORM;
        state.variables[VAR.ego_dir] = 0;
    }
}

// --- add.to.pic (NAGI picture/pic_add.c, view/obj_picbuff.c) ----------------------------

/** The temporary object used to add a cel to the picture (NAGI's view_pic_add). */
const picAdd = newObject(0);

/**
 * Draws the cel into the picture with its priority, plus a box in the margin priority at
 * its feet (as high as its priority band) so ego can't walk through it.
 * NAGI view/obj_picbuff.c: obj_add_pic_pri()
 * @param {AgiObject} v
 */
function objAddPicPri(v) {
    if ((v.priority & 0x0F) === 0) v.priority |= priTable[v.y];
    objBlit(v);

    if (v.priority > 0x3F) return;

    let cy        = v.y;
    let priHeight = 0;
    do {
        priHeight++;
        if (cy <= 0) break;
        cy--;
    } while (priTable[cy] === priTable[v.y]);

    const height = Math.min(v.ySize, priHeight);
    const margin = v.priority & 0xF0;
    const pb     = state.picBuffer;
    const base   = v.y * PIC_WIDTH + v.x;

    for (let i = 0; i < v.xSize; i++) pb[base + i] = (pb[base + i] & 0x0F) | margin;

    if (height > 1) {
        let p = base;
        const side = v.xSize - 1;
        for (let n = height - 1; n > 0; n--) {
            p -= PIC_WIDTH;
            pb[p] = (pb[p] & 0x0F) | margin;
            pb[p + side] = (pb[p + side] & 0x0F) | margin;
        }
        for (let n = v.xSize - 2; n > 0; n--) {
            p++;
            pb[p] = (pb[p] & 0x0F) | margin;
        }
    }
}

/**
 * NAGI picture/pic_add.c: add_to_pic()
 * @param {number} viewNo @param {number} loopNo @param {number} celNo
 * @param {number} x @param {number} y @param {number} pri priority | margin << 4
 */
export function addToPic(viewNo, loopNo, celNo, x, y, pri) {
    scriptWrite(SCRIPT.ADD_TO_PIC, 0);
    scriptWrite(viewNo, loopNo);
    scriptWrite(celNo, x);
    scriptWrite(y, pri);

    const v = picAdd;
    objViewSet(v, viewNo);
    objLoopSet(v, loopNo);
    objCelSet(v, celNo);

    v.celPrevHeight = v.ySize;
    v.celPrevWidth  = v.xSize;
    v.xPrev = v.x = x;
    v.yPrev = v.y = y;
    v.flags    = O.OBJIGNORE | O.HORIZONIGNORE | O.PRIFIXED;
    v.priority = 0x0F;
    objPosShuffle(v);
    if ((pri & 0x0F) === 0) v.flags = 0;
    v.priority = pri;

    blistsErase();
    objAddPicPri(v);
    blistsDraw();
    objCelUpdate(v);
}

/**
 * show.obj: draws loop 0, cel 0 of a (loaded) view at the bottom centre of the picture,
 * in front of everything, saving what was there. Returns a function that puts the picture
 * back.
 * NAGI obj_show.c: obj_show()
 * @param {number} viewNo
 * @returns {() => void}
 */
export function objShowDraw(viewNo) {
    const v = newObject(0xFF);
    objViewSet(v, viewNo);

    v.celPrevHeight = v.ySize;
    v.celPrevWidth  = v.xSize;
    v.xPrev = v.x   = Math.trunc((159 - v.xSize) / 2);
    v.yPrev = v.y   = 167;
    v.priority = 0x0F;
    v.flags   |= O.PRIFIXED;

    const bgArea = blitNew(v);
    blitSave(bgArea);
    objBlit(v);
    objCelUpdate(v);

    return () => {
        blitRestore(bgArea);
        objCelUpdate(v);
    };
}

// --- Commands ---------------------------------------------------------------------------

/** @param {number} n */
const obj = n => objects()[n];
/** @param {number} n */
const varOf = n => state.variables[n];

/**
 * The logic commands for objects, merged into `commands` in logicCommands.js. Parameter
 * counts match NAGI's command table (checked at start-up).
 */
export const objectCommands = {
    // NAGI view/obj_base.c: cmd_animate_obj(), obj_animate()
    agi_animate_obj: (/** @type {number} */ n) => {
        const v = obj(n);
        if (!v) agiError(0x0D, n);
        if (!(v.flags & O.ANIMATE)) {
            v.flags     = O.UPDATE | O.CYCLE | O.ANIMATE;
            v.motion    = MT.NORM;
            v.cycle     = CY.NORM;
            v.direction = 0;
        }
    },

    // NAGI view/obj_base.c: cmd_unanimate_all()
    agi_unanimate_all: () => {
        blistsErase();
        for (const v of objects()) v.flags &= ~(O.ANIMATE | O.DRAWN);
    },

    // NAGI view/obj_drawerase.c
    agi_draw:  (/** @type {number} */ n) => objDraw(n),
    agi_erase: (/** @type {number} */ n) => objErase(n),

    // NAGI view/view_base.c
    agi_set_view:   (/** @type {number} */ n, /** @type {number} */ viewNo) => objViewSet(obj(n), viewNo),
    agi_set_view_v: (/** @type {number} */ n, /** @type {number} */ varNo) => objViewSet(obj(n), varOf(varNo)),
    agi_set_loop:   (/** @type {number} */ n, /** @type {number} */ loopNo) => objLoopSet(obj(n), loopNo),
    agi_set_loop_v: (/** @type {number} */ n, /** @type {number} */ varNo) => objLoopSet(obj(n), varOf(varNo)),
    agi_set_cel: (/** @type {number} */ n, /** @type {number} */ celNo) => {
        objCelSet(obj(n), celNo);
        obj(n).flags &= ~O.SKIPUPDATE;
    },
    agi_set_cel_v: (/** @type {number} */ n, /** @type {number} */ varNo) => {
        objCelSet(obj(n), varOf(varNo));
        obj(n).flags &= ~O.SKIPUPDATE;
    },
    agi_last_cel: (/** @type {number} */ n, /** @type {number} */ varNo) => {
        state.variables[varNo] = obj(n).celTotal - 1;
    },
    agi_current_cel:  (/** @type {number} */ n, /** @type {number} */ varNo) => { state.variables[varNo] = obj(n).cel; },
    agi_current_loop: (/** @type {number} */ n, /** @type {number} */ varNo) => { state.variables[varNo] = obj(n).loop; },
    agi_current_view: (/** @type {number} */ n, /** @type {number} */ varNo) => { state.variables[varNo] = obj(n).viewNo; },
    agi_number_of_loops: (/** @type {number} */ n, /** @type {number} */ varNo) => { state.variables[varNo] = obj(n).loopTotal; },

    // NAGI view/obj_loop.c
    agi_fix_loop:     (/** @type {number} */ n) => { obj(n).flags |= O.LOOPFIXED; },
    agi_release_loop: (/** @type {number} */ n) => { obj(n).flags &= ~O.LOOPFIXED; },

    // NAGI view/obj_cycle.c
    agi_normal_cycle: (/** @type {number} */ n) => {
        obj(n).cycle = CY.NORM;
        obj(n).flags |= O.CYCLE;
    },
    agi_end_of_loop: (/** @type {number} */ n, /** @type {number} */ flagNo) => {
        const v = obj(n);
        v.cycle = CY.END;
        v.flags |= O.UPDATE | O.CYCLE | O.SKIPUPDATE;
        v.u[0] = flagNo;
        resetFlag(flagNo);
    },
    agi_reverse_cycle: (/** @type {number} */ n) => {
        obj(n).cycle = CY.REV;
        obj(n).flags |= O.CYCLE;
    },
    agi_reverse_loop: (/** @type {number} */ n, /** @type {number} */ flagNo) => {
        const v = obj(n);
        v.cycle = CY.REVEND;
        v.flags |= O.UPDATE | O.CYCLE | O.SKIPUPDATE;
        v.u[0] = flagNo;
        resetFlag(flagNo);
    },
    agi_cycle_time: (/** @type {number} */ n, /** @type {number} */ varNo) => {
        obj(n).cycleTime  = varOf(varNo);
        obj(n).cycleCount = varOf(varNo);
    },
    agi_stop_cycling:  (/** @type {number} */ n) => { obj(n).flags &= ~O.CYCLE; },
    agi_start_cycling: (/** @type {number} */ n) => { obj(n).flags |= O.CYCLE; },

    // NAGI view/obj_motion_cmd.c
    agi_move_obj: (/** @type {number} */ n, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ stepSize, /** @type {number} */ flagNo) => {
        moveObj(obj(n), x, y, stepSize, flagNo);
    },
    agi_move_obj_v: (/** @type {number} */ n, /** @type {number} */ varX, /** @type {number} */ varY, /** @type {number} */ varStep, /** @type {number} */ flagNo) => {
        moveObj(obj(n), varOf(varX), varOf(varY), varOf(varStep), flagNo);
    },
    agi_follow_ego: (/** @type {number} */ n, /** @type {number} */ stepSize, /** @type {number} */ flagNo) => {
        const v = obj(n);
        v.motion = MT.FOLLOW;
        v.u[0]   = stepSize <= v.stepSize ? v.stepSize : stepSize;
        v.u[1]   = flagNo;
        resetFlag(flagNo);
        v.u[2]   = 0xFF;
        v.flags |= O.UPDATE;
    },
    agi_wander: (/** @type {number} */ n) => {
        const v = obj(n);
        if (v.num === 0) state.programControl = true;
        v.motion = MT.WANDER;
        v.flags |= O.UPDATE;
    },
    agi_normal_motion: (/** @type {number} */ n) => { obj(n).motion = MT.NORM; },
    agi_stop_motion: (/** @type {number} */ n) => {
        const v = obj(n);
        v.direction = 0;
        v.motion    = MT.NORM;
        if (v.num === 0) {
            state.variables[VAR.ego_dir] = 0;
            state.programControl = true;
        }
    },
    agi_start_motion: (/** @type {number} */ n) => {
        const v = obj(n);
        v.motion = MT.NORM;
        if (v.num === 0) {
            state.variables[VAR.ego_dir] = 0;
            state.programControl = false;
        }
    },
    agi_step_size: (/** @type {number} */ n, /** @type {number} */ varNo) => { obj(n).stepSize = varOf(varNo); },
    agi_step_time: (/** @type {number} */ n, /** @type {number} */ varNo) => {
        obj(n).stepCount = varOf(varNo);
        obj(n).stepTime  = varOf(varNo);
    },
    agi_set_dir: (/** @type {number} */ n, /** @type {number} */ varNo) => { obj(n).direction = varOf(varNo); },
    agi_get_dir: (/** @type {number} */ n, /** @type {number} */ varNo) => { state.variables[varNo] = obj(n).direction; },
    agi_program_control: () => { state.programControl = true; },
    agi_player_control: () => {
        state.programControl = false;
        if (ego().motion !== MT.EGO) ego().motion = MT.NORM;
    },

    // NAGI view/obj_position.c
    agi_position: (/** @type {number} */ n, /** @type {number} */ x, /** @type {number} */ y) => {
        const v = obj(n);
        v.x = v.xPrev = x;
        v.y = v.yPrev = y;
    },
    agi_position_v: (/** @type {number} */ n, /** @type {number} */ varX, /** @type {number} */ varY) => {
        const v = obj(n);
        v.x = v.xPrev = varOf(varX);
        v.y = v.yPrev = varOf(varY);
    },
    agi_get_posn: (/** @type {number} */ n, /** @type {number} */ varX, /** @type {number} */ varY) => {
        state.variables[varX] = obj(n).x;
        state.variables[varY] = obj(n).y;
    },
    agi_reposition: (/** @type {number} */ n, /** @type {number} */ varDX, /** @type {number} */ varDY) => {
        const v = obj(n);
        v.flags |= O.REPOS;
        const dx = (varOf(varDX) << 24) >> 24; // signed byte
        v.x = dx < 0 && v.x < -dx ? 0 : v.x + dx;
        const dy = (varOf(varDY) << 24) >> 24;
        v.y = dy < 0 && v.y < -dy ? 0 : v.y + dy;
        objPosShuffle(v);
    },
    agi_reposition_to: (/** @type {number} */ n, /** @type {number} */ x, /** @type {number} */ y) => {
        const v = obj(n);
        v.x = x;
        v.y = y;
        v.flags |= O.REPOS;
        objPosShuffle(v);
    },
    agi_reposition_to_v: (/** @type {number} */ n, /** @type {number} */ varX, /** @type {number} */ varY) => {
        const v = obj(n);
        v.x = varOf(varX);
        v.y = varOf(varY);
        v.flags |= O.REPOS;
        objPosShuffle(v);
    },
    agi_object_on_water:    (/** @type {number} */ n) => { obj(n).flags |= O.WATER; },
    agi_object_on_land:     (/** @type {number} */ n) => { obj(n).flags |= O.LAND; },
    agi_object_on_anything: (/** @type {number} */ n) => { obj(n).flags &= ~(O.LAND | O.WATER); },
    agi_set_horizon:     (/** @type {number} */ y) => { state.horizon = y; },
    agi_ignore_horizon:  (/** @type {number} */ n) => { obj(n).flags |= O.HORIZONIGNORE; },
    agi_observe_horizon: (/** @type {number} */ n) => { obj(n).flags &= ~O.HORIZONIGNORE; },

    // NAGI view/obj_priority.c
    agi_set_priority: (/** @type {number} */ n, /** @type {number} */ pri) => {
        obj(n).flags |= O.PRIFIXED;
        obj(n).priority = pri;
    },
    agi_set_priority_v: (/** @type {number} */ n, /** @type {number} */ varNo) => {
        obj(n).flags |= O.PRIFIXED;
        obj(n).priority = varOf(varNo);
    },
    agi_release_priority: (/** @type {number} */ n) => { obj(n).flags &= ~O.PRIFIXED; },
    agi_get_priority: (/** @type {number} */ n, /** @type {number} */ varNo) => { state.variables[varNo] = obj(n).priority; },

    // NAGI view/obj_proximity.c
    agi_ignore_objs:  (/** @type {number} */ n) => { obj(n).flags |= O.OBJIGNORE; },
    agi_observe_objs: (/** @type {number} */ n) => { obj(n).flags &= ~O.OBJIGNORE; },
    agi_distance: (/** @type {number} */ n1, /** @type {number} */ n2, /** @type {number} */ varNo) => {
        const a = obj(n1);
        const b = obj(n2);
        if (!(a.flags & O.DRAWN) || !(b.flags & O.DRAWN)) {
            state.variables[varNo] = 255;
        } else {
            const d = Math.abs(a.y - b.y) +
                Math.abs(a.x + Math.trunc(a.xSize / 2) - b.x - Math.trunc(b.xSize / 2));
            state.variables[varNo] = d > 0xFE ? 0xFE : d;
        }
    },

    // NAGI view/obj_block.c
    agi_block: (/** @type {number} */ x1, /** @type {number} */ y1, /** @type {number} */ x2, /** @type {number} */ y2) => {
        state.blockState = true;
        state.blockX1 = x1;
        state.blockY1 = y1;
        state.blockX2 = x2;
        state.blockY2 = y2;
    },
    agi_unblock: () => { state.blockState = false; },
    agi_ignore_blocks:  (/** @type {number} */ n) => { obj(n).flags |= O.BLOCKIGNORE; },
    agi_observe_blocks: (/** @type {number} */ n) => { obj(n).flags &= ~O.BLOCKIGNORE; },

    // NAGI view/obj_update.c
    agi_stop_update:  (/** @type {number} */ n) => objStopUpdate(obj(n)),
    agi_start_update: (/** @type {number} */ n) => objStartUpdate(obj(n)),
    // AGI 2.917 and later redraw every object, not just this one.
    agi_force_update: (/** @type {number} */ n) => {
        blistsErase();
        blistsDraw();
        blistsUpdate();
    },

    // NAGI picture/pic_add.c
    agi_add_to_pic: (/** @type {number} */ viewNo, /** @type {number} */ loopNo, /** @type {number} */ celNo, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ pri, /** @type {number} */ margin) => {
        addToPic(viewNo, loopNo, celNo, x, y, (pri | (margin << 4)) & 0xFF);
    },
    agi_add_to_pic_v: (/** @type {number} */ v1, /** @type {number} */ v2, /** @type {number} */ v3, /** @type {number} */ v4, /** @type {number} */ v5, /** @type {number} */ v6, /** @type {number} */ v7) => {
        addToPic(varOf(v1), varOf(v2), varOf(v3), varOf(v4), varOf(v5), (varOf(v6) | (varOf(v7) << 4)) & 0xFF);
    },

    // NAGI view/obj_base.c: cmd_unknown_174 (set.pri.base). Changes the priority bands.
    agi_set_pri_base: (/** @type {number} */ base) => {
        priorityOrig = false;
        for (let y = 0; y < 0xA8; y++) {
            const d = y - base;
            priTable[y] = d >= 0 ? Math.min(0x0F, Math.trunc((d * 0x0A) / (0xA8 - base)) + 5) : 4;
        }
    },

    // Tests (NAGI logic/logic_eval.c)
    agi_test_posn: (/** @type {number} */ n, /** @type {number} */ x1, /** @type {number} */ y1, /** @type {number} */ x2, /** @type {number} */ y2) => {
        const v = obj(n);
        return isInside(v.x, v.x, v.y, x1, y1, x2, y2);
    },
    agi_test_center_posn: (/** @type {number} */ n, /** @type {number} */ x1, /** @type {number} */ y1, /** @type {number} */ x2, /** @type {number} */ y2) => {
        const v = obj(n);
        const c = v.x + Math.trunc(v.xSize / 2);
        return isInside(c, c, v.y, x1, y1, x2, y2);
    },
    agi_test_right_posn: (/** @type {number} */ n, /** @type {number} */ x1, /** @type {number} */ y1, /** @type {number} */ x2, /** @type {number} */ y2) => {
        const v = obj(n);
        const r = v.x + v.xSize - 1;
        return isInside(r, r, v.y, x1, y1, x2, y2);
    },
    agi_test_obj_in_box: (/** @type {number} */ n, /** @type {number} */ x1, /** @type {number} */ y1, /** @type {number} */ x2, /** @type {number} */ y2) => {
        const v = obj(n);
        return isInside(v.x, v.x + v.xSize - 1, v.y, x1, y1, x2, y2);
    },
};

/**
 * NAGI logic/logic_eval.c: is_obj_inside()
 * @param {number} left @param {number} right @param {number} y
 * @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
 */
function isInside(left, right, y, x1, y1, x2, y2) {
    return !(left < x1 || y < y1 || right > x2 || y > y2);
}

/**
 * NAGI view/obj_motion_cmd.c: cmd_move_obj(), cmd_move_obj_v()
 * @param {AgiObject} v @param {number} x @param {number} y @param {number} stepSize @param {number} flagNo
 */
function moveObj(v, x, y, stepSize, flagNo) {
    v.motion = MT.MOVE;
    setMoveX(v, x);
    setMoveY(v, y);
    v.u[4] = v.stepSize;
    if (stepSize !== 0) v.stepSize = stepSize;
    v.u[5] = flagNo;
    resetFlag(flagNo);
    v.flags |= O.UPDATE;
    if (v.num === 0) state.programControl = true;
    objMoveUpdate(v);
}

/** For the debug panel and hashes: the drawing lists' sizes. */
export const blitListSizes = () => [updatedList.length, staticList.length];
