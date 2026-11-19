// @ts-check
/**
 * Vite plugin that serves local game data from `games/` in both `vite` (dev)
 * and `vite preview` (production build), and lists the available games at
 * `games/index.json`.
 *
 * Game data is never copied into `dist/`: the original Sierra files are
 * copyrighted and stay local (see .gitignore).
 *
 * Supported layouts:
 *   games/<name>/      extracted original files (LOGDIR, VOL.0, WORDS.TOK, ...)
 *   games/<name>.zip   the same files in a ZIP archive
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * @typedef {object} GameEntry
 * @property {string} id         Folder name, or ZIP file name without extension.
 * @property {'folder'|'zip'} kind
 * @property {string} url        URL relative to the page: the folder (with trailing slash) or the ZIP.
 * @property {string[]} [files]  Folder games only: the files in the folder.
 * @property {2|3|null} version  AGI version guessed from the directory files; null if unknown (ZIPs).
 */

const IS_V2_DIRFILE = /^(log|pic|snd|view)dir$/i;
const IS_V3_DIRFILE = /^[a-z0-9]+dir$/i;

/**
 * @param {string} gamesDir
 * @returns {GameEntry[]}
 */
export function listGames(gamesDir) {
    if (!fs.existsSync(gamesDir)) return [];

    /** @type {GameEntry[]} */
    const games = [];

    for (const entry of fs.readdirSync(gamesDir, {withFileTypes: true})) {
        if (entry.name.startsWith('.')) continue;

        if (entry.isDirectory()) {
            const files = fs.readdirSync(path.join(gamesDir, entry.name), {withFileTypes: true})
                .filter(f => f.isFile())
                .map(f => f.name);

            /** @type {2|3|null} */
            let version = null;
            if (files.some(f => IS_V2_DIRFILE.test(f))) version = 2;
            else if (files.some(f => IS_V3_DIRFILE.test(f))) version = 3;

            // Skip folders that don't look like an AGI game at all.
            if (version === null) continue;

            games.push({
                id:   entry.name,
                kind: 'folder',
                url:  `games/${encodeURIComponent(entry.name)}/`,
                files,
                version,
            });
        } else if (entry.isFile() && /\.zip$/i.test(entry.name)) {
            games.push({
                id:      entry.name.replace(/\.zip$/i, ''),
                kind:    'zip',
                url:     `games/${encodeURIComponent(entry.name)}`,
                version: null,
            });
        }
    }

    return games.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * @param {{gamesDir?: string}} [options]
 * @returns {import('vite').Plugin}
 */
export default function gamesPlugin(options = {}) {
    const gamesDir = path.resolve(options.gamesDir ?? 'games');

    /** @type {import('vite').Connect.NextHandleFunction} */
    const middleware = (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        // The page may live under a sub-path, so match on the trailing "/games/..." part.
        const match = /(?:^|\/)games\/(.*)$/.exec(url.pathname);
        if (!match) return next();

        res.setHeader('Cache-Control', 'no-cache');

        if (match[1] === 'index.json') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({games: listGames(gamesDir)}));
            return;
        }

        const filePath = path.resolve(gamesDir, decodeURIComponent(match[1]));
        if (!filePath.startsWith(gamesDir + path.sep) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
            res.statusCode = 404;
            res.end('Not found');
            return;
        }

        res.setHeader('Content-Type', /\.zip$/i.test(filePath) ? 'application/zip' : 'application/octet-stream');
        fs.createReadStream(filePath).pipe(res);
    };

    return {
        name: 'agi-games',
        configureServer(server) {
            server.middlewares.use(middleware);
        },
        configurePreviewServer(server) {
            server.middlewares.use(middleware);
        },
    };
}
