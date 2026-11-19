import {load, inventoryObjects} from './resources';
import interpreter from './interpreter';
import {VAR} from './constants'
import TTS from './tts';
import {state} from './state';
import {commands} from './logicCommands';
import {initGamePicker} from './gameLibrary';

let renderRAF;
let renderPrevTime = 0;
let isStarting     = false;

const gamePickerEl = document.getElementById('game-picker');

// When a game starts without a user gesture (?game= in the URL), the browser keeps the
// AudioContext suspended. Resume it on the first click or key press, unless the game is paused.
const resumeAudioOnGesture = () => {
    if (!AGI.state || !renderRAF) return;
    AGI.state.soundEmulator.activate();
    removeEventListener('pointerdown', resumeAudioOnGesture, true);
    removeEventListener('keydown', resumeAudioOnGesture, true);
};
addEventListener('pointerdown', resumeAudioOnGesture, true);
addEventListener('keydown', resumeAudioOnGesture, true);

window.AGI = {
    hasStarted: false,
    FPS:        40,
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
        AGI.bltDebug = interpreter.bltDebug;
        AGI.TTS      = TTS;
        AGI.inv      = inventoryObjects;

        AGI.togglePause(); // starts the game loop
    },

    render: () => {
        if (!AGI.state) return;
        if (AGI.state.hasQuit) return;

        const now = Date.now();

        if (now - renderPrevTime > 1000 / AGI.FPS * Math.max(state.variables[VAR.cycle_delay], 1)) {
            interpreter.cycle();
            renderPrevTime = now;
        }

        renderRAF = requestAnimationFrame(AGI.render);
    },

    togglePause: () => {
        if (!AGI.state) return;

        if (renderRAF) {
            AGI.canvasEl.style.opacity = 0.4;
            cancelAnimationFrame(renderRAF);
            renderRAF = null;
            AGI.state.soundEmulator.deactivate();
        } else {
            AGI.canvasEl.style.opacity = 1;

            AGI.state.soundEmulator.activate();
            AGI.render();
        }
    }
};

initGamePicker(gamePickerEl, source => AGI.start(source));
