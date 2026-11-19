// @ts-check
// Portions ported from NAGI (c) 2001-2002 Nick Sonneveld, X11 license, see licenses/NAGI-LICENSE.txt
// (sys/time.c)

/**
 * The game clock in v11 (seconds), v12 (minutes), v13 (hours) and v14 (days). It counts
 * the time the game has been running, starting from 0 (the variables are cleared when a
 * game starts or restarts); it is not the time of day.
 *
 * NAGI updates it from a separate thread. Here the elapsed time is measured by the game
 * loop and applied at the start of each cycle (see recorder.js for replays).
 */

import {VAR} from './constants';

let pendingMs = 0;
let last      = 0;

/** Starts measuring from now, e.g. when the game starts or resumes from a pause. */
export function clockResume() {
    last = performance.now();
}

/** Whole seconds that have passed since the previous call (or clockResume()). */
export function clockElapsedSeconds() {
    const now = performance.now();
    pendingMs += now - last;
    last = now;

    const seconds = Math.floor(pendingMs / 1000);
    pendingMs -= seconds * 1000;
    return seconds;
}

/**
 * Adds seconds to the game clock, carrying into minutes, hours and days.
 * NAGI sys/time.c: clock_thread()
 * @param {Uint8Array} variables
 * @param {number} seconds
 */
export function clockAdvance(variables, seconds) {
    for (let i = 0; i < seconds; i++) {
        variables[VAR.clock_seconds]++;

        if (variables[VAR.clock_seconds] >= 60) {
            variables[VAR.clock_seconds] = 0;
            variables[VAR.clock_minutes]++;
        }
        if (variables[VAR.clock_minutes] >= 60) {
            variables[VAR.clock_minutes] = 0;
            variables[VAR.clock_hours]++;
        }
        if (variables[VAR.clock_hours] >= 24) {
            variables[VAR.clock_hours] = 0;
            variables[VAR.clock_days]++;
        }
    }
}
