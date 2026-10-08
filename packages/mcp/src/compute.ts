// docs/27 §5 unified compute media: every calculation goes out as one `exfa/compute@1` envelope over the
// engine's `compute` RPC — operation "calc" for a single FitRequest, operation "batch" for a docs/23
// BatchRequest — answered by `exfa/compute-result@1`. An engine without `compute` (UNKNOWN_METHOD, or a
// non-envelope answer) gets the same payload through the legacy `calc` method / `batch` RPC. Capability is
// probed once per adapter instance and cached for the life of the process.
import {
  EngineError,
  engineErrorFrom,
  type ComputeRequest,
  type ComputeResult,
  type EngineAdapter,
  type FitRequest,
  type FitStats,
} from "./adapters/types.js";

/** Adapters that already answered `compute` (per adapter instance; a restarted process re-probes). */
const computeCapable = new WeakMap<EngineAdapter, boolean>();

/** UNKNOWN_METHOD arrives as a thrown EngineError (transport-level `{id, error}` or an adapter's unwrapping of a
 *  contract-error result) or inside the compute-result envelope. */
export const isUnknownMethod = (e: unknown): boolean =>
  (e as any)?.code === "UNKNOWN_METHOD" || /unknown method/i.test(String((e as any)?.message ?? e));

/** One `compute` call for the envelope; null when this engine has no `compute` (probed once, then cached). */
async function tryCompute(engine: EngineAdapter, request: ComputeRequest): Promise<unknown | null> {
  if (computeCapable.get(engine) === false) return null;
  let env: ComputeResult;
  try {
    env = await engine.call<ComputeResult>("compute", request);
  } catch (e) {
    if (isUnknownMethod(e)) {
      computeCapable.set(engine, false);
      return null;
    }
    // a compute-level error (bad fit, bad batch…) or a transport failure: thrown exactly like `calc` would
    throw e;
  }
  if (!env || typeof env !== "object" || env.operation !== request.operation) {
    computeCapable.set(engine, false); // answered, but not an exfa/compute-result@1 envelope
    return null;
  }
  computeCapable.set(engine, true);
  if (env.result !== undefined) return env.result;
  const ce = env.error;
  if (!ce) throw new EngineError("BAD_ENGINE_RESPONSE", `compute ${request.operation}: the envelope has neither result nor error`);
  if (isUnknownMethod(ce)) {
    computeCapable.set(engine, false);
    return null;
  }
  throw engineErrorFrom(ce);
}

/** One fit: `compute` operation "calc" when the engine has it, else the legacy `calc` method. */
export async function computeCalc(engine: EngineAdapter, fit: FitRequest): Promise<FitStats> {
  const r = await tryCompute(engine, { format: "exfa/compute@1", operation: "calc", fit });
  return r === null ? engine.calc(fit) : (r as FitStats);
}

/** A docs/23 BatchRequest: `compute` operation "batch" when the engine has it, else the legacy `batch` RPC
 *  (a second UNKNOWN_METHOD propagates — the caller phrases "no batch method"). */
export async function computeBatch(engine: EngineAdapter, batch: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await tryCompute(engine, { format: "exfa/compute@1", operation: "batch", batch });
  return r === null ? engine.call<Record<string, unknown>>("batch", batch) : (r as Record<string, unknown>);
}
