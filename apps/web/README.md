# EVE Fit Web

A modern web fitting tool for EVE Online (Vite + React + TypeScript) that aims to reproduce Pyfa's UI features.
It is built on the stateless EXCT engine contract (`calc(FitRequest) -> FitStats`, see
[eve-fit-docs/05-api-schema](https://github.com/EX-CT/eve-fit-docs/blob/main/docs/05-api-schema.md)).

**Live:** https://ex-ct.github.io/eve-fit-web/

中文：基于无状态引擎契约的 EVE 配船网页（复现 Pyfa 界面功能）。引擎通过可切换的适配层调用，可在浏览器内运行（TypeScript / WASM），也可调用本地 HTTP 引擎。数据来自 eve-sde-pipeline 的 Release。界面支持中文（物品名来自数据集，主要界面文字已翻译）。

## Features
- **Market browser and search.** Browse the market-group tree from the dataset. Search names in English or Chinese, with kind filters. "Show info" lists attributes, ship bonus text (traits) and required skills; opened on a fitted module, drone or the ship it adds the engine-computed fitted values (changed values highlighted).
- **Fitting window.**
  - High/mid/low/rig/subsystem/service slots, using totals from the engine and showing empty slots.
  - Module states: offline, online, active, overheated (click for the next state, right-click for the previous).
  - Charges and ammo, filtered by charge group, size and capacity.
  - Mutaplasmids: choose one and set each rolled attribute with a slider.
  - Drones (quantity and number active), fighters (squadron size, launched or not, per-ability toggles with Pyfa's defaults), implants and boosters (each slot holds one; booster side effects can be switched on one at a time), cargo.
  - Per-module spool-up for Triglavian weapons and mutadaptive repairers (overrides the fit default).
  - T3D modes, fit notes.
  - Undo / redo per fit (buttons, Ctrl+Z / Ctrl+Y).
  - Attribute overrides (Pyfa's override editor): in Show info, set a base attribute value for a type in this fit (sent as `overrides`).
- **Character and skills.** Built-in All 5, All 4 and All 0 characters, plus custom characters with a default level and per-skill levels. Shows which skills the fit requires and which are missing, with a "train required" button. Pilot security status.
- **Damage patterns and target profiles.** Built-in presets, including NPC factions, plus custom ones. Damage patterns feed EHP and RAH adaptation; target profiles feed DPS vs target and the graphs.
- **Projected, fleet and environment.**
  - Projected modules, drones and fighters, each with an amount and a distance.
  - Projected saved fits.
  - Fleet booster fits (command bursts) and manual warfare buffs (any buff ID with a value).
  - System effects and beacons (wormhole, abyssal, Triglavian, incursion, faction warfare, metaliminal storms), and system security.
- **Full stats panel:**
  - resources (CPU, powergrid, calibration, drone bandwidth and bay, fighter bay and tubes, cargo, hardpoints)
  - offense: DPS and volley per damage type and per weapon, vs target
  - defense: HP, resists, EHP, raw/effective/sustained tank
  - capacitor: stability, delta, injectors
  - navigation, targeting (lock times, jam chance), drones
  - mining yield (with waste), outgoing remote repairs / capacitor transfer (with spool range), bombs to kill per damage type and Covert Ops level, overheat burnout per module, EHP per drone / fighter (engine F stats-ext 1.10)
  - violations (named in words) and engine warnings
- **Price:** computed by the engine (eve-dogma docs/23 `price` block, backends wasm-worker and http): ship, fittings, loaded charges, drones/fighters, implants/boosters and cargo, each line with its price source; unpriced items are listed. Sources, highest first: **my prices** (local price overrides by type, market group, group or category, fixed ISK or a multiplier, e.g. self-produced = 0; stored in this browser only and sent as `price_overrides`), the **updated snapshot** ("update prices": the latest [eve-market-prices](https://github.com/EX-CT/eve-market-prices/releases) Jita snapshot, copied into the site by CI on every build, at least every 6 h, and loaded into the engine with `prices_load`), else the Jita snapshot embedded in the engine. The price panel and the About tab show the provenance (price source, snapshot id and time, SDE build and hash).
- **Graphs:** DPS vs range (turret hit chance, missile application, drones), capacitor vs time, regen vs fill %, speed and distance vs time, lock time vs signature, warp time vs distance. On a backend with the graph RPC (CONTRACT-GRAPHS rev 0.2: `graph_specs` / `graph`: the default `wasm-worker` (F), and `wasm-j-worker` through F) the engine computes these graphs, and the application profile (best ammo), EWAR and remote-repair graphs are added. On other backends, or if an engine graph call fails, the UI computes approximations from one stats result. A label next to the graph says which kind you are looking at.
- **Compare:** several saved fits side by side (DPS, volley, EHP per layer, tank, capacitor, speed, align, signature, targeting, CPU/PG left, problems), computed in one engine `batch` call (docs/23) on the F backends, one calc per fit on the others; best value highlighted, deltas against the first fit (any fit can be made the baseline).
- **What-if:** variants of the active fit computed in one go and ranked by any metric as deltas: every meta variation of a module (Pyfa's variations menu), every compatible charge, each module offline, other characters. Rows that add fitting problems are marked; *Apply* takes a variant (undo restores the fit).
- **Multi-fit graphs:** overlay other saved fits on any graph (one engine call per fit, same x range; dashed per fit), and on engine graphs use a saved fit as the target of the damage / application / EWAR / remote-repair graphs (CONTRACT-GRAPHS 0.2 `target.fit`). The **ECM burst + scan-res damps** graph (Pyfa's `fitEcmBurstScanresDamps`) shows the enemy's lock time and lock uptime per 30 s burst, or the damage dealt before dying, against the enemy scan resolution.
- **Import and export (formats layer, `src/formats`):** every fit text goes through the formats layer, which returns structured fits (FitRequest JSON) before any engine call; the engines take structured fits and skills only. The layer runs the **eve-fit-formats** WASM module (crate `eve-fit-formats-wasm` of EX-CT/eve-dogma, built from the same `engines.lock` pin as engine F; Pyfa-exact formats): EFT (with mutated-module blocks, several fits at once), DNA (and chat links), ESI fitting JSON, EVE client XML, EFT config files (file import), multibuy and Pyfa's ship-stats text (computed from the engine's stats of the fit). Share links `?eft=` / `?dna=` use it too. Without the module (local dev without a Rust build, or `?formats=builtin`) the built-in TypeScript parsers (EFT, DNA, ESI JSON, multibuy) take over; the dialog and the About tab say which one is active.
- **Fit library:** saved fits are stored in IndexedDB (falling back to localStorage, then memory; a library kept in localStorage by earlier versions is migrated once, with a copy left under `eve-fit-web:v1:migrated`). Folders (nested, `a/b`) and tags, grouping by folder or ship group, search (name, ship, folder, notes, `tag:<name>`), rename / move / tag (one fit or a selection), duplicate, delete (links from projected and fleet fits are removed), export of a selection or the whole library as one EVE XML file or as EFT, and JSON backup / restore (fits, folders, characters, profiles, implant sets; restoring the same backup twice adds nothing). Pasting several EFT fits at once imports them all.
- **Damage patterns / target profiles:** built in are only the exact patterns (Uniform, EM, Thermal, Kinetic, Explosive) and a few target profiles; NPC profiles derived from the SDE (eve-sde-pipeline `presets.json`) can be shown; Pyfa's own built-in set (118 damage patterns, 195 target profiles) is opt-in in the Profiles tab. That set is Pyfa data (GPL-3.0) from the pipeline's separate asset `presets-pyfa-LGPL-GPL.json`: CI deploys it as its own file next to the site with its notice and attribution, it is not part of this MIT repository, and the browser fetches it only when turned on.
- **Pyfa import:** Pyfa's export formats (EFT, DNA, EVE XML, ESI JSON) through the formats layer, and Pyfa's saved-fits database (`saveddata.db`) read in the browser with sql.js (`src/formats/pyfadb.ts`): fits with module states, charges, spool, mutated modules, drones, fighters and abilities, implants, boosters and side effects, cargo, notes, T3D modes, system security, beacons, projected modules/drones/fighters and projected fits, command fits, characters with skills and security status, damage patterns, target profiles, implant sets and attribute overrides. The imported fits give the same numbers as Pyfa (checked in the e2e against stats Pyfa computed for the test database).
- **Language:** English / 中文 switch for item names (dataset `names_i18n`) and the main UI labels.
- **Options:** factor in reload, default spool-up, RAH adapt/unadapted. Settings are stored in localStorage; fits, characters and profiles in the fit library (IndexedDB).

## Engine adapter (`src/engine/adapter.ts`)
| backend | where it runs | notes |
|---|---|---|
| `ts-worker` | browser (Web Worker) | **fallback**: variant D TypeScript bundle, built in CI from `EX-CT/eve-dogma-lab@variant-d`. It loads the same release dataset |
| `wasm-worker` | browser (Web Worker) | **default** (mainline = F): variant F Rust→WASM, stats **and** graphs in one worker (C-ABI `calc` + `rpc` with `graph` / `graph_specs`, CONTRACT-GRAPHS 0.2), built in CI from `ENGINE_F_SRC` in [`engines.lock`](engines.lock) (`owner/repo@sha:dir`, currently [EX-CT/eve-dogma](https://github.com/EX-CT/eve-dogma) @ 1dc951b, crate `eve-wasm` → `engines/f/eve_wasm.wasm`) with the release dataset compiled in. CI gates the deploy on its e2e, the bench 1.9.0 corpus (331 cases) and the graphs 0.2 suite (178 cases), both in headless Chrome. `?engine=wasm-g4-worker` (the retired separate graphs worker) maps to this backend |
| `wasm-j-worker` | browser (Web Worker) | **optional** speed-reference engine (not the default): variant J (round-1 winner; the mainline is Rust based on F; C++20 → WASM with Emscripten, LGPL-3.0-or-later), built in CI from `ENGINE_J_SRC` in [`engines.lock`](engines.lock) (`owner/repo@sha:dir`; moving to EX-CT/eve-dogma is a one-line change). The worker writes the release dataset into the module's virtual FS. J has no graph RPC, so its graphs come from F (`GRAPH_FALLBACK` in `src/engine/adapter.ts`); the Graphs label and the About tab say which backend computed them. CI runs the bench 1.9.0 stats corpus in headless Chrome against this build too (`tools/browser-dogma-bench.py`; informational for J) |
| `http` | any engine server | `POST {url}/v1/calc`, `GET {url}/v1/meta` (graph RPC: `POST {url}/v1/graph`, `GET {url}/v1/graph_specs`); e.g. variant C `serve-http`, through `tools/engine-bridge.mjs` for CORS |

Pick a backend in the header, or with `?engine=wasm-worker|ts-worker|wasm-j-worker|http&http=http://127.0.0.1:8787`.
Adding another engine means writing one class that implements `Engine` (`init`, `calc`, and optionally `graph` / `graphSpecs`). The UI code does not change.

Local HTTP engine for the hosted site:
```bash
node tools/engine-bridge.mjs --upstream http://127.0.0.1:8080                 # variant C: eve-dogma-go serve-http -addr :8080
node tools/engine-bridge.mjs --stdio "eve-dogma --dataset D.json.gz serve-stdio"   # any engine with the JSONL RPC
# then open https://ex-ct.github.io/eve-fit-web/?engine=http&http=http://127.0.0.1:8787
```

### Default engine backend

The hosted site's default backend is `wasm-worker` (F), set by the repository variable `DEFAULT_ENGINE`; the workflow falls back to `ts-worker` when the variable is unset. To switch it without a code change,
set the repository variable `DEFAULT_ENGINE` (for example `gh variable set DEFAULT_ENGINE -b wasm-worker -R EX-CT/eve-fit-web`)
and re-run the `pages` workflow (`tools/switch-default.sh <backend-id>` does both, waits for the run and checks the live build-info), or dispatch `pages` with the `default_engine` input. Visitors who never picked a backend
follow the new default; an explicit choice in the backend selector is kept. `?engine=<id>` overrides both. The
**About** tab shows the active backend, the engine's reported version, the engine F/J/D commits, the dataset and the site build.

## Development
```bash
npm ci
mkdir -p public/data public/engines/d public/engines/f
gh release download -R EX-CT/eve-sde-pipeline -p 'dataset-*.json.gz' -O public/data/dataset.json.gz
# engine D: (in eve-dogma-lab@variant-d/variant-d) npm ci && npm run build:web; copy dist-web/eve-dogma-ts.mjs to public/engines/d/
npm run dev
node tools/smoke.mjs http://127.0.0.1:5173/eve-fit-web/ ts-worker   # headless check
node tools/e2e.mjs http://127.0.0.1:5173/eve-fit-web/ ts-worker     # UI end-to-end; engine arg may be 'http&http=http://127.0.0.1:8787'
npm test                                                             # unit tests (vitest, src/**/*.test.ts)
```

Engine F and the formats module (Rust, stable + `wasm32-unknown-unknown`; commit from `ENGINE_F_SRC` in engines.lock):
```bash
EVE_DOGMA_DATASET=$PWD/public/data/dataset.json.gz cargo build --profile release-small --target wasm32-unknown-unknown -p eve-wasm -p eve-fit-formats-wasm
cp target/wasm32-unknown-unknown/release-small/{eve_wasm,eve_fit_formats_wasm}.wasm public/engines/f/
```

## Deployment
`.github/workflows/pages.yml` runs on push, by hand, and every 6 h:
1. Download the latest `eve-sde-pipeline` release dataset.
2. Build engine D and engine F (WASM).
3. Build the site and run a headless Chrome smoke test (the demo fit must compute), then the UI end-to-end test (`tools/e2e.mjs`: EFT import, projected web, beacon, graphs, booster side effect, fleet buff, EFT/DNA export, custom character, fighter abilities) on the TS, F (`wasm-worker`) and J backends. On F that run checks that every graph is engine-computed, including a lock-time value against the formula. The same pinned F commit, built natively, runs the e2e through `tools/engine-bridge.mjs` on the `http` backend. Then, inside headless Chrome against the built `wasm-worker`: the CONTRACT-GRAPHS 0.2 case suite (eve-dogma-bench `graphs-round2`, pinned as `GRAPHS_BENCH_SHA`; `python3 graphs/run_graphs.py --name web --rpc-cmd "node tools/browser-rpc.mjs <site-url> wasm-worker"`) and the bench 1.9.0 stats corpus (`DOGMA_BENCH_SHA`, `tools/browser-dogma-bench.py`). Any failure on the default backend stops the deploy.
4. Deploy to GitHub Pages.

## Tests
* Unit tests: `npm test` (vitest, `src/**/*.test.ts`, node). They use a committed dataset slice
  (`src/test/fixtures/mini-dataset.json.gz`, rebuilt with `node tools/make-test-dataset.mjs`) and, when present,
  `public/engines/f/eve_fit_formats_wasm.wasm` (CI requires it: `REQUIRE_FORMATS_WASM=1`).
* End to end: `tools/e2e.mjs` in headless Chrome against a running site (includes the fit library: Pyfa database import
  checked against Pyfa's own stats, library operations, backup/restore, DNA import, reload persistence and migration).
* `src/test/fixtures/pyfa-saveddata.db` is a Pyfa saved-fits database made with Pyfa itself (see
  [src/test/fixtures/README.md](src/test/fixtures/README.md)); it is data only.
* Test ids: unit tests are named `web.unit.<slug>: …`, e2e checks `web.e2e.<slug>: …`; [docs/test-ids.md](docs/test-ids.md)
  maps the e2e ids to the names used before.
* CI (`pages.yml`) gates the deploy on engine F and the formats module building, the unit tests, the e2e on
  ts-worker and wasm-worker (F), the bench 1.9.0 corpus (331 cases), the graphs 0.2 suite (178 cases), and the full eve-dogma-bench `pending-1.11` suite set
  (`BENCH_SUITES_SHA`; `tools/run_all_suites.sh tools/browser-engine.mjs`: core, ext, ext_rpc, batch, effects, graphs,
  cap, mutated, formats) in the browser build, gated by `check_no_regress.py --baseline baselines/f.json`; the per-suite
  results are the run artifact `bench-suites-wasm-worker`. `tools/browser-engine.mjs` is an `eve-fit`-compatible CLI
  (`calc`, `batch`, `serve-stdio`) backed by the site in headless Chrome (`BROWSER_RPC=<url>` reuses a
  `tools/browser-rpc.mjs --http PORT` server).

## Licence
- UI code: MIT.
- The bundled engines are LGPL-3.0-or-later (F: EX-CT/eve-dogma; D and J: EX-CT/eve-dogma-lab). They are loaded as separate files (`engines/`), with their source on GitHub.
- EVE Online data © CCP hf., used under CCP's developer licence (`data/LICENSE.EVE`).
- sql.js (MIT) reads Pyfa databases; it is loaded only when such a file is imported.
- No Pyfa code is used: the Pyfa database reader follows the table layout of the file, and the test database is data generated by running Pyfa outside this repository. Graph formulas come from public EVE mechanics documentation.
