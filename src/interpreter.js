import {FLAG, RESTART_LOGIC_0, VAR} from './constants';
import {Bitmap} from './bitmap';
import screen from './screen';
import {commands} from './logicCommands';
import SoundEmulatorTiSn76496a from './soundEmulator';
import {clockAdvance, clockElapsedSeconds} from './clock';
import {afterCycle, clockSeconds, cycleStarted, Hash} from './recorder';
import {state, resetControllers, restart, updateSound} from './state';
import playerCommandSystem from './playerCommandSystem';
import {objsDirCalc, objtableUpdate} from './objects';
import {eventsInit} from './events';
import {inputPoll} from './input';
import {checkCommandTable, debugInfo} from './diagnostics';
import {onMessage} from './dialogs';
import {getCyclesDone} from './recorder';
import {debugAfterCycle} from './debugPanel';
import {statusLineWrite} from './status';
import {menuInput, menuRequested} from './menu';

let canvasContext;
let audioContext;

let priorityFrame = null; // ImageData for show.pri.screen

const bltFrame = () => {
    if (state.showPriorityScreen) {
        // The picture area shows priorities; the text rows below it stay as they are.
        priorityFrame ??= canvasContext.createImageData(320, 200);
        priorityFrame.data.set(state.frameData.data);
        screen.renderPriority(priorityFrame);
        canvasContext.putImageData(priorityFrame, 0, 0);
    } else {
        canvasContext.putImageData(state.frameData, 0, 0);
    }
};
const bltDebug = () => {
    const c  = document.createElement('canvas');
    c.width  = 320;
    c.height = 200;
    screen.renderPriority(state.debugFrameData);
    c.getContext('2d').putImageData(state.debugFrameData, 0, 0);
    const imageEl   = document.createElement('img');
    imageEl.src     = c.toDataURL();
    imageEl.onclick = e => e.target.parentElement.removeChild(e.target);
    document.getElementById('debug').appendChild(imageEl);
};

const init = (_canvasContext, _audioContext, _actionContainerElement, _actionSearchElement) => {
    if (canvasContext) return;

    canvasContext                = _canvasContext;
    audioContext                 = _audioContext;
    state.actionContainerElement = _actionContainerElement;
    state.actionSearchElement    = _actionSearchElement;

    state.visualBuffer         = new Bitmap();
    state.visualPriorityBuffer = new Bitmap();
    state.priorityBuffer       = new Bitmap();
    state.frameData            = canvasContext.createImageData(320, 200);
    state.debugFrameData       = canvasContext.createImageData(320, 200);

    state.soundEmulator = new SoundEmulatorTiSn76496a(_audioContext);

    screen.init(state);

    _actionSearchElement.onkeydown  = e => e.stopPropagation();
    _actionSearchElement.onkeypress = e => e.stopPropagation();
    _actionSearchElement.onkeyup    = () => playerCommandSystem.searchSaidSystem();

    eventsInit(window);
    checkCommandTable(commands);

    restart();
};

let prevVariables = new Uint8Array(256);
let prevFlags     = new Uint8Array(256);

/**
 * The variables and flags that changed since the previous cycle, as pairs
 * [code, new value] (code < 256: variable; 256 + n: flag n), for the recording.
 * @returns {number[]}
 */
const stateChanges = () => {
    const changes = [];
    for (let i = 0; i < 256; i++) {
        if (state.variables[i] !== prevVariables[i]) changes.push(i, state.variables[i]);
        if (state.flags[i] !== prevFlags[i]) changes.push(256 + i, state.flags[i]);
    }
    prevVariables = state.variables.slice();
    prevFlags     = state.flags.slice();
    return changes;
};

/**
 * Hashes of the game state after a cycle, for comparing a replay with its recording:
 * [variables, flags, items, strings and input state; screen objects; the picture buffer
 * and the screen image].
 * @returns {number[]}
 */
const hashGame = () => {
    const h = new Hash()
        .addAll(state.variables).addAll(state.flags).addAll(state.items)
        .addString(state.inputLine)
        .add(state.programControl ? 1 : 0).add(state.allowInput ? 1 : 0).add(state.horizon);
    for (let i = 0; i < state.strings.length; i++) h.addString(state.strings[i] ?? '');

    const o = new Hash();
    for (const obj of state.gameObjects) {
        for (const key of Object.keys(obj)) {
            const value = obj[key];
            if (typeof value === 'number' || typeof value === 'boolean') o.addString(String(value));
        }
        o.addAll(obj.u);
    }

    const screenHash = new Hash().addBuffer(state.picBuffer).addBuffer(state.frameData.data);

    return [h.h, o.h, screenHash.h];
};

/** @type {string[]} the messages shown in the running cycle */
let cycleMessages = [];
onMessage(m => cycleMessages.push(m.text));

/**
 * Notes how the cycle that parsed the player's input ended, for the debug tools and the
 * parser test (test/replays/sq1-parser.script.json): the words stored, v9, flags 2 and 4
 * (which the next cycle resets), the word groups of the said() that matched (null if
 * none; a game may reset flag 4 itself afterwards, as SQ1's logic 0 does) and the
 * messages shown.
 */
function noteInputCycle() {
    const cycle = getCyclesDone();
    const said  = debugInfo.lastSaid;
    debugInfo.lastInput = {
        cycle,
        text:     debugInfo.lastParse?.text ?? null,
        words:    state.parsedWords.map(w => w.text),
        groups:   state.parsedWords.map(w => w.group),
        v9:       state.variables[VAR.unknown_word_no],
        f2:       state.flags[FLAG.input_received],
        f4:       state.flags[FLAG.input_parsed],
        said:     said && said.cycle === cycle ? said.groups : null,
        messages: cycleMessages.slice(),
    };
}

/**
 * Step 1 of a cycle (NAGI nagi_main.c, main loop): reset the input state. In NAGI this
 * happens before do_delay(), which polls input while it waits.
 */
const beginCycle = () => {
    resetControllers();
    commands.agi_reset(FLAG.input_received);  // player has not entered a command
    commands.agi_reset(FLAG.input_parsed);    // said() has not accepted the input yet
    state.variables[VAR.key_pressed]     = 0;
    state.variables[VAR.unknown_word_no] = 0;
};

/**
 * Steps 3-7 of a cycle (NAGI nagi_main.c, main loop), run after the delay and input poll.
 * A generator: it yields while a command waits for the player (see wait.js), and the game
 * loop calls next() once per poll until it is done.
 * @returns {Generator<void, void, void>}
 */
function* runCycle() {
    cycleStarted();
    cycleMessages = [];

    // menu.input asked for the menu: NAGI shows it at the start of input_poll(), during the
    // delay; here at the start of the cycle, followed by the rest of the input poll (a
    // chosen item's controller).
    if (menuRequested()) {
        yield* menuInput();
        inputPoll();
    }
    clockAdvance(state.variables, clockSeconds(clockElapsedSeconds));

    const ego = state.gameObjects[0];

    // Ego direction: under program control the logic reads ego's direction from v6;
    // under player control v6 (set by the arrow keys) steers ego.
    if (state.programControl) {
        state.variables[VAR.ego_dir] = ego.direction;
    } else {
        ego.direction = state.variables[VAR.ego_dir];
    }
    objsDirCalc();

    let oldScore    = state.variables[VAR.score];
    const soundFlag = state.flags[FLAG.sound_on];

    // new.room / restart.game stop logic 0, which then runs again from the top in the
    // same cycle.
    while ((yield* commands.agi_call(0)) === RESTART_LOGIC_0) {
        state.variables[VAR.unknown_word_no]      = 0;
        state.variables[VAR.object_edge_code]     = 0;
        state.variables[VAR.object_touching_edge] = 0;
        commands.agi_reset(FLAG.input_received);
        oldScore = state.variables[VAR.score];
    }

    ego.direction = state.variables[VAR.ego_dir];

    if (oldScore !== state.variables[VAR.score] || soundFlag !== state.flags[FLAG.sound_on]) {
        statusLineWrite();
    }

    state.variables[VAR.object_edge_code]     = 0;
    state.variables[VAR.object_touching_edge] = 0;
    commands.agi_reset(FLAG.new_room);
    commands.agi_reset(FLAG.game_restarted);
    commands.agi_reset(FLAG.game_restored);

    // Objects aren't updated on the text screen (text.screen).
    if (!state.textMode) objtableUpdate();

    bltFrame();
    playerCommandSystem.updateSaidSystem();
    updateSound();

    // the player entered a line before this cycle (or parse ran in it)
    if (debugInfo.lastParse?.cycle === getCyclesDone()) noteInputCycle();
    afterCycle(hashGame(), state.variables[VAR.room_no], stateChanges());
    debugAfterCycle();
}

/**
 * One interpreter cycle without the delay (for scripted use from the console). Stops with
 * a warning if a command waits for the player; the game loop then finishes the cycle.
 * @returns {Generator<void, void, void>|null} the unfinished cycle, if it waits
 */
const cycle = () => {
    beginCycle();
    inputPoll();
    const running = runCycle();
    if (running.next().done) return null;
    console.warn('AGI: the cycle waits for the player; the game loop will finish it');
    return running;
};

export default {
    bltDebug,
    bltFrame,
    init,
    beginCycle,
    inputPoll,
    runCycle,
    cycle,
}
