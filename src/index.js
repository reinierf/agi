import {load, inventoryObjects} from './resources';
import interpreter from './interpreter';
import {FLAG, VAR} from './constants'
import TTS from './tts';
import {state} from './state';
import {commands} from './logicCommands';
import {initGamePicker} from './gameLibrary';
import {unimplementedSummary} from './diagnostics';
import {
    getCyclesDone, getRecording, getReplayResult, isReplaying, onReplayFinished, recordValue,
    cyclePaused, cycleResume, startRecording, startReplay, takeReplayEvents,
} from './recorder';
import {eventInject} from './events';
import {setSeedSource, timeSeed} from './rng';
import {clockResume} from './clock';
import {initDialogs} from './dialogs';
import {initDebugPanel, toggleDebugPanel} from './debugPanel';

// Portions ported from NAGI (c) 2001-2002 Nick Sonneveld, X11 license, see licenses/NAGI-LICENSE.txt
// (sys/delay.c)

let loopTimer      = null;  // pending setTimeout of the game loop; null while paused
/** @type {Generator<void, void, void>|null} the cycle that is running: it waits for the player */
let running        = null;
let tickPrev       = 0;     // when the previous cycle started
let isStarting     = false;
let replayRealtime = false; // replay at the game's own speed instead of as fast as possible
let replayPause    = false; // pause the game where the replay ends

// A replay is started by storing it here and reloading the page (see AGI.replay).
const REPLAY_STORAGE_KEY = 'agi-replay';

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

        // Record from the very start, and replay a recording if one is pending.
        const gameId = new URLSearchParams(location.search).get('game') || source.url || '';
        startRecording(gameId);
        setSeedSource(() => recordValue('seed', timeSeed));
        startPendingReplay();

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

        initDialogs(TTS);
        clockResume();
        if (isReplaying() && !replayRealtime) state.soundEmulator.silence(true);

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

        if (isReplaying()) {
            replayStep();
            if (replayPause && !isReplaying()) {
                // Stop exactly after the last recorded cycle; togglePause() resumes.
                AGI.canvasEl.style.opacity = 0.4;
                AGI.state.soundEmulator.deactivate();
                return;
            }
            loopTimer = setTimeout(AGI.loop, replayRealtime ? POLL_INTERVAL : 0);
            return;
        }

        const now = performance.now();
        if (running) {
            // The cycle waits (a message window, have.key): it polls input itself.
            stepCycle(false);
        } else {
            interpreter.inputPoll();
            if (now - tickPrev >= state.variables[VAR.cycle_delay] * DELAY_MULT || state.flags[FLAG.input_received]) {
                tickPrev = now;
                running  = interpreter.runCycle();
                stepCycle(true);
            }
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

    /**
     * The recording of this session so far (from the game's first cycle).
     * @returns {import('./recorder').Recording}
     */
    recording: () => getRecording(),

    /** Saves the recording of this session as a JSON file. */
    downloadRecording: () => {
        const rec  = getRecording();
        const blob = new Blob([JSON.stringify(rec)], {type: 'application/json'});
        const a    = document.createElement('a');
        a.href     = URL.createObjectURL(blob);
        a.download = `${rec.game || 'agi'}-${rec.cycles}-cycles.agirec.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    },

    /**
     * Replays a recording: reloads the page with the recording's game and feeds it the
     * recorded input, cycle by cycle. The result is in AGI.replayResult() and on the console.
     * @param {import('./recorder').Recording|string} recording  the recording or its JSON
     * @param {{realtime?: boolean, pause?: boolean}} [options]  realtime: play at the game's
     *   own speed; pause: stop the game right after the last recorded cycle
     */
    replay: (recording, options) => {
        const rec = typeof recording === 'string' ? JSON.parse(recording) : recording;
        sessionStorage.setItem(REPLAY_STORAGE_KEY, JSON.stringify({rec, realtime: !!options?.realtime, pause: !!options?.pause}));
        const url = new URL(location.href);
        url.searchParams.set('game', rec.game);
        url.hash = '';
        location.assign(url);
    },

    /** @returns {import('./recorder').ReplayResult|null} */
    replayResult: () => getReplayResult(),

    /** Shows or hides the debug panel (also Ctrl+`). */
    toggleDebug: () => toggleDebugPanel(),

    /** Number of cycles run since the game started. */
    cycles: () => getCyclesDone(),

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
            clockResume();
            AGI.loop();
        }
    }
};

/**
 * Runs the current cycle until it ends or yields (it waits for the player, or have.key
 * lets keys arrive). When it ends, the next one is begun (NAGI resets the input state
 * before the delay).
 * @param {boolean} first  the cycle starts now (not a resume)
 */
function stepCycle(first) {
    if (!first) cycleResume().forEach(eventInject);
    if (running.next().done) {
        running = null;
        interpreter.beginCycle();
    } else {
        cyclePaused();
        interpreter.bltFrame(); // show what the waiting command drew
    }
}

/** Starts the replay stored by AGI.replay(), if any. */
function startPendingReplay() {
    const pending = sessionStorage.getItem(REPLAY_STORAGE_KEY);
    if (!pending) return;
    sessionStorage.removeItem(REPLAY_STORAGE_KEY);

    const {rec, realtime, pause} = JSON.parse(pending);
    startReplay(rec);
    replayRealtime = realtime;
    replayPause    = !!pause;
    console.info(`AGI: replaying ${rec.cycles} cycles of ${rec.game}${realtime ? ' in real time' : ''}`);
}

/**
 * Runs replay cycles: as many as fit in about 20 ms, or one per v10 ticks in real time.
 * Each cycle gets the events recorded before it, then runs like a live cycle.
 */
function replayStep() {
    const end = performance.now() + 20;
    do {
        if (running) {
            stepCycle(false);
            if (running && replayRealtime) return; // still waiting: poll again in the next loop
            continue;
        }
        const now = performance.now();
        if (replayRealtime && now - tickPrev < state.variables[VAR.cycle_delay] * DELAY_MULT) return;
        tickPrev = now;

        takeReplayEvents().forEach(eventInject);
        interpreter.inputPoll();
        running = interpreter.runCycle();
        stepCycle(true);
    } while (!replayRealtime && isReplaying() && performance.now() < end);
}

onReplayFinished(result => {
    AGI.state?.soundEmulator.silence(false);
    clockResume();
    const where = result.firstMismatch
        ? ` First difference in cycle ${result.firstMismatch.cycle} (room ${result.firstMismatch.room}): ${result.firstMismatch.parts.join(', ')}.` +
          (result.firstMismatch.details.length ? ` ${result.firstMismatch.details.join('; ')}` : '')
        : '';
    const log = result.status === 'passed' ? console.info : console.warn;
    log(`AGI: replay ${result.status}: ${result.cycles} cycles, ${result.mismatches} with differences.${where}` +
        (result.problems.length ? '\n  ' + result.problems.join('\n  ') : ''));
});

initDebugPanel({downloadRecording: AGI.downloadRecording, replay: json => AGI.replay(json)});
if (new URLSearchParams(location.search).has('debug')) {
    toggleDebugPanel();
}

initGamePicker(gamePickerEl, source => AGI.start(source));

if (new URLSearchParams(location.search).has('wordbuttons')) {
    AGI.toggleWordButtons();
}
