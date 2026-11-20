import {getFontStream} from './resources';
import {BITMAP_HEIGHT, BITMAP_WIDTH} from './bitmap';
import {palette, SCREEN_WIDTH_PIXELS} from './constants';
import {state} from './state';

let fontStream;

// Portions ported from NAGI (c) 2001-2002 Nick Sonneveld, X11 license, see licenses/NAGI-LICENSE.txt
// (sys/chargen.c)

// Text cells are 8 x 8 pixels: 40 columns, 25 rows (row r is pixel rows r*8 to r*8+7).
const COLUMNS = 40;
const ROWS    = 25;

/** @param {number} x @param {number} y @param {number} rgb */
function putPixel(x, y, rgb) {
    const data = state.frameData.data;
    const i    = (y * SCREEN_WIDTH_PIXELS + x) * 4;
    data[i]     = (rgb >>> 16) & 0xFF;
    data[i + 1] = (rgb >>> 8) & 0xFF;
    data[i + 2] = rgb & 0xFF;
    data[i + 3] = 0xFF;
}

/**
 * Draws one character in a text cell. `attrib` is a text attribute as NAGI's text_comb:
 * bits 0-3 the foreground colour, bits 4-6 the background, and bit 7 inverts the
 * character (in graphics mode: white background, black text).
 * NAGI sys/chargen.c: ch_put()
 * @param {number} row @param {number} col @param {number} ch @param {number} attrib
 */
export function chPut(row, col, ch, attrib) {
    if (row < 0 || row >= ROWS || col < 0 || col >= COLUMNS) return;
    const invert = (attrib & 0x80) !== 0 ? 0xFF : 0;
    const fg     = palette[attrib & 0x0F];
    const bg     = palette[(attrib & 0x70) >> 4];

    fontStream.position = (ch & 0xFF) * 8;
    for (let y = 0; y < 8; y++) {
        let bits = fontStream.readUint8() ^ invert;
        for (let x = 0; x < 8; x++) {
            putPixel(col * 8 + x, row * 8 + y, (bits & 0x80) ? fg : bg);
            bits <<= 1;
        }
    }
}

/**
 * Fills the text cells from (row1, col1) to (row2, col2) with the background colour of
 * `attrib` (bits 4-7).
 * NAGI sys/chargen.c: ch_clear()
 * @param {number} row1 @param {number} col1 @param {number} row2 @param {number} col2
 * @param {number} attrib
 */
export function chClear(row1, col1, row2, col2, attrib) {
    const rgb = palette[(attrib & 0xF0) >> 4];
    for (let y = Math.max(row1, 0) * 8; y < Math.min(row2 + 1, ROWS) * 8; y++) {
        for (let x = Math.max(col1, 0) * 8; x < Math.min(col2 + 1, COLUMNS) * 8; x++) {
            putPixel(x, y, rgb);
        }
    }
}

/**
 * Clears text cells to black, or to white for any other colour (in graphics mode AGI has
 * only those two text backgrounds).
 * NAGI ui/agi_text.c: calc_text_bg(), ui/window.c: window_clear()
 */
function clearTextRect(y1, x1, y2, x2, color) {
    chClear(y1, x1, y2, x2, color ? 0xFF : 0);
}

const sRegex = /%s(\d+)/; // "%s123" string regex

function bltText(row = 0, col = 0, text = '') {
    let regexResult;
    while ((regexResult = sRegex.exec(text)) !== null) {
        text = text.slice(0, regexResult.index) + state.strings[parseInt(regexResult[1])] + text.slice(regexResult.index + regexResult.length + 1);
    }

    // http://agi.sierrahelp.com/AGIStudioHelp/Logic/DisplayCommands/set.text.attribute.html
    // A white background shows black text; on black, text has the foreground colour.
    // NAGI ui/agi_text.c: text_combine() (EGA)
    const attrib = state.textBG === 15 ? 0x8F : state.textFG & 0x0F;

    for (let i = 0; i < text.length; i++) {
        const chr = text.charCodeAt(i);
        if (chr === 10) {
            row++;
            col = 0;
            continue;
        }
        chPut(row, col, chr, attrib);

        col++;
        if (col >= COLUMNS) {
            col = 0;
            row++;
        }
    }
}

/**
 * Fills a rectangle of the picture area on the screen with a colour. x and width are in
 * picture pixels (2 screen pixels wide); y is the top row. No clipping.
 * NAGI sys/vid_render.c: ega_rect()
 * @param {number} x @param {number} y @param {number} width @param {number} height
 * @param {number} colour
 */
export function fillPicRect(x, y, width, height, colour) {
    const rgb = palette[colour & 0x0F];
    const top = state.playTop * 8;
    for (let row = y; row < y + height && top + row < 200; row++) {
        for (let col = x * 2; col < (x + width) * 2; col++) putPixel(col, top + row, rgb);
    }
}

/**
 * Draws the priority screen (2 pixels wide, like the picture) into `imageData`: the high
 * nibble of the picture buffer, with control lines and the objects drawn in, as NAGI's
 * show.pri.screen shows it.
 * @param {ImageData} imageData 320 x 200
 */
export function renderPriority(imageData) {
    const {data} = imageData;
    const end    = Math.min(BITMAP_HEIGHT * BITMAP_WIDTH, (200 - state.playTop * 8) * BITMAP_WIDTH);
    const offset = state.playTop * 8 * BITMAP_WIDTH * 8; // the picture starts at row playTop
    for (let k = 0; k < end; k++) {
        const rgb = palette[state.picBuffer[k] >> 4];
        for (let p = 0; p < 2; p++) {
            data[offset + k * 8 + p * 4]     = (rgb >>> 16) & 0xFF;
            data[offset + k * 8 + p * 4 + 1] = (rgb >>> 8) & 0xFF;
            data[offset + k * 8 + p * 4 + 2] = rgb & 0xFF;
            data[offset + k * 8 + p * 4 + 3] = 255;
        }
    }
}

export const init = () => {
    fontStream = getFontStream();

    for (let i = 320 * 200; i-- > 0;) {
        state.frameData.data[i * 4]     = 0;
        state.frameData.data[i * 4 + 1] = 0;
        state.frameData.data[i * 4 + 2] = 0;
        state.frameData.data[i * 4 + 3] = 0xFF;

        state.debugFrameData.data[i * 4]     = 0;
        state.debugFrameData.data[i * 4 + 1] = 0;
        state.debugFrameData.data[i * 4 + 2] = 0;
        state.debugFrameData.data[i * 4 + 3] = 0xFF;
    }
};

export default {
    init,
    chPut,
    chClear,
    fillPicRect,
    bltText,
    clearTextRect,
    renderPriority,
};
