// @ts-check
// Portions ported from NAGI (c) 2001-2002 Nick Sonneveld, X11 license, see licenses/NAGI-LICENSE.txt
// (ui/msg.c, ui/string.c)

/**
 * AGI's word wrap for message windows and display: fills in %-codes and breaks the text
 * into lines.
 *
 * A pure function with no interpreter state, so it can be unit-tested on its own; the
 * values for %-codes come from the `lookup` the caller passes (msg.js).
 */

/**
 * Values for the %-codes in a message. Each returns null (or undefined) when there's
 * nothing to insert.
 * @typedef {object} WrapLookup
 * @property {(n: number) => string|null|undefined} globalMsg  %gN: message N of logic 0
 * @property {(n: number) => string|null|undefined} msg        %mN: message N of this logic
 * @property {(n: number) => string|null|undefined} object     %oN: name of the item whose number is in vN
 * @property {(n: number) => string|null|undefined} string     %sN: string N
 * @property {(n: number) => number} variable                  %vN: variable N
 * @property {(n: number) => string|null|undefined} word      %wN: word N (1-based) the player typed
 */

/**
 * @typedef {object} Wrapped
 * @property {string} text    the lines, separated by '\n'
 * @property {number} width   the widest line (NAGI msgstate.tsize.w)
 * @property {number} height  the number of lines (NAGI msgstate.tsize.h)
 */

/** NAGI ui/msg.c: HEIGHT_MAX (EGA). Wrapping stops once this many lines are full. */
export const HEIGHT_MAX = 20;

/**
 * Wraps `str` to lines of at most `width` characters, filling in %-codes.
 *
 * Quirks kept from AGI:
 * - a line is full at `width` characters even if the next one is a space, so a word that
 *   ends exactly at the edge still moves to the next line;
 * - text that fills the last line exactly ends with an empty line;
 * - spaces before a break stay at the end of the line (NAGI's loop that would skip them
 *   tests the '\n' it has just written, so it never skips any);
 * - a line feed doesn't forget the last space of the line before it;
 * - the character after `newlineChar` ('\\') is put in as it is;
 * - '%' followed by an unknown code drops both characters.
 *
 * NAGI ui/msg.c: str_wordwrap(), r_display1f93() (_Display1F93), display_new_line(),
 * str_to_int_ptr()
 * @param {string|null} str   null: no text (an empty window of 0 lines)
 * @param {number} width
 * @param {WrapLookup} lookup
 * @param {string} [newlineChar]
 * @returns {Wrapped}
 */
export function wordwrap(str, width, lookup, newlineChar = '\\') {
    /** @type {string[]} the wrapped text, one character per element */
    const out  = [];
    let charCur  = 0;   // characters on the current line
    let lastWord = -1;  // index in `out` of the last space on the line, -1 if none
    let w = 0;
    let h = 0;

    const newLine = () => {
        h++;
        if (charCur > w) w = charCur;
        charCur = 0;
    };

    /** @param {string} s @param {number} i @returns {[number, number]} */
    const strToInt = (s, i) => {
        let n = 0;
        while (i < s.length && s[i] >= '0' && s[i] <= '9') n = n * 10 + s.charCodeAt(i++) - 48;
        return [n, i];
    };

    /** @param {string|null|undefined} source */
    const add = source => {
        if (source === null || source === undefined) return;
        let i = 0;

        while (i < source.length && h <= HEIGHT_MAX - 1) {
            while (charCur < width) {
                if (i >= source.length) return;
                const c = source[i];

                if (c === newlineChar) {
                    i++;
                    if (i >= source.length) return;
                    out.push(source[i++]);
                    charCur++;
                } else if (c === '\n') {
                    out.push(source[i++]);
                    newLine();
                } else if (c === ' ') {
                    lastWord = out.length;
                    out.push(source[i++]);
                    charCur++;
                } else if (c === '%') {
                    const code = source[i + 1];
                    i += 2;
                    if (code === undefined || !'gmosvw'.includes(code)) continue; // unknown: both dropped
                    let n;
                    [n, i] = strToInt(source, i);
                    switch (code) {
                        case 'g': add(lookup.globalMsg(n)); break;
                        case 'm': add(lookup.msg(n)); break;
                        case 'o': add(lookup.object(n)); break;
                        case 's': add(lookup.string(n)); break;
                        case 'v': {
                            let text = String(lookup.variable(n));
                            if (source[i] === '|') {
                                let pad;
                                [pad, i] = strToInt(source, i + 1);
                                text = text.padStart(pad, '0'); // NAGI ui/string.c: string_zero_pad()
                            }
                            add(text);
                            break;
                        }
                        case 'w': add(n >= 1 ? lookup.word(n) : null); break;
                    }
                } else {
                    out.push(source[i++]);
                    charCur++;
                }
            }

            // The line is full.
            if (lastWord < 0) {
                out.push('\n');
                newLine();
            } else {
                // Break at the last space: what follows it moves to the next line.
                charCur -= out.length - lastWord;
                newLine();
                out[lastWord] = '\n';
                charCur += out.length - (lastWord + 1);
                lastWord = -1;
            }
        }
    };

    if (str !== null) {
        add(str);
        newLine();
    }
    return {text: out.join(''), width: w, height: h};
}
