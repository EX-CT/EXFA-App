# EXFA-Format v1 — authoritative spec (lead-authored; implement exactly)

Repo: EX-CT/EXFA-Format (created, empty). Contents:
```
schema/          JSON Schema draft 2020-12: fit-document.schema.json, library.schema.json, library-index.schema.json, scenario.schema.json, common.schema.json
ts/              npm package "@exfa/format" (TypeScript, ESM): types.ts, migrate.ts, resolve.ts, branches.ts, files.ts, history.ts, index.ts; vitest tests
rust/            crate "exfa-format": serde types, resolve, files (read/write directory layout), tests
fixtures/        shared vectors used by BOTH ts and rust tests: library + expected FitRequest per resolved fit; legacy-v0 library + expected migrated library
README.md  CHANGELOG.md  LICENSE (LGPL-3.0-or-later) + LICENSE.GPL-3.0  .github/workflows/ci.yml (npm ci+test+build in ts/, cargo test in rust/, schema-validate fixtures with ajv)
```
Readers MUST preserve unknown fields on round trip (schemas: additionalProperties true). Field names snake_case. IDs are opaque strings. All EVE items are type_id numbers; names never authoritative.

## Types (TypeScript is normative; Rust mirrors with serde)
```ts
export type Slot = 'high'|'mid'|'low'|'rig'|'subsystem'|'service';
export type ModState = 'offline'|'online'|'active'|'overheated';
export type Security = 'hisec'|'lowsec'|'nullsec'|'wspace';
export interface SdeRef { build: number; dataset_revision?: number|null }
export interface Mutation { base_type_id: number; mutaplasmid_type_id: number; attributes: Record<string, number> }

/** Calculable core: everything about the ship itself, nothing that references other library objects. */
export interface Fit {
  ship: { type_id: number; mode_type_id?: number|null };
  modules: FitModule[];
  drones: { type_id: number; quantity: number; active: number; mutation?: Mutation|null; alt_id?: string|null }[];
  fighters: { type_id: number; quantity: number; active: boolean; abilities?: number[]|null }[];
  implants: number[];
  boosters: { type_id: number; side_effects?: number[] }[];
  cargo: { type_id: number; quantity: number; alt_id?: string|null }[];
  projected: { kind: 'module'|'drone'|'fighter'; type_id: number; state?: ModState; charge_type_id?: number|null; quantity?: number; amount: number; distance_m: number|null }[];
  fleet_buffs: { buff_id: number; value: number }[];
  environment: { effect_type_ids: number[]; system_security: Security|null };
  overrides?: { type_id: number; attribute_id: number; value: number }[];
  options: { factor_reload: boolean; spool: number; rah: 'adapt'|'disable' };
}
export interface FitModule { type_id: number; slot: Slot; state: ModState; charge_type_id?: number|null; mutation?: Mutation|null;
  spool?: number|null; group?: number|null /* link group (UI) */; alt_id?: string|null /* -> Alternative.id */ }

/** Alternatives: a set of interchangeable choices for one fitted item. The item's current type is one of options. */
export interface Alternative { id: string; options: { type_id: number; charge_type_id?: number|null; quantity?: number|null }[] }
/** Named branch = which option every alternative uses ("main", "low skill", "budget"). picks: alt_id -> index into options. */
export interface Branch { id: string; name: string; note?: string; picks: Record<string, number> }
export interface HistoryEntry { at: string /* ISO */; fit: Fit; note?: string }

export interface FitDocument {
  format: 'exfa/fit@1';
  id: string; name: string; notes?: string; tags?: string[];
  folder?: string;               // "PvP/Frigates", "" = root. In the on-disk layout it is derived from the directory and omitted.
  created?: string; modified?: string;
  sde?: SdeRef;                  // SDE the fit was last saved against
  fit: Fit;
  refs: { character_id: string; damage_pattern_id: string; target_profile_id: string; scenario_ids: string[] };
  links: { booster_fit_ids: string[]; projected_fits: { fit_id: string; amount: number; distance_m: number|null }[] };
  alternatives: Alternative[];
  branches: Branch[]; active_branch?: string|null;
  history: HistoryEntry[];       // newest last, capped at 50 (see history.ts)
  ui?: Record<string, unknown>;  // app-private, preserved verbatim
}

export interface Character { id: string; name: string; default_level: number; levels: Record<string, number>;
  security_status?: number|null; alpha_clone?: boolean; builtin?: boolean; esi?: Record<string, unknown> }
export interface DamagePattern { id: string; name: string; em: number; thermal: number; kinetic: number; explosive: number; builtin?: boolean }
export interface TargetProfile { id: string; name: string; em: number; thermal: number; kinetic: number; explosive: number;
  signature_radius?: number|null; max_velocity?: number|null; radius?: number|null; hp?: number|null; builtin?: boolean }

/** Scenario = one hypothetical enemy + geometry. Same field names as engine contract 1.5 FitRequest.scenarios[]. */
export interface Scenario {
  id: string; name: string; builtin?: boolean;
  target: { profile_id: string } | { fit_id: string; resist_mode?: 'auto'|'shield'|'armor'|'hull'|'weighted_average' } | { profile: Omit<TargetProfile,'id'|'name'|'builtin'> };
  params: { distance_m?: number|null; time_s?: number|null; tgt_speed_mps?: number|null; tgt_speed_pct?: number|null; tgt_sig_m?: number|null;
            atk_speed_mps?: number|null; atk_speed_pct?: number|null; atk_angle_deg?: number|null; tgt_angle_deg?: number|null };
  settings?: { ignore_resists?: boolean; apply_projected?: boolean; ignore_lock_range?: boolean; ignore_drone_control_range?: boolean; mobile_drone_mode?: 'auto'|'follow_attacker'|'follow_target' };
}
/** Fleet group: command members boost every other member. */
export interface Fleet { id: string; name: string; folder?: string; notes?: string;
  members: { fit_id: string; role: 'command'|'member' }[] }

export interface Library {
  format: 'exfa/library@1';
  folders: string[];                          // explicit (possibly empty) folders, normalised "A/B"
  fits: Record<string, FitDocument>;
  characters: Record<string, Character>; damage_patterns: Record<string, DamagePattern>;
  target_profiles: Record<string, TargetProfile>; scenarios: Record<string, Scenario>; fleets: Record<string, Fleet>;
}
```

## resolve.ts / Rust resolve — `resolve(lib, fitId, opts?: { branch?: string|null }) : FitRequest` (engine contract 1.5)
Pure, deterministic. Output field order irrelevant, but content must equal the fixtures. Mapping (mirror of today's EXFA-App `toRequest`, apps/web/src/fit/model.ts — read it, outputs must match it for the same fit):
- `schema_version: 1`; `ship` from fit.ship; `character` from refs.character_id (fallback: id 'all5' if present, else `{default_level:5, levels:{}}`): `{skills:{default_level, levels}, security_status: ?? null, alpha_clone: === true}`.
- modules → `{type_id, slot, state, charge_type_id ?? null, mutation ?? null, spool: spool!=null ? {type:'spool_scale', amount: spool} : null}` (group/alt_id dropped). drones `{type_id,quantity,active, mutation if set}`; fighters `{type_id,quantity,active,abilities ?? null}`; implants; boosters `{type_id, side_effects ?? []}`; cargo `{type_id, quantity}`.
- `fleet: {buffs: fit.fleet_buffs, booster_fits}` where booster_fits = resolved (depth 1, i.e. nested fits get no fleet/projected/scenarios) fits of: `links.booster_fit_ids` ∪ every `command` member of every Fleet that contains this fit, excluding the fit itself, de-duplicated, order: links first, then fleets in key order, members in order. Missing ids skipped.
- `projected`: fit.projected items → `{kind:'module', module:{type_id,state ?? 'active',charge_type_id ?? null}, amount, distance_m}` / `{kind:'drone', drone:{type_id, quantity ?? 1, active: quantity ?? 1}, …}` / `{kind:'fighter', fighter:{type_id, quantity ?? 1, active:true, abilities:null}, …}`, then links.projected_fits → `{kind:'fit', fit:<resolved depth 1>, amount, distance_m}` (missing skipped). Depth ≥1: projected = [].
- `environment: {effect_type_ids, system_security}`; `damage_pattern`: refs id ≠ 'uniform' and exists → `{em,thermal,kinetic,explosive}` else null; `target_profile`: id ≠ 'none' and exists → `{em,thermal,kinetic,explosive,signature_radius ?? null,max_velocity ?? null,radius ?? null}` else null; `overrides ?? []`.
- `options: {factor_reload, default_spool:{type:'spool_scale', amount: options.spool}, rah, include_attributes:'none', sources:false, validate:true, cap_sim:{reload:false, stagger:false, max_time_s:null}}`.
- `scenarios` (depth 0 only, omitted when refs.scenario_ids empty): each existing id → `{id, target, params (nulls dropped), settings (if any)}` where target `{profile_id}` → `{profile:{em,thermal,kinetic,explosive,max_velocity,signature_radius,radius,hp}}` (?? null each), `{fit_id}` → `{fit: resolved depth 1, resist_mode ?? 'auto'}`, inline `{profile}` passed through. Missing ids skipped.
- `opts.branch`: resolve the fit as if `applyBranch(doc, branch)` had been applied (see below) — without mutating the library.
Also export `resolveFit(fit: Fit, ctx)` used internally, and `scenarioRequest(lib, scenario)` → the engine `scenarios[]` element (UI uses it for ad-hoc scenarios).

## branches.ts
- `applyBranch(doc, branchId): FitDocument` → for each alternative with a pick, set every item whose alt_id matches (modules/drones/cargo) to options[pick] (type_id; charge_type_id if option has the key; quantity for drones/cargo if option has it; modules keep slot from the old item, state kept unless it becomes invalid — not checkable without SDE, so keep it; the engine clamps and reports STATE_CLAMPED). Sets active_branch.
- `captureBranch(doc, name): FitDocument` → new Branch whose picks = current option index of every alternative (index of the option equal to the item's current type_id; skip if not found).
- `addAlternative(doc, target: {list:'modules'|'drones'|'cargo', index}, typeIds)` → creates/extends the Alternative (current type always included as options[0] on creation), sets alt_id on the item AND all link-group siblings of a module (same `group`). `removeAlternative`.
- `branchDiverged(doc): boolean` — current items differ from active_branch picks.

## history.ts
`recordHistory(prevDoc, nextDoc, now = new Date()): FitDocument` → if `prevDoc.fit` deep-differs from `nextDoc.fit` AND (history empty OR last entry `at` older than 10 min) push `{at: now, fit: prevDoc.fit}`; cap 50 (drop oldest). `restoreHistory(doc, index)` → current fit becomes that entry (and the current fit is pushed first).

## migrate.ts
- `migrate(anyJson): Library` dispatch: `format === 'exfa/library@1'` → validate shape, fill missing arrays/maps with empty; legacy (no `format`, has `fits` whose values have `ship_type_id`) → `migrateLegacyLibrary`; legacy backup file of EXFA web (`eve-fit-web-library` wrapper — read apps/web/src/fit/library.ts backup format to find its shape) → unwrap then legacy; anything with an unknown `exfa/library@N` N>1 → throw `FormatError('UNSUPPORTED_VERSION')`.
- `migrateFitDocument(any)`: `exfa/fit@1` passthrough-normalise; legacy Fit (apps/web/src/fit/model.ts `Fit`) → FitDocument: ship {type_id: ship_type_id, mode_type_id}; modules/drones/fighters/implants/boosters/cargo copied; projected items of kind 'fit' → links.projected_fits, others → fit.projected; fleet.booster_fit_ids → links.booster_fit_ids; fleet.buffs → fit.fleet_buffs; environment array + system_security → environment object; refs from character_id/damage_pattern_id/target_profile_id, scenario_ids []; options/overrides/notes/folder/tags/created/modified copied; alternatives/branches/history [].
- Legacy Library: fits mapped as above, characters/damagePatterns→damage_patterns/targetProfiles→target_profiles copied, folders, scenarios {}, fleets {}.
- `migrate` never loses data: unknown legacy fields go to `doc.ui.legacy`.

## files.ts (also Rust `files` module) — directory layout shared by web folder export, zip export and the future desktop app
```
<root>/library.exfa.json                     {format:'exfa/library-index@1', folders, characters, damage_patterns, target_profiles, scenarios, fleets}
<root>/<folder path>/<safe name>.<id>.exfa.json   FitDocument without `folder`
```
`safe name` = name with `/\:*?"<>|` and control chars replaced by `_`, trimmed, max 80 chars, empty → "fit". Folder path segments sanitised the same way. `toFiles(lib): {path: string, text: string}[]` (JSON pretty-printed 2-space, trailing newline, deterministic key order = declaration order above); `fromFiles(files): Library` (folder = directory of the file; id from the doc, not the filename; library-index optional). Round trip `fromFiles(toFiles(lib))` deep-equals lib (folders normalised).

## Packaging
- ts: `package.json` name `@exfa/format`, version 1.0.0, type module, `exports` → `dist/index.js` + types `dist/index.d.ts`, `prepare: tsc -p .` so the App can depend on `github:EX-CT/EXFA-Format#v1.0.0` (verify that a git-dependency install from a local clone path builds dist). No runtime deps.
- rust: crate `exfa-format` 1.0.0, deps serde/serde_json only.
- Fixtures: at least 1 library with ≥4 fits covering: mutation, spool, link group + alternatives + 2 branches, fleet with command member, projected fit, scenario with profile_id and with fit_id, T3D mode, character fallback; expected resolve outputs as JSON files; legacy-v0 library (copy a realistic shape from EXFA-App tests/fixtures if any) + expected migration.
