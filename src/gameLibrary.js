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

/**
 * Fills the picker and returns a function that gives the source to load when the player starts.
 * @param {HTMLSelectElement} selectEl
 * @returns {Promise<() => GameSource | null>}
 */
export async function initGamePicker(selectEl) {
    const hashUrl = location.hash.slice(1);
    if (hashUrl) {
        selectEl.hidden = true;
        return () => ({kind: 'zip', url: hashUrl});
    }

    const games = await listGames();
    const requested = new URLSearchParams(location.search).get('game');

    selectEl.replaceChildren();

    if (games.length === 0) {
        selectEl.append(new Option('No games found in games/ (see README)', ''));
        selectEl.disabled = true;
        return () => null;
    }

    for (const game of games) {
        const option = new Option(isSupported(game) ? game.id : `${game.id} (AGI v3, not supported yet)`, game.id);
        option.disabled = !isSupported(game);
        selectEl.append(option);
    }

    const initial = games.find(g => g.id === requested && isSupported(g)) ?? games.find(isSupported);
    if (requested && initial?.id !== requested) {
        console.warn(`Game "${requested}" not found or not supported; available:`, games.map(g => g.id));
    }
    if (initial) selectEl.value = initial.id;

    // Keep ?game= in sync so a reload (or a shared link) opens the same game.
    selectEl.addEventListener('change', () => {
        const url = new URL(location.href);
        url.searchParams.set('game', selectEl.value);
        history.replaceState(null, '', url);
    });

    return () => {
        const game = games.find(g => g.id === selectEl.value);
        return game ? toGameSource(game) : null;
    };
}
