// @ts-check
// Portions ported from NAGI (c) 2001-2002 Nick Sonneveld, X11 license, see licenses/NAGI-LICENSE.txt
// (state_io.c, state_info.c)

/**
 * save.game, restore.game and restart.game.
 *
 * The dialogs are NAGI's: the directory to save in, a list of 12 slots (or of the saved
 * games, to restore), a description, and a last "About to save/restore" confirmation.
 * There are no disks or directories in a browser: saved games go to localStorage, and the
 * "directory" the player types (by default the game's folder name) just names a separate
 * set of 12 slots. A slot's "file" is named as NAGI names it: <dir>\<game id>sg.<n>.
 *
 * What is saved is what NAGI saves: the interpreter state (variables, flags, strings,
 * controller keys, horizon, block, text settings, ...), the object table, where each
 * inventory item is, the script and the logics' scan starts. The picture isn't saved: a
 * restore replays the script (the room's loads and drawing) to rebuild it.
 *
 * Reading saved games goes through the recorder, so replays get the same saved games.
 */

import {FLAG, RESTART_LOGIC_0, VAR} from './constants';
import {state} from './state';
import {clockPause, clockResume} from './clock';
import {isReplaying, recordValue} from './recorder';
import {closeWindow, messageBox, messageBoxDraw, msgState} from './msg';
import {gotoRowCol, pushRowCol, popRowCol, textAttribPop, textAttribPush, textColour, agiPrintf, windowClear, windowPutChar} from './text';
import {stringEdit} from './agiString';
import {cancelLine, inputEditOff, inputEditOn, inputEditStatus, inputRedraw} from './input';
import {statusLineWrite} from './status';
import {eventWait, userBooleanPoll} from './wait';
import {EVENT_DIRECTION, EVENT_KEY} from './events';
import {scriptAllow, scriptBlock} from './script';
import {addToPic, blistsErase, MT, O, objDraw, objViewSet, renderUpdate} from './objects';
import {
    loadLogic, picDiscard, picDraw, picLoad, picOverlay, soundLoad, stopSound, viewDiscard, viewLoad,
} from './logicCommands';

const STORAGE_PREFIX = 'agi-save:';
const SLOTS = 12;

/** The "directory" saved games go in. NAGI state_info.c: save_dir */
let saveDir = '';
/** The description of the game being saved or restored. NAGI state_info.c: save_description */
let saveDescription = '';
/** A name set with set.simple: save and restore without asking. NAGI state_io.c: state_name_auto */
let stateNameAuto = '';
/** NAGI state_info.c: diskspace_available (true until the first slot list) */
let diskspaceAvailable = true;

/**
 * @typedef {object} SaveSlot
 * @property {number} num   slot number, 1-12
 * @property {string} diz   description ('' if the slot is empty or another game's)
 * @property {number} date  when it was saved (ms), 0 if empty
 */

/**
 * set.simple: save and restore under this name without the dialogs.
 * NAGI state_io.c: cmd_unknown_170()
 * @param {number} strNo
 */
export function setSimple(strNo) {
    stateNameAuto = (state.strings[strNo] ?? '').slice(0, 31);
}

// ---- storage ----

/** The game's folder name, the default "directory". */
const gameFolder = () => new URLSearchParams(location.search).get('game') || 'AGI';

/**
 * The file name of a slot. NAGI state_info.c: state_name_create()
 * @param {number} num
 */
function stateNameCreate(num) {
    const sep = /[\\/]$/.test(saveDir) ? '' : saveDir.includes('/') ? '/' : '\\';
    return `${saveDir}${sep}${state.gameId.toLowerCase()}sg.${num}`;
}

/** @param {string} fileName */
const storageKey = fileName => STORAGE_PREFIX + fileName.toLowerCase();

/**
 * The descriptions of the 12 slots in the save directory: '' for an empty slot or one
 * saved by another game (NAGI compares the game id).
 * NAGI state_info.c: state_get_diz()
 * @returns {SaveSlot[]}
 */
function readSlots() {
    return recordValue('saveSlots', () => {
        const slots = [];
        for (let num = 1; num <= SLOTS; num++) {
            let diz  = '';
            let date = 0;
            try {
                const save = JSON.parse(localStorage.getItem(storageKey(stateNameCreate(num))) ?? 'null');
                if (save && save.id === state.gameId) {
                    diz  = save.description;
                    date = save.date;
                }
            } catch { /* no storage, or not a saved game */ }
            slots.push({num, diz, date});
        }
        return slots;
    });
}

/**
 * @param {string} fileName
 * @returns {any|null} the saved game, or null if there is none
 */
function readSave(fileName) {
    return recordValue('restore', () => {
        try {
            return JSON.parse(localStorage.getItem(storageKey(fileName)) ?? 'null');
        } catch {
            return null;
        }
    });
}

/**
 * @param {string} fileName @param {any} save
 * @returns {boolean} false if it couldn't be stored
 */
function writeSave(fileName, save) {
    if (isReplaying()) return true; // a replay doesn't overwrite the player's saved games
    try {
        localStorage.setItem(storageKey(fileName), JSON.stringify(save));
        return true;
    } catch {
        return false;
    }
}

// ---- the dialogs (NAGI state_info.c) ----

/**
 * Asks for a line of text in a message window 31 columns wide; `str` is the text to
 * start from. Returns the text, or null for Esc.
 * NAGI state_info.c: state_get_text()
 * @param {string} msg @param {string} str @param {number} size most characters + 1
 * @returns {Generator<void, string|null, void>}
 */
function* stateGetText(msg, str, size) {
    messageBoxDraw(msg, 0, 0x1F, true);
    gotoRowCol(msgState.tposEdge.row, msgState.tpos.col);
    windowClear(msgState.tposEdge.row, msgState.tpos.col, msgState.tposEdge.row, msgState.tposEdge.col - 1, 0);
    textAttribPush();
    textColour(0x0F, 0);

    const {key, text} = yield* stringEdit(str, size, 0x1F);

    textAttribPop();
    closeWindow();
    return key === 0x0D ? text : null;
}

/**
 * Asks for the directory to save in or restore from. Every directory exists here; an
 * empty one is the default.
 * NAGI state_info.c: state_get_path(), state_dir_check()
 * @param {'s'|'r'} type
 * @returns {Generator<void, boolean, void>}
 */
function* stateGetPath(type) {
    if (!saveDir) saveDir = gameFolder();
    if (stateNameAuto) return true;

    const msg = type === 's'
        ? '         SAVE GAME\n\nOn which disk or in which directory do you wish to save this game?\n\n(For example, "B:" or "C:\\savegame")\n\n'
        : '        RESTORE GAME\n\nOn which disk or in which directory is the game that you want to restore?\n\n(For example, "B:" or "C:\\savegame")\n\n';

    const dir = yield* stateGetText(msg, saveDir, 200);
    if (dir === null) return false;

    saveDir = dir.replace(/^ +/, '') || gameFolder();
    if (saveDir.length > 1 && /[\\/]$/.test(saveDir)) saveDir = saveDir.slice(0, -1);
    if (/^.:$/.test(saveDir)) saveDir += '\\';
    return true;
}

/**
 * Lets the player choose a slot (save: all 12; restore: the saved games) with the arrow
 * keys. Returns the slot number, or 0 for Esc or when there's nothing to restore.
 * NAGI state_info.c: state_get_filename(), state_draw_arrow(), state_draw_blank()
 * @param {'s'|'r'} type
 * @returns {Generator<void, number, void>}
 */
function* stateGetFilename(type) {
    const all   = readSlots();
    const slots = type === 's' ? all : all.filter(s => s.date !== 0);

    // The most recent one is selected first.
    let newest = 0;
    let newestDate = 0;
    slots.forEach((s, i) => {
        if (s.date > newestDate) {
            newestDate = s.date;
            newest     = i;
        }
    });

    if (slots.length === 0 && !stateNameAuto) {
        yield* messageBox(`There are no games to\nrestore in\n\n ${saveDir}\n\nPress ENTER to continue.`);
        return 0;
    }

    if (stateNameAuto && !diskspaceAvailable) {
        saveDescription = stateNameAuto;
        const named = slots.find(s => s.diz === stateNameAuto);
        if (named) return named.num;
        if (type === 's') {
            const empty = slots.find(s => s.diz === '');
            if (empty) return empty.num;
        }
        if (type === 'r') return 0;
    }

    const height = 5 + slots.length;
    if (!stateNameAuto) {
        messageBoxDraw(type === 's'
            ? 'Use the arrow keys to select the slot in which you wish to save the game. Press ENTER to save in the slot, ESC to not save a game.'
            : 'Use the arrow keys to select the game which you wish to restore. Press ENTER to restore the game, ESC to not restore a game.',
        height, 0x22, true);
    } else if (!diskspaceAvailable) {
        messageBoxDraw('   Sorry, this disk is full.\nPosition pointer and press ENTER\n    to overwrite a saved game\nor press ESC and try again \n    with another disk\n', height, 0x22, true);
    } else {
        messageBoxDraw('Use the arrow keys to move\n     the pointer to your name.\nThen press ENTER\n', height, 0x22, true);
    }

    const top = 5 + msgState.tpos.row;
    diskspaceAvailable = false;

    slots.forEach((s, i) => {
        gotoRowCol(top + i, msgState.tpos.col);
        agiPrintf(` - ${s.diz}`);
    });

    /** @param {number} i @param {string} ch */
    const mark = (i, ch) => {
        gotoRowCol(top + i, msgState.tpos.col);
        windowPutChar(ch);
    };

    let current = newest;
    mark(current, '\x1A'); // the font's right arrow
    for (;;) {
        const event = yield* eventWait();
        if (event.type === EVENT_KEY) {
            if (event.data === 0x0D) {
                if (!stateNameAuto) {
                    saveDescription = slots[current].diz;
                } else if (type === 'r') {
                    stateNameAuto = slots[current].diz;
                }
                closeWindow();
                return slots[current].num;
            }
            if (event.data === 0x1B) {
                closeWindow();
                return 0;
            }
        } else if (event.type === EVENT_DIRECTION) {
            mark(current, ' ');
            if (event.data === 1) current = current === 0 ? slots.length - 1 : current - 1;
            else if (event.data === 5) current = current === slots.length - 1 ? 0 : current + 1;
            mark(current, '\x1A');
        }
    }
}

/**
 * The save or restore dialogs, up to the confirmation. Returns the slot number, or 0 if
 * the player cancelled.
 * NAGI state_info.c: state_get_info()
 * @param {'s'|'r'} type
 * @returns {Generator<void, number, void>}
 */
function* stateGetInfo(type) {
    const editWasOff = inputEditStatus();
    inputEditOn();
    textAttribPush();
    pushRowCol();
    stopSound();
    textColour(0, 0x0F);

    let num = 0;
    if (yield* stateGetPath(type)) {
        num = yield* stateGetFilename(type);
        if (num !== 0 && type === 's' && !stateNameAuto) {
            const description = yield* stateGetText('How would you like to describe this saved game?\n\n', saveDescription, 0x20);
            if (description === null) {
                num = 0;
            } else {
                saveDescription = description;
            }
        }
    }

    popRowCol();
    textAttribPop();
    if (editWasOff) inputEditOff();
    return num;
}

/**
 * Shows the "About to save/restore" message and waits for Enter (true) or Esc (false).
 * @param {string} msg
 * @returns {Generator<void, boolean, void>}
 */
function* confirm(msg) {
    messageBoxDraw(msg, 0, 0x23, false);
    return (yield* userBooleanPoll()) === 1;
}

// ---- save.game and restore.game (NAGI state_io.c) ----

/**
 * save.game
 * NAGI state_io.c: cmd_save_game()
 * @returns {Generator<void, void, void>}
 */
export function* saveGame() {
    clockPause();
    const newlineOrig    = msgState.newlineChar;
    msgState.newlineChar = '@';

    const num = yield* stateGetInfo('s');
    if (num !== 0) {
        const fileName = stateNameCreate(num);
        const go = stateNameAuto
            || (yield* confirm(`About to save the game\ndescribed as:\n\n${saveDescription}\n\nin file:\n ${fileName}\n\nPress ENTER to continue.\nPress ESC to cancel.`));
        if (go && !writeSave(fileName, stateSave())) {
            yield* messageBox(`The directory\n   ${saveDir}\n is full or the disk is write-protected.\nPress ENTER to continue.`);
        }
    }

    closeWindow();
    msgState.newlineChar = newlineOrig;
    clockResume();
}

/**
 * restore.game. When a game is restored, logic 0 starts again from the top.
 * NAGI state_io.c: cmd_restore_game()
 * @returns {Generator<void, symbol|undefined, void>}
 */
export function* restoreGame() {
    clockPause();
    const newlineOrig    = msgState.newlineChar;
    msgState.newlineChar = '@';
    let result;

    const num = yield* stateGetInfo('r');
    if (num !== 0) {
        const fileName = stateNameCreate(num);
        const go = stateNameAuto
            || (yield* confirm(`About to restore the game\ndescribed as:\n\n${saveDescription}\n\nfrom file:\n ${fileName}\n\nPress ENTER to continue.\nPress ESC to cancel.`));
        if (go) {
            const save = readSave(fileName);
            if (!save) {
                yield* messageBox(`Can't open file:\n ${fileName}`);
            } else if (save.format !== 'agi-save' || save.version !== 1) {
                yield* messageBox('Error in restoring game.\nPress ENTER to quit.');
                state.hasQuit = true;
            } else {
                stateRestore(save);
                stateReload();
                state.controllers.fill(0);
                state.flags[FLAG.game_restored] = 1;
                // NAGI also enables every menu item here (menus are Phase 3's menu item).
                result = RESTART_LOGIC_0;
            }
        }
    }

    closeWindow();
    msgState.newlineChar = newlineOrig;
    clockResume();
    return result;
}

/** What a saved game holds. @returns {object} */
function stateSave() {
    const loaded = /** @type {any[]} */ (state.loadedLogics);
    return {
        format: 'agi-save', version: 1, id: state.gameId, description: saveDescription, date: Date.now(),
        // NAGI's AGI_STATE
        variables: Array.from(state.variables),
        flags: Array.from(state.flags),
        strings: state.strings.slice(),
        horizon: state.horizon,
        block: [state.blockState, state.blockX1, state.blockY1, state.blockX2, state.blockY2],
        programControl: state.programControl,
        scriptSize: state.scriptSize,
        scriptSaved: state.scriptSaved,
        keysForControllers: {...state.keysForControllers},
        text: [state.textFG, state.textBG, state.textComb],
        allowInput: state.allowInput,
        inputLinePos: state.inputLinePos,
        cursorChar: state.cursorChar,
        statusLineRow: state.statusLineRow,
        statusLineOn: state.statusLineOn,
        playTop: state.playTop,
        // the rest
        objects: state.gameObjects.map(o => ({...o, u: o.u.slice()})),
        items: Array.from(state.items),
        script: state.script.map(e => e.slice()),
        scanStarts: loaded.flatMap((l, no) => (l ? [[no, l.scanStart - l.entryPoint]] : [])),
    };
}

/** @type {Array<[number, number]>} scan starts of the restored game, for stateReload() */
let scanStarts = [];

/** Copies a saved game into the state. @param {any} save */
function stateRestore(save) {
    state.variables.set(save.variables);
    state.flags.set(save.flags);
    state.strings = save.strings.slice();
    state.horizon = save.horizon;
    [state.blockState, state.blockX1, state.blockY1, state.blockX2, state.blockY2] = save.block;
    state.programControl     = save.programControl;
    state.scriptSize         = save.scriptSize;
    state.scriptSaved        = save.scriptSaved;
    state.keysForControllers = {...save.keysForControllers};
    [state.textFG, state.textBG, state.textComb] = save.text;
    state.allowInput    = save.allowInput;
    state.inputLinePos  = save.inputLinePos;
    state.cursorChar    = save.cursorChar;
    state.statusLineRow = save.statusLineRow;
    state.statusLineOn  = save.statusLineOn;
    state.playTop       = save.playTop;

    save.objects.forEach((/** @type {any} */ o, /** @type {number} */ i) => {
        Object.assign(state.gameObjects[i], o, {u: o.u.slice()});
    });
    state.items.set(save.items);
    state.script = save.script.map((/** @type {number[]} */ e) => e.slice());
    scanStarts   = save.scanStarts;

    // NAGI sets these from the machine it runs on.
    state.variables[VAR.computer_type]  = 0; // IBM PC
    state.variables[VAR.video_mode]     = 3; // EGA (jsyang's value; see state.js)
    state.variables[VAR.free_memory]    = 10;
    state.variables[VAR.sound_channels] = 1; // PC speaker
}

/**
 * Rebuilds the room after a restore: discards the room's resources, replays the script
 * (with writing to it blocked) to load and draw them again, then redraws the objects that
 * were on screen and the picture, status line and input line.
 * NAGI state_io.c: state_reload()
 */
function stateReload() {
    stopSound();

    // NAGI initialise.c: room_init(): everything but logic 0 goes.
    const logic0 = /** @type {any[]} */ (state.loadedLogics)[0];
    state.loadedLogics = /** @type {any} */ ([logic0]);
    state.loadedViews  = [];
    state.loadedPics   = [];
    state.loadedSounds = [];
    scriptBlock();

    const oldFlags = state.gameObjects.map(v => v.flags);
    for (const v of state.gameObjects) {
        if (v.flags & O.ANIMATE) v.flags = (v.flags & ~O.DRAWN) | O.UPDATE;
    }

    blistsErase();
    state.picVisible = false;

    const script = state.script;
    for (let i = 0; i < script.length; i++) {
        const [type, n] = script[i];
        switch (type) {
            case 0: {
                loadLogic(n);
                const scan = scanStarts.find(([no]) => no === n);
                const logic = /** @type {any[]} */ (state.loadedLogics)[n];
                if (scan) logic.scanStart = logic.entryPoint + scan[1];
                break;
            }
            case 1: viewLoad(n); break;
            case 2: picLoad(n); break;
            case 3: soundLoad(n); break;
            case 4: picDraw(n); break;
            case 5: {
                const [view, loop] = script[++i];
                const [cel, x]     = script[++i];
                const [y, pri]     = script[++i];
                addToPic(view, loop, cel, x, y, pri);
                break;
            }
            case 6: picDiscard(n); break;
            case 7: viewDiscard(n); break;
            case 8: picOverlay(n); break;
        }
    }

    scriptAllow();

    state.gameObjects.forEach((v, num) => {
        if (state.loadedViews[v.viewNo]) objViewSet(v, v.viewNo);
        const flags = oldFlags[num];
        if (flags & O.ANIMATE) {
            if (flags & O.DRAWN) {
                objDraw(num);
                if (v.motion === MT.FOLLOW) v.u[2] = 0xFF; // follow.count
            }
            // NAGI then tests (flags & (O_DRAWN & O_ANIMATE)) == O_DRAWN, which is never
            // true, so obj_stop_update() is never called.
            v.flags = flags;
        }
    });

    inputEditOn();
    cancelLine();
    renderUpdate(0, 167, 160, 168);
    state.picVisible = true;
    statusLineWrite();
    inputRedraw();
}
