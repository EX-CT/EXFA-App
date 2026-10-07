# EXFA v2 — handoff status

Snapshot of where the v2 upgrade stands, so work can resume from a fresh clone.
Source documents in this folder:

- `design.md` — the approved v2 design (Chinese), incl. the 8 decisions the owner answered.
- `app-v2-spec.md` — implementation spec for the App, stages A–D. Stage B is the section to finish next.
- `format-v1-spec.md` — EXFA-Format v1 spec (the repo EX-CT/EXFA-Format already implements it).

## Done (merged / released)

| Piece | Where |
|---|---|
| Engine v0.2.0: `adjustments[]`, `scenarios` → `scenario_results`, attacker speed / angle graph axes, formats RPC in the main wasm (contract 1.5.0) | EX-CT/EXFA-Engine PR #6, release `v0.2.0` |
| EXFA-Format v1.0.0: JSON schemas, TS package, Rust crate, migrate + resolve, folder layout | EX-CT/EXFA-Format `main` |
| App Stage A: brand / logo / PWA, warm-black + gold theme, 3-column single-screen shell, bottom dock, toasts with undo, no native dialogs, WASM-only engine | EX-CT/EXFA-App PR #1 (squash `cfa5245`) |

## In progress — Stage B (branch `devin/1791318840-v2-market`)

Implemented in this branch (spec: `app-v2-spec.md` → "Stage B"):

- Compact market rows: 18px, 8px indent, 10px caret, group item counts, 16px icon, fixed 24px meta badge
  (T2 / F / D / O / S / M<n>), slot letter only in search / "All", hover-only info button (`ui/Market.tsx`, `styles.css`).
- Fit-item selection (`sel` state, gold left border) for modules / drones / fighters / cargo (`ui/Fitting.tsx`, `App.tsx`).
- Operation modes Smart / Replace / Add in the header, Q / W / E shortcuts, persisted in settings (`store/index.ts`).
- Market single-click = preview candidate, double-click / Enter = apply; drag-and-drop unchanged.
- Pure `applyMarketPick(ds, fit, sel, typeId, mode)` in `fit/model.ts` + tests in `fit/model.market.test.ts`
  (link-group replace, charge keep/load, offline kept, drone/fighter replace with quantity clamp, subsystem, ship = new fit).
- Compare strip `ui/CompareStrip.tsx`: tabs Variations / Charges / Offline / Characters, every row computed by the engine
  (150 ms debounce, request JSON as cache key, stale results dropped, ≤ 60 rows), CPU / PG / Cap delta + category metrics
  + price, red frame for new violations, amber frame for new missing skills, tooltip with reasons, metric pinning per category.
  New metrics in `fit/metrics.ts` (weapon range, tracking, module range, cap time, active tank, price).
- What-if dock tab removed (its content now lives in the compare strip); module rows show `⇄n` to open Variations.
- New zh strings in `i18n-zh.ts`; e2e scenarios added to `tools/e2e.mjs` (smart preview/replace, Ctrl+Z / Ctrl+Y, toast undo,
  add mode, replace-without-selection warning, over-powergrid red frame).

Verified at the time of this snapshot:

- `npx tsc -b` passes, `npx vitest run` 48/48 passes, `npx vite build` passes.
- `node tools/smoke.mjs <url> wasm-worker` passes (Rifter, engine 0.2.0).

Still to do for Stage B:

1. Run the full e2e and fix whatever fails: `CHROME=<chrome path> node tools/e2e.mjs http://127.0.0.1:4173/EXFA-App/ wasm-worker`
   (serve the build with `npx vite preview --port 4173`). The last run was interrupted; the "projected" scenario was just
   switched from click to drag-and-drop because single-click no longer applies.
2. Rendered review + screenshots (1920×1080 and 1600×900): compact market with badges; autocannon selected with Variations
   deltas; Replace candidate with red frame + tooltip; Afterburner selected + MWD candidate (speed / sig / cap deltas);
   replace toast with Undo. Check them by eye, not only by DOM.
3. `git diff --check`, review, open the Stage B PR, CI green, merge, Pages deploy.

## Next stages (not started)

- Stage D — library persisted as EXFA-Format (folders, alternatives, branches, history, fleets / command buffs, projected fits),
  IndexedDB migration keeping the legacy `eve-fit-web*` stores, manual import / export of single fit, folder and zip.
- Stage C — scenarios editor + graph dock: multi-fit × multi-target lines, all engine graph axes, legend toggle,
  crosshair, CSV / PNG export, ≤ 12 lines.
- Then docs / README refresh, deploy, final report.

## Environment notes

- Run App tests from `apps/web` (root vitest also scans `packages/mcp/dist`).
- Engine builds need `EXFA_DATASET=<path to dataset-3569502-r7.json.gz>`; don't run repo-wide `cargo fmt` (Engine is not rustfmt-clean).
- `packages/mcp`: after changing a tool description run `npm run schemas`, otherwise the schema snapshot CI fails.
- Known follow-up outside Stage B: UI dataset SDE `3579973` vs engine embedded SDE `3569502`.
