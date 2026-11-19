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

const gamePickerEl     = document.getElementById('game-picker');
const getSelectedGame  = initGamePicker(gamePickerEl);

window.AGI = {
    hasStarted: false,
    FPS:        40,
    state:      null,
    commands:   null,
    canvasEl:   null,
    TTS:        null,
    inv:        null,

    start: async () => {
        if (AGI.state || isStarting) return;

        const source = (await getSelectedGame)();
        if (!source) {
            alert('No game selected. Put a game in the games/ folder (see README) and reload.');
            return;
        }

        isStarting = true;
        gamePickerEl.disabled = true;

        try {
            await load(source);
        } catch (e) {
            isStarting = false;
            gamePickerEl.disabled = false;
            console.error(e);
            alert(`Could not load the game: ${e.message}`);
            return;
        }

        gamePickerEl.hidden = true;
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
