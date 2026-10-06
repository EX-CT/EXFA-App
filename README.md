# EXFA-App — EXFA · 精密装配助理

[![pages](https://github.com/EX-CT/EXFA-App/actions/workflows/pages.yml/badge.svg)](https://github.com/EX-CT/EXFA-App/actions/workflows/pages.yml) [![site](https://img.shields.io/badge/site-ex--ct.github.io%2FEXFA--App-brightgreen)](https://ex-ct.github.io/EXFA-App/)

**Live site: https://ex-ct.github.io/EXFA-App/** — an EVE Online fitting tool in the browser,
the Pyfa-shaped replacement on top of the Rust engine in
[EX-CT/EXFA-Engine](https://github.com/EX-CT/EXFA-Engine). No install, no account required;
all computation runs locally in a Web Worker (Rust→WASM).

## Features

* **Fitting, Pyfa-style**: market tree + search with EVE shorthand (`lse`, `dc ii`, `5mn mwd`),
  double-click or drag items onto the fitting canvas, right-click a module for its context menu
  (variations, states, remove), drag charges onto a module to load them.
* **Everything computed by the engine**: offense/defense/capacitor/navigation/targeting stats,
  resource bars, drone bays, remote assistance, damage patterns and target profiles — with
  interactive graphs (DPS vs range, capacitor vs time, …) straight from the engine's graph RPC.
* **Characters**: built-in all-0/all-5, manual sheets, alpha-clone caps, and **ESI sign-in**
  (EVE SSO v2 PKCE) to import trained skills and implants straight into the fit.
* **Formats**: EFT / DNA / ESI-JSON / XML / eftcfg import (WASM formats engine, or a built-in
  fallback), export to EFT / DNA / ESI / multibuy, share links.
* **Prices**: the engine embeds a snapshot at build time; the site re-fetches the newest
  EXFA-Data `prices-*` snapshot hourly and injects it into the live engine session (status shown
  in the price box). Local "my price" overrides on top.
* **中文界面** toggle, mutaplasmid mutations, projected/fleet/environment effects, fit library
  with folders + tags + backup/restore.

## Components

* **EXFA Web** (`apps/web`): a vite/React single-page app. The engine runs in a Web Worker as
  Rust→WASM (dataset compiled in; stats + graphs), or over HTTP against a local/remote `exfa` engine
  via `tools/engine-bridge.mjs`. Deployed by GitHub Pages to `https://ex-ct.github.io/EXFA-App/`
  (workflow `.github/workflows/pages.yml`, `BASE` repo variable); optional second publish to
  Cloudflare Pages (`deploy-cf` job, see EXFA-Docs docs/25).
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

## Configuration (repo variables / secrets)

| Name | Where | Purpose |
| --- | --- | --- |
| `ESI_CLIENT_ID` | repo variable | EVE developer app client id baked into the build (`VITE_ESI_CLIENT_ID`); without it users can still paste a client id into the Character panel |
| `CF_ENABLED` / `CF_PROJECT` | repo variable | set `CF_ENABLED=true` to turn on the Cloudflare Pages deploy (`deploy-cf` job) |
| `CF_API_TOKEN` / `CF_ACCOUNT_ID` | repo secret | Cloudflare API token (Pages:Edit) + account id for wrangler Direct Upload |

Registering the EVE app: developers.eveonline.com → new application → callback
`<site-base>/esi/callback` (e.g. `https://ex-ct.github.io/EXFA-App/esi/callback`),
scopes `esi-skills.read_skills.v1` + `esi-clones.read_implants.v1`. PKCE public client,
no secret needed.

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
