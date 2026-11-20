/**
 * A minimal headless Chrome for the tools: starts Chrome and talks to one page over the
 * DevTools Protocol. Set CHROME to the browser executable if it isn't found.
 */
import {spawn} from 'node:child_process';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

const CHROME_PATHS = [
    process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
].filter(Boolean);

export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** A minimal Chrome DevTools Protocol client for one page. */
export async function openChrome() {
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
