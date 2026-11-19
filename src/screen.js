import {getFontStream} from './resources';
import {BITMAP_HEIGHT, BITMAP_WIDTH} from './bitmap';
import {palette, SCREEN_WIDTH_PIXELS} from './constants';
import {state} from './state';

let fontStream;

function clearTextRect(y1, x1, y2, x2, color) {
    color      = palette[color];
    const data = state.frameData.data;

    for (let y = y1; y <= y2; y++) {
        for (let x = x1; x <= x2; x++) {
            for (let i = -7; i <= 0; i++) {
                for (let j = 0; j < 8; j++) {
                    const index         = ((y * 8) + i) * SCREEN_WIDTH_PIXELS + ((x * 8) + j);
                    data[index * 4]     = color;
                    data[index * 4 + 1] = color;
                    data[index * 4 + 2] = color;
                    data[index * 4 + 3] = 0xFF;
                }
            }
        }
    }
}

const sRegex = /%s(\d+)/; // "%s123" string regex

function bltText(row = 0, col = 0, text = '') {
    let regexResult;
    while ((regexResult = sRegex.exec(text)) !== null) {
        text = text.slice(0, regexResult.index) + state.strings[parseInt(regexResult[1])] + text.slice(regexResult.index + regexResult.length + 1);
    }

    let textBGColor;
    let textFGColor;
    //http://agi.sierrahelp.com/AGIStudioHelp/Logic/DisplayCommands/set.text.attribute.html
    // The background color can only be black (if BG is 0)
    // or white (if BG is greater than 0). If the background
    // is white, all text will be displayed with a black
    // foreground. Otherwise, the text will be displayed
    // with the foreground specified by FG (0-15).
    if (state.textBG === 15) {
        textBGColor = palette[15]; // White BG
        textFGColor = palette[0] // Black FG
    } else {
        textBGColor = 0x00; // Black BG
        textFGColor = palette[state.textFG] // Color FG
    }

    for (let i = 0; i < text.length; i++) {
        const chr = text[i].charCodeAt(0);
        if (chr === 10) {
            row++;
            col = 0;
            continue;
        }
        fontStream.position = chr * 8;

        const data = state.frameData.data;
        for (let y = -7; y <= 0; y++) {
            let colData = fontStream.readUint8();
            for (let x = 0; x < 8; x++) {
                let color;

                if ((colData & 0x80) === 0x80) {
                    color = textFGColor; // Black FG
                } else {
                    color = textBGColor; // White BG
                }

                const index         = (row * 8 + y) * 320 + (col * 8 + x);
                data[index * 4]     = color;
                data[index * 4 + 1] = color;
                data[index * 4 + 2] = color;
                data[index * 4 + 3] = 0xFF;
                colData             = colData << 1;
            }
        }

        col++;
        if (col >= 40) {
            col = 0;
            row++;
        }
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
    for (let k = 0; k < BITMAP_HEIGHT * BITMAP_WIDTH; k++) {
        const rgb = palette[state.picBuffer[k] >> 4];
        for (let p = 0; p < 2; p++) {
            data[k * 8 + p * 4]     = (rgb >>> 16) & 0xFF;
            data[k * 8 + p * 4 + 1] = (rgb >>> 8) & 0xFF;
            data[k * 8 + p * 4 + 2] = rgb & 0xFF;
            data[k * 8 + p * 4 + 3] = 255;
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
    bltText,
    clearTextRect,
    renderPriority,
};
