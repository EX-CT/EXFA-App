// Engine adapter: the UI talks to a stateless calc function hosted in one Web Worker.

export type FitStats = Record<string, any>;

export interface EngineInfo { id: string; label: string; detail?: string }

export interface Engine {
  readonly info: EngineInfo;
  /** resolves when the engine can calculate; returns a human-readable description (engine name, dataset) */
  init(): Promise<string>;
  calc(request: unknown): Promise<FitStats>;
  /** Graph RPC (CONTRACT-GRAPHS rev 0.4). */
  graph?(request: GraphRequest): Promise<GraphResult>;
  graphSpecs?(): Promise<GraphSpecs | null>;
  /** Full response ({id, result} | {id, error}) for engine RPCs beyond calc/graph. */
  rpcRaw?(method: string, params: unknown): Promise<{ result?: any; error?: { code: string; message: string } }>;
  /** Engine providing graph RPC results. */
  readonly graphInfo?: EngineInfo;
  dispose(): void;
}

/** GraphRequest per CONTRACT-GRAPHS 0.4. */
export interface GraphRequest {
  schema_version: 1; graph: string; fit: unknown; target?: unknown;
  x: { axis: string; values: number[] }; y: string[]; params?: Record<string, unknown>; settings?: Record<string, unknown>;
}
/** GraphResult (null = invalid point) or a contract error {error:{code,message,path}}. */
export interface GraphResult { graph?: string; x_axis?: string; x?: number[]; series?: Record<string, (number | null)[]>; meta?: unknown; error?: { code: string; message: string; path?: string } }
/** graph_specs catalogue: graphs[name].axes / .series (other fields engine-specific). */
export interface GraphSpecs { contract?: string; graphs: Record<string, { axes?: Record<string, unknown>; series?: Record<string, unknown>; title?: string }> }

const asSpecs = (r: any): GraphSpecs | null => (r && !r.error && r.graphs && typeof r.graphs === 'object' ? r : null);

export interface EngineConfig { datasetUrl: string; wasmUrl: string }

/** Worker-hosted in-browser engines (the worker owns its own dataset copy). */
class WorkerEngine implements Engine {
  private w: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, { ok: (v: any) => void; err: (e: Error) => void }>();
  readonly info: EngineInfo = { id: 'wasm-worker', label: 'EXFA Engine v0.2.0 · WebAssembly worker' };
  private readonly initMsg: Record<string, unknown>;
  constructor(initMsg: Record<string, unknown>) { this.initMsg = initMsg; }

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

export function createEngine(cfg: EngineConfig): Engine {
  return new WorkerEngine({ kind: 'wasm', wasmUrl: cfg.wasmUrl });
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
