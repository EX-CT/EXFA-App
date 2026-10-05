# EXFA-App — EXFA · 精密装配助理

The **EXFA Web** browser UI (`apps/web`) and the **EXFA MCP** server (`packages/mcp`), on top of the
stateless engine contract from [EX-CT/EXFA-Engine](https://github.com/EX-CT/EXFA-Engine).

* **EXFA Web** (`apps/web`): a vite/React single-page app. The engine runs in a Web Worker as
  Rust→WASM (dataset compiled in; stats + graphs), or over HTTP against a local/remote `exfa` engine
  via `tools/engine-bridge.mjs`. Deployed by GitHub Pages to `https://ex-ct.github.io/EXFA-App/`
  (workflow `.github/workflows/pages.yml`, `BASE` repo variable).
* **EXFA MCP** (`packages/mcp`): engine-agnostic MCP server (search, validate, compute, compare,
  optimise) for AI agents. Binary `exfa-mcp`, package `@ex-ct/exfa-mcp`; see
  [`packages/mcp/README.md`](packages/mcp/README.md).

## Data and engine inputs (CI / Pages)

Everything the site needs is downloaded from sibling releases — nothing is compiled from Rust or SDE
here:

* `apps/web/public/data/dataset-*.json.gz`, `presets-web.json` — latest `sde-*` release of
  [EX-CT/EXFA-Data](https://github.com/EX-CT/EXFA-Data) (`tools/slim-presets.mjs` slims `presets.json`).
* `apps/web/public/prices/latest.json.gz` — newest `prices-*`-tagged release of EXFA-Data (release
  **list**, not `/releases/latest` — that endpoint points at the Latest-marked `sde-*` release).
* `apps/web/public/engines/f/{exfa_wasm.wasm,exfa_formats_wasm.wasm}` — latest EXFA-Engine release
  assets (`exfa-wasm32-wasip1.wasm`, `exfa_formats_wasm.wasm`), the in-browser stats/graphs and
  format-import engines.

## Development

```bash
npm ci
npm run build --workspace=apps/web      # or: npm run build -w packages/mcp
npm run test --workspaces --if-present
```

Unit tests need the mini dataset (`apps/web/src/test/fixtures`) — checked in. The formats WASM is
optional locally (`EXFA_FORMATS_WASM` env or `apps/web/public/engines/f/exfa_formats_wasm.wasm`);
MCP integration tests need `EXFA_ENGINE_BIN` + `EXFA_DATASET` (see `packages/mcp/src/test/helpers.ts`).

## Licence

LGPL-3.0-or-later (`LICENSE`, `LICENSE.GPL-3.0`), per the EXFA licensing policy in
[EX-CT/EXFA-Docs](https://github.com/EX-CT/EXFA-Docs) docs/00. EVE Online data © CCP hf., used under
the CCP developer licence.
