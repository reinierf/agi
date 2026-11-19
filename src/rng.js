// @ts-check
// Portions ported from NAGI (c) 2001-2002 Nick Sonneveld, X11 license, see licenses/NAGI-LICENSE.txt
// (sys/rand.c)

/**
 * AGI's random number generator: a 16-bit linear congruential generator, seeded from the
 * clock the first time it is used (and again whenever the seed becomes 0). The seed comes
 * through `seedSource`, so a recording can store it and a replay can use the same one.
 */

let seed = 0;

/** NAGI's seed: the time in 1/20 seconds (Tandy clock rate). */
export const timeSeed = () => {
    const t = Date.now();
    return (Math.floor(t / 1000) * 20 + Math.floor((t % 1000) / 1000 * 20)) & 0xFFFF;
};

let seedSource = timeSeed;

/** @param {() => number} fn returns a new seed when the generator needs one */
export function setSeedSource(fn) {
    seedSource = fn;
}

/**
 * A random byte, 0-255.
 * NAGI sys/rand.c: agi_rand()
 */
export function agiRand() {
    if (seed === 0) {
        seed = seedSource() & 0xFFFF;
    }
    seed = (Math.imul(0x7C4D, seed) + 1) & 0xFFFF;
    return (seed ^ (seed >> 8)) & 0xFF;
}

/**
 * A random whole number from `min` up to but not including `max`, from agiRand().
 * Used where jsyang's code picks a random value (wander); not an AGI function itself.
 * @param {number} min
 * @param {number} max
 */
export const randomBetween = (min, max) => min + agiRand() % (max - min);
