import {agiRand, randomBetween} from './rng';
import screen from './screen';
import Logic from './logic';
import {blistsDraw, blistsErase, objectCommands, objectsNewRoom, renderUpdate} from './objects';
import {Pic} from './bitmap';
import {readAgiResource, wordGroups} from './resources';
import Sound from './sound';
import {View} from './view';
import {VAR, AGI_RESOURCE_TYPE, FLAG, RESTART_LOGIC_0} from './constants';
import {state, restart, getInventoryItems, updateSound} from './state';
import playerSaveSystem from './playerSaveSystem';
import {charPoll, eventsClear, eventsEmpty, eventWrite, EVENT_CONTROLLER, EVENT_SOUND_DONE} from './events';
import {askString} from './dialogs';
import {closeWindow, display, logicMsg, messageBox, printAt} from './msg';
import {calcTextBg, screenRedraw, textColour, textScreen, windowClear, windowPortionClear} from './text';
import {cancelLine, echoLine, inputClear, inputRedraw, parseText} from './input';
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

// A message window for commands whose own screens aren't ported yet (status, show.obj):
// waits for Enter or Esc like print.
const _alert = function* (message) {
    yield* messageBox(message);
};

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
function stopSound() {
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
            commands.agi_load_logic(logicNo);
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

    // NAGI picture/pic_res.c: pic_load()
    agi_load_pic: (varNo) => {
        const picNo = state.variables[varNo];
        if (!state.loadedPics[picNo]) {
            blistsErase();
            state.loadedPics[picNo] = new Pic(readAgiResource(AGI_RESOURCE_TYPE.PIC, picNo));
            blistsDraw();
        }
    },

    // NAGI picture/pic_res.c: pic_overlay(). Objects are taken off the picture while it is
    // drawn and put back after; nothing shows until show.pic.
    agi_overlay_pic: (varNo) => {
        const picNo = state.variables[varNo];
        blistsErase();
        state.loadedPics[picNo].draw(state.visualBuffer, state.visualPriorityBuffer, state.priorityBuffer, state.picBuffer);
        blistsDraw();
        state.picVisible = false;
    },

    // NAGI picture/pic_res.c: pic_draw(). Clears to white with priority 4 first.
    agi_draw_pic: (varNo) => {
        const picNo = state.variables[varNo];
        blistsErase();
        state.visualBuffer.clear(0x0F);
        state.visualPriorityBuffer.clear(0x04);
        state.priorityBuffer.clear(0x04);
        state.picBuffer.fill(0x4F);
        state.loadedPics[picNo].draw(state.visualBuffer, state.visualPriorityBuffer, state.priorityBuffer, state.picBuffer);
        blistsDraw();
        state.picVisible = false;
    },

    // NAGI picture/pic_res.c: cmd_show_pic()
    agi_show_pic: () => {
        commands.agi_reset(FLAG.windows_remain);
        closeWindow();
        renderUpdate(0, 167, 160, 168);
        state.picVisible = true;
    },

    agi_discard_pic: (varNo) => {
        const picNo = state.variables[varNo];
        blistsErase();
        state.loadedPics[picNo] = null;
        blistsDraw();
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

    agi_show_mem: () => {
        // ???
    },

    agi_obj_status_v: (oA) => {
        // ???
    },

    agi_return: () => {
        // Logic early exit
    },

    // NAGI view/view_base.c: view_load(). A view that is already loaded isn't loaded again.
    agi_load_view: (viewNo) => {
        if (state.loadedViews[viewNo]) return;
        blistsErase();
        state.loadedViews[viewNo] = new View(readAgiResource(AGI_RESOURCE_TYPE.VIEW, viewNo));
        blistsDraw();
    },

    agi_load_view_v: (varNo) => {
        commands.agi_load_view(state.variables[varNo]);
    },

    // NAGI view/view_base.c: view_discard(). (NAGI also discards every view loaded after
    // this one, as the original does; not done here yet.)
    agi_discard_view: (viewNo) => {
        blistsErase();
        state.loadedViews[viewNo] = null;
        blistsDraw();
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

    agi_load_logic: (logNo) => {
        LLL(`agi_load_logic(${logNo})`);

        if (state.loadedLogics[logNo]) {
            state.loadedLogics[logNo].data.position = state.loadedLogics[logNo].entryPoint;
        } else {
            // NAGI logic/logic_base.c: logic_load_2() takes the objects off the picture
            // while it loads.
            blistsErase();
            state.loadedLogics[logNo] = new Logic(logNo);
            blistsDraw();
        }
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

    agi_script_size: (bytes) => {

    },

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
    agi_set_game_id: (msg) => 0,

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

        const scoreEl = document.createElement('span');
        scoreEl.id    = 'score';
        state.menuContainerElement.appendChild(scoreEl);
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

    agi_status_line_on: () => {

    },

    agi_status_line_off: () => {

    },

    agi_load_sound: (soundNo) => {
        state.loadedSounds[soundNo] = new Sound(readAgiResource(AGI_RESOURCE_TYPE.SOUND, soundNo));
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

    agi_status: function* () {
        // Text based - inventory screen. (A message window until the inventory screen is
        // ported: NAGI obj_show.c.)
        yield* _alert(`You are carrying:\n\n${getInventoryItems().join('\n')}`);
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

    agi_show_obj: function* (viewNo) {
        // Display the inventory item
        // http://agi.sierrahelp.com/AGIStudioHelp/Logic/InventoryItemCommands/show.obj.html

        commands.agi_load_view(viewNo);
        const view         = state.loadedViews[viewNo];
        const canvasEl     = view.getDisplay();
        canvasEl.className = 'item';
        canvasEl.title     = view.description;
        canvasEl.onclick   = () => document.body.removeChild(canvasEl);
        document.body.append(canvasEl);
        yield* _alert(view.description);
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

    agi_save_game:    playerSaveSystem.saveNextCycle,
    agi_restore_game: playerSaveSystem.restoreNextCycle,
    // NAGI state_io.c (CmdRestartGame). The "Press ENTER to restart" confirmation (skipped
    // when flag 16 is set) needs the message window from Phase 3; until then it restarts
    // without asking, as jsyang's version did.
    agi_restart_game: () => {
        stopSound();
        const soundOn = state.flags[FLAG.sound_on];
        cancelLine();
        blistsErase(); // NAGI initialise.c: game_init()
        restart();
        commands.agi_set(FLAG.game_restarted);
        state.flags[FLAG.sound_on] = soundOn;
        return RESTART_LOGIC_0;
    },

    agi_quit: (n1) => {
        state.hasQuit = true;
        state.soundEmulator.deactivate();
        document.body.innerHTML = '';
    },

    agi_pause: () => {
        state.hasPaused = !state.hasPaused;
    },

    agi_toggle_monitor: () => {

    },

    agi_init_joy: () => {

    },

    agi_version: () => {

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

    agi_get_string: (strNo, msg, x, y, maxLen) => {
        state.dialogueStrNo  = strNo;
        state.dialoguePrompt = msg;
        state.dialogueStrX   = x;
        state.dialogueStrY   = y;
        state.dialogueStrLen = maxLen;
        state.dialogueMode   = 1;

        // Ask user for a string
        const result = askString(commands._agi_get_message(msg));

        if (result) {
            state.strings[strNo] = result.substring(0, maxLen);
            commands.agi_set(FLAG.input_received);
            commands.agi_set(FLAG.input_parsed);
        }
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

    agi_get_num: (mPROMPT, vNUM) => {
        // http://agi.sierrahelp.com/AGIStudioHelp/Logic/MathematicalCommands/get.num.html
        const choice          = askString(commands._agi_get_message(mPROMPT), '0');
        state.variables[vNUM] = parseFloat(choice || '0');
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

