// @ts-check
import {unzipSync} from 'fflate';
import {ByteBuffer} from './bytebuffer';
import {AGI_RESOURCE_TYPE, DECRYPTION_KEY} from './constants';

/** @typedef {{volNo: number, volOffset: number}} DirRecord */

/**
 * Where to load a game from.
 * - `zip`: a ZIP archive containing the game files.
 * - `folder`: a folder URL (with trailing slash) plus the names of the files in it.
 * @typedef {{kind: 'zip', url: string} | {kind: 'folder', url: string, files: string[]}} GameSource
 */

/** @typedef {Record<string, Uint8Array>} GameFileMap File name -> contents. */

/** @type {DirRecord[]} */
let logdirRecords  = [];
/** @type {DirRecord[]} */
let picdirRecords  = [];
/** @type {DirRecord[]} */
let viewdirRecords = [];
/** @type {DirRecord[]} */
let snddirRecords  = [];
/** @type {ByteBuffer[]} */
let volBuffers     = [];
/** @type {boolean[]} */
let availableVols  = [];
/** @type {ByteBuffer} */
let fontStream;

/** @type {{name: string, room: number}[]} */
export const inventoryObjects = [];
/** @type {string[][]} Word group number -> words in that group. */
export const wordGroups       = [];

// todo: Handle AGI V3 files
// http://agi.sierrahelp.com/Documentation/Specifications/3-1-Files.html

/**
 * @param {ByteBuffer} buffer
 * @param {DirRecord[]} records
 * @param {boolean} [isAGIv3]
 */
function parseDirfile(buffer, records, isAGIv3 = false) {
    const length = buffer.length / 3;
    for (let i = 0; i < length; i++) {
        const val       = (buffer.readUint8() << 16) + (buffer.readUint8() << 8) + buffer.readUint8();
        const volNo     = val >>> 20;
        const volOffset = val & 0xFFFFF;

        if (val >>> 16 === 0xFF) {
            continue;
        }

        records[i] = {volNo: volNo, volOffset: volOffset};
        if (availableVols[volNo] === undefined) {
            availableVols[volNo] = true;
        }
    }
}

/**
 * @param {number} type One of AGI_RESOURCE_TYPE.
 * @param {number} num Resource number.
 * @returns {ByteBuffer}
 */
export function readAgiResource(type, num) {
    let record;
    switch (type) {
        case AGI_RESOURCE_TYPE.LOGIC:
            record = logdirRecords[num];
            break;
        case AGI_RESOURCE_TYPE.PIC:
            record = picdirRecords[num];
            break;
        case AGI_RESOURCE_TYPE.VIEW:
            record = viewdirRecords[num];
            break;
        case AGI_RESOURCE_TYPE.SOUND:
            record = snddirRecords[num];
            break;
        default:
            throw "Undefined resource type: " + type;
    }

    const volStream              = new ByteBuffer(volBuffers[record.volNo].buffer, record.volOffset);
    const signature              = volStream.readUint16();
    const volNo                  = volStream.readUint8();
    const resourceLength         = volStream.readUint16();
    let isCompressed             = false;
    let compressedResourceLength = 0;

    // todo: Handle AGIv3 game resources
    if (!isAGIv2Resource) {
        compressedResourceLength = volStream.readUint16();
        isCompressed             = resourceLength !== compressedResourceLength;
    }

    if (isCompressed) {
        // todo: decompress with LZW
        // https://en.wikipedia.org/wiki/Lempel%E2%80%93Ziv%E2%80%93Welch
        // // http://www.agidev.com/articles/agispec/agispecs-5.html#ss5.3
        const buf = volStream.buffer.slice(record.volOffset + 7, record.volOffset + 7 + compressedResourceLength);

        if (type === 0) {
            console.log(buf.join(','));
        }

        return new ByteBuffer(volStream.buffer, record.volOffset + 7, record.volOffset + 7 + compressedResourceLength);
    } else {
        return new ByteBuffer(volStream.buffer, record.volOffset + 5, record.volOffset + 5 + resourceLength);
    }

}

// http://www.agidev.com/articles/agispec/agispecs-10.html#ss10.2
const getASCIIFromWordChar   = (/** @type {number} */ byte) => byte ^ 0x7F;
const isWithinLowercaseASCII = (/** @type {number} */ v) => (v >= 97 && v <= 122);

function extractWords(/** @type ByteBuffer */byteBuffer) {
    byteBuffer.startPosition = byteBuffer.readUint16(false);// 26 x 2 bytes for each letter of the alphabet
    byteBuffer.position      = 0;

    let lastWord = '';
    while (true) {
        let currentWord           = '';
        // Process each word
        let charCountFromLastWord = byteBuffer.readUint8();

        while (true) {
            const byte  = byteBuffer.readUint8();
            const ascii = getASCIIFromWordChar(byte >= 128 ? byte - 128 : byte);

            if (isWithinLowercaseASCII(ascii)) {
                currentWord += String.fromCharCode(ascii);
            } else if (ascii === 32) {
                currentWord += ' ';
            } else if (ascii === 45) {
                currentWord += '-';
            } else {
                byteBuffer.position--;
                // End of word; next byte = word group number
                const wordGroupNumber       = byteBuffer.readUint16(false);
                currentWord                 = lastWord.substring(0, charCountFromLastWord) + currentWord;
                wordGroups[wordGroupNumber] = wordGroups[wordGroupNumber] || [];
                wordGroups[wordGroupNumber].push(currentWord);
                lastWord = currentWord;
                break;
            }

        }
        if (byteBuffer.hasReachedEnd()) return;
    }
}

export const getFontStream = () => fontStream;

const IS_DIRFILE_V2 = /^(log|pic|snd|view)dir$/i;
const IS_DIRFILE    = /^((log|pic|snd|view)|[a-z0-9]+)dir$/i;
const IS_VOLFILE    = /^[a-z0-9]*vol\.[0-9]{1,2}$/i;
const IS_WORDSTOK   = /^words\.tok$/i;
const IS_OBJECT     = /^object$/i;
const IS_ICON       = /^[a-z0-9]+.ico$/i;

/** @typedef {{name: string, byteBuffer: ByteBuffer}} GameFile */

/**
 * @param {string} name
 * @param {Uint8Array} uint8a
 * @returns {GameFile}
 */
const getDecompressedFile = (name, uint8a) => ({
    name:       name.toLowerCase(),
    byteBuffer: new ByteBuffer(uint8a)
});

/** True for the files the interpreter reads; everything else in a game folder (EXE, docs, ...) is skipped. */
const isGameFile = (/** @type {string} */ name) =>
    [IS_DIRFILE, IS_VOLFILE, IS_WORDSTOK, IS_OBJECT, IS_ICON].some(re => re.test(name));

/**
 * @param {string} url
 * @returns {Promise<Uint8Array>}
 */
async function fetchBytes(url) {
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Failed to load ${url}: ${res.status} ${res.statusText}`);
    }
    return new Uint8Array(await res.arrayBuffer());
}

async function downloadFont(file = 'font.bin') {
    fontStream = new ByteBuffer(await fetchBytes(file));
}

/** @type {boolean} */
let isAGIv2Resource;

/**
 * @param {string} url
 * @returns {Promise<GameFileMap>}
 */
async function downloadZip(url) {
    return unzipSync(await fetchBytes(url));
}

/**
 * Downloads the game files from a folder, one request per file.
 * @param {string} url Folder URL, with trailing slash.
 * @param {string[]} files File names in the folder.
 * @returns {Promise<GameFileMap>}
 */
async function downloadFolder(url, files) {
    const names = files.filter(isGameFile);
    const contents = await Promise.all(
        names.map(name => fetchBytes(url + encodeURIComponent(name)))
    );

    /** @type {GameFileMap} */
    const fileMap = {};
    names.forEach((name, i) => fileMap[name] = contents[i]);
    return fileMap;
}

/**
 * @param {GameSource} source
 * @returns {Promise<GameFileMap>}
 */
export function downloadGame(source) {
    return source.kind === 'folder'
        ? downloadFolder(source.url, source.files)
        : downloadZip(source.url);
}

/**
 * Sorts the downloaded files by type.
 * @param {GameFileMap} fileMap
 */
function indexGameFiles(fileMap) {
    isAGIv2Resource = Object.keys(fileMap)
        .map(f => f.toLowerCase())
        .some(f => IS_DIRFILE_V2.test(f));

    /** @type {GameFile[]} */
    const dirFiles = [];
    /** @type {GameFile[]} */
    const volFiles = [];
    /** @type {GameFile | undefined} */
    let wordsTokFile;
    /** @type {GameFile | undefined} */
    let objectFile;
    /** @type {GameFile | undefined} */
    let iconFile;

    Object.keys(fileMap).forEach(name => {
        const uint8array = fileMap[name];

        if (IS_DIRFILE.test(name)) {
            dirFiles.push(getDecompressedFile(name, uint8array));
        } else if (IS_VOLFILE.test(name)) {
            volFiles.push(getDecompressedFile(name, uint8array));
        } else if (IS_WORDSTOK.test(name)) {
            wordsTokFile = getDecompressedFile(name, uint8array);
        } else if (IS_OBJECT.test(name)) {
            objectFile = getDecompressedFile(name, uint8array);
        } else if (IS_ICON.test(name)) {
            iconFile = getDecompressedFile(name, uint8array);
        }
    });

    return {
        dirFiles,
        volFiles,
        wordsTokFile,
        objectFile,
        iconFile,
    };
}

/** @param {Uint8Array} buffer */
function setBufferAsFavicon(buffer) {
    const blob = new Blob([/** @type {Uint8Array<ArrayBuffer>} */ (buffer)]);

    const reader = new FileReader();

    reader.onload = () => {
        const base64 = String(reader.result).split('base64,')[1];
        const favicon = /** @type {HTMLLinkElement | null} */ (document.getElementById('favicon'));

        if (favicon) favicon.href = 'data:image/vnd.microsoft.icon;base64,' + base64;
    };

    reader.readAsDataURL(blob);
}


// todo
// ref: https://github.com/huguesv/AgiPlayer/blob/ced9361b910e6ad391c86380c6e17c73ea01064f/src/Woohoo.Agi.Interpreter/Resources/Serialization/InventoryDecoder.cs#L94
/** @param {ByteBuffer} byteBuffer */
function getIsObjectFileEncrypted(byteBuffer) {
}

/** @param {ByteBuffer} byteBuffer */
function extractInventoryObjects(byteBuffer) {
    const decryptedBuffer     = new Uint8Array(byteBuffer.buffer.length);
    const decryptedByteBuffer = new ByteBuffer(decryptedBuffer);


    let decryptionIndex = 0;
    while (!byteBuffer.hasReachedEnd()) {
        decryptedBuffer[byteBuffer.position] = DECRYPTION_KEY[decryptionIndex++].charCodeAt(0) ^ byteBuffer.readUint8();

        if (decryptionIndex >= DECRYPTION_KEY.length) {
            decryptionIndex = 0;
        }
    }

    const objNamesOffset     = decryptedByteBuffer.readUint16();
    const maxAnimatedObjects = decryptedByteBuffer.readUint8(); // ???

    while (decryptedByteBuffer.position <= objNamesOffset) {
        const nameOffset = decryptedByteBuffer.readUint16();
        const room       = decryptedByteBuffer.readUint8();

        let i    = 0;
        let name = '';
        while (true) {
            const char = String.fromCharCode(decryptedBuffer[nameOffset + i + 3]); // + 4 if padded (Amiga version)
            if (char === '\0') break;
            name += char;
            i++;
        }

        inventoryObjects.push({name, room});
    }
}

/**
 * @template T
 * @param {T | undefined} file
 * @param {string} description
 * @returns {T}
 */
function requireFile(file, description) {
    if (!file) throw new Error(`Game data is missing ${description}`);
    return file;
}

/**
 * Downloads and parses a game. Must be called once, before the interpreter starts.
 * @param {GameSource} source
 */
export async function load(source) {
    await downloadFont();

    const gameFiles = indexGameFiles(await downloadGame(source));

    if (gameFiles.iconFile) {
        setBufferAsFavicon(gameFiles.iconFile.byteBuffer.buffer);
    }

    /** @param {string} name */
    const getDirFile = name => requireFile(gameFiles.dirFiles.find(f => f.name === name), name.toUpperCase()).byteBuffer;

    if (isAGIv2Resource) {
        parseDirfile(getDirFile('logdir'), logdirRecords);
        parseDirfile(getDirFile('picdir'), picdirRecords);
        parseDirfile(getDirFile('viewdir'), viewdirRecords);
        parseDirfile(getDirFile('snddir'), snddirRecords);
    } else {
        const dirFile = requireFile(gameFiles.dirFiles[0], 'a DIR file').byteBuffer;

        const logdirStart  = dirFile.readUint16();
        const picdirStart  = dirFile.readUint16();
        const viewdirStart = dirFile.readUint16();
        const snddirStart  = dirFile.readUint16();

        const dirFileBuffer = dirFile.buffer;

        const logBB  = new ByteBuffer(dirFileBuffer.slice(logdirStart, picdirStart));
        const picBB  = new ByteBuffer(dirFileBuffer.slice(picdirStart, viewdirStart));
        const viewBB = new ByteBuffer(dirFileBuffer.slice(viewdirStart, snddirStart));
        const sndBB  = new ByteBuffer(dirFileBuffer.slice(snddirStart));

        parseDirfile(logBB, logdirRecords);
        parseDirfile(picBB, picdirRecords);
        parseDirfile(viewBB, viewdirRecords);
        parseDirfile(sndBB, snddirRecords);
    }

    volBuffers = [];

    gameFiles.volFiles.forEach(f => {
        const index       = parseFloat(f.name.split('.')[1]);
        volBuffers[index] = f.byteBuffer;
    });

    extractInventoryObjects(requireFile(gameFiles.objectFile, 'OBJECT').byteBuffer);
    extractWords(requireFile(gameFiles.wordsTokFile, 'WORDS.TOK').byteBuffer);
}

export default {
    load,
    readAgiResource,
};
