# EXFA v2 — handoff status

Snapshot of where the v2 upgrade stands, so work can resume from a fresh clone.
Cross-repo status (Engine, Data, Bench, Format, known CI/deploy issues): EX-CT/EXFA-Docs `docs/27-v2-handoff.md`.
Source documents in this folder:

- `design.md` — the approved v2 design (Chinese), incl. the 8 decisions the owner answered.
- `app-v2-spec.md` — implementation spec for the App, stages A–D. Stage C is the section to finish next.
- `format-v1-spec.md` — EXFA-Format v1 spec (the repo EX-CT/EXFA-Format already implements it).

## Done (merged / released)

| Piece | Where |
|---|---|
| Engine v0.2.0: `adjustments[]`, `scenarios` → `scenario_results`, attacker speed / angle graph axes, formats RPC in the main wasm (contract 1.5.0) | EX-CT/EXFA-Engine PR #6, release `v0.2.0` |
| Engine v0.2.1: rebuilt on SDE 3586130 (embedded build now matches the UI dataset); SDE upgrades run via sde-update polling + bench gate | EX-CT/EXFA-Engine release `v0.2.1`, EXFA-Bench PR #5 |
| EXFA-Format v1.0.0: JSON schemas, TS package, Rust crate, migrate + resolve, folder layout | EX-CT/EXFA-Format `main` |
| App Stage A: brand / logo / PWA, warm-black + gold theme, 3-column single-screen shell, bottom dock, toasts with undo, no native dialogs, WASM-only engine | EX-CT/EXFA-App PR #1 (squash `cfa5245`) |
| App Stage B: compact market, Smart/Replace/Add modes, engine-backed compare strip | EX-CT/EXFA-App PR #2 (squash `8a6d84d`) |
| App Stage D: fit library on `@exfa/format` (FitDocument / Library@1), IndexedDB v2, folder tree + fleets + branches/history, alternatives, `.exfa.json`/zip/folder import-export | EX-CT/EXFA-App PR #4 (squash `77e7ee6`) |

## Stage D notes (merged)

- App depends on `@exfa/format` via `github:EX-CT/EXFA-Format#v1.0.0` (git dep, `prepare` builds the ts package on install).
- Internal model: `FitDoc` = `FitDocument`; every engine request goes through `requestFor(lib, doc)` → format `resolveFit`
  (covers refs/links/fleets/scenarios). Never reintroduce the old flat fit fields.
- IndexedDB `eve-fit-web` v2: `docs` store (FitDocument by id) + `kv.index`. v1 `fits`/`kv` and the old localStorage blob
  migrate through `migrate()`/`migrateFitDocument` on first open and are left untouched as backups.
- Merge rule everywhere (`.exfa.json`, `.zip`, folder, legacy backup, FitBrowser file import): same id → newer `modified` wins;
  UI reports added / updated / skipped counts.
- Zip/folder I/O in `formats/zipfiles.ts` (fflate; `toFiles` layout, `fromFiles` to rebuild). `showDirectoryPicker` buttons
  are hidden when unsupported.
- Dead `ui/WhatIf.tsx` removed; `fit/whatif.ts` stays (compare-strip scenario variants).
- Browser smokes: `tools/smoke-d3.mjs` (tree/fleets/branches/history), `tools/smoke-d4.mjs` (alternatives/branch UI),
  `tools/smoke-d5.mjs` (exfa/zip import-export). All take `<url>` and `CHROME=`.
- Verified: `tsc -b`, `vitest` 54/54, `vite build`, `e2e.mjs` 108/108, smokes 16/16.

## Known issues outside this branch

- `CHROME` defaults to `/usr/bin/google-chrome` in all browser tools; point it at the local Chrome (Windows:
  `C:/Program Files/Google/Chrome/Application/chrome.exe`; Devin VM: `/home/ubuntu/.local/bin/google-chrome`).

## Next stages (not started)

- Stage C — scenarios editor + graph dock: multi-fit × multi-target lines, all engine graph axes, legend toggle,
  crosshair, CSV / PNG export, ≤ 12 lines (`app-v2-spec.md` → "Stage C"; uses `Library.scenarios` and
  `doc.refs.scenario_ids` which the Stage-D model already persists).
- Then docs / README refresh, deploy, final report.

## Environment notes

- Run App tests from `apps/web` (root vitest also scans `packages/mcp/dist`).
- Engine builds need `EXFA_DATASET=<path to dataset-3586130-r7.json.gz>` (or the tag pinned in sde.lock); don't run repo-wide `cargo fmt` (Engine is not rustfmt-clean).
- `packages/mcp`: after changing a tool description run `npm run schemas`, otherwise the schema snapshot CI fails.
- Resolved follow-up: engine `v0.2.1` embeds SDE `3586130` — same as the UI dataset (was `3569502`).
