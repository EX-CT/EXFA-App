// JSONL RPC over the site's active engine backend, inside headless Chrome:
//   node tools/browser-rpc.mjs <site-url> <engine-id>           < {"id","method","params"} lines   > {"id","result"} lines
//   node tools/browser-rpc.mjs <site-url> <engine-id> --batch   < FitRequest lines                > FitStats lines (bench batch mode)
//   node tools/browser-rpc.mjs <site-url> <engine-id> --http PORT   one browser kept open; POST /rpc (or /batch) with JSONL
//     request lines, JSONL response lines back (tools/browser-engine.mjs uses it via BROWSER_RPC=http://127.0.0.1:PORT);
//     header `x-prices: <file>` loads that price snapshot first (like `eve-fit --prices FILE`), no header clears it
// Methods: graph, graph_specs, calc, format RPCs, and other Engine RPC methods (batch, prices_load, ...). All calls go through the main
// Engine WASM worker, i.e. exactly the build that is deployed. Used to run the EXFA-Bench graphs-round2 suite
// (graphs/run_graphs.py --rpc-cmd) against the browser build.
import puppeteer from 'puppeteer-core';
import readline from 'node:readline';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/EXFA-App/';
const engine = process.argv[3] ?? 'wasm-worker';
const batch = process.argv.includes('--batch');
const httpPort = process.argv.includes('--http') ? +process.argv[process.argv.indexOf('--http') + 1] : null;
const b = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const p = await b.newPage();
await p.goto(url, { waitUntil: 'networkidle0', timeout: 120000 });
await p.waitForFunction((e) => window.__eveEngine?.info?.id === e, { timeout: 120000 }, engine);
/** one JSONL line -> one JSONL line (batch: FitRequest -> FitStats; else {id, method, params} -> {id, result}) */
async function handle(line, asBatch) {
  let id = null, out;
  try {
    const m = asBatch ? { id: null, method: 'calc', params: JSON.parse(line) } : JSON.parse(line);
    id = m.id ?? null;
    // the page has no filesystem: RPC prices_load {path} reads the file here
    if (m.method === 'prices_load' && typeof m.params?.path === 'string') m.params = pricesParams(m.params.path);
    if (m.method === 'sde_override' && typeof m.params?.path === 'string') m.params = sdeParams(m.params.path);
    const result = await p.evaluate(async (method, params) => {
      const e = window.__eveEngine;
      if (method === 'graph') return e.graph ? e.graph(params) : { error: { code: 'UNKNOWN_METHOD', message: 'backend has no graph RPC' } };
      if (method === 'graph_specs') return e.graphSpecs ? e.graphSpecs() : null;
      // the engine's text where the backend gives it (eve-fit prints floats as 1.0; JSON.parse + stringify would not)
      if (method === 'calc') return e.rpcText ? { __text: await e.rpcText('calc', params) } : e.calc(params);
      // shipstats: compute the full-precision request stats first, then pass them to the Engine formats RPC.
      if (method === 'format_export' && params?.format === 'shipstats' && !params.stats && !params.stats_json) {
        const f = params.fit ?? {};
        const st = await e.calc({ ...f, options: { ...(f.options ?? {}), include_attributes: 'all', full_precision: true, default_spool: { type: 'spool_scale', amount: 0 } }, modules: (f.modules ?? []).map((m) => ({ ...m, spool: null })) });
        if (st?.error) return st;
        return { __raw: await e.rpcRaw(method, { ...params, stats_json: JSON.stringify(st) }) };
      }
      // rpcRaw gives the whole {id, result|error} envelope: pass it through, not wrapped in another result
      if (['eft_parse', 'eft_export', 'format_import', 'format_export'].includes(method))
        return { __raw: await e.rpcRaw(method, params) };
      // anything else (batch, prices_load, version, ...): the engine's own RPC, response passed through as is
      if (e.rpcText) return { __text: await e.rpcText(method, params) };
      if (e.rpcRaw) return { __raw: await e.rpcRaw(method, params) };
      return { error: { code: 'UNKNOWN_METHOD', message: method } };
    }, m.method ?? 'calc', m.params ?? null);
    // engine response text as written (floats keep their form, e.g. 1.0), with this request's id
    if (result && typeof result === 'object' && '__text' in result) {
      const tx = result.__text;
      if (asBatch && tx.startsWith('{"id":1,"result":') && tx.endsWith('}')) return tx.slice(17, -1);
      if (!asBatch && tx.startsWith('{"id":1,')) return `{"id":${JSON.stringify(id)},${tx.slice(8)}`;
    }
    out = result && typeof result === 'object' && '__text' in result ? { id, ...JSON.parse(result.__text), ...(id !== undefined ? { id } : {}) }
      : result && typeof result === 'object' && '__raw' in result ? { ...result.__raw, id } : { id, result };
  } catch (e) {
    out = { id, error: { code: 'BROWSER', message: String(e?.message ?? e) } };
  }
  return JSON.stringify(asBatch ? out.result ?? out : out);
}
// The engine's market snapshot (L4) is global in the page, while each `browser-engine.mjs` process is its own engine
// session: the request's state is the session's own `prices_load` (RPC, header x-session) if it made one, else its
// `--prices FILE` (header x-prices), else none. It is (re)loaded whenever it differs from what the page holds.
/** prices_load params for a price file: the page has no filesystem, so the file (gzip or plain JSON) is read here and
 *  passed as `snapshot`; text that is not JSON is passed as is, for the engine to reject (BAD_PRICES). */
function pricesParams(file) {
  let b;
  try { b = readFileSync(file); } catch (e) { return { path: file }; } // the engine reports the missing file
  if (b[0] === 0x1f && b[1] === 0x8b) b = gunzipSync(b);
  const text = b.toString('utf8');
  try { return { snapshot: JSON.parse(text) }; } catch { return { snapshot: text }; }
}
/** sde_override params for a pack file: its bytes as pack_b64 (a missing file is left to the engine: not_found). */
function sdeParams(file) {
  try { return { pack_b64: readFileSync(file).toString('base64') }; } catch { return { path: file }; }
}
/** `eve-fit --sde FILE` for one request: load the pack before, reset after; a load failure is the request's error. */
async function withSde(file, run) {
  if (!file) return run();
  const r = await p.evaluate(async (pp) => window.__eveEngine.rpcRaw('sde_override', pp), sdeParams(file));
  const err = r?.error ?? r?.result?.error;
  if (err) throw Object.assign(new Error(err.message), { engineError: err });
  try { return await run(); } finally { await p.evaluate(async () => window.__eveEngine.rpcRaw('sde_override', { reset: true })); }
}
const CLEAR = { key: 'clear', params: { clear: true } };
let pricesNow = 'clear';
const sessionPrices = new Map();
async function usePrices(want) {
  if (want.key === pricesNow) return;
  const params = want.params ?? pricesParams(want.file);
  const r = await p.evaluate(async (pp) => window.__eveEngine.rpcRaw ? window.__eveEngine.rpcRaw('prices_load', pp) : null, params);
  const err = r?.error ?? r?.result?.error;
  if (err) throw Object.assign(new Error(err.message), { engineError: { ...err, message: `--prices ${want.file ?? ''}: ${err.message}` } });
  pricesNow = want.key;
}
/** after a passed-through RPC `prices_load` that succeeded: that is now this session's state */
function notePricesLoad(session, line, out) {
  try {
    const m = JSON.parse(line);
    const o = JSON.parse(out);
    if (m.method !== 'prices_load' || o.error || o.result?.error) return;
    const st = typeof m.params?.path === 'string' ? { key: `file:${m.params.path}`, file: m.params.path } : { key: `rpc:${JSON.stringify(m.params)}`, params: m.params };
    pricesNow = st.key;
    if (session) sessionPrices.set(session, st);
  } catch { /* not JSON: nothing loaded */ }
}
if (httpPort) {
  let queue = Promise.resolve(); // one page: requests run one after the other
  http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const asBatch = req.url.startsWith('/batch');
      const file = req.headers['x-prices']; // `eve-fit --prices FILE`
      const session = req.headers['x-session'] ?? null;
      const sde = req.headers['x-sde'] ?? null; // `eve-fit --sde FILE`
      queue = queue.then(async () => {
        await usePrices(sessionPrices.get(session) ?? (file ? { key: `file:${file}`, file } : CLEAR));
        const outs = [];
        await withSde(sde, async () => { for (const l of body.split('\n')) if (l.trim()) { const o = await handle(l, asBatch); notePricesLoad(session, l, o); outs.push(o); } });
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        res.end(outs.map((o) => o + '\n').join(''));
      }).catch((e) => {
        if (e.engineError) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: e.engineError })); }
        else { res.writeHead(500); res.end(String(e)); }
      });
    });
  }).listen(httpPort, '127.0.0.1', () => console.error(`browser-rpc: ${engine} on http://127.0.0.1:${httpPort}`));
  const stop = async () => { await b.close(); process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
} else {
  try {
    const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const line of rl) if (line.trim()) process.stdout.write(await handle(line, batch) + '\n');
  } finally {
    await b.close();
  }
}
