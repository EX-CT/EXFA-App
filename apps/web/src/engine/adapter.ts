import { canonicalBackend } from './defaults';
// Engine adapter: the UI talks to a stateless `calc(FitRequest) -> FitStats` function. Backends are swappable at
// runtime (settings panel / ?engine= URL parameter), so the final engine choice does not touch UI code.

export type FitStats = Record<string, any>;

export interface EngineInfo { id: string; label: string; detail?: string }

export interface Engine {
  readonly info: EngineInfo;
  /** resolves when the engine can calculate; returns a human-readable description (engine name, dataset) */
  init(): Promise<string>;
  calc(request: unknown): Promise<FitStats>;
  /** Optional graph RPC (CONTRACT-GRAPHS rev 0.2, EXFA-Bench `graphs-round2`). Engines without it leave these
   *  undefined or resolve graphSpecs() to null; the UI then falls back to its own approximation graphs. */
  graph?(request: GraphRequest): Promise<GraphResult>;
  graphSpecs?(): Promise<GraphSpecs | null>;
  /** Optional engine RPC (full response {id, result} | {id, error}) for methods beyond calc/graph: docs/23 `batch`,
   *  `prices_load`. Backends without an RPC leave it undefined; engines without the method answer UNKNOWN_METHOD. */
  rpcRaw?(method: string, params: unknown): Promise<{ result?: any; error?: { code: string; message: string } }>;
  /** Backend that answers graph() when it is not this engine itself (see GRAPH_FALLBACK); set once graphSpecs() resolved. */
  readonly graphInfo?: EngineInfo;
  dispose(): void;
}

/** Backends whose graphs come from another backend's graph RPC while their own engine has none. The WASM build
 *  computes stats and graphs itself, so no current backend needs a fallback; kept for stored-config backends. */
export const GRAPH_FALLBACK: Record<string, string> = {};


/** GraphRequest per CONTRACT-GRAPHS 0.2: {schema_version, graph, fit, target?, x:{axis, values}, y:[...], params?, settings?} */
export interface GraphRequest {
  schema_version: 1; graph: string; fit: unknown; target?: unknown;
  x: { axis: string; values: number[] }; y: string[]; params?: Record<string, unknown>; settings?: Record<string, unknown>;
}
/** GraphResult (null = invalid point) or a contract error {error:{code,message,path}}. */
export interface GraphResult { graph?: string; x_axis?: string; x?: number[]; series?: Record<string, (number | null)[]>; meta?: unknown; error?: { code: string; message: string; path?: string } }
/** graph_specs catalogue: graphs[name].axes / .series (other fields engine-specific). */
export interface GraphSpecs { contract?: string; graphs: Record<string, { axes?: Record<string, unknown>; series?: Record<string, unknown>; title?: string }> }

const asSpecs = (r: any): GraphSpecs | null => (r && !r.error && r.graphs && typeof r.graphs === 'object' ? r : null);

export interface EngineConfig { backend: string; httpUrl: string; datasetUrl: string; wasmUrl: string }

export const BACKENDS: EngineInfo[] = [
  { id: 'wasm-worker', label: 'In-browser: EXFA engine (Rust→WASM, dataset compiled in; stats + graphs) in a Web Worker' },
  { id: 'http', label: 'Local/remote HTTP engine (POST {url}/v1/calc, e.g. `exfa` behind tools/engine-bridge.mjs)' },
];

/** Worker-hosted in-browser engines (the worker owns its own dataset copy). */
class WorkerEngine implements Engine {
  private w: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, { ok: (v: any) => void; err: (e: Error) => void }>();
  readonly info: EngineInfo;
  private readonly initMsg: Record<string, unknown>;
  constructor(info: EngineInfo, initMsg: Record<string, unknown>) { this.info = info; this.initMsg = initMsg; }

  private call(msg: Record<string, unknown>): Promise<any> {
    const id = ++this.seq;
    return new Promise((ok, err) => { this.pending.set(id, { ok, err }); this.w!.postMessage({ ...msg, id }); });
  }
  async init(): Promise<string> {
    this.w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.w.onmessage = (ev) => {
      const { id, result, error } = ev.data;
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      if (error) p.err(new Error(error)); else p.ok(result);
    };
    this.w.onerror = (ev) => { for (const p of this.pending.values()) p.err(new Error(ev.message || 'worker error')); this.pending.clear(); };
    return this.call({ op: 'init', ...this.initMsg });
  }
  calc(request: unknown) { return this.call({ op: 'calc', request }); }
  graph(request: GraphRequest): Promise<GraphResult> { return this.call({ op: 'rpc', method: 'graph', params: request }); }
  async graphSpecs() { try { return asSpecs(await this.call({ op: 'rpc', method: 'graph_specs', params: {} })); } catch { return null; } }
  /** Any engine RPC method, full response ({id, result} | {id, error}); used by tools/browser-rpc.mjs (bench batch, prices). */
  rpcRaw(method: string, params: unknown): Promise<any> { return this.call({ op: 'rpc_raw', method, params }); }
  /** The engine's response text as written (exact number formatting; bench tooling). */
  rpcText(method: string, params: unknown): Promise<string> { return this.call({ op: 'rpc_text', method, params }); }
  dispose() { this.w?.terminate(); this.w = null; }
}

class HttpEngine implements Engine {
  readonly info: EngineInfo;
  private readonly base: string;
  constructor(info: EngineInfo, base: string) { this.info = info; this.base = base.replace(/\/+$/, ''); }
  async init() {
    try {
      const r = await fetch(`${this.base}/v1/meta`);
      if (r.ok) { const m = await r.json(); return `${m.engine ?? 'HTTP engine'} · SDE ${m.sde_build ?? '?'} @ ${this.base}`; }
    } catch { /* fall through: try a calc-only server */ }
    const r = await fetch(`${this.base}/healthz`).catch(() => null);
    if (!r || !r.ok) throw new Error(`no engine at ${this.base}: GET /v1/meta failed. Is it running with CORS (tools/engine-bridge.mjs)? From the hosted site, allow the browser's local-network permission prompt.`);
    return `HTTP engine @ ${this.base}`;
  }
  async calc(request: unknown) {
    const r = await fetch(`${this.base}/v1/calc`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
    const body = await r.json().catch(() => ({ error: { code: 'BAD_RESPONSE', message: `HTTP ${r.status}` } }));
    return body;
  }
  /** Bridge routes POST /v1/graph and GET /v1/graph_specs (tools/engine-bridge.mjs, engines with the graph RPC). */
  async graph(request: GraphRequest): Promise<GraphResult> {
    const r = await fetch(`${this.base}/v1/graph`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
    return r.json().catch(() => ({ error: { code: 'BAD_RESPONSE', message: `HTTP ${r.status}` } }));
  }
  async graphSpecs() {
    try { const r = await fetch(`${this.base}/v1/graph_specs`); return r.ok ? asSpecs(await r.json()) : null; } catch { return null; }
  }
  /** Bridge route POST /v1/rpc {method, params} (tools/engine-bridge.mjs). */
  async rpcRaw(method: string, params: unknown) {
    const r = await fetch(`${this.base}/v1/rpc`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params }) });
    if (!r.ok) return { error: { code: 'UNKNOWN_METHOD', message: `HTTP ${r.status}` } };
    return r.json().catch(() => ({ error: { code: 'BAD_RESPONSE', message: `HTTP ${r.status}` } }));
  }
  dispose() {}
}

/** Fit stats from `primary`; graph RPC from `primary` if it has one, else from a lazily started second backend. */
class GraphSplitEngine implements Engine {
  graphInfo?: EngineInfo;
  private g: Promise<Engine | null> | null = null;
  private own: boolean | null = null;
  private readonly primary: Engine;
  private readonly makeGraph: () => Engine;
  constructor(primary: Engine, makeGraph: () => Engine) { this.primary = primary; this.makeGraph = makeGraph; }
  get info() { return this.primary.info; }
  init() { return this.primary.init(); }
  calc(request: unknown) { return this.primary.calc(request); }
  get rpcRaw() { return this.primary.rpcRaw?.bind(this.primary); }
  get rpcText() { return (this.primary as WorkerEngine).rpcText?.bind(this.primary); }
  private second() {
    return (this.g ??= (async () => {
      const e = this.makeGraph();
      try { await e.init(); return e; } catch { e.dispose(); return null; }
    })());
  }
  async graphSpecs(): Promise<GraphSpecs | null> {
    if (this.own === null) this.own = !!(await this.primary.graphSpecs?.().catch(() => null));
    if (this.own) { this.graphInfo = this.primary.info; return this.primary.graphSpecs!(); }
    const e = await this.second();
    const specs = e?.graphSpecs ? await e.graphSpecs() : null;
    this.graphInfo = specs && e ? e.info : undefined;
    return specs;
  }
  async graph(request: GraphRequest): Promise<GraphResult> {
    if (this.own) return this.primary.graph!(request);
    const e = await this.second();
    return e?.graph ? e.graph(request) : { error: { code: 'NO_GRAPH_ENGINE', message: 'graph backend unavailable' } };
  }
  dispose() { this.primary.dispose(); this.g?.then((e) => e?.dispose()); }
}

export function createEngine(cfg: EngineConfig): Engine {
  cfg = { ...cfg, backend: canonicalBackend(cfg.backend) };
  const fb = GRAPH_FALLBACK[cfg.backend];
  if (fb && fb !== cfg.backend) return new GraphSplitEngine(createBase(cfg), () => createBase({ ...cfg, backend: fb }));
  return createBase(cfg);
}

function createBase(cfg: EngineConfig): Engine {
  const info = BACKENDS.find((b) => b.id === cfg.backend) ?? BACKENDS[0];
  switch (info.id) {
    case 'http': return new HttpEngine(info, cfg.httpUrl);
    default: return new WorkerEngine(info, { kind: 'wasm', wasmUrl: cfg.wasmUrl });
  }
}

// ---- docs/23 engine batch + prices on top of rpcRaw ----

/** An RPC error is either the response's `error` or (exfa) a `result` that is `{error}`. */
const rpcError = (r: { result?: any; error?: { code: string; message: string } }) => r.error ?? (r.result && typeof r.result === 'object' && !Array.isArray(r.result) && r.result.error) ?? null;

/** One engine `batch` call (docs/23 BatchRequest -> BatchResult); null when the backend has no batch RPC. */
export async function engineBatch(e: Engine, request: Record<string, unknown>): Promise<{ results: { index: number; id?: string; label?: string; stats?: FitStats; error?: { code: string; message: string } }[] } | null> {
  if (!e.rpcRaw) return null;
  const r = await e.rpcRaw('batch', request).catch(() => null); // backend without an RPC export
  if (!r) return null;
  const err = rpcError(r);
  if (err) { if (err.code === 'UNKNOWN_METHOD') return null; throw new Error(`${err.code}: ${err.message}`); }
  return r.result;
}

/** Set (snapshot object) or clear (null) the engine session's market snapshot (L4, `prices_load`, label `injected`).
 *  false when the backend has no prices RPC. */
export async function enginePricesLoad(e: Engine, snapshot: unknown | null): Promise<boolean> {
  if (!e.rpcRaw) return false;
  const r = await e.rpcRaw('prices_load', snapshot == null ? { clear: true } : { snapshot }).catch(() => null);
  if (!r) return false;
  const err = rpcError(r);
  if (err) { if (err.code === 'UNKNOWN_METHOD') return false; throw new Error(`${err.code}: ${err.message}`); }
  return true;
}
