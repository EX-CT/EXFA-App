#!/usr/bin/env node
// An `eve-fit`-compatible command line backed by the site's in-browser engine (tools/browser-rpc.mjs), so the
// EXFA-Bench runners (tools/run_all_suites.sh: run.py --cmd/--batch-cmd, score.py --batch-cmd, run_graphs.py
// --rpc-cmd, evaluate_formats.py --rpc ...) can score the deployed build as if it were a native engine binary.
//   BROWSER_URL=<site-url> BROWSER_ENGINE=wasm-worker tools/browser-engine.mjs [--prices FILE] [--sde FILE] calc [FILE] | batch [--request FILE|-] | serve-stdio | version | meta
// (--prices, --sde and batch --request need BROWSER_RPC; files are read by browser-rpc and passed to the page's engine)
// With BROWSER_RPC=http://127.0.0.1:PORT (a running `browser-rpc.mjs <url> <engine> --http PORT`) every call reuses that one
// browser instead of starting Chrome per process (the bench's run.py starts one process per case).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const url = process.env.BROWSER_URL ?? 'http://127.0.0.1:4173/EXFA-App/';
const engine = process.env.BROWSER_ENGINE ?? 'wasm-worker';
const rpc = fileURLToPath(new URL('./browser-rpc.mjs', import.meta.url));
const argv = process.argv.slice(2);
const flag = (f) => { const i = argv.indexOf(f); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v ?? ''; };
const pricesFile = flag('--prices');
const sdeFile = flag('--sde');
const requestFile = flag('--request');
const [cmd, file] = argv;
const run = (args, input) => {
  const c = spawn(process.execPath, [rpc, url, engine, ...args], { stdio: [input == null ? 'inherit' : 'pipe', 'inherit', 'inherit'] });
  if (input != null) { c.stdin.end(input); }
  c.on('exit', (code) => process.exit(code ?? 1));
};
const server = process.env.BROWSER_RPC;
const write = (t) => new Promise((r) => process.stdout.write(t, r));
// one engine session per process (its own prices_load state in the shared page, tools/browser-rpc.mjs)
const session = `${process.pid}-${Date.now()}`;
const post = async (path, body) => {
  const r = await fetch(server + path, { method: 'POST', body, headers: { 'x-session': session, ...(pricesFile ? { 'x-prices': resolve(pricesFile) } : {}), ...(sdeFile ? { 'x-sde': resolve(sdeFile) } : {}) } });
  // like eve-fit: an engine error for the global options (e.g. a bad --prices file) is printed as JSON, exit 2
  if (r.status === 400) { await write(await r.text() + '\n'); process.exit(2); }
  if (!r.ok) { console.error(`error: ${await r.text()}`); process.exit(2); }
  return r.text();
};
if ((pricesFile != null || sdeFile != null || requestFile != null) && !server) { console.error('error: --prices / --sde / batch --request need BROWSER_RPC'); process.exit(2); }
if (server) {
  if (cmd === 'batch' && requestFile != null) {
    // `eve-fit batch --request FILE|-`: one BatchRequest (docs/23) -> one BatchResult JSON
    const req = JSON.parse(requestFile === '-' ? readFileSync(0, 'utf8') : readFileSync(requestFile, 'utf8'));
    const resp = JSON.parse(await post('/rpc', JSON.stringify({ id: 1, method: 'batch', params: req }) + '\n'));
    await write(JSON.stringify(resp.result ?? { error: resp.error }) + '\n');
  } else if (cmd === 'version' || cmd === 'meta') {
    const resp = JSON.parse(await post('/rpc', JSON.stringify({ id: 1, method: cmd, params: {} }) + '\n'));
    await write(JSON.stringify(resp.result ?? { error: resp.error }) + '\n');
  } else if (cmd === 'batch') await write(await post('/batch', readFileSync(0, 'utf8')));
  else if (cmd === 'calc') await write(await post('/batch', JSON.stringify(JSON.parse(file && file !== '-' ? readFileSync(file, 'utf8') : readFileSync(0, 'utf8'))) + '\n'));
  else if (cmd === 'serve-stdio') {
    const rl = (await import('node:readline')).createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const line of rl) if (line.trim()) await write(await post('/rpc', line + '\n'));
  } else { console.error('usage: browser-engine.mjs calc [FILE] | batch | serve-stdio'); process.exit(2); }
  process.exit(0);
}
if (cmd === 'batch') run(['--batch']);
else if (cmd === 'serve-stdio') run([]);
else if (cmd === 'calc') {
  const text = file && file !== '-' ? readFileSync(file, 'utf8') : readFileSync(0, 'utf8');
  run(['--batch'], JSON.stringify(JSON.parse(text)) + '\n');
} else {
  console.error('usage: browser-engine.mjs calc [FILE] | batch | serve-stdio   (env BROWSER_URL, BROWSER_ENGINE)');
  process.exit(2);
}
