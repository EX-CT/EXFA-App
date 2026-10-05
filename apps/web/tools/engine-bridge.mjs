#!/usr/bin/env node
// Local engine bridge for the web UI's HTTP backend (zero dependencies).
// Adds CORS + Private-Network-Access headers so the GitHub Pages site can call an engine on this machine.
//   node tools/engine-bridge.mjs --upstream http://127.0.0.1:8080          # forward to an engine HTTP server (e.g. variant C serve-http)
//   node tools/engine-bridge.mjs --stdio "eve-dogma --dataset D serve-stdio" # wrap any engine's JSONL RPC (contract `serve-stdio`)
// Options: --port 8787 (default), --host 127.0.0.1. Then choose "HTTP" in the UI with URL http://127.0.0.1:8787
import http from 'node:http';
import { spawn } from 'node:child_process';
import readline from 'node:readline';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const port = +(args.port ?? 8787), host = args.host ?? '127.0.0.1';
if (!args.upstream && !args.stdio) { console.error('need --upstream URL or --stdio "CMD"'); process.exit(2); }

let rpc = null;
if (args.stdio) {
  const child = spawn(args.stdio, { shell: true, stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting = new Map();
  let seq = 0;
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    try { const m = JSON.parse(line); const w = waiting.get(m.id); if (w) { waiting.delete(m.id); w(m); } } catch { /* ignore non-JSON */ }
  });
  child.on('exit', (c) => { console.error(`engine exited (${c})`); process.exit(1); });
  rpc = (method, params) => new Promise((ok) => { const id = ++seq; waiting.set(id, ok); child.stdin.write(JSON.stringify({ id, method, params }) + '\n'); });
}

const cors = {
  'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type', 'access-control-allow-private-network': 'true', 'access-control-max-age': '600',
};
const body = (req) => new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); });

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  try {
    const url = new URL(req.url, 'http://x');
    if (rpc) {
      let out;
      if (url.pathname === '/v1/calc' && req.method === 'POST') { const m = await rpc('calc', JSON.parse((await body(req)).toString())); out = m.result ?? m.error; }
      else if (url.pathname === '/v1/graph' && req.method === 'POST') { const m = await rpc('graph', JSON.parse((await body(req)).toString())); out = m.result ?? m.error; }
      else if (url.pathname === '/v1/graph_specs') { const m = await rpc('graph_specs', {}); out = m.result ?? m.error; }
      else if (url.pathname === '/v1/meta') { const m = await rpc('meta', {}); out = m.result ?? m.error; }
      // any engine RPC method ({method, params} -> the full {id, result} | {id, error} response): batch, prices_load, ...
      else if (url.pathname === '/v1/rpc' && req.method === 'POST') { const q = JSON.parse((await body(req)).toString()); out = await rpc(q.method, q.params ?? null); }
      else if (url.pathname === '/healthz') out = { ok: true };
      else { res.writeHead(404, cors); res.end(); return; }
      res.writeHead(200, { ...cors, 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
      return;
    }
    const up = await fetch(new URL(url.pathname + url.search, args.upstream), {
      method: req.method, headers: { 'content-type': req.headers['content-type'] ?? 'application/json' },
      body: req.method === 'POST' ? await body(req) : undefined,
    });
    res.writeHead(up.status, { ...cors, 'content-type': up.headers.get('content-type') ?? 'application/json' });
    res.end(Buffer.from(await up.arrayBuffer()));
  } catch (e) {
    res.writeHead(502, { ...cors, 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'BRIDGE', message: String(e?.message ?? e) } }));
  }
}).listen(port, host, () => console.error(`engine bridge on http://${host}:${port} -> ${args.upstream ?? args.stdio}`));
