import {agiRand, randomBetween} from './rng';
import screen from './screen';
import Logic from './logic';
import {blistsDraw, blistsErase, objectCommands, objectsNewRoom, objShowDraw, renderUpdate} from './objects';
import {Pic} from './bitmap';
import {readAgiResource, wordGroups} from './resources';
import Sound from './sound';
import {View} from './view';
import {VAR, AGI_RESOURCE_TYPE, FLAG, RESTART_LOGIC_0} from './constants';
import {state, restart, updateSound} from './state';
import {restoreGame, saveGame, setSimple} from './persist';
import {charPoll, eventsClear, eventsEmpty, eventWrite, EVENT_CONTROLLER, EVENT_SOUND_DONE} from './events';
import {getNum, getString} from './agiString';
import {popScript, pushScript, SCRIPT, scriptAllow, scriptNew, scriptSize, scriptWrite} from './script';
import {closeWindow, display, logicMsg, messageBox, printAt, strWordwrap} from './msg';
import {clockPause, clockResume} from './clock';
import {cmdStatus, statusLineOff, statusLineOn, statusLineWrite} from './status';
import {calcTextBg, screenRedraw, textColour, textScreen, windowClear, windowPortionClear} from './text';
import {cancelLine, echoLine, inputClear, inputEditOff, inputEditOn, inputEditStatus, inputRedraw, parseText} from './input';
import {userBooleanPoll} from './wait';
import {debugInfo} from './diagnostics';
import {getCyclesDone} from './recorder';
import {saidMatches} from './parser';

const INTERPOLATE_VAR = /%v[0-9]+/g;
const INTERPOLATE_MSG = /%m[0-9]{1,3}/g;
const INTERPOLATE_STR = /%s[0-9]{1,3}/g;
const INTERPOLATE_WORD = /%w([0-9]+)/g;

let currentMenu;

// Logging
// const LLL = new Function();
const LLL = (...args) => console.log.apply(console, [state.logicNo, ...args]);

/**
 * Loads a logic if it isn't loaded yet (without writing it to the script).
 * NAGI logic/logic_base.c: logic_load_2(), which takes the objects off the picture while
 * it loads.
 * @param {number} logNo
 */
export function loadLogic(logNo) {
    if (state.loadedLogics[logNo]) return;
    blistsErase();
    state.loadedLogics[logNo] = new Logic(logNo);
    blistsDraw();
}

/**
 * NAGI picture/pic_res.c: pic_load(). A picture that is already loaded isn't loaded again.
 * @param {number} picNo
 */
export function picLoad(picNo) {
    if (state.loadedPics[picNo]) return;
    blistsErase();
    scriptWrite(SCRIPT.LOAD_PIC, picNo);
    state.loadedPics[picNo] = new Pic(readAgiResource(AGI_RESOURCE_TYPE.PIC, picNo));
    blistsDraw();
}

/**
 * Draws a picture into the picture buffer, cleared to white with priority 4 first. The
 * objects are taken off while it is drawn and put back after; nothing shows until show.pic.
 * NAGI picture/pic_res.c: pic_draw()
 * @param {number} picNo
 */
export function picDraw(picNo) {
    scriptWrite(SCRIPT.DRAW_PIC, picNo);
    blistsErase();
    state.visualBuffer.clear(0x0F);
    state.visualPriorityBuffer.clear(0x04);
    state.priorityBuffer.clear(0x04);
    state.picBuffer.fill(0x4F);
    state.loadedPics[picNo].draw(state.visualBuffer, state.visualPriorityBuffer, state.priorityBuffer, state.picBuffer);
    blistsDraw();
    state.picVisible = false;
}

/**
 * Draws a picture over the one in the picture buffer.
 * NAGI picture/pic_res.c: pic_overlay()
 * @param {number} picNo
 */
export function picOverlay(picNo) {
    scriptWrite(SCRIPT.OVERLAY_PIC, picNo);
    blistsErase();
    state.loadedPics[picNo].draw(state.visualBuffer, state.visualPriorityBuffer, state.priorityBuffer, state.picBuffer);
    blistsDraw();
    state.picVisible = false;
}

/** NAGI picture/pic_res.c: pic_discard() @param {number} picNo */
export function picDiscard(picNo) {
    scriptWrite(SCRIPT.DISCARD_PIC, picNo);
    blistsErase();
    state.loadedPics[picNo] = null;
    blistsDraw();
}

/**
 * NAGI view/view_base.c: view_load(). A view that is already loaded isn't loaded again.
 * @param {number} viewNo
 */
export function viewLoad(viewNo) {
    if (state.loadedViews[viewNo]) return;
    blistsErase();
    scriptWrite(SCRIPT.LOAD_VIEW, viewNo);
    state.loadedViews[viewNo] = new View(readAgiResource(AGI_RESOURCE_TYPE.VIEW, viewNo));
    blistsDraw();
}

/**
 * NAGI view/view_base.c: view_discard(). (NAGI also discards every view loaded after this
 * one, as the original does; not done here yet.)
 * @param {number} viewNo
 */
export function viewDiscard(viewNo) {
    scriptWrite(SCRIPT.DISCARD_VIEW, viewNo);
    blistsErase();
    state.loadedViews[viewNo] = null;
    blistsDraw();
}

/**
 * NAGI sound/sound_base.c: sound_load(). A sound that is already loaded isn't loaded again.
 * @param {number} soundNo
 */
export function soundLoad(soundNo) {
    if (state.loadedSounds[soundNo]) return;
    scriptWrite(SCRIPT.LOAD_SOUND, soundNo);
    state.loadedSounds[soundNo] = new Sound(readAgiResource(AGI_RESOURCE_TYPE.SOUND, soundNo));
}

// The sound the game is playing, as far as the game knows: it ends when stopped or when
// its end-of-sound event is handled, not when the audio finishes. `seq` tells sounds
// apart, so a late event for a sound that was already stopped is ignored.
// NAGI sound/sound_base.c: sound_flag, sound_state.
/** @type {{seq: number, flagNo: number}|null} */
let currentSound = null;
let soundSeq     = 0;

/**
 * Stops the sound that is playing, if any, and sets its flag.
 * NAGI sound/sound_base.c: sound_stop()
 */
export function stopSound() {
    state.playedSound && state.playedSound.stop();
    if (currentSound) {
        state.flags[currentSound.flagNo] = 1;
        currentSound = null;
    }
}

/**
 * Handles the end-of-sound event for sound `seq`: sets its flag if it is still the
 * sound that is playing.
 * @param {number} seq
 */
export function soundFinished(seq) {
    if (currentSound && currentSound.seq === seq) {
        state.flags[currentSound.flagNo] = 1;
        currentSound = null;
    }
}

export const commands = {
    agi_increment: (varNo) => {
        if (state.variables[varNo] < 255)
            state.variables[varNo]++;
    },

    agi_decrement: (varNo) => {
        if (state.variables[varNo] > 0)
            state.variables[varNo]--;
    },

    agi_assignn: (varNo, num) => {
        state.variables[varNo] = num;
    },

    agi_assignv: (varNo1, varNo2) => {
        commands.agi_assignn(varNo1, state.variables[varNo2]);
    },

    agi_addn: (varNo, num) => {
        state.variables[varNo] += num;
    },

    agi_addv: (varNo1, varNo2) => {
        commands.agi_addn(varNo1, state.variables[varNo2]);
    },

    agi_subn: (varNo, num) => {
        state.variables[varNo] -= num;
    },

    agi_subv: (varNo1, varNo2) => {
        commands.agi_subn(varNo1, state.variables[varNo2]);
    },

    agi_lindirectn: (varNo, val) => {
        state.variables[state.variables[varNo]] = val;
    },

    agi_lindirectv: (varNo1, varNo2) => {
        commands.agi_lindirectn(varNo1, state.variables[varNo2]);
    },

    agi_rindirect: (varNo1, varNo2) => {
        state.variables[varNo1] = state.variables[state.variables[varNo2]];
    },

    agi_set: (flagNo) => {
        state.flags[flagNo] = 1;
    },

    agi_reset: (flagNo) => {
        state.flags[flagNo] = 0;
    },

    agi_toggle: (flagNo) => {
        state.flags[flagNo] = state.flags[flagNo] ? 0 : 1;
    },

    agi_set_v: (varNo) => {
        commands.agi_set(state.variables[varNo]);
    },

    agi_reset_v: (varNo) => {
        commands.agi_reset(state.variables[varNo]);
    },

    agi_toggle_v: (varNo) => {
        commands.agi_toggle(state.variables[varNo]);
    },

    // A generator, as it runs a logic (see Logic.parseLogic()).
    agi_call: function* (logicNo) {
        // LLL('agi_call', logicNo);
        state.logicStack.push(state.logicNo);
        state.logicNo = logicNo;

        if (state.loadedLogics[logicNo] == null) {
            loadLogic(logicNo);
        }

        // NAGI logic/logic_base.c (CmdCall): if the called logic ended with a restart of
        // logic 0 (new.room, restart.game), the caller stops too.
        const result  = yield* state.loadedLogics[logicNo].parseLogic();
        state.logicNo = state.logicStack.pop();
        return result;
    },

    agi_call_v: (varNo) => {
        return commands.agi_call(state.variables[varNo]);
    },

    // NAGI ui/msg.c: cmd_print_at(), print_at()
    agi_print_at: function* (msgNo, row, col, width) {
        yield* printAt(msgNo, row, col, width);
    },

    agi_shake_screen: (shakeCount) => {
        const canvas = document.getElementById('canvas');

        canvas.style.animation = '';

        // Trigger reflow to reset iteration count
        void canvas.offsetWidth;

        canvas.style.animation = 'screenshake 0.1s linear 0s ' + shakeCount;
    },

    // NAGI ui/msg.c: cmd_print_at_v()
    agi_print_at_v: function* (varNo, row, col, width) {
        yield* printAt(state.variables[varNo], row, col, width);
    },

    agi_mul_n: (varNo, val) => {
        state.variables[state.variables[varNo]] *= val;
    },

    agi_mul_v: (varNo1, varNo2) => {
        commands.agi_mul_n(varNo1, state.variables[varNo2]);
    },

    agi_div_n: (varNo, val) => {
        state.variables[state.variables[varNo]] /= val;
    },

    agi_div_v: (varNo1, varNo2) => {
        commands.agi_div_n(varNo1, state.variables[varNo2]);
    },

    // NAGI new_room.c: new_room()
    agi_new_room: (roomNo) => {
        LLL(`agi_new_room(${roomNo})`);

        commands.agi_stop_sound(); // sets the playing sound's flag
        eventsClear();

        objectsNewRoom();

        state.programControl = false;
        state.blockState     = false;
        state.horizon        = 36;

        state.variables[VAR.prev_room_no]         = state.variables[VAR.room_no];
        state.variables[VAR.room_no]              = roomNo;
        state.variables[VAR.object_edge_code]     = 0;
        state.variables[VAR.object_touching_edge] = 0;
        state.variables[VAR.ego_view_no]          = state.gameObjects[0].viewNo;
        state.variables[VAR.free_memory]          = 10;

        scriptNew();
        scriptAllow();
        commands.agi_load_logic(roomNo);

        // If ego left by an edge of the screen, it comes in at the opposite edge.
        const ego = state.gameObjects[0];
        switch (state.variables[VAR.ego_edge_code]) {
            case 1: // horizon: move to the bottom
                ego.y = 0xA7;
                break;
            case 2: // right edge: move to the left edge
                ego.x = 0;
                break;
            case 3: // bottom edge: move to just below the default horizon
                ego.y = 0x25;
                break;
            case 4: // left edge: move to the right edge
                ego.x = 0xA0 - ego.xSize;
                break;
        }
        state.variables[VAR.ego_edge_code] = 0;

        commands.agi_set(FLAG.new_room);
        state.controllers.fill(0);
        statusLineWrite();
        inputRedraw();

        // The word-group buttons (debug view) collect the said() tests of the new room.
        state.testSaid = {};

        // The logic that called new.room stops here, and the main cycle runs logic 0
        // again from the top.
        return RESTART_LOGIC_0;
    },

    agi_new_room_v: (varNo) => {
        return commands.agi_new_room(state.variables[varNo]);
    },

    agi_load_pic: (varNo) => {
        picLoad(state.variables[varNo]);
    },

    agi_overlay_pic: (varNo) => {
        picOverlay(state.variables[varNo]);
    },

    agi_draw_pic: (varNo) => {
        picDraw(state.variables[varNo]);
    },

    // NAGI picture/pic_res.c: cmd_show_pic()
    agi_show_pic: () => {
        commands.agi_reset(FLAG.windows_remain);
        closeWindow();
        renderUpdate(0, 167, 160, 168);
        state.picVisible = true;
    },

    agi_discard_pic: (varNo) => {
        picDiscard(state.variables[varNo]);
    },

    // DEBUG COMMANDS?

    // NAGI picture/pic_add.c: cmd_show_pri(). Shows the priority screen (drawn by
    // interpreter.js) until Enter or Esc, then the picture again.
    agi_show_pri_screen: function* () {
        state.showPriorityScreen = true;
        yield* userBooleanPoll();
        state.showPriorityScreen = false;
        renderUpdate(0, 167, 160, 168);
    },

    // Shows the interpreter's memory use in the original. NAGI leaves it out
    // (cmd_do_nothing); there is no fixed memory to report here.
    agi_show_mem: () => {
    },

    // A debugging command (shows an object's state in Sierra's interpreter). NAGI's command
    // table maps it to cmd_do_nothing, so it does nothing here either.
    agi_obj_status_v: (varNo) => {
    },

    agi_return: () => {
        // Logic early exit
    },

    agi_load_view: (viewNo) => {
        viewLoad(viewNo);
    },

    agi_load_view_v: (varNo) => {
        commands.agi_load_view(state.variables[varNo]);
    },

    agi_discard_view: (viewNo) => {
        viewDiscard(viewNo);
    },

    agi_discard_view_v: (varNo) => {
        commands.agi_discard_view(state.variables[varNo]);
    },

    // NAGI ui/cmd_input.c: cmd_prevent_input(), cmd_accept_input()
    agi_prevent_input: () => {
        state.allowInput = false;
        inputClear();
    },

    agi_accept_input: () => {
        state.allowInput = true;
        inputRedraw();
    },

    // NAGI sys/rand.c: cmd_random(). Both ends are included (jsyang's version never
    // returned `end`).
    agi_random: (start, end, varNo) => {
        state.variables[varNo] = (agiRand() % (end - start + 1)) + start;
    },

    agi_set_string: (strNo, msgNo) => {
        // LLL(`agi_set_string(${strNo},${msgNo})`);
        state.strings[strNo] = commands._agi_get_message(msgNo);
    },

    // NAGI logic/logic_base.c: cmd_load_logics(), logic_load(). Unlike call and new.room's
    // own loading, this is written to the script.
    agi_load_logic: (logNo) => {
        loadLogic(logNo);
        scriptWrite(SCRIPT.LOAD_LOGIC, logNo);
    },

    agi_load_logic_v: (varNo) => {
        commands.agi_load_logic(state.variables[varNo]);
    },

    // NAGI ui/msg.c: cmd_display()
    agi_display: (row, col, msgNo) => {
        display(row, col, msgNo);
    },

    // NAGI ui/msg.c: cmd_display_v()
    agi_display_v: (varNo1, varNo2, varNo3) => {
        display(state.variables[varNo1], state.variables[varNo2], state.variables[varNo3]);
    },

    // NAGI ui/agi_text.c: cmd_clear_lines(). Rows are cleared to black, or to white for
    // any other colour (in graphics mode).
    agi_clear_lines: (upper, lower, colour) => {
        if (upper > lower) lower = upper; // NAGI warns and clears only the upper row
        windowPortionClear(upper, lower, calcTextBg(colour));
    },

    // NAGI sys/script.c: cmd_script_size()
    agi_script_size: (size) => {
        scriptSize(size);
    },

    // NAGI sys/script.c: cmd_unknown_171(), cmd_unknown_172()
    agi_push_script: () => {
        pushScript();
    },

    agi_pop_script: () => {
        popScript();
    },

    // NAGI trace.c: cmd_trace_info() sets up the trace window of trace.on, which isn't
    // ported (see agi_trace_on).
    agi_trace_info: (logNo, firstRow, height) => {
    },

    // http://agi.sierrahelp.com/AGIStudioHelp/Logic/MenuIOCommands/set.key.html
    // NAGI ui/controller.c: cmd_set_key(). The key code is the two bytes as a little-endian
    // word: an ASCII code, or a scan code << 8 for F-keys and Alt+letter (see events.js).
    // The first mapping made for a key wins.
    agi_set_key: (keyLow, keyHigh, controllerNo) => {
        const key = keyLow | (keyHigh << 8);
        if (key !== 0 && state.keysForControllers[key] === undefined) {
            state.keysForControllers[key] = controllerNo;
        }
    },

    // http://agi.sierrahelp.com/AGIStudioHelp/Logic/SystemCommands/set.game.id.html
    // NAGI agi_string.c: cmd_set_game_id(). Saved games are only listed for the game
    // that saved them.
    agi_set_game_id: (msgNo) => {
        state.gameId = (logicMsg(msgNo) ?? '').slice(0, 20);
    },

    // http://agi.sierrahelp.com/AGIStudioHelp/Logic/DisplayCommands/configure.screen.html
    // NAGI ui/agi_text.c: cmd_config_screen(). Only the input line row is used so far;
    // the play area and status line positions are for Phase 3.
    agi_configure_screen: (playTop, inputLine, statusLine) => {
        state.playTop       = playTop;
        state.inputLinePos  = inputLine;
        state.statusLineRow = statusLine;
    },

    // http://agi.sierrahelp.com/AGIStudioHelp/Logic/DisplayCommands/set.cursor.char.html
    // NAGI ui/cmd_input.c: cmd_set_cursor_char()
    agi_set_cursor_char: (msgNo) => {
        const message    = commands._agi_get_message(msgNo) || '';
        state.cursorChar = message.charCodeAt(0) || 0;
    },

    _agi_get_message: (msgNo) => {
        let interpolated = state.loadedLogics[state.logicNo].messages[msgNo];

        // Variable interpolation
        if (interpolated) {
            interpolated = interpolated.replace(INTERPOLATE_VAR, (match, p1) => {
                const vNum = parseFloat(match.replace('%v', ''));
                return state.variables[vNum].toString();
            });

            interpolated = interpolated.replace(INTERPOLATE_MSG, (match, p1) => {
                const mNum = parseFloat(match.replace('%m', ''));
                return state.loadedLogics[state.logicNo].messages[mNum];
            });

            interpolated = interpolated.replace(INTERPOLATE_STR, (match, p1) => {
                const sNum = parseFloat(match.replace('%s', ''));
                return state.strings[sNum];
            });

            // %wN: the Nth word the player typed (as stored by the parser); nothing if there
            // are fewer words. NAGI ui/msg.c (case 'w').
            interpolated = interpolated.replace(INTERPOLATE_WORD, (match, n) => {
                const word = state.parsedWords[parseInt(n, 10) - 1];
                return word ? word.text : '';
            });

            // Ensure backslash is removed
            interpolated = interpolated.replace(/\\/g, '');
        }

        return interpolated;
    },

    agi_set_menu: (msg) => {
        currentMenu = {
            name:    commands._agi_get_message(msg),
            members: [{text: commands._agi_get_message(msg), ctrNo: -1}]
        };

        state.menu.push(currentMenu);
    },

    agi_set_menu_member: (msg, ctrNo) => {
        currentMenu.members.push({
            text: commands._agi_get_message(msg),
            ctrNo
        });
    },

    agi_submit_menu: () => {
        if (state.menuContainerElement.children.length > 0) return;

        for (let m of state.menu) {
            const menuId           = 'menu-' + m.name.toLowerCase();
            const selectEl         = document.createElement('select');
            selectEl.id            = menuId;
            selectEl.selectedIndex = 0;
            selectEl.onchange      = () => {
                // Like NAGI's menu (ui/menu.c), a choice is queued as a controller event.
                eventWrite(EVENT_CONTROLLER, parseFloat(selectEl.value));
                selectEl.selectedIndex = 0;
                selectEl.blur();
            };

            for (let i of m.members) {
                const optionEl     = document.createElement('option');
                optionEl.value     = i.ctrNo.toString();
                optionEl.innerHTML = i.text;

                selectEl.appendChild(optionEl);
            }

            state.menuContainerElement.appendChild(selectEl);

        }
    },

    agi_enable_member: (ctrl) => {

    },

    agi_disable_member: (ctrl) => {

    },

    // NAGI objects.c: cmd_put(), cmd_put_v(), cmd_get_room_v(). The room is always a
    // variable; for put.v the item is a variable too (jsyang's put.v used the raw bytes).
    agi_put: (itemNo, varNo) => {
        state.items[itemNo] = state.variables[varNo];
    },

    agi_put_v: (itemVarNo, roomVarNo) => {
        state.items[state.variables[itemVarNo]] = state.variables[roomVarNo];
    },

    agi_get_room_v: (itemVarNo, varNo) => {
        state.variables[varNo] = state.items[state.variables[itemVarNo]];
    },

    agi_drop: (item) => {
        state.items[item] = 0;
    },

    // NAGI ui/status.c: cmd_status_line_on(), cmd_status_line_off()
    agi_status_line_on: () => {
        statusLineOn();
    },

    agi_status_line_off: () => {
        statusLineOff();
    },

    agi_load_sound: (soundNo) => {
        soundLoad(soundNo);
    },

    // NAGI sound/sound_base.c: cmd_sound(). Stopping the current sound sets its flag; the
    // new sound's flag is cleared and set again when it ends.
    agi_sound: (soundNo, flagNo) => {
        stopSound();
        commands.agi_reset(flagNo);
        state.playedSound = state.loadedSounds[soundNo];
        updateSound(); // whether sound is on (flag 9) right now

        if (state.playedSound) {
            const seq    = ++soundSeq;
            currentSound = {seq, flagNo};
            // When the audio plays to its end (or ends at once because sound is off), that
            // is queued as an event; soundFinished() then sets the flag. So the flag is set
            // in the same cycle in a replay, whatever the audio is doing.
            state.playedSound.play(state.soundEmulator, () => eventWrite(EVENT_SOUND_DONE, seq));
        }
    },

    agi_stop_sound: () => {
        stopSound();
        state.playedSound = null;
    },

    // NAGI ui/agi_text.c: cmd_text_screen()
    agi_text_screen: () => {
        textScreen();
    },

    // NAGI ui/status.c: cmd_status()
    agi_status: function* () {
        yield* cmdStatus();
    },

    // NAGI ui/agi_text.c: cmd_clear_text_rect()
    agi_clear_text_rect: (upperRow, upperCol, lowerRow, lowerCol, colour) => {
        windowClear(upperRow, upperCol, lowerRow, lowerCol, calcTextBg(colour));
    },

    agi_menu_input: () => {

    },

    // NAGI ui/agi_text.c: cmd_graphics()
    agi_graphics: () => {
        screenRedraw();
    },

    // NAGI obj_show.c: cmd_show_obj(), obj_show(). Shows loop 0, cel 0 of the view at the
    // bottom of the picture with its description in a message window. A view that wasn't
    // loaded is loaded for this and discarded again.
    agi_show_obj: function* (viewNo) {
        const wasLoaded = !!state.loadedViews[viewNo];
        if (!wasLoaded) {
            state.loadedViews[viewNo] = new View(readAgiResource(AGI_RESOURCE_TYPE.VIEW, viewNo));
        }

        const restorePicture = objShowDraw(viewNo);
        yield* messageBox(state.loadedViews[viewNo].description);
        restorePicture();

        if (!wasLoaded) state.loadedViews[viewNo] = null;
    },

    agi_show_obj_v: function* (varNo) {
        yield* commands.agi_show_obj(state.variables[varNo]);
    },

    agi_get: (itemNo) => {
        // http://agi.sierrahelp.com/AGIStudioHelp/Logic/InventoryItemCommands/get.html
        state.items[itemNo] = 255;
    },

    agi_get_v: (vItem) => {
        commands.agi_get(state.variables[vItem]);
    },

    agi_discard_sound: (soundNo) => {
        state.loadedSounds[soundNo] = null;
    },

    // NAGI state_io.c: cmd_save_game()
    agi_save_game: function* () {
        yield* saveGame();
    },

    // NAGI state_io.c: cmd_restore_game(). Logic 0 starts again after a restore.
    agi_restore_game: function* () {
        return yield* restoreGame();
    },

    // NAGI state_io.c: cmd_unknown_170()
    agi_set_simple: (strNo) => {
        setSimple(strNo);
    },
    // NAGI state_io.c: cmd_restart_game(). Asks first, unless flag 16 is set. On a restart
    // logic 0 starts again; the sound setting (flag 9) is kept.
    agi_restart_game: function* () {
        stopSound();
        const editWasOff = inputEditStatus();
        inputEditOn();

        const restartIt = state.flags[FLAG.auto_restart]
            || (yield* messageBox('Press ENTER to restart\nthe game.\n\nPress ESC to continue\nthis game.')) === 1;

        if (restartIt) {
            cancelLine();
            const soundOn = state.flags[FLAG.sound_on];
            blistsErase(); // NAGI initialise.c: game_init()
            restart();
            commands.agi_set(FLAG.game_restarted);
            if (soundOn) state.flags[FLAG.sound_on] = 1;
            // NAGI also enables every menu item here (menus are Phase 3's menu item).
        }
        if (restartIt || editWasOff) inputEditOff();

        return restartIt ? RESTART_LOGIC_0 : undefined;
    },

    // NAGI base.c: cmd_quit(). quit(1) quits at once; otherwise the player is asked.
    // Quitting stops the game and clears the page (there is no DOS to return to).
    agi_quit: function* (now) {
        stopSound();
        if (now !== 1 && (yield* messageBox('Press ENTER to quit.\nPress ESC to keep playing.')) !== 1) return;
        state.hasQuit = true;
        state.soundEmulator.deactivate();
        document.body.innerHTML = '';
    },

    // NAGI base.c: cmd_pause(). The game clock stops while the window is open.
    agi_pause: function* () {
        clockPause();
        eventsClear();
        stopSound();
        yield* messageBox('      Game paused.\nPress Enter to continue.');
        clockResume();
    },

    // Switches between EGA, CGA and other displays in the original; this interpreter only
    // has EGA, so it does nothing.
    agi_toggle_monitor: () => {
    },

    // Does nothing in NAGI either (cmd_do_nothing): no joystick here.
    agi_init_joy: () => {
    },

    // NAGI ui/cmd_misc.c: cmd_version() shows NAGI's own name and credits in a message
    // window (and has a TODO for the original's version text). This shows this
    // interpreter's, in the same way.
    agi_version: function* () {
        yield* messageBox('  Adventure Game Interpreter\n      in the web browser\n\nSee the README for credits.');
    },

    // NAGI trace.c: cmd_trace_on() opens a logic-tracing window when flag 10 (debug) is
    // set. Not ported: the debug panel (Ctrl+`) does that job here.
    agi_trace_on: () => {
    },

    // NAGI log.c: cmd_log() appends the room, the last input line and a message to the
    // file LOGFILE. Here it goes to the browser console.
    agi_log: (msgNo) => {
        console.info(`AGI log: room ${state.variables[VAR.room_no]}, input line: ${state.inputPrev}\n${strWordwrap(logicMsg(msgNo), 78)}`);
    },

    agi_echo_line: () => {
        echoLine();
    },

    agi_cancel_line: () => {
        cancelLine();
    },

    agi_open_dialogue: () => {
        state.dialogue = true;
    },

    agi_close_dialogue: () => {
        state.dialogue = false;
    },

    // NAGI agi_string.c: cmd_get_string()
    agi_get_string: function* (strNo, msgNo, row, col, maxLen) {
        yield* getString(strNo, msgNo, row, col, maxLen);
    },

    // NAGI agi_string.c: cmd_word_to_string(). Copies the player's word number `wordNo`
    // (0-based) into a string; empty if there is no such word.
    agi_word_to_string: (strNo, wordNo) => {
        const word           = state.parsedWords[wordNo];
        state.strings[strNo] = word ? word.text : '';
    },

    // NAGI ui/parse.c: cmd_parse()
    agi_parse: (strNo) => {
        commands.agi_reset(FLAG.input_received);
        commands.agi_reset(FLAG.input_parsed);
        if (strNo < 12) {
            parseText(state.strings[strNo] || '');
        }
    },

    // NAGI ui/msg.c: cmd_print()
    agi_print: function* (msgNo) {
        yield* messageBox(logicMsg(msgNo));
    },

    // NAGI ui/msg.c: cmd_print_v()
    agi_print_v: function* (varNo) {
        yield* messageBox(logicMsg(state.variables[varNo]));
    },

    // NAGI ui/agi_text.c: cmd_set_text_attribute()
    agi_set_text_attribute: (fg, bg) => {
        textColour(fg, bg);
    },

    /* Handled by Logic.parseLogic

    agi_set_scan_start,
    agi_reset_scan_start,

     */

    // NAGI ui/msg.c: cmd_close_window()
    agi_close_window: () => {
        closeWindow();
    },

    // NAGI agi_string.c: cmd_get_num()
    agi_get_num: function* (msgNo, varNo) {
        yield* getNum(msgNo, varNo);
    },

    /* Tests */
    agi_test_equaln: (varNo, val) => {
        return state.variables[varNo] == val;
    },

    agi_test_equalv: (varNo1, varNo2) => {
        return commands.agi_test_equaln(varNo1, state.variables[varNo2]);
    },

    agi_test_lessn: (varNo, val) => {
        return state.variables[varNo] < val;
    },

    agi_test_lessv: (varNo1, varNo2) => {
        return commands.agi_test_lessn(varNo1, state.variables[varNo2]);
    },

    agi_test_greatern: (varNo, val) => {
        return state.variables[varNo] > val;
    },

    agi_test_greaterv: (varNo1, varNo2) => {
        return commands.agi_test_greatern(varNo1, state.variables[varNo2]);
    },

    agi_test_isset: (flagNo) => {
        return state.flags[flagNo];
    },

    agi_test_issetv: (varNo) => {
        return commands.agi_test_isset(state.variables[varNo]);
    },

    agi_test_has: (itemNo) => {
        return state.items[itemNo] === 255;
    },

    agi_test_obj_in_room: (itemNo, varNo) => {
        return state.items[itemNo] === state.variables[varNo];
    },

    agi_test_controller: (ctrNo) => {
        return state.controllers[ctrNo] > 0;
    },

    // NAGI logic/logic_eval.c: cmd_have_key(). Uses v19 if a key was read this cycle,
    // otherwise takes key events off the queue (dropping other events) until it finds a
    // key or the queue is empty.
    // NAGI logic/logic_eval.c: cmd_have_key(). NAGI's event_read() fetches the keys the
    // system has received each time it is called, so a logic that loops until have.key
    // (text screens: "press any key") sees the key arrive. Here keys arrive only between
    // JS tasks, so with nothing queued the logic first yields to the game loop once.
    agi_test_have_key: function* () {
        let key = state.variables[VAR.key_pressed];
        if (key === 0) {
            if (eventsEmpty()) yield;
            do {
                key = charPoll();
            } while (key === 0xFFFF);
        }

        if (key !== 0) {
            state.variables[VAR.key_pressed] = key;
            return true;
        }
        return false;
    },

    // NAGI logic/logic_eval.c: cmd_said(). On a match flag 4 is set, so later said()
    // tests in the same cycle are false.
    agi_test_said: (...testWordGroups) => {
        // Collect the tested word groups for the word-group buttons (debug view).
        const key           = testWordGroups.map(iWG => (wordGroups[iWG] || [iWG])[0]).join(' ');
        state.testSaid[key] = testWordGroups.join(',');

        const matched = saidMatches(
            testWordGroups,
            state.parsedWords.map(w => w.group),
            !!state.flags[FLAG.input_received],
            !!state.flags[FLAG.input_parsed],
        );

        if (matched) {
            commands.agi_set(FLAG.input_parsed);
            debugInfo.lastSaid = {groups: testWordGroups, logicNo: state.logicNo, cycle: getCyclesDone()};
        }
        return matched;
    },

    agi_test_compare_strings: (strNo1, strNo2) => {
        return state.strings[strNo1] == state.strings[strNo2];
    },

};

// Commands for animated objects (objects.js).
Object.assign(commands, objectCommands);

