// @ts-check
/**
 * Chooses which game to load.
 *
 * In order of precedence:
 *   1. `#<url>`        a ZIP at any URL (the original jsyang behaviour), e.g. `#/demos/archive1.zip`
 *   2. `?game=<name>`  a game from the local `games/` folder
 *   3. the game picker dropdown, filled from `games/index.json`
 */

/** @typedef {import('./resources').GameSource} GameSource */

/**
 * One entry of `games/index.json`, as produced by tools/games-plugin.js.
 * @typedef {object} GameEntry
 * @property {string} id
 * @property {'folder'|'zip'} kind
 * @property {string} url
 * @property {string[]} [files]
 * @property {2|3|null} version
 */

/** @returns {Promise<GameEntry[]>} */
export async function listGames() {
    try {
        const res = await fetch('games/index.json');
        if (!res.ok) return [];
        return (await res.json()).games ?? [];
    } catch {
        return [];
    }
}

/**
 * @param {GameEntry} game
 * @returns {GameSource}
 */
export function toGameSource(game) {
    return game.kind === 'folder'
        ? {kind: 'folder', url: game.url, files: game.files ?? []}
        : {kind: 'zip', url: game.url};
}

/** @param {GameEntry} game */
const isSupported = game => game.version !== 3;

/** Option value of "Unload game"; can't clash with a game id, which is a folder or file name. */
const UNLOAD = '\0unload';

/**
 * Fills the picker and calls `onSelect` when a game is chosen: straight away for `#<url>` or a valid
 * `?game=`, otherwise when the player picks one from the dropdown (which starts empty).
 *
 * The interpreter keeps its state in module globals and cannot unload a game, so picking another
 * game after one was selected reloads the page with the new `?game=`.
 *
 * @param {HTMLSelectElement} selectEl
 * @param {(source: GameSource) => void} onSelect
 */
export async function initGamePicker(selectEl, onSelect) {
    const hashUrl = location.hash.slice(1);
    if (hashUrl) {
        selectEl.hidden = true;
        onSelect({kind: 'zip', url: hashUrl});
        return;
    }

    const games = await listGames();
    const requested = new URLSearchParams(location.search).get('game');

    selectEl.replaceChildren();

    if (games.length === 0) {
        selectEl.append(new Option('No games found in games/ (see README)', ''));
        selectEl.disabled = true;
        return;
    }

    const placeholder = new Option('Choose a game…', '');
    placeholder.disabled = true;
    selectEl.append(placeholder);

    // Reloads the page without ?game=, the only way to unload (see above). Enabled once a game is chosen.
    const unload = new Option('Unload game', UNLOAD);
    unload.disabled = true;
    selectEl.append(unload);

    for (const game of games) {
        const option = new Option(isSupported(game) ? game.id : `${game.id} (AGI v3, not supported yet)`, game.id);
        option.disabled = !isSupported(game);
        selectEl.append(option);
    }

    let hasSelected = false;

    /** @param {GameEntry} game */
    const select = game => {
        hasSelected = true;
        unload.disabled = false;
        selectEl.value = game.id;
        // Give keyboard focus back to the page, so arrow keys move ego instead of changing the game.
        selectEl.blur();
        onSelect(toGameSource(game));
    };

    selectEl.addEventListener('change', () => {
        const url = new URL(location.href);

        if (selectEl.value === UNLOAD) {
            url.searchParams.delete('game');
            location.assign(url);
            return;
        }

        url.searchParams.set('game', selectEl.value);

        if (hasSelected) {
            location.assign(url);
            return;
        }

        // Keep ?game= in sync so a reload (or a shared link) opens the same game.
        history.replaceState(null, '', url);
        const game = games.find(g => g.id === selectEl.value);
        if (game) select(game);
    });

    selectEl.value = '';

    if (requested) {
        const game = games.find(g => g.id === requested && isSupported(g));
        if (game) {
            select(game);
        } else {
            console.warn(`Game "${requested}" not found or not supported; available:`, games.map(g => g.id));
        }
    }
}
