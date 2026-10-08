// docs/27 compute envelope: capability probe (once per adapter), UNKNOWN_METHOD fallback to `calc` / the `batch`
// RPC, and error propagation. Fake adapters only — no real engine needed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CachingAdapter } from "../adapters/cache.js";
import { EngineError, type ComputeResult, type EngineAdapter, type FitRequest, type FitStats } from "../adapters/types.js";
import { computeBatch, computeCalc } from "../compute.js";

interface Call {
  method: string;
  params: unknown;
}

/** Minimal EngineAdapter; every `call`/`calc`/`batch` invocation is recorded and `handler` answers `call`. */
function fakeEngine(handler: (method: string, params: any) => Promise<unknown> | unknown, calls: Call[], extra: Partial<EngineAdapter> = {}): EngineAdapter {
  return {
    kind: "fake",
    async calc(req: FitRequest): Promise<FitStats> {
      calls.push({ method: "calc", params: req });
      return { via: "calc", ship: (req as any).ship };
    },
    async batch(reqs: FitRequest[]) {
      calls.push({ method: "batch[]", params: reqs });
      return reqs.map(() => ({ via: "batch[]" }));
    },
    async eftParse() {
      return {};
    },
    async eftExport() {
      return "";
    },
    async meta() {
      return { engine: "fake" };
    },
    async call<T>(method: string, params: unknown): Promise<T> {
      calls.push({ method, params });
      return (await handler(method, params)) as T;
    },
    async close() {},
    ...extra,
  };
}

const FIT = { ship: { type_id: 587 } };

test("mcp.compute.calc-envelope: a compute-capable engine answers the exfa/compute@1 envelope and stays on it", async () => {
  const calls: Call[] = [];
  const e = fakeEngine(async (m, p: any) => {
    assert.equal(m, "compute");
    assert.equal(p.format, "exfa/compute@1");
    assert.equal(p.operation, "calc");
    return { format: "exfa/compute-result@1", operation: "calc", result: { offense: { total: { dps: { total: 42 } } } } };
  }, calls);
  const s: any = await computeCalc(e, FIT);
  assert.equal(s.offense.total.dps.total, 42);
  assert.equal((calls[0].params as any).fit, FIT);
  // capability is trusted once known: every fit is a `compute` call, never a re-probe or a `calc`
  await computeCalc(e, { ship: { type_id: 1 } });
  assert.deepEqual(calls.map((c) => c.method), ["compute", "compute"]);
});

test("mcp.compute.calc-fallback-cached: UNKNOWN_METHOD falls back to `calc`; `compute` is never retried", async () => {
  const calls: Call[] = [];
  const e = fakeEngine(async (m) => {
    throw new EngineError("UNKNOWN_METHOD", `unknown method ${m}`);
  }, calls);
  const s: any = await computeCalc(e, FIT);
  assert.equal(s.via, "calc");
  const s2: any = await computeCalc(e, { ship: { type_id: 1 } });
  assert.equal(s2.via, "calc");
  assert.deepEqual(calls.map((c) => c.method), ["compute", "calc", "calc"], "one probe, then straight to calc");
});

test("mcp.compute.envelope-unknown-method: UNKNOWN_METHOD inside the result envelope also falls back", async () => {
  const calls: Call[] = [];
  const e = fakeEngine(async () => ({ format: "exfa/compute-result@1", operation: "calc", error: { code: "UNKNOWN_METHOD", message: "no compute" } }) satisfies ComputeResult, calls);
  const s: any = await computeCalc(e, FIT);
  assert.equal(s.via, "calc");
  await computeCalc(e, FIT);
  assert.equal(calls.filter((c) => c.method === "compute").length, 1);
});

test("mcp.compute.errors-propagate: a compute error that is not UNKNOWN_METHOD surfaces unchanged (no calc retry)", async () => {
  const calls: Call[] = [];
  const e = fakeEngine(async () => {
    throw new EngineError("BAD_REQUEST", "ship: required", "ship");
  }, calls);
  await assert.rejects(computeCalc(e, FIT), (err: any) => err.code === "BAD_REQUEST" && err.path === "ship" && /ship: required/.test(err.message));
  assert.deepEqual(calls.map((c) => c.method), ["compute"], "a request-level error is not retried on the legacy path");
});

test("mcp.compute.envelope-error: an error inside the result envelope becomes an EngineError", async () => {
  const e = fakeEngine(async () => ({ format: "exfa/compute-result@1", operation: "calc", error: { code: "DATASET", message: "no dataset", path: "fit" } }) satisfies ComputeResult, []);
  await assert.rejects(computeCalc(e, FIT), (err: any) => err instanceof EngineError && err.code === "DATASET" && /no dataset/.test(err.message));
});

test("mcp.compute.malformed-envelope: a non-envelope answer counts as 'no compute' and falls back", async () => {
  const calls: Call[] = [];
  const e = fakeEngine(async () => ({ ok: true }), calls);
  const s: any = await computeCalc(e, FIT);
  assert.equal(s.via, "calc");
  await computeCalc(e, FIT);
  assert.equal(calls.filter((c) => c.method === "compute").length, 1, "probed once, then straight to calc");
});

test("mcp.compute.batch-envelope: the batch operation carries the BatchRequest and returns the BatchResponse", async () => {
  const calls: Call[] = [];
  const req = { batch_version: 1, fits: [{ id: "a", fit: FIT }] };
  const e = fakeEngine(async (m, p: any) => {
    assert.equal(m, "compute");
    assert.deepEqual(p, { format: "exfa/compute@1", operation: "batch", batch: req });
    return { format: "exfa/compute-result@1", operation: "batch", result: { form: "fits", total: 1, results: [{ index: 0, id: "a" }] } };
  }, calls);
  const r: any = await computeBatch(e, req);
  assert.equal(r.total, 1);
  assert.equal(r.results[0].id, "a");
  assert.deepEqual(calls.map((c) => c.method), ["compute"]);
});

test("mcp.compute.batch-fallback: no `compute` falls back to the legacy `batch` RPC, once", async () => {
  const calls: Call[] = [];
  const req = { batch_version: 1, fits: [{ id: "a", fit: FIT }] };
  const e = fakeEngine(async (m) => {
    if (m === "batch") return { form: "fits", total: 1, results: [] };
    throw new EngineError("UNKNOWN_METHOD", `unknown method ${m}`);
  }, calls);
  const r: any = await computeBatch(e, req);
  assert.equal(r.form, "fits");
  await computeBatch(e, req);
  assert.deepEqual(calls.map((c) => c.method), ["compute", "batch", "batch"], "one compute probe, batches go to `batch`");
});

test("mcp.compute.neither-method: an engine with neither `compute` nor `batch` reports UNKNOWN_METHOD for batches", async () => {
  const e = fakeEngine(async (m) => {
    throw new EngineError("UNKNOWN_METHOD", `unknown method ${m}`);
  }, []);
  assert.equal(((await computeCalc(e, FIT)) as any).via, "calc");
  await assert.rejects(computeBatch(e, { batch_version: 1 }), (err: any) => err.code === "UNKNOWN_METHOD");
});

test("mcp.compute.cache-shared: compute/calc results share the CachingAdapter calc cache", async () => {
  let innerCalls = 0;
  const raw = fakeEngine(async () => {
    innerCalls++;
    return { format: "exfa/compute-result@1", operation: "calc", result: { n: innerCalls } } satisfies ComputeResult;
  }, []);
  const c = new CachingAdapter(raw);
  const a: any = await computeCalc(c, FIT); // miss → inner compute; result cached under key(fit)
  const b: any = await c.calc(FIT); // calc hit on the same key
  const d: any = await computeCalc(c, FIT); // compute hit: synthesized envelope, no inner call
  assert.equal(innerCalls, 1);
  assert.deepEqual([a.n, b.n, d.n], [1, 1, 1]);
});
