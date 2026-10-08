// Response cache in front of any adapter. Engines are pure functions of (dataset, request), so identical
// requests (an agent re-asking, compare after compute, optimiser revisits) are answered from memory.
import { createHash } from "node:crypto";
import { EngineError, isContractError, type ContractError, type EngineAdapter, type EngineMeta, type FitRequest, type FitStats, type PricesLoadResult } from "./types.js";

export class CachingAdapter implements EngineAdapter {
  private m = new Map<string, FitStats | ContractError>();
  hits = 0;
  misses = 0;

  constructor(
    private inner: EngineAdapter,
    private max = 2000,
  ) {}

  get kind() {
    return this.inner.kind;
  }

  private key(req: FitRequest): string {
    return createHash("sha1").update(JSON.stringify(req)).digest("base64");
  }

  private put(k: string, v: FitStats | ContractError) {
    if (this.m.size >= this.max) this.m.delete(this.m.keys().next().value!); // oldest first (insertion order)
    this.m.set(k, v);
  }

  private get(k: string) {
    const v = this.m.get(k);
    if (v !== undefined) {
      this.m.delete(k); // refresh recency
      this.m.set(k, v);
      this.hits++;
    } else this.misses++;
    return v;
  }

  async calc(req: FitRequest): Promise<FitStats> {
    const k = this.key(req);
    const v = this.get(k);
    if (v !== undefined && !isContractError(v)) return v;
    const r = await this.inner.calc(req);
    this.put(k, r);
    return r;
  }

  async batch(reqs: FitRequest[]): Promise<(FitStats | ContractError)[]> {
    const keys = reqs.map((r) => this.key(r));
    const out: (FitStats | ContractError | undefined)[] = keys.map((k) => this.get(k));
    const todo = out.map((v, i) => (v === undefined ? i : -1)).filter((i) => i >= 0);
    if (todo.length) {
      const res = await this.inner.batch(todo.map((i) => reqs[i]));
      todo.forEach((i, j) => {
        out[i] = res[j];
        if (!isContractError(res[j]) || !/TIMEOUT|ENGINE_/.test(res[j].error.code)) this.put(keys[i], res[j]);
      });
    }
    return out as (FitStats | ContractError)[];
  }

  eftParse(text: string): Promise<FitRequest> {
    return this.inner.eftParse(text);
  }

  eftExport(fit: FitRequest, name?: string): Promise<string> {
    return this.inner.eftExport(fit, name);
  }

  async meta(): Promise<EngineMeta> {
    return { ...(await this.inner.meta()), mcp_cache: { size: this.m.size, max: this.max, hits: this.hits, misses: this.misses } };
  }

  /** docs/27 `compute` (operation "calc") shares the calc cache: same fit → same FitStats, so a hit answers with a
   *  synthesized compute-result envelope. Every other method (incl. operation "batch") passes through. */
  async call<T = unknown>(method: string, params: unknown): Promise<T> {
    const p = params as { operation?: string; fit?: FitRequest } | null;
    if (method !== "compute" || p?.operation !== "calc" || !p.fit || typeof p.fit !== "object") return this.inner.call<T>(method, params);
    const k = this.key(p.fit);
    const v = this.get(k);
    if (v !== undefined && !isContractError(v)) return { format: "exfa/compute-result@1", operation: "calc", result: v } as T;
    const env = await this.inner.call<{ operation?: string; result?: unknown }>(method, params);
    if (env?.operation === "calc" && env.result !== undefined && !isContractError(env.result)) this.put(k, env.result as FitStats);
    return env as T;
  }

  /** New price data changes results: the cache is dropped. */
  async setPrices(path: string | null): Promise<PricesLoadResult> {
    if (!this.inner.setPrices) throw new EngineError("UNSUPPORTED", `the ${this.inner.kind} adapter cannot load price files`);
    const r = await this.inner.setPrices(path);
    this.m.clear();
    return r;
  }

  close(): Promise<void> {
    return this.inner.close();
  }
}
