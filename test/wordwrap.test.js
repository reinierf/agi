// Unit tests for AGI's word wrap (message windows, display). The expected values follow
// NAGI's r_display1f93() step by step. Run with `npm test`.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {wordwrap} from '../src/wordwrap.js';

/** @type {import('../src/wordwrap.js').WrapLookup} */
const lookup = {
    globalMsg: n => ({1: 'global one'})[n],
    msg:       n => ({2: 'local two', 3: 'see %v3'})[n],
    object:    n => ['nothing', 'a gadget'][n === 5 ? 1 : 0],
    string:    n => ({1: 'Roger'})[n],
    variable:  n => ({3: 7, 4: 123})[n] ?? 0,
    word:      n => ['look', 'door'][n - 1],
};

const wrap = (str, width = 30) => wordwrap(str, width, lookup);

test('breaks at the last space that fits', () => {
    assert.deepEqual(wrap("You'll have to be more specific."),
        {text: "You'll have to be more\nspecific.", width: 22, height: 2});
});

test('a word that ends exactly at the edge still moves to the next line', () => {
    // "abcd efghi" is 10 characters, but the line is full before the space after it is read.
    assert.deepEqual(wrap('abcd efghi more', 10), {text: 'abcd\nefghi\nmore', width: 5, height: 3});
});

test('a word longer than the width is cut', () => {
    assert.deepEqual(wrap('abcdefgh', 5), {text: 'abcde\nfgh', width: 5, height: 2});
});

test('text that fills the last line exactly ends with an empty line', () => {
    assert.deepEqual(wrap('abcde', 5), {text: 'abcde\n', width: 5, height: 2});
});

test('line feeds start a new line', () => {
    assert.deepEqual(wrap('ab\ncd'), {text: 'ab\ncd', width: 2, height: 2});
});

test('spaces before a break stay at the end of the line', () => {
    // Two spaces: the break replaces the second one; the first stays and counts.
    assert.deepEqual(wrap('abc  defgh', 6), {text: 'abc \ndefgh', width: 5, height: 2});
});

test('no text gives an empty window', () => {
    assert.deepEqual(wrap(null), {text: '', width: 0, height: 0});
});

test('%v, with zero padding', () => {
    assert.equal(wrap('v=%v3.').text, 'v=7.');
    assert.equal(wrap('[%v3|3]').text, '[007]');
    assert.equal(wrap('[%v4|2]').text, '[123]'); // never cut
    assert.equal(wrap('%v9').text, '0');
});

test('%s, %w, %o, %m, %g', () => {
    assert.equal(wrap('Hi %s1!').text, 'Hi Roger!');
    assert.equal(wrap('I can\'t %w1 the %w2.').text, 'I can\'t look the door.');
    assert.equal(wrap('[%w3][%w0]').text, '[][]');
    assert.equal(wrap('It is %o5.').text, 'It is a gadget.');
    assert.equal(wrap('%m2, %g1').text, 'local two, global one');
    assert.equal(wrap('%m3').text, 'see 7'); // codes inside inserted text are filled in too
});

test('inserted text is wrapped with the rest', () => {
    assert.deepEqual(wrap('Hello %s1 and more', 12), {text: 'Hello Roger\nand more', width: 11, height: 2});
});

test('an unknown %-code drops the % and the code only', () => {
    assert.equal(wrap('a%q5b').text, 'a5b');
});

test('the character after a backslash is put in as it is', () => {
    assert.equal(wrap('say \\"hi\\" \\%v3').text, 'say "hi" %v3');
});

test('wrapping stops after 20 full lines', () => {
    const result = wrap('x'.repeat(1000), 10);
    assert.equal(result.text, ('x'.repeat(10) + '\n').repeat(20));
    assert.equal(result.height, 21); // over 19: message_box shows "Message too verbose"
});
