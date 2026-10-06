# EXFA-App

A browser-based EVE Online fitting assistant built with Vite, React, and TypeScript. EXFA-App calculates fits,
graphs, prices, and fit-format conversions through the released EXFA Engine WASM worker.

**Live:** https://ex-ct.github.io/EXFA-App/

中文：基于浏览器的 EVE Online 配船工具，使用 EXFA Engine WASM 计算装配、图表、价格和配置格式。配置保存在本地浏览器中，界面支持中文。

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
  - mining yield (with waste), outgoing remote repairs / capacitor transfer (with spool range), bombs to kill per damage type and Covert Ops level, overheat burnout per module, EHP per drone / fighter (Engine stats-ext)
  - engine adjustments with localized details and a one-click write-back to the fit, violations (named in words), and warnings
- **Price:** computed by the Engine price RPC: ship, fittings, loaded charges, drones/fighters, implants/boosters and cargo, each line with its price source; unpriced items are listed. Sources, highest first: **my prices** (local price overrides by type, market group, group or category, fixed ISK or a multiplier, e.g. self-produced = 0; stored in this browser only and sent as `price_overrides`), the **updated snapshot** ("update prices": the latest [eve-market-prices](https://github.com/EX-CT/eve-market-prices/releases) Jita snapshot, copied into the site by CI on every build, at least every 6 h, and loaded into the engine with `prices_load`), else the Jita snapshot embedded in the engine. The price panel and the About popover show the provenance (price source, snapshot id and time, SDE build and hash).
- **Graphs:** DPS vs range (turret hit chance, missile application, drones), capacitor vs time, regen vs fill %, speed and distance vs time, lock time vs signature, warp time vs distance. Graphs are computed by the Engine `graph_specs` / `graph` RPC (CONTRACT-GRAPHS 0.4); the UI never substitutes approximations.
- **Compare:** several saved fits side by side (DPS, volley, EHP per layer, tank, capacitor, speed, align, signature, targeting, CPU/PG left, problems), computed in one Engine `batch` call; best value highlighted, deltas against the first fit (any fit can be made the baseline).
- **What-if:** variants of the active fit computed in one go and ranked by any metric as deltas: every meta variation of a module (Pyfa's variations menu), every compatible charge, each module offline, other characters. Rows that add fitting problems are marked; *Apply* takes a variant (undo restores the fit).
- **Multi-fit graphs:** overlay other saved fits on any graph (one Engine call per fit, same x range; dashed per fit), and use a saved fit as the target of damage / application / EWAR / remote-repair graphs (CONTRACT-GRAPHS 0.4 `target.fit`). The **ECM burst + scan-res damps** graph shows the enemy's lock time and lock uptime per 30 s burst, or damage dealt before dying.
- **Import and export:** EFT (including mutated modules and multi-fit text), DNA and chat links, ESI fitting JSON, EVE client XML, EFT config files, multibuy, and ship-stats text use the formats RPC in the main EXFA Engine WASM worker. Pyfa's saved-fits database is read locally by `src/formats/pyfadb.ts`; files are not uploaded.
- **Fit library:** saved fits are stored in IndexedDB (falling back to localStorage, then memory; legacy data migrates once while preserving the existing `eve-fit-web*` keys). Folders (nested, `a/b`) and tags, grouping by folder or ship group, search (name, ship, folder, notes, `tag:<name>`), rename / move / tag (one fit or a selection), duplicate, delete with an Undo notification (links from projected and fleet fits are removed), export of a selection or the whole library as one EVE XML file or as EFT, and JSON backup / restore (fits, folders, characters, profiles, implant sets; restoring the same backup twice adds nothing). Pasting several EFT fits at once imports them all.
- **Damage patterns / target profiles:** built in are only the exact patterns (Uniform, EM, Thermal, Kinetic, Explosive) and a few target profiles; NPC profiles derived from the SDE (eve-sde-pipeline `presets.json`) can be shown; Pyfa's own built-in set (118 damage patterns, 195 target profiles) is opt-in in the Profiles tab. That set is Pyfa data (GPL-3.0) from the pipeline's separate asset `presets-pyfa-LGPL-GPL.json`: CI deploys it as its own file next to the site with its notice and attribution, it is not part of this MIT repository, and the browser fetches it only when turned on.
- **Pyfa import:** Pyfa's export formats (EFT, DNA, EVE XML, ESI JSON) through the formats layer, and Pyfa's saved-fits database (`saveddata.db`) read in the browser with sql.js (`src/formats/pyfadb.ts`): fits with module states, charges, spool, mutated modules, drones, fighters and abilities, implants, boosters and side effects, cargo, notes, T3D modes, system security, beacons, projected modules/drones/fighters and projected fits, command fits, characters with skills and security status, damage patterns, target profiles, implant sets and attribute overrides. The imported fits give the same numbers as Pyfa (checked in the e2e against stats Pyfa computed for the test database).
- **Language:** English / 中文 switch for item names (dataset `names_i18n`) and the main UI labels.
- **Options:** factor in reload, default spool-up, RAH adapt/unadapted. Settings are stored in localStorage; fits, characters and profiles in the fit library (IndexedDB).

## Engine (WASM-only)

The App uses the EXFA Engine v0.2.0 WASM worker as its only compute backend. A single worker handles calculations,
graphs, prices, and format RPCs; the App does not select or fall back to native, TypeScript, or HTTP engines.
The About popover reports the Engine release, dataset provenance, and measured dataset / Engine / first-calculation
startup times.

## Development
```bash
cd apps/web
npm ci
# Provide public/data/dataset.json.gz and public/engines/f/exfa_wasm.wasm from the releases pinned by the repository.
npm run dev
node tools/smoke.mjs http://127.0.0.1:5173/EXFA-App/ wasm-worker
node tools/e2e.mjs http://127.0.0.1:5173/EXFA-App/ wasm-worker
npm test                                                             # unit tests (vitest, src/**/*.test.ts)
```

## Deployment
`.github/workflows/pages.yml` runs on push, by hand, and every 6 h:
1. Download the latest EXFA-Data SDE dataset and the Engine WASM pinned to v0.2.0.
2. Build the App using the `/EXFA-App/` Pages base path.
3. Run the TypeScript checks, unit tests, browser smoke and end-to-end gates, then the Engine graph and benchmark suites against the same browser WASM worker. Any failure stops deployment.
4. Deploy to GitHub Pages.

## Tests
* Unit tests: `npx tsc -b && npx vitest run && npx vite build`. They use a committed dataset slice
  (`src/test/fixtures/mini-dataset.json.gz`, rebuilt with `node tools/make-test-dataset.mjs`).
* End to end: `tools/e2e.mjs` in headless Chrome against a running site (includes the fit library: Pyfa database import
  checked against Pyfa's own stats, library operations, backup/restore, DNA import, reload persistence and migration).
* `src/test/fixtures/pyfa-saveddata.db` is a Pyfa saved-fits database made with Pyfa itself (see
  [src/test/fixtures/README.md](src/test/fixtures/README.md)); it is data only.
* Test ids: unit tests are named `web.unit.<slug>: …`, e2e checks `web.e2e.<slug>: …`; [docs/test-ids.md](docs/test-ids.md)
  maps the e2e ids to the names used before.
* CI (`pages.yml`) gates the deploy on the Engine v0.2.0 WASM build, unit tests, the WASM-worker e2e,
  the bench 1.9.0 corpus (331 cases), the graphs 0.4 suite, and the full eve-dogma-bench `pending-1.11` suite set
  (`BENCH_SUITES_SHA`; `tools/run_all_suites.sh tools/browser-engine.mjs`: core, ext, ext_rpc, batch, effects, graphs,
  cap, mutated, formats) in the browser build, gated by `check_no_regress.py --baseline baselines/f.json`; the per-suite
  results are the run artifact `bench-suites-wasm-worker`. `tools/browser-engine.mjs` is an `eve-fit`-compatible CLI
  (`calc`, `batch`, `serve-stdio`) backed by the site in headless Chrome (`BROWSER_RPC=<url>` reuses a
  `tools/browser-rpc.mjs --http PORT` server).

## Licence
- UI code: MIT.
- The EXFA Engine WASM is LGPL-3.0-or-later and is distributed separately from this App, with its source on GitHub.
- EVE Online data © CCP hf., used under CCP's developer licence (`data/LICENSE.EVE`).
- sql.js (MIT) reads Pyfa databases; it is loaded only when such a file is imported.
- No Pyfa code is used: the Pyfa database reader follows the table layout of the file, and the test database is data generated by running Pyfa outside this repository. Graph formulas come from public EVE mechanics documentation.
