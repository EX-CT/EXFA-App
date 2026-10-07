# EXFA v2 — handoff status

Snapshot of where the v2 upgrade stands, so work can resume from a fresh clone.
Cross-repo status (Engine, Data, Bench, Format, known CI/deploy issues): EX-CT/EXFA-Docs `docs/27-v2-handoff.md`.
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
- `node tools/e2e.mjs http://127.0.0.1:4173/EXFA-App/ wasm-worker` passes 105/105 (headless Chrome on Windows and Linux).
- Rendered review done (1920×1080 + 1600×900, `node tools/shots.mjs <url> <outdir>`): compact market with badges,
  autocannon selected with Variations deltas, overpowered candidate red frame + tooltip, Afterburner selected + MWD
  candidate (speed / sig / cap deltas), replace toast with Undo.

Stage B bug fixes in the test tooling itself (the suite had never run to completion):

- `page.dragAndDrop` was removed from puppeteer — the market drag now goes through `mouse.dragAndDrop` behind
  `page.setDragInterception(true)` (required, or it waits on `Input.dragIntercepted` forever).
- Playwright-style chords (`press('Control+a')`) replaced by `pressChord` (down/press/up).
- Double-clicks used the removed `{ clickCount: 2 }` option — now `{ count: 2 }`.
- The overfit-validation scenario applied market rows with a single click — now a double-click under Add mode.
- Windows paths: `new URL(...).pathname` → `fileURLToPath` in `e2e.mjs` (fixtures) and `i18n.test.ts`.

Still to do for Stage B:

1. `git diff --check`, review, CI green, merge PR #2, Pages deploy.

## Known issues outside this branch

- `CHROME` defaults to `/usr/bin/google-chrome` in all browser tools; point it at the local Chrome (Windows:
  `C:/Program Files/Google/Chrome/Application/chrome.exe`; Devin VM: `/home/ubuntu/.local/bin/google-chrome`).

## Next stages (not started)

- Stage D — library persisted as EXFA-Format (folders, alternatives, branches, history, fleets / command buffs, projected fits),
  IndexedDB migration keeping the legacy `eve-fit-web*` stores, manual import / export of single fit, folder and zip.
- Stage C — scenarios editor + graph dock: multi-fit × multi-target lines, all engine graph axes, legend toggle,
  crosshair, CSV / PNG export, ≤ 12 lines.
- Then docs / README refresh, deploy, final report.

## Environment notes

- Run App tests from `apps/web` (root vitest also scans `packages/mcp/dist`).
- Engine builds need `EXFA_DATASET=<path to dataset-3586130-r7.json.gz>` (or the tag pinned in sde.lock); don't run repo-wide `cargo fmt` (Engine is not rustfmt-clean).
- `packages/mcp`: after changing a tool description run `npm run schemas`, otherwise the schema snapshot CI fails.
- Resolved follow-up: engine `v0.2.1` embeds SDE `3586130` — same as the UI dataset (was `3569502`).
