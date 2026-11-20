// @ts-check

/**
 * The debug panel: room, cycle and ego; the last parsed input and the said() test that
 * matched it; the last message printed; recently changed variables and flags; commands
 * the game used that aren't implemented; a live view of the priority screen; and buttons
 * to save the session recording or replay a recording file; a toggle for text-to-speech.
 *
 * Toggle with Ctrl+` (no AGI key uses it), ?debug in the URL, or AGI.toggleDebug().
 */

import {state} from './state';
import {VAR} from './constants';
import {debugInfo, onUnimplemented, unimplemented} from './diagnostics';
import {messageLog, onMessage} from './dialogs';
import {getCyclesDone} from './recorder';
import screen from './screen';
import TTS from './tts';

const MAX_CHANGES   = 40;
const CLOCK_VARS    = new Set([VAR.clock_seconds, VAR.clock_minutes, VAR.clock_hours, VAR.clock_days]);

/** @typedef {{cycle: number, kind: 'v'|'f', no: number, from: number, to: number}} Change */

/** @type {Change[]} newest last */
const changes = [];
let prevVariables = new Uint8Array(256);
let prevFlags     = new Uint8Array(256);

/** @type {HTMLElement|null} */
let panel = null;
let renderQueued = false;
let showPriority = false;
let hideClock    = true;

/** @type {HTMLCanvasElement|null} */
let priorityCanvas = null;
/** @type {ImageData|null} */
let priorityImage  = null;
/** @type {HTMLElement|null} parts of the panel body that render() fills */
let topPart        = null;
/** @type {HTMLElement|null} */
let changesList    = null;
/** @type {HTMLElement|null} */
let bottomPart     = null;

/**
 * Creates the panel (hidden) and the Ctrl+` shortcut.
 * @param {{downloadRecording: () => void, replay: (json: string) => void}} actions
 */
export function initDebugPanel(actions) {
    panel = document.getElementById('debug-panel');
    if (!panel) return;

    panel.replaceChildren();

    const header = el('div', 'debug-header');
    header.append(el('strong', '', 'Debug'), el('span', 'debug-hint', ' Ctrl+`'));

    const buttons = el('div', 'debug-buttons');
    buttons.append(
        button('Close', () => toggleDebugPanel()),
        button('Save recording', actions.downloadRecording),
        button('Replay file…', () => fileInput.click()),
        toggleButton('Priority', showPriority, on => {
            showPriority = on;
            requestRender();
        }),
    );

    buttons.append(toggleButton('Read aloud', TTS.isEnabled(), on => TTS.setEnabled(on)));

    const fileInput  = /** @type {HTMLInputElement} */ (el('input'));
    fileInput.type   = 'file';
    fileInput.accept = '.json,application/json';
    fileInput.hidden = true;
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (file) actions.replay(await file.text());
    });

    const body = el('div', 'debug-body');
    body.id    = 'debug-body';

    priorityCanvas        = /** @type {HTMLCanvasElement} */ (el('canvas', 'debug-priority'));
    priorityCanvas.width  = 320;
    priorityCanvas.height = 168;
    priorityCanvas.hidden = true;

    const clockToggle   = /** @type {HTMLInputElement} */ (el('input'));
    clockToggle.type    = 'checkbox';
    clockToggle.checked = hideClock;
    clockToggle.addEventListener('change', () => {
        hideClock = clockToggle.checked;
        requestRender();
    });
    const clockLabel = el('label', 'debug-option');
    clockLabel.append(clockToggle, ' hide clock (v11-v14)');

    // The body's structure is made once and render() only replaces what's inside topPart,
    // changesList and bottomPart. render() runs after every cycle; the checkbox (or the
    // canvas) taken out of the page between a click's mousedown and mouseup never toggles.
    topPart     = el('div');
    changesList = el('div');
    bottomPart  = el('div');
    body.append(topPart, priorityCanvas, section('Changed variables and flags', clockLabel, changesList), bottomPart);

    panel.append(header, buttons, fileInput, body);

    addEventListener('keydown', e => {
        if (e.ctrlKey && e.code === 'Backquote') {
            e.preventDefault();
            toggleDebugPanel();
        }
    });

    onMessage(requestRender);
    onUnimplemented(requestRender);
}

/** Shows or hides the panel. */
export function toggleDebugPanel() {
    if (!panel) return;
    panel.hidden = !panel.hidden;
    requestRender();
}

/** Call after every cycle: tracks changed variables and flags, and refreshes the panel. */
export function debugAfterCycle() {
    const cycle = getCyclesDone() - 1;

    for (let i = 0; i < 256; i++) {
        if (state.variables[i] !== prevVariables[i]) {
            changes.push({cycle, kind: 'v', no: i, from: prevVariables[i], to: state.variables[i]});
        }
        if (state.flags[i] !== prevFlags[i]) {
            changes.push({cycle, kind: 'f', no: i, from: prevFlags[i], to: state.flags[i]});
        }
    }
    if (changes.length > 1000) changes.splice(0, changes.length - 1000);

    prevVariables = state.variables.slice();
    prevFlags     = state.flags.slice();

    requestRender();
}

function requestRender() {
    if (!panel || panel.hidden || renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
        renderQueued = false;
        render();
    });
}

function render() {
    const body = document.getElementById('debug-body');
    if (!body || !state.gameObjects[0]) return;

    const v   = state.variables;
    const ego = state.gameObjects[0];

    const sections = [];

    sections.push(section('Game',
        line(`room ${v[VAR.room_no]} (from ${v[VAR.prev_room_no]}) · cycle ${getCyclesDone()}`),
        line(`ego ${ego.x},${ego.y} dir ${ego.direction} · v6 ${v[VAR.ego_dir]} · ${state.programControl ? 'program' : 'player'} control`),
        line(`v10 delay ${v[VAR.cycle_delay]} · score ${v[VAR.score]}/${v[VAR.max_score]} · clock ${v[VAR.clock_hours]}:${pad(v[VAR.clock_minutes])}:${pad(v[VAR.clock_seconds])}`),
    ));

    const parse = debugInfo.lastParse;
    if (parse) {
        const words = parse.words.map(w => w.group === 0 ? `${w.text} (unknown)` : `${w.text} (${w.group})`).join(' · ') || '(no words)';
        const said  = debugInfo.lastSaid && debugInfo.lastSaid.cycle === parse.cycle
            ? `matched said(${debugInfo.lastSaid.groups.join(', ')}) in logic ${debugInfo.lastSaid.logicNo}`
            : 'no said() matched';
        sections.push(section(`Input (cycle ${parse.cycle})`,
            line(`"${parse.text}"`),
            line(words + (parse.unknownWord ? ` · v9 = ${parse.unknownWord}` : '')),
            line(said),
        ));
    }

    const message = messageLog[messageLog.length - 1];
    if (message) {
        const text = message.text.length > 300 ? message.text.slice(0, 300) + '…' : message.text;
        sections.push(section(`Last message (logic ${message.logicNo})`, line(text, 'debug-message')));
    }

    const shown = changes
        .filter(c => !(hideClock && c.kind === 'v' && CLOCK_VARS.has(c.no)))
        .slice(-MAX_CHANGES)
        .reverse()
        .map(c => line(`#${c.cycle} ${c.kind}${c.no} ${c.from} → ${c.to}`));

    const missing = [...unimplemented.values()].map(u =>
        line(`${u.kind === 'stub' ? 'stub' : 'missing'} ${u.name} ×${u.count} (logic ${u.logicNo}, room ${u.room})`));

    topPart?.replaceChildren(...sections);
    changesList?.replaceChildren(...(shown.length ? shown : [line('none yet')]));
    bottomPart?.replaceChildren(section('Not implemented', ...(missing.length ? missing : [line('none used yet')])));

    if (priorityCanvas) {
        priorityCanvas.hidden = !showPriority;
        if (showPriority && state.picBuffer) {
            const ctx = priorityCanvas.getContext('2d');
            if (ctx) {
                priorityImage ??= new ImageData(320, 200);
                screen.renderPriority(priorityImage);
                ctx.putImageData(priorityImage, 0, 0);
            }
        }
    }
}

/** @param {number} n */
const pad = n => String(n).padStart(2, '0');

/**
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text]
 */
function el(tag, className = '', text = '') {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text) e.textContent = text;
    return e;
}

/** @param {string} text @param {string} [className] */
const line = (text, className = 'debug-line') => el('div', className, text);

/** @param {string} title @param {...(Node|string)} children */
function section(title, ...children) {
    const s = el('section', 'debug-section');
    s.append(el('h4', '', title), ...children);
    return s;
}

/** @param {string} label @param {() => void} onClick */
function button(label, onClick) {
    const b = /** @type {HTMLButtonElement} */ (el('button', '', label));
    b.type = 'button';
    b.addEventListener('click', () => {
        onClick();
        b.blur(); // keep keys going to the game
    });
    return b;
}

/**
 * A button that stays pressed while on (aria-pressed, styled in index.html).
 * @param {string} label @param {boolean} on @param {(on: boolean) => void} onChange
 */
function toggleButton(label, on, onChange) {
    const b = button(label, () => {
        on = !on;
        b.setAttribute('aria-pressed', String(on));
        onChange(on);
    });
    b.classList.add('debug-toggle');
    b.setAttribute('aria-pressed', String(on));
    return b;
}
