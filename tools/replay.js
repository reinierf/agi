/**
 * Replays recordings in headless Chrome and reports whether each one replays identically.
 *
 *   npm run replay -- test/replays/sq1-start.agirec.json [more files...] [--realtime]
 *
 * Starts a Vite dev server on a free port (the game must be in games/<name>/), opens the
 * page in headless Chrome, calls AGI.replay() and waits for the result. Exits with 1 if a
 * replay fails. --realtime plays at the game's own speed instead of as fast as possible.
 * Set CHROME to the browser executable if it isn't found.
 *
 * Recordings come from AGI.downloadRecording() in the browser. They contain key presses
 * and state hashes, no game data. A recording stops replaying identically when the
 * interpreter's behaviour changes on purpose; record it again then.
 */
import {readFileSync} from 'node:fs';
import {createServer} from 'vite';
import {openChrome, sleep} from './chrome.js';

async function main() {
    const realtime = process.argv.includes('--realtime');
    const files    = process.argv.slice(2).filter(a => a !== '--realtime');
    if (files.length === 0) {
        console.error('Usage: npm run replay -- <recording.json> [...]');
        process.exit(2);
    }

    const server = await createServer({server: {port: 3100, strictPort: false}, logLevel: 'error'});
    await server.listen();
    const base = server.resolvedUrls.local[0];

    const chrome = await openChrome();
    let failed   = 0;

    try {
        for (const file of files) {
            const rec = JSON.parse(readFileSync(file, 'utf8'));
            chrome.logs.length = 0;

            await chrome.send('Page.navigate', {url: base});
            for (let i = 0; i < 100 && !(await chrome.evaluate('!!window.AGI').catch(() => false)); i++) await sleep(100);

            await chrome.evaluate(`AGI.replay(${JSON.stringify(JSON.stringify(rec))}, {realtime: ${realtime}})`).catch(() => {});

            let result = null;
            const t0   = Date.now();
            while (Date.now() - t0 < 10 * 60 * 1000) {
                await sleep(250);
                result = await chrome.evaluate('window.AGI && AGI.replayResult ? AGI.replayResult() : null').catch(() => null);
                if (result && result.status !== 'running') break;
            }

            const ok = result?.status === 'passed';
            if (!ok) failed++;

            const detail = result?.firstMismatch
                ? `, first difference in cycle ${result.firstMismatch.cycle} (room ${result.firstMismatch.room}): ${result.firstMismatch.parts.join(', ')}` +
                  (result.firstMismatch.details?.length ? ` (${result.firstMismatch.details.join('; ')})` : '')
                : '';
            console.log(`${ok ? 'PASS' : 'FAIL'} ${file}: ${result ? `${result.cycles}/${result.totalCycles} cycles, ${result.mismatches} with differences${detail}` : 'no result'}`);
            for (const p of result?.problems ?? []) console.log(`  ${p}`);
            for (const l of chrome.logs.filter(l => l.startsWith('EXCEPTION'))) console.log(`  ${l}`);
        }
    } finally {
        chrome.close();
        await server.close();
    }

    process.exit(failed ? 1 : 0);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
