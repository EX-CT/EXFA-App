# Test ids

Stable ids for the checks in `tools/e2e.mjs` (`web.e2e.<slug>`, kebab-case). A check prints as
`PASS  web.e2e.<slug>: <description>`; the description may change, the id does not. Map of id to the check name
used before the ids were added (2026-10-03):

| id | old name |
|---|---|
| `web.e2e.eft-share-link-import` | EFT import via ?eft=, ship |
| `web.e2e.drone-dps` | drones dps |
| `web.e2e.weapon-dps-charges` | weapon dps (charges) |
| `web.e2e.armor-tank` | armor tank |
| `web.e2e.mutated-module-import` | mutated module imported |
| `web.e2e.no-violations` | no violations |
| `web.e2e.zh-weapon-names` | zh weapon names |
| `web.e2e.en-weapon-names-restored` | en weapon names restored |
| `web.e2e.projected-web` | projected web slows the ship |
| `web.e2e.environment-beacon` | environment beacon applied |
| `web.e2e.graph-set` | Engine graph types are offered |
| `web.e2e.graph-{dps,cap,regen,mobility,lock,warp,app,ewar,rr}` | Engine graph <kind> |
| `web.e2e.graph-lock-time-matches-stats` | engine lock-time graph matches stats |
| `web.e2e.graph-ewar-web-neut` | engine ewar graph has web + neut |
| `web.e2e.graph-cap-within-capacity` | engine capacitor graph within capacity |
| `web.e2e.booster-side-effect` | booster side effect lowers armor HP |
| `web.e2e.undo-redo` | undo / redo |
| `web.e2e.show-info-fitted-values` | show info: fitted attribute values |
| `web.e2e.attribute-override` | attribute override raises weapon dps |
| `web.e2e.attribute-override-removed` | removing the override restores dps |
| `web.e2e.manual-fleet-buff` | manual fleet buff raises shield resist (lower resonance) |
| `web.e2e.eft-export` | EFT export |
| `web.e2e.eft-export-mutated` | mutated module EFT round trip |
| `web.e2e.dna-export` | DNA export |
| `web.e2e.multibuy-export` | multibuy export |
| `web.e2e.esi-json-export` | ESI JSON export |
| `web.e2e.implant-set` | implant set applied (6 Snake + kept RP-905, faster) |
| `web.e2e.sde-npc-damage-profile` | SDE NPC damage profile (Guristas) changes EHP |
| `web.e2e.custom-character` | custom character (all 0) lowers dps |
| `web.e2e.missing-skills` | missing skills reported |
| `web.e2e.per-module-spool` | per-module spool 0% lowers disintegrator dps |
| `web.e2e.esi-json-reimport` | ESI JSON re-import |
| `web.e2e.multi-fit-eft-import` | multi-fit EFT import + fit browser groups |
| `web.e2e.fit-browser-search` | fit browser search |
| `web.e2e.fit-price-esi` | fit price from ESI (retired 2026-10-03: prices come from the engine price block, see `web.e2e.engine-price-block`) |
| `web.e2e.fighter-dps` | fighter dps |
| `web.e2e.fighter-abilities` | fighter abilities listed |
| `web.e2e.fighter-ability-toggle` | disabling an attack ability lowers fighter dps |
| `web.e2e.about-page` | About popover: Engine release, dataset, startup timings, links |
| `web.e2e.no-page-errors` | no page errors |

## e2e checks added after the rename (no old name)

| id | description |
|---|---|
| `web.e2e.compare-fits` | compare table of 3 fits with best values marked |
| `web.e2e.formats-provider` | imports / exports run through the main Engine WASM formats RPC |
| `web.e2e.graph-ecm-burst` | ECM burst graph (engine) matches the lock-time formula |
| `web.e2e.graph-ecm-damage` | ECM burst graph, damage dealt before dying |
| `web.e2e.graph-overlay` | dps graph overlays a second fit |
| `web.e2e.graph-target-fit` | damage graph against a target fit (engine) |
| `web.e2e.pyfa-db-import` | Pyfa saveddata.db import (sql.js): every fit, character, profiles, implant set, into folder "Pyfa import" |
| `web.e2e.pyfa-db-stats` | Pyfa database fits compute Pyfa's numbers (DPS vs target profile, EHP vs damage pattern, speed with a projected web, CPU) within 1e-6 relative |
| `web.e2e.pyfa-db-links` | projected fit and fleet booster fit links, saved character |
| `web.e2e.library-rename-move-tag` | rename, move to a nested folder and tag a fit |
| `web.e2e.library-search-tags` | tag filter and search (ship name) |
| `web.e2e.library-folder-rename` | renaming a folder moves its fits |
| `web.e2e.library-duplicate-delete` | duplicate keeps folder and tags; delete is immediate and Undo restores it |
| `web.e2e.library-export-xml-eft` | bulk export (one EVE XML with 2 fittings, multi-fit EFT) and XML re-import |
| `web.e2e.library-backup-restore` | JSON backup (v2: folders, tags) restores without duplicating fits |
| `web.e2e.dna-import` | DNA import (plain and fitting link) round trip: same DNA back, ship, modules, charges, drones launched |
| `web.e2e.library-reload-persistence` | fits, folders and tags survive a reload (IndexedDB) |
| `web.e2e.library-migration` | the localStorage library of earlier versions moves to IndexedDB (copy kept) |
| `web.e2e.mining-yield` | mining section shows the Engine yield (modules + drones = total m³/s) |
| `web.e2e.outgoing-reps` | outgoing remote armor reps and capacitor transfer shown with the engine values |
| `web.e2e.bombing-table` | bombs to kill per damage type and Covert Ops level match the engine |
| `web.e2e.overheat-burnout` | overheated modules show the expected burnout time (modules[].heat) |
| `web.e2e.drone-ehp` | each drone row shows the EHP of one drone (drones.items[]) |
| `web.e2e.validation-problems` | engine violations (capital module on a frigate, slots, turrets, rig size, powergrid) are listed in Problems with their labels |
| `web.e2e.adjustments-feedback` | Engine adjustments show localized code/path/requested/used details and write back to the fit |
| `web.e2e.adjustments-writeback` | write back clears an adjustment and offers Undo |
| `web.e2e.adjustments-undo` | Undo restores the corrected request and its adjustment |
| `web.e2e.shipstats-export` | ship stats export (Engine stats + formats RPC) |
| `web.e2e.whatif-apply` | applying a scenario changes the fit; undo restores it |
| `web.e2e.whatif-charges` | what-if ranks compatible charges |
| `web.e2e.whatif-undo` | undo after apply |
| `web.e2e.whatif-variations` | what-if lists module variations with engine dps (T1 below T2) |
| `web.e2e.xml-export` | EVE XML export |
| `web.e2e.xml-reimport` | EVE XML re-import keeps the mutated module |
| `web.e2e.compare-batch` | compare window computes all fits in one Engine batch call |
| `web.e2e.engine-price-block` | fit price from the Engine price block (embedded Jita snapshot) with provenance |
| `web.e2e.price-update-snapshot` | (new) "update prices" injects the latest EXFA-Data snapshot into the engine (prices_load) |
| `web.e2e.my-prices-self-made` | (new) a "my price" (self-produced = 0) is sent as price_override and stored locally |
| `web.e2e.my-prices-editor` | (new) a category multiplier from the "my prices" editor scales the ship price |
| `web.e2e.price-reset` | (new) clearing my prices and "update prices" returns to the embedded snapshot |
| `web.e2e.price-unsupported` | retired: pricing is always available from the Engine WASM worker |
| `web.e2e.show-info-engine-values` | (new) every fitted value in show info equals the engine attribute value (independent include_attributes=all calc) |
| `web.e2e.show-info-skill-formula` | (new) fitted damage multiplier and rate of fire of Heavy Neutron Blaster II match the all-V skill formula |
| `web.e2e.builtin-damage-exact` | (new) the built-in damage patterns are exactly Uniform, EM, Thermal, Kinetic, Explosive |
| `web.e2e.pyfa-damage-patterns` | (new) Pyfa built-in damage patterns (opt-in) with Pyfa values: [NPC][Asteroid]Guristas 0 / 19.8 / 80.2 / 0 |
| `web.e2e.pyfa-damage-pattern-applied` | (new) the selected Pyfa pattern is sent to the engine and changes EHP |
| `web.e2e.zh-ui` | zh-CN UI (tabs, stats sections, slots, import/export dialog) has no untranslated labels |

## Unit tests (`npm test`, vitest)

Test names start with their id (`web.unit.<slug>: <description>`). Format RPC behavior is handled by the main
Engine WASM worker; there is no separate formats-WASM asset or TypeScript fallback parser.

| id | file | description |
|---|---|---|
| `web.unit.charges-valid-only` | `src/data/charges.test.ts` | the charge picker offers only charges of the module charge groups, size and capacity |
| `web.unit.compare-best-delta` | `src/fit/metrics.test.ts` | best per direction (high dps, low align) and deltas vs the first fit |
| `web.unit.compare-ties-missing` | `src/fit/metrics.test.ts` | equal values mark no best; all-zero rows dropped; errored stats are missing |
| `web.unit.my-prices-validation` | `src/data/prices.test.ts` | docs/23 override shape: one target, one of price / multiplier, values >= 0 |
| `web.unit.my-prices-storage` | `src/data/prices.test.ts` | my prices and the update toggle round-trip through localStorage; invalid entries dropped |
| `web.unit.price-snapshot-parse` | `src/data/prices.test.ts` | eve-price-snapshot v1, gzip or plain; other files rejected |
| `web.unit.pyfa-presets-map` | `src/data/pyfaPresets.test.ts` | Pyfa ratios become percent shares (0.1 % steps) with pyfa: ids; other files rejected |
| `web.unit.i18n-coverage` | `src/i18n.test.ts` | every t()/tr() literal and every dynamic label key has a zh-CN translation |
| `web.unit.i18n-jsx-literals` | `src/i18n.test.ts` | no untranslated English text nodes or placeholder/title attributes in the UI |
| `web.unit.i18n-switch` | `src/i18n.test.ts` | t() returns Chinese only in zh mode and falls back to the key |
| `web.unit.library-backup-merge` | `src/fit/library.test.ts` | JSON backup v2 (no built-ins), v1 backups still restore, restoring twice adds nothing, colliding ids are remapped with their links |
| `web.unit.library-folders` | `src/fit/library.test.ts` | folder list with parents; renaming moves subfolders and fits; deleting moves fits up |
| `web.unit.library-rename-duplicate-delete` | `src/fit/library.test.ts` | rename, duplicate (new id, folder and tags kept), delete drops links to the fit |
| `web.unit.library-search-tags` | `src/fit/library.test.ts` | search by name, ship (English), folder, notes and tag:<name>; tags normalised |
| `web.unit.metric-lock-range-km` | `src/fit/metrics.test.ts` | lock range is reported in km |
| `web.unit.module-move` | `src/fit/model.test.ts` | rack position swap and move to the end of the rack; other racks and other slots untouched |
| `web.unit.pyfadb-fighters` | `src/formats/pyfadb.test.ts` | squadron size -1 = full squadron, ability toggles as active effect ids |
| `web.unit.pyfadb-fits` | `src/formats/pyfadb.test.ts` | every saved fit with ship, mode, notes, module states, charges, cargo |
| `web.unit.pyfadb-links-profiles` | `src/formats/pyfadb.test.ts` | characters, profiles, implant sets, projected and command fits resolve to library ids |
| `web.unit.pyfadb-mutated-implants-boosters` | `src/formats/pyfadb.test.ts` | mutated module, implants, booster side effects, drones kept in the bay |
| `web.unit.pyfadb-rejects` | `src/formats/pyfadb.test.ts` | non-SQLite bytes and SQLite files without Pyfa tables are errors |
| `web.unit.request-missing-projected-fit` | `src/fit/model.test.ts` | a projected fit deleted from the library is dropped |
| `web.unit.request-nested-fits` | `src/fit/model.test.ts` | projected and fleet booster fits nest one level deep only |
| `web.unit.request-shape` | `src/fit/model.test.ts` | a UI fit becomes a contract FitRequest (schema 1, all-5 skills, uniform profile = null) |
| `web.unit.store-diff` | `src/store/library.test.ts` | only changed fits are written, removed ones deleted, built-ins never stored |
| `web.unit.store-fallback` | `src/store/library.test.ts` | without IndexedDB the library goes to localStorage |
| `web.unit.store-idb-roundtrip` | `src/store/library.test.ts` | fits and kv survive a new connection; puts, deletes and kv replace in one transaction |
| `web.unit.store-migration` | `src/store/library.test.ts` | the localStorage library of earlier versions moves into IndexedDB once; a copy is kept |
| `web.unit.whatif-charges` | `src/fit/whatif.test.ts` | a charge scenario loads every module of that type |
| `web.unit.whatif-offline-remove` | `src/fit/whatif.test.ts` | offline and remove edits, out-of-range indices ignored |
| `web.unit.whatif-variations` | `src/fit/whatif.test.ts` | meta variations of a module, the fitted type excluded, charge kept |

## Suites (CI, browser build, Engine v0.2.0 wasm-worker)

Not single checks but bench corpora scored by the bench's own tools; each gates the deploy.

| suite | what | pin |
|---|---|---|
| `web-bench` | EXFA-Bench cases/ (1.9.0, 331 cases), `tools/browser-dogma-bench.py` | `DOGMA_BENCH_SHA` |
| `web-graphs` | graphs contract 0.4 case suite | `GRAPHS_BENCH_SHA` |
| `web-suites` | every suite of EXFA-Bench pending-1.11 `tools/run_all_suites.sh` (core, ext + ext/unit incl. tp_/probe_/val_, ext_rpc, batch, effects, graphs, cap, mutated, formats) with `tools/browser-engine.mjs` as the engine; gate `tools/check_no_regress.py` vs `baselines/f.json`; per-suite results uploaded as artifact `bench-suites-wasm-worker` | `BENCH_SUITES_SHA` |

## Ids from the eve3 gap list

`EX-CT/EXFA-Bench` (branch pending-1.11) `inventory/mcp-web-gaps.md` @97e4cc5 lists two web checks as weak or partial.
They are covered by:

| gap id | checks |
|---|---|
| DB-001 (saved fits persist across a reload) | `web.e2e.library-reload-persistence` (reload without a share link, IndexedDB), `web.e2e.library-migration`, `web.unit.store-idb-roundtrip`, `web.unit.store-migration` |
| FMT-DNA-001 (DNA import) | `web.e2e.dna-import` (plain DNA and fitting link, round trip) |
