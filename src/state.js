import {FLAG, MAX_GAMEOBJECTS, VAR} from './constants';
import {newObject, resetBlitLists} from './objects';
import {loadLogic, roomInit} from './logicCommands';
import {inventoryObjects} from './resources';

export const state = {
    programControl:       false,    // Does the game have control over player character (ego)?
    visualBuffer:         null,     // 2x1 pixels for colored drawing
    visualPriorityBuffer: null,     // Only for drawing priority
    priorityBuffer:       null,     // Only for obstacles and control priorities
    gameId:               '',   // set.game.id
    scriptSize:           50,   // script.size (NAGI default 0x32)
    /** @type {Array<[number, number]>} the script (script.js) */
    script:               [],
    scriptSaved:          0,    // push.script
    /** @type {string[]} */
    strings:              [],
    items:                new Uint8Array(256),
    variables:            new Uint8Array(256),
    flags:                new Uint8Array(256),
    controllers:          new Uint8Array(256),
    /** @type {Record<number, number>} key code -> controller (set.key) */
    keysForControllers:   {},

    textMode: false, // text.screen is on (NAGI chgen_textmode)

    /** @type {any[]} Characters, animated sprites, etc. */
    gameObjects: [],

    testSaid:   {},    // List all the said test command queries as options to be chosen

    /** @type {import('./parser').ParsedWord[]} Words stored by the last parse, for said(). */
    parsedWords: [],
    showPriorityScreen: false, // show.pri.screen is showing

    /** NAGI's picture buffer with the objects drawn in: priority << 4 | colour (objects.js). */
    picBuffer:  new Uint8Array(160 * 168).fill(0x4F),
    picVisible: false, // show.pic has run since the last draw.pic
    inputLine:     '',  // what the player is typing
    inputPrev:     '',  // the previous command, for echo.line
    cursorChar:    0,   // set.cursor.char; 0 = none
    playTop:       0,   // configure.screen
    inputLinePos:  23,  // configure.screen; text row of the input line (NAGI default 0x17)
    statusLineRow: 21,  // configure.screen (NAGI default 0x15)
    statusLineOn:  false, // status.line.on (NAGI state.status_state)

    horizon: 0,
    blockState: false, // a block() is set
    blockX1: 0,
    blockY1: 0,
    blockX2: 0,
    blockY2: 0,

    /** @type {any[]} */
    loadedViews:  [],
    loadedLogics: [],
    loadedPics:   [],
    loadedSounds: [],
    logicStack:   [],
    /** @type {number[]} numbers of the loaded logics, views and pictures in load order */
    logicOrder:   [],
    /** @type {number[]} */
    viewOrder:    [],
    /** @type {number[]} */
    picOrder:     [],
    logicNo:      0,

    soundEmulator: null, // SoundEmulatorTiSn76496a,
    playedSound:   null,

    textFG:                15,      // set.text.attribute (NAGI state.text_fg)
    textBG:                0,       // text background: 0, or 0xFF for white (NAGI state.text_bg)
    textComb:              15,      // attribute text is written in (NAGI state.text_comb; text.js)
    debugFrameData:        null,    // ImageData // For checking various visual / priority aspects
    /** @type {any} ImageData */
    frameData:             null,
    allowInput:            true,
    hasQuit:               false,

    dialogue:       false, // a message window or open.dialogue (NAGI msgstate.dialogue_open)

    menuState: 1, // allow.menu (NAGI state.menu_state)

    actionContainerElement: null,
};

export function resetControllers() {
    state.controllers.fill(0);
}

export function restart() {
    state.hasQuit   = false;

    resetControllers();
    state.keysForControllers = {};
    state.parsedWords        = [];
    state.inputLine          = '';

    state.variables.fill(0);
    state.flags.fill(0);
    // Every item starts in the room the OBJECT file gives it (NAGI initialise.c: game_init()
    // reloads the object file). This used to leave every item in room 0.
    state.items.fill(0);
    inventoryObjects.forEach((obj, i) => state.items[i] = obj.room);

    state.variables[VAR.video_mode]    = 3; // EGA
    state.variables[VAR.free_memory]   = 255;
    state.variables[VAR.sound_volume]  = 15;
    state.variables[VAR.max_input_len] = 41;

    state.flags[FLAG.sound_on]      = 1;
    state.flags[FLAG.noise_enabled] = 1;
    state.flags[FLAG.new_room]      = 1;

    resetBlitLists();
    state.blockState = false;
    for (let i = MAX_GAMEOBJECTS; i-- > 0;) {
        state.gameObjects[i] = newObject(i);
    }
    roomInit();
    loadLogic(0);
}

export function updateSound() {
    state.soundEmulator.muted = !state.flags[FLAG.sound_on];
}
