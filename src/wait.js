// @ts-check
// Portions ported from NAGI (c) 2001-2002 Nick Sonneveld, X11 license, see licenses/NAGI-LICENSE.txt
// (ui/events.c, ui/msg.c, sys/delay.c)

/**
 * Waiting for the player inside a command. NAGI blocks in the command itself (a message
 * window waits for Enter before the logic goes on). Here logic runs as a generator
 * (logic.js), and a command that waits is a generator too: each `yield` hands control
 * back to the game loop for one poll, and the logic carries on where it stopped once the
 * wait is over.
 *
 * Every poll goes through the recorder, so a replay feeds each key to the same poll.
 */

import {charPoll, eventInject, eventsClear} from './events';
import {waitBegin, waitEnd, waitPoll} from './recorder';

/** One AGI tick is 50 ms. NAGI sys/delay.c: DELAY_MULT */
const DELAY_MULT = 50;

/**
 * The current AGI tick (20 per second).
 * NAGI sys/delay.c: calc_agi_tick()
 */
export const agiTick = () => Math.floor(performance.now() / DELAY_MULT);

/**
 * Reads one event: 1 for Enter, 0 for Esc, null for anything else or nothing.
 * NAGI ui/events.c: has_user_reply() (0xFFFF is null here)
 * @returns {1|0|null}
 */
function hasUserReply() {
    for (const event of waitPoll()) eventInject(event);
    switch (charPoll()) {
        case 0x0D: return 1;
        case 0x1B: return 0;
        default:   return null;
    }
}

/**
 * Drops queued events, then waits for Enter (returns 1) or Esc (returns 0). Other keys
 * are read and dropped.
 * NAGI ui/events.c: user_bolean_poll()
 * @returns {Generator<void, 1|0, void>}
 */
export function* userBooleanPoll() {
    eventsClear();
    waitBegin();
    let reply;
    while ((reply = hasUserReply()) === null) yield;
    waitEnd();
    return reply;
}

/**
 * Waits until `ticks` ticks have passed or Enter or Esc is pressed. Queued events are
 * kept; other keys are read and dropped. (In a replay, the wait ends at the poll it ended
 * at when recorded.)
 * NAGI ui/msg.c: message_box(), the loop for v21 > 0
 * @param {number} ticks
 * @returns {Generator<void, void, void>}
 */
export function* waitTicksOrReply(ticks) {
    const recordedPolls = waitBegin();
    const end = agiTick() + ticks;
    let polls = 0;
    for (;;) {
        const timeLeft = recordedPolls !== null ? polls < recordedPolls : agiTick() < end;
        if (!timeLeft) break;
        polls++;
        if (hasUserReply() !== null) break;
        yield;
    }
    waitEnd();
}
