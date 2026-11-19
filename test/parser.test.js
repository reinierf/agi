// Unit tests for the AGI parser and said() matcher, using a small hand-made dictionary
// (no copyrighted game files needed). Run with `npm test`.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cleanInput, parse, saidMatches, WORD_ANY, WORD_ROL} from '../src/parser.js';

/**
 * Encodes a WORDS.TOK file: 26 big-endian offsets, then prefix-compressed entries with
 * characters XOR 0x7F, the high bit on the last character, and a big-endian group number.
 * @param {Record<string, number>} dict word -> group
 */
function makeWordsTok(dict) {
    const words  = Object.keys(dict).sort();
    const bytes  = new Array(52).fill(0);
    let previous = '';

    for (const word of words) {
        const letter = word.charCodeAt(0) - 97;
        if (bytes[letter * 2] === 0 && bytes[letter * 2 + 1] === 0) {
            bytes[letter * 2]     = bytes.length >> 8;
            bytes[letter * 2 + 1] = bytes.length & 0xFF;
            previous              = '';
        }

        let shared = 0;
        while (shared < previous.length && shared < word.length && previous[shared] === word[shared]) shared++;

        bytes.push(shared);
        for (let i = shared; i < word.length; i++) {
            let b = word.charCodeAt(i) ^ 0x7F;
            if (i === word.length - 1) b |= 0x80;
            bytes.push(b);
        }
        bytes.push(dict[word] >> 8, dict[word] & 0xFF);
        previous = word;
    }

    return new Uint8Array(bytes);
}

// Group numbers as a game would have them. 0 = filler words, 1 = "anyword", 9999 = "rol".
const DICT = makeWordsTok({
    'the':         0,
    'at':          0,
    'look':        20,
    'examine':     20,
    'look at':     21,   // a dictionary phrase
    'look around': 22,
    'get':         30,
    'take':        30,
    'pick up':     30,
    'key':         40,
    'keycard':     41,
    'door':        50,
    'open':        60,
    'anyword':     1,
    'rol':         9999,
    'i':           70,   // "i" in the dictionary overrides the automatic skip
});

const groups = result => result.words.map(w => w.group);

test('cleanInput: separators end words, several in a row count as one', () => {
    assert.equal(cleanInput('  look,,  at   the door!! '), 'look at the door');
    assert.equal(cleanInput('get key.open door'), 'get key open door');
    assert.equal(cleanInput('(look)[at]{door};:?'), 'look at door');
});

test('cleanInput: illegal characters are removed, not treated as separators', () => {
    assert.equal(cleanInput('don\'t'), 'dont');
    assert.equal(cleanInput('key-card'), 'keycard');
    assert.equal(cleanInput('"open" `door`'), 'open door');
});

test('cleanInput: empty and separator-only input', () => {
    assert.equal(cleanInput(''), '');
    assert.equal(cleanInput(' ,.!? '), '');
});

test('parse: a normal command', () => {
    const r = parse(DICT, 'open door');
    assert.deepEqual(groups(r), [60, 50]);
    assert.equal(r.unknownWord, 0);
});

test('parse: lookup is case-insensitive', () => {
    assert.deepEqual(groups(parse(DICT, 'OPEN Door')), [60, 50]);
});

test('parse: filler words (group 0) are skipped', () => {
    const r = parse(DICT, 'open the door');
    assert.deepEqual(groups(r), [60, 50]);
});

test('parse: single-letter "a" is skipped without a dictionary entry', () => {
    assert.deepEqual(groups(parse(DICT, 'get a key')), [30, 40]);
});

test('parse: a dictionary entry for a single letter overrides the automatic skip', () => {
    assert.deepEqual(groups(parse(DICT, 'i')), [70]);
});

test('parse: the longest dictionary phrase wins', () => {
    const r = parse(DICT, 'look at door');
    assert.deepEqual(groups(r), [21, 50]);
    assert.equal(r.words[0].text, 'look at');

    assert.deepEqual(groups(parse(DICT, 'look around')), [22]);
    assert.deepEqual(groups(parse(DICT, 'pick up key')), [30, 40]);
});

test('parse: a phrase only matches whole words', () => {
    // "key" must not match the start of "keycard", and vice versa.
    assert.deepEqual(groups(parse(DICT, 'get keycard')), [30, 41]);
    assert.deepEqual(groups(parse(DICT, 'get key')), [30, 40]);
});

test('parse: an unknown word is stored, v9 is its 1-based position, parsing stops', () => {
    const r = parse(DICT, 'open the window now');
    assert.deepEqual(groups(r), [60, 0]);
    assert.equal(r.unknownWord, 2);
    assert.equal(r.words[1].text, 'window');
});

test('parse: an unknown first word', () => {
    const r = parse(DICT, 'xyzzy door');
    assert.deepEqual(groups(r), [0]);
    assert.equal(r.unknownWord, 1);
});

test('parse: words that do not start with a letter are unknown', () => {
    const r = parse(DICT, 'open 3 doors');
    assert.equal(r.unknownWord, 2);
    assert.equal(r.words[1].text, '3');
});

test('parse: unknown word counts filler words as not stored', () => {
    // v9 counts stored words, so skipped filler words don't add to it.
    assert.equal(parse(DICT, 'the the the blorb').unknownWord, 1);
});

test('parse: at most 10 words are stored', () => {
    const r = parse(DICT, 'key key key key key key key key key key key key');
    assert.equal(r.words.length, 10);
    assert.equal(r.unknownWord, 0);
});

test('parse: nothing stored for empty or filler-only input', () => {
    assert.equal(parse(DICT, '').words.length, 0);
    assert.equal(parse(DICT, 'the a at').words.length, 0);
});

test('said: exact match', () => {
    assert.equal(saidMatches([60, 50], [60, 50], true, false), true);
});

test('said: extra or missing player words do not match', () => {
    assert.equal(saidMatches([60, 50], [60, 50, 40], true, false), false);
    assert.equal(saidMatches([60, 50], [60], true, false), false);
    assert.equal(saidMatches([60, 50], [50, 60], true, false), false);
});

test('said: anyword (1) matches any single word, including an unknown one', () => {
    assert.equal(saidMatches([60, WORD_ANY], [60, 50], true, false), true);
    assert.equal(saidMatches([60, WORD_ANY], [60, 0], true, false), true);
    assert.equal(saidMatches([60, WORD_ANY], [60], true, false), false);
});

test('said: rol (9999) matches the rest of the line, however long', () => {
    assert.equal(saidMatches([20, WORD_ROL], [20, 50, 40, 30], true, false), true);
    assert.equal(saidMatches([20, WORD_ROL], [20], true, false), true);
    assert.equal(saidMatches([WORD_ROL], [20, 50], true, false), true);
    assert.equal(saidMatches([20, WORD_ROL], [60, 50], true, false), false);
});

test('said: only matches when flag 2 is set and flag 4 is clear', () => {
    assert.equal(saidMatches([60, 50], [60, 50], false, false), false);
    assert.equal(saidMatches([60, 50], [60, 50], true, true), false);
});

test('said: no stored words', () => {
    assert.equal(saidMatches([60], [], true, false), false);
    // A said() without arguments is true when nothing was stored (as in NAGI).
    assert.equal(saidMatches([], [], false, false), true);
});

test('parse + said: a command recognised by the dictionary but tested differently', () => {
    const words = groups(parse(DICT, 'examine key'));
    assert.deepEqual(words, [20, 40]);
    assert.equal(saidMatches([20, 50], words, true, false), false);
    assert.equal(saidMatches([20, 40], words, true, false), true);
});
