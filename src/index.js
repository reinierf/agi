import {load, inventoryObjects} from './resources';
import interpreter from './interpreter';
import {FLAG, VAR} from './constants'
import TTS from './tts';
import {state} from './state';
import {commands} from './logicCommands';
import {initGamePicker} from './gameLibrary';
import {unimplementedSummary} from './diagnostics';

// Portions ported from NAGI (c) 2001-2002 Nick Sonneveld, X11 license, see licenses/NAGI-LICENSE.txt
// (sys/delay.c)

let loopTimer      = null;  // pending setTimeout of the game loop; null while paused
let tickPrev       = 0;     // when the previous cycle started
let isStarting     = false;

// One AGI tick is 50 ms (20 per second). A cycle lasts at least v10 ticks.
// NAGI sys/delay.c: DELAY_MULT
const DELAY_MULT = 50;
// How often input is polled while waiting (NAGI sleeps 5 ms between polls).
const POLL_INTERVAL = 5;

const gamePickerEl = document.getElementById('game-picker');

// When a game starts without a user gesture (?game= in the URL), the browser keeps the
// AudioContext suspended. Resume it on the first click or key press, unless the game is paused.
const resumeAudioOnGesture = () => {
    if (!AGI.state || !loopTimer) return;
    AGI.state.soundEmulator.activate();
    removeEventListener('pointerdown', resumeAudioOnGesture, true);
    removeEventListener('keydown', resumeAudioOnGesture, true);
};
addEventListener('pointerdown', resumeAudioOnGesture, true);
addEventListener('keydown', resumeAudioOnGesture, true);

window.AGI = {
    hasStarted: false,
    state:      null,
    commands:   null,
    canvasEl:   null,
    TTS:        null,
    inv:        null,

    /** Loads a game and starts running it. Only one game can be loaded per page. */
    start: async source => {
        if (AGI.state || isStarting) return;

        isStarting = true;

        try {
            await load(source);
        } catch (e) {
            console.error(e);
            alert(`Could not load the game: ${e.message}`);
            return;
        }

        AGI.hasStarted = true;
        AGI.canvasEl   = document.getElementById('canvas');

        TTS.init();

        interpreter.init(
            AGI.canvasEl.getContext("2d"),
            new AudioContext(),
            document.getElementById('menu'),
            document.getElementById('actions'),
            document.getElementById('player-input'),
        );

        AGI.state    = state;
        AGI.commands = commands;
        AGI.cycle    = interpreter.cycle;
        interpreter.beginCycle();
        AGI.bltDebug = interpreter.bltDebug;
        AGI.TTS      = TTS;
        AGI.inv      = inventoryObjects;
        AGI.unimplemented = unimplementedSummary;

        AGI.togglePause(); // starts the game loop
    },

    /**
     * The game loop. Polls input every few milliseconds and runs a cycle once v10 ticks
     * have passed since the previous one, or as soon as the player enters a command
     * (flag 2), like do_delay() in NAGI sys/delay.c and the main loop in nagi_main.c.
     */
    loop: () => {
        loopTimer = null;
        if (!AGI.state || AGI.state.hasQuit) return;

        interpreter.inputPoll();

        const now = performance.now();
        if (now - tickPrev >= state.variables[VAR.cycle_delay] * DELAY_MULT || state.flags[FLAG.input_received]) {
            tickPrev = now;
            interpreter.runCycle();
            interpreter.beginCycle();
        }

        loopTimer = setTimeout(AGI.loop, POLL_INTERVAL);
    },

    /**
     * Shows or hides jsyang's word-group buttons, a debug view of the said() tests the game
     * has run. Clicking one stores those word groups as if the player had typed them.
     */
    toggleWordButtons: () => {
        for (const id of ['player-input', 'actions']) {
            const el = document.getElementById(id);
            if (el) el.hidden = !el.hidden;
        }
    },

    togglePause: () => {
        if (!AGI.state) return;

        if (loopTimer) {
            AGI.canvasEl.style.opacity = 0.4;
            clearTimeout(loopTimer);
            loopTimer = null;
            AGI.state.soundEmulator.deactivate();
        } else {
            AGI.canvasEl.style.opacity = 1;

            AGI.state.soundEmulator.activate();
            AGI.loop();
        }
    }
};

initGamePicker(gamePickerEl, source => AGI.start(source));

if (new URLSearchParams(location.search).has('wordbuttons')) {
    AGI.toggleWordButtons();
}
