// All configuration comes from the environment (MCP clients pass env in their server config).
import { existsSync } from "node:fs";
import { CachingAdapter } from "./adapters/cache.js";
import { CliAdapter } from "./adapters/cli.js";
import { HttpAdapter } from "./adapters/http.js";
import { expandCommand } from "./adapters/cmd.js";
import { RpcAdapter } from "./adapters/rpc.js";
import type { EngineAdapter } from "./adapters/types.js";

export interface Config {
  /** "rpc" (long-running serve-stdio, default), "cli" (spawn per call) or "http" (remote engine server). */
  adapter: "rpc" | "cli" | "http";
  engineUrl: string;
  bin: string;
  dataset: string;
  rpcCmd: string;
  calcCmd: string;
  batchCmd: string;
  workers: number;
  timeoutMs: number;
  /** Skill level applied when a fit gives no skills (engines default to 0, which surprises people). */
  defaultSkillLevel: number;
  maxBatch: number;
  cacheSize: number;
  httpHost: string;
  httpPort: number;
  allowedHosts: string[] | null;
}

export const ENV_DOC: Record<string, string> = {
  EXFA_ENGINE_BIN: "engine binary (default: `exfa` on PATH, the engine built by EX-CT/EXFA-Engine; any contract-compatible engine works)",
  EXFA_DATASET: "dataset-<build>.json.gz used by both the engine and the MCP search index (required)",
  EXFA_ADAPTER: "`rpc` (default: long-running `serve-stdio` process), `cli` (spawn `calc`/`batch` per call) or `http` (remote engine server)",
  EXFA_ENGINE_URL: "base URL of an HTTP engine for EXFA_ADAPTER=http (POST /v1/calc, /v1/batch, /v1/rpc; GET /v1/meta)",
  EXFA_RPC_CMD: "rpc command template (default `{bin} --dataset {dataset} serve-stdio`)",
  EXFA_CALC_CMD: "cli calc template (default `{bin} --dataset {dataset} calc`)",
  EXFA_BATCH_CMD: "cli batch template (default `{bin} --dataset {dataset} batch`)",
  EXFA_WORKERS: "number of rpc engine processes (default 1; batches are spread over them)",
  EXFA_TIMEOUT_MS: "per-call engine timeout (default 60000)",
  EXFA_DEFAULT_SKILLS: "skill level for fits that give none (default 5, i.e. Pyfa 'All 5')",
  EXFA_MAX_BATCH: "max candidate fits evaluated per helper call (default 400)",
  EXFA_CACHE: "calc results kept in memory by exact request (default 2000; 0 disables)",
  EXFA_PRICE_SOURCE: "price source for get_prices / price_fit: `esi` (default; CCP ESI /markets/prices/, universe average) or `fuzzwork` (trade-hub sell/buy percentile)",
  EXFA_PRICE_SYSTEM: "trade hub for fuzzwork: jita (default), amarr, dodixie, rens, hek",
  EXFA_PRICE_CACHE: "price cache directory (default $XDG_CACHE_HOME/exfa-mcp or ~/.cache/exfa-mcp; `off` = memory only)",
  EXFA_PRICE_TTL_S: "price cache lifetime in seconds (default 3600; ESI uses its Expires header)",
  EXFA_OFFLINE: "1 = never fetch prices; use the cache whatever its age (results say stale)",
  EXFA_USER_AGENT: "User-Agent sent to ESI / Fuzzwork (default names this project; add your contact per ESI etiquette)",
  EXFA_PRICES: "injected price file loaded into the engine at start (docs/23 file layer, like `exfa --prices FILE`): path or http(s) URL of an eve-price-snapshot v1 / {type_id: isk} map, or `latest` (newest EX-CT/EXFA-Data release; cached under EXFA_PRICE_CACHE/snapshots). Tool load_prices changes it at run time",
  EXFA_PRICES_REPO: "GitHub repo of the snapshot releases for `latest` (default EX-CT/EXFA-Data)",
  EXFA_HTTP_HOST: "HTTP bind address for --http (default 127.0.0.1)",
  EXFA_HTTP_PORT: "HTTP port for --http (default 8765)",
};

function int(v: string | undefined, d: number): number {
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const adapter = (env.EXFA_ADAPTER ?? "rpc").toLowerCase();
  if (adapter !== "rpc" && adapter !== "cli" && adapter !== "http") throw new Error(`EXFA_ADAPTER must be rpc, cli or http, got ${adapter}`);
  return {
    adapter,
    engineUrl: env.EXFA_ENGINE_URL || "",
    bin: env.EXFA_ENGINE_BIN || "exfa",
    dataset: env.EXFA_DATASET || "",
    rpcCmd: env.EXFA_RPC_CMD || "{bin} --dataset {dataset} serve-stdio",
    calcCmd: env.EXFA_CALC_CMD || "{bin} --dataset {dataset} calc",
    batchCmd: env.EXFA_BATCH_CMD || "{bin} --dataset {dataset} batch",
    workers: Math.max(1, int(env.EXFA_WORKERS, 1)),
    timeoutMs: Math.max(1000, int(env.EXFA_TIMEOUT_MS, 60_000)),
    defaultSkillLevel: Math.min(5, Math.max(0, int(env.EXFA_DEFAULT_SKILLS, 5))),
    maxBatch: Math.max(1, int(env.EXFA_MAX_BATCH, 400)),
    cacheSize: Math.max(0, int(env.EXFA_CACHE, 2000)),
    httpHost: env.EXFA_HTTP_HOST || "127.0.0.1",
    httpPort: int(env.EXFA_HTTP_PORT, 8765),
    allowedHosts: env.EXFA_ALLOWED_HOSTS === "*" ? null : env.EXFA_ALLOWED_HOSTS ? env.EXFA_ALLOWED_HOSTS.split(",").map((x) => x.trim()).filter(Boolean) : [],
  };
}

export function checkConfig(cfg: Config): void {
  if (!cfg.dataset) throw new Error("EXFA_DATASET is not set (path to dataset-<build>.json.gz)");
  if (!existsSync(cfg.dataset)) throw new Error(`EXFA_DATASET does not exist: ${cfg.dataset}`);
}

export function createAdapter(cfg: Config): EngineAdapter {
  const a = createRawAdapter(cfg);
  return cfg.cacheSize > 0 ? new CachingAdapter(a, cfg.cacheSize) : a;
}

function createRawAdapter(cfg: Config): EngineAdapter {
  if (cfg.adapter === "http") {
    if (!cfg.engineUrl) throw new Error("EXFA_ADAPTER=http needs EXFA_ENGINE_URL");
    return new HttpAdapter({ baseUrl: cfg.engineUrl, timeoutMs: cfg.timeoutMs });
  }
  const vars = { bin: cfg.bin, dataset: cfg.dataset };
  if (cfg.adapter === "cli")
    return new CliAdapter({
      calcArgv: expandCommand(cfg.calcCmd, vars),
      batchArgv: expandCommand(cfg.batchCmd, vars),
      rpcArgv: expandCommand(cfg.rpcCmd, vars),
      timeoutMs: cfg.timeoutMs,
    });
  return new RpcAdapter({ argv: expandCommand(cfg.rpcCmd, vars), workers: cfg.workers, timeoutMs: cfg.timeoutMs });
}
