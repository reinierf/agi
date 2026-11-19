// @ts-check
// Portions ported from NAGI (c) 2001-2002 Nick Sonneveld, X11 license, see licenses/NAGI-LICENSE.txt
// (ui/parse.c, logic/logic_eval.c)

/**
 * The AGI text parser: turns a line the player typed into word-group numbers using the
 * game's WORDS.TOK, and matches those against said() tests.
 *
 * Pure functions with no interpreter state, so they can be unit-tested on their own. The
 * interpreter applies the results (flag 2, v9, the stored words) in logicCommands.js.
 */

export const WORD_IGNORE   = 0;     // filler words ("the", "a", ...): skipped
export const WORD_ANY      = 1;     // said(): matches any one word
export const WORD_ROL      = 9999;  // said(): matches the rest of the line
export const WORD_BUF_SIZE = 10;    // at most this many words are stored
export const PARSE_BUF_SIZE = 42;   // NAGI's parse_string[42]

const NOT_FOUND = 0xFFFF;

const CHAR_SEPARATORS = ' ,.?!();:[]{}';
const CHAR_ILLEGAL    = '\'`-"';

/**
 * @typedef {object} ParsedWord
 * @property {number} group  Word-group number; 0 for the unknown word.
 * @property {string} text   The player's text for this word (may contain a space for
 *                           dictionary phrases such as "look at").
 */

/**
 * @typedef {object} ParseResult
 * @property {ParsedWord[]} words  Stored words, including an unknown word if there was one.
 * @property {number} unknownWord  1-based position of the unknown word (the value for v9),
 *                                 or 0 if every word was known.
 */

/**
 * Cleans the player's text: separators end a word (several in a row count as one),
 * illegal characters are dropped, and words end up separated by single spaces.
 *
 * NAGI ui/parse.c: parse_read() (_ParseClean)
 * @param {string} str
 * @returns {string}
 */
export function cleanInput(str) {
    let buf = '';
    let i   = 0;

    while (i < str.length) {
        // Skip excess separators at the start and between words.
        if (CHAR_SEPARATORS.includes(str[i]) || CHAR_ILLEGAL.includes(str[i])) {
            i++;
        } else {
            do {
                if (CHAR_SEPARATORS.includes(str[i])) {
                    buf += ' ';
                    break;
                }

                if (!CHAR_ILLEGAL.includes(str[i])) {
                    buf += str[i];
                }
                i++;
            } while (i < str.length);
        }
    }

    if (buf.endsWith(' ')) {
        buf = buf.slice(0, -1);
    }

    // NAGI writes into a 42-byte buffer without a bounds check; input is never longer
    // (the input line holds at most 40 characters, AGI strings 40).
    return buf.slice(0, PARSE_BUF_SIZE - 1);
}

/** @param {Uint8Array} data @param {number} offset */
const loadBE16 = (data, offset) => (data[offset] << 8) | data[offset + 1];

/**
 * Skips past the current dictionary entry. Returns the offset of the next entry, or -1 at
 * the end of the data (NAGI has no end check; real files never need it).
 *
 * NAGI ui/parse.c: dictWordNext() (_WordNext)
 * @param {Uint8Array} data
 * @param {number} offset
 */
function dictWordNext(data, offset) {
    while (offset < data.length && (data[offset] & 0x80) === 0) {
        offset++;
    }
    return offset < data.length ? offset + 3 : -1;
}

/**
 * Looks up the word that starts at `pos` in `str` (cleaned input). Finds the longest
 * dictionary entry that matches whole words, since entries can contain spaces.
 *
 * WORDS.TOK layout: 26 big-endian offsets (one per first letter), then entries. Each entry
 * is a byte with the number of leading characters shared with the previous entry, then the
 * rest of the characters XOR 0x7F, the last one with its high bit set, then the 2-byte
 * big-endian word-group number.
 *
 * NAGI ui/parse.c: word_find() (_WordFind)
 * @param {Uint8Array} data  WORDS.TOK
 * @param {string} str       cleaned input
 * @param {number} pos       start of the word in `str`
 * @returns {{wordNum: number, next: number}} wordNum is NOT_FOUND (0xFFFF) for an unknown
 *   word; next is where the following word starts (-1 if the word was not found).
 */
export function wordFind(data, str, pos) {
    const ch = (/** @type {number} */ i) => (i < str.length ? str[i].toLowerCase() : '\0');

    let wordNum   = NOT_FOUND;
    let wordNext  = -1;
    const chFirst = ch(pos);

    // Words that don't start with a letter are never looked up.
    if (chFirst < 'a' || chFirst > 'z') {
        return {wordNum, next: -1};
    }

    // A single-letter "a" or "i" is skipped automatically. The dictionary is still
    // searched, and a match there overrides this.
    if ((ch(pos + 1) === ' ' || ch(pos + 1) === '\0') && (chFirst === 'a' || chFirst === 'i')) {
        wordNum  = WORD_IGNORE;
        wordNext = pos + 1;
        if (ch(pos + 1) === ' ') wordNext++;
    }

    const indexOffset = loadBE16(data, (chFirst.charCodeAt(0) - 97) * 2);

    if (indexOffset === 0) {
        // No words start with this letter. (NAGI returns WORD_IGNORE for "a"/"i" here
        // without moving on, which would hang; no real game lacks a- and i-words.)
        return wordNext === -1 ? {wordNum: NOT_FOUND, next: -1} : {wordNum, next: wordNext};
    }

    let w       = indexOffset;
    let input   = pos;
    let chCount = 0;

    while (w !== -1 && w < data.length && data[w] >= chCount) {
        if (data[w++] === chCount) {
            while ((data[w] & 0x7F) === (ch(input).charCodeAt(0) ^ 0x7F)) {
                input++;
                chCount++;

                if (data[w] & 0x80) { // last character of the entry
                    // Only a match if the player's word (or phrase) ends here too.
                    if (ch(input) === '\0' || ch(input) === ' ') {
                        wordNum  = loadBE16(data, w + 1);
                        wordNext = input;
                        if (ch(input) !== '\0') wordNext++;
                    }
                    break;
                }

                w++;
            }
        }

        // Keep going to find the longest match.
        if (ch(input) === '\0') break;
        w = dictWordNext(data, w);
    }

    if (wordNext === -1) {
        return {wordNum: NOT_FOUND, next: -1};
    }
    return {wordNum, next: wordNext};
}

/**
 * Parses a line of player input into word groups.
 *
 * NAGI ui/parse.c: parse() (_ParseString)
 * @param {Uint8Array} data  WORDS.TOK
 * @param {string} input
 * @returns {ParseResult}
 */
export function parse(data, input) {
    const str = cleanInput(input);
    /** @type {ParsedWord[]} */
    const words     = [];
    let unknownWord = 0;
    let pos         = 0;

    while (pos < str.length && words.length < WORD_BUF_SIZE) {
        const {wordNum, next} = wordFind(data, str, pos);

        if (wordNum === NOT_FOUND) {
            const end = str.indexOf(' ', pos);
            words.push({group: 0, text: str.slice(pos, end === -1 ? str.length : end)});
            unknownWord = words.length;
            break;
        }

        if (wordNum !== WORD_IGNORE) {
            words.push({group: wordNum, text: str.slice(pos, next < str.length ? next - 1 : str.length)});
        }

        pos = next;
    }

    return {words, unknownWord};
}

/**
 * The said() test: do the stored words match these word groups?
 * Group 1 matches any one word; group 9999 matches the rest of the line. Otherwise the
 * words must match one to one, with no words left over on either side.
 *
 * It only compares if there are stored words, flag 4 (input already accepted) is clear and
 * flag 2 (player entered a command) is set. The caller sets flag 4 when this returns true.
 *
 * NAGI logic/logic_eval.c: cmd_said() (CmdSaid)
 * @param {number[]} groups        word groups in the said() test
 * @param {number[]} words         stored word groups (0 for an unknown word)
 * @param {boolean} inputReceived  flag 2
 * @param {boolean} inputAccepted  flag 4
 * @returns {boolean}
 */
export function saidMatches(groups, words, inputReceived, inputAccepted) {
    let remaining = groups.length;
    let bad       = words.length;
    let i         = 0;
    let cur       = 0;

    if (bad !== 0 && !inputAccepted && inputReceived) {
        while (remaining !== 0) {
            const num = groups[i++];
            remaining--;

            if (num === WORD_ROL) {
                remaining = 0;
                bad       = 0;
                break;
            }
            if (bad === 0) { // the test has more words than the player typed
                bad++;
                break;
            }
            if (num !== words[cur] && num !== WORD_ANY) {
                break;
            }
            cur++;
            bad--;
        }
    }

    // Note: with no stored words, a said() with no arguments is true, as in NAGI.
    return (remaining | bad) === 0;
}
