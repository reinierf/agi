/**
 * Plays a scripted session into a game in headless Chrome, and saves the recording and
 * screenshots. Use it to make replay tests (test/replays/) and to look at the screen.
 *
 *   npm run record -- <script.json> [--out recording.json] [--shots dir]
 *
 * The script is JSON:
 *   {
 *     "game": "SQ1",                      // folder in games/ (case matters)
 *     "steps": [
 *       {"cycles": 200},                  // wait until 200 more cycles have run
 *       {"wait": 1500},                   // wait 1.5 s of real time
 *       {"until": "AGI.state.variables[0] === 2", "timeout": 20000},  // wait for a condition
 *       {"type": "look at the floor\n"},  // type text; \n is Enter
 *       {"key": "Escape"},                // one key, by its KeyboardEvent.key name
 *       {"closeWindows": 2000},           // press Enter whenever a message window is open,
 *                                         // until none has been open for 2 s
 *       {"shot": "room2"},                // save the screen as <shots>/room2.png
 *       {"eval": "AGI.state.variables[9]", "label": "v9"}  // print a value
 *     ]
 *   }
 * Waiting for cycles doesn't work while the game is waiting for a key (a message window).
 * Exits with 1 if a step fails (the screen is then saved as <shots>/error.png) or the page
 * throws.
 */
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {createServer} from 'vite';
import {openChrome, sleep} from './chrome.js';

function parseArgs(argv) {
    const args = {script: null, out: null, shots: null};
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--out') args.out = argv[++i];
        else if (argv[i] === '--shots') args.shots = argv[++i];
        else args.script = argv[i];
    }
    return args;
}

/** KeyboardEvent init for a key name or a typed character. */
function keyInit(key) {
    if (key === '\n') key = 'Enter';
    const code = /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key;
    return {key, code, bubbles: true};
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.script) {
        console.error('Usage: npm run record -- <script.json> [--out recording.json] [--shots dir]');
        process.exit(2);
    }
    const script = JSON.parse(readFileSync(args.script, 'utf8'));
    const shots  = args.shots ?? path.join(path.dirname(args.script), 'shots');

    const server = await createServer({server: {port: 3100, strictPort: false}, logLevel: 'error'});
    await server.listen();
    const base = server.resolvedUrls.local[0];

    const chrome = await openChrome();
    let failed   = false;

    const key = async k => {
        await chrome.evaluate(`dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify(keyInit(k))}))`);
        await sleep(20);
    };

    try {
        await chrome.send('Page.navigate', {url: `${base}?game=${encodeURIComponent(script.game)}`});
        for (let i = 0; !(await chrome.evaluate('!!(window.AGI && AGI.state)').catch(() => false)); i++) {
            if (i > 200) throw new Error(`game ${script.game} did not start (is it in games/${script.game}/?)`);
            await sleep(100);
        }

        for (const step of script.steps) {
            if (step.cycles !== undefined) {
                const target = (await chrome.evaluate('AGI.cycles()')) + step.cycles;
                const t0     = Date.now();
                while ((await chrome.evaluate('AGI.cycles()')) < target) {
                    if (Date.now() - t0 > (step.timeout ?? 60000)) throw new Error(`timed out waiting for ${step.cycles} cycles`);
                    await sleep(50);
                }
            } else if (step.wait !== undefined) {
                await sleep(step.wait);
            } else if (step.until !== undefined) {
                const t0 = Date.now();
                while (!(await chrome.evaluate(step.until).catch(() => false))) {
                    if (Date.now() - t0 > (step.timeout ?? 30000)) throw new Error(`timed out waiting for ${step.until}`);
                    await sleep(50);
                }
            } else if (step.type !== undefined) {
                for (const ch of step.type) await key(ch);
            } else if (step.closeWindows !== undefined) {
                let quietSince = Date.now();
                while (Date.now() - quietSince < step.closeWindows) {
                    if (await chrome.evaluate('AGI.state.dialogue')) {
                        await sleep(300); // as a player would: see it, then press Enter
                        await key('Enter');
                        quietSince = Date.now();
                    }
                    await sleep(50);
                }
            } else if (step.key !== undefined) {
                await key(step.key);
            } else if (step.shot !== undefined) {
                mkdirSync(shots, {recursive: true});
                const url  = await chrome.evaluate(`document.getElementById('canvas').toDataURL('image/png')`);
                const file = path.join(shots, `${step.shot}.png`);
                writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
                console.log(`shot ${file}`);
            } else if (step.eval !== undefined) {
                const value = await chrome.evaluate(`(async () => JSON.stringify(await (${step.eval})))()`);
                console.log(`${step.label ?? step.eval}: ${value}`);
            }
        }

        if (args.out) {
            const rec = await chrome.evaluate('AGI.recording()');
            writeFileSync(args.out, JSON.stringify(rec));
            console.log(`recording ${args.out}: ${rec.cycles} cycles, ${rec.events.length} events`);
        }
    } catch (e) {
        console.error(e.message);
        failed = true;
        try {
            mkdirSync(shots, {recursive: true});
            const url  = await chrome.evaluate(`document.getElementById('canvas').toDataURL('image/png')`);
            const file = path.join(shots, 'error.png');
            writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
            console.error(`screen at the error: ${file}`);
        } catch { /* no page */ }
    } finally {
        const exceptions = chrome.logs.filter(l => l.startsWith('EXCEPTION'));
        exceptions.forEach(l => console.log(`  ${l}`));
        if (exceptions.length) failed = true;
        chrome.close();
        await server.close();
    }

    process.exit(failed ? 1 : 0);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
