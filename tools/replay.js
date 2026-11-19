/**
 * Replays recordings in headless Chrome and reports whether each one replays identically.
 *
 *   npm run replay -- test/replays/sq1-start.agirec.json [more files...]
 *
 * Starts a Vite dev server on a free port (the game must be in games/<name>/), opens the
 * page in headless Chrome, calls AGI.replay() and waits for the result. Exits with 1 if a
 * replay fails. Set CHROME to the browser executable if it isn't found.
 *
 * Recordings come from AGI.downloadRecording() in the browser. They contain key presses
 * and state hashes, no game data. A recording stops replaying identically when the
 * interpreter's behaviour changes on purpose; record it again then.
 */
import {spawn} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'vite';

const CHROME_PATHS = [
    process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
].filter(Boolean);

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** A minimal Chrome DevTools Protocol client for one page. */
async function openChrome() {
    const chromePath = CHROME_PATHS.find(p => existsSync(p));
    if (!chromePath) throw new Error('Chrome not found; set CHROME to its path');

    const port    = 9400 + Math.floor(Math.random() * 500);
    const profile = mkdtempSync(path.join(tmpdir(), 'agi-replay-'));
    const chrome  = spawn(chromePath, [
        '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
        '--no-first-run', '--autoplay-policy=no-user-gesture-required', 'about:blank',
    ], {stdio: 'ignore'});

    let targets;
    for (let i = 0; i < 50 && !targets; i++) {
        try {
            targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        } catch {
            await sleep(200);
        }
    }
    const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise(r => ws.addEventListener('open', r));

    let id = 0;
    const pending = new Map();
    const logs    = [];
    ws.addEventListener('message', ev => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
            const {resolve, reject} = pending.get(msg.id);
            pending.delete(msg.id);
            msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
        } else if (msg.method === 'Runtime.consoleAPICalled') {
            logs.push(msg.params.args.map(a => a.value ?? a.description).join(' '));
        } else if (msg.method === 'Runtime.exceptionThrown') {
            const d = msg.params.exceptionDetails;
            logs.push('EXCEPTION ' + (d.exception?.description || d.text));
        } else if (msg.method === 'Page.javascriptDialogOpening') {
            send('Page.handleJavaScriptDialog', {accept: true});
        }
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const i = ++id;
        pending.set(i, {resolve, reject});
        ws.send(JSON.stringify({id: i, method, params}));
    });
    await send('Page.enable');
    await send('Runtime.enable');

    const evaluate = async expression => {
        const r = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result.value;
    };

    const close = () => {
        ws.close();
        chrome.kill();
        setTimeout(() => rmSync(profile, {recursive: true, force: true}), 500);
    };

    return {send, evaluate, logs, close};
}

async function main() {
    const files = process.argv.slice(2);
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

            await chrome.evaluate(`AGI.replay(${JSON.stringify(JSON.stringify(rec))})`).catch(() => {});

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
                ? `, first difference in cycle ${result.firstMismatch.cycle} (room ${result.firstMismatch.room}): ${result.firstMismatch.parts.join(', ')}`
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
