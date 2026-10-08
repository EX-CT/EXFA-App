import { describe, expect, it } from 'vitest';
import { BUILTIN_CHARACTERS, BUILTIN_DAMAGE, BUILTIN_TARGETS } from '../data/presets';
import { emptyLibrary, newFit, patchFit, requestFor, type Library } from './model';

const lib = (): Library => ({
  ...emptyLibrary(),
  characters: Object.fromEntries(BUILTIN_CHARACTERS.map((c) => [c.id, c])),
  damage_patterns: Object.fromEntries(BUILTIN_DAMAGE.map((d) => [d.id, d])),
  target_profiles: Object.fromEntries(BUILTIN_TARGETS.map((t) => [t.id, t])),
});

describe('fit/model requestFor (format resolveFit)', () => {
  it('web.unit.request-shape: a UI fit document becomes a contract FitRequest (schema 1, all-5 skills, uniform profile = null)', () => {
    const f = newFit(587, 'R');
    f.fit.modules.push({ type_id: 2873, slot: 'high', state: 'active', charge_type_id: 21898, spool: 0.5 });
    const r = requestFor(lib(), f);
    expect(r.schema_version).toBe(1);
    expect(r.ship).toEqual({ type_id: 587, mode_type_id: null });
    expect(r.character.skills.default_level).toBe(5);
    expect(r.modules[0]).toEqual({ type_id: 2873, slot: 'high', state: 'active', charge_type_id: 21898, mutation: null, spool: { type: 'spool_scale', amount: 0.5 } });
    expect(r.damage_pattern).toBeNull();
    expect(r.target_profile).toBeNull();
    expect(r.options.include_attributes).toBe('none');
  });
  it('web.unit.request-nested-fits: projected and fleet booster fits nest one level deep only', () => {
    const l = lib();
    const a = newFit(587, 'A'), b = newFit(603, 'B');
    a.links.projected_fits.push({ fit_id: b.id, amount: 1, distance_m: 5000 });
    b.links.projected_fits.push({ fit_id: a.id, amount: 1, distance_m: 5000 });
    a.links.booster_fit_ids.push(b.id);
    l.fits = { [a.id]: a, [b.id]: b };
    const r = requestFor(l, a);
    const pf = r.projected[0] as { kind: 'fit'; fit: typeof r };
    expect(pf.fit.ship.type_id).toBe(603);
    expect(pf.fit.projected).toEqual([]);
    expect(r.fleet.booster_fits[0].fleet.booster_fits).toEqual([]);
  });
  it('web.unit.request-missing-projected-fit: a projected fit deleted from the library is dropped', () => {
    const f = newFit(587, 'A');
    f.links.projected_fits.push({ fit_id: 'gone', amount: 1, distance_m: null });
    expect(requestFor(lib(), f).projected).toEqual([]);
  });
  it('web.unit.request-unsaved-doc: a document not in the library still resolves (what-if variants)', () => {
    const l = lib();
    const a = newFit(587, 'A'), b = newFit(603, 'B');
    a.links.booster_fit_ids.push(b.id);
    l.fits = { [b.id]: b }; // a is a working copy, not stored
    const r = requestFor(l, a);
    expect(r.ship.type_id).toBe(587);
    expect(r.fleet.booster_fits).toHaveLength(1);
  });
});

describe('fit/model moveModule', () => {
  const mods = (f: ReturnType<typeof newFit>) => f.fit.modules.map((m) => `${m.slot}:${m.type_id}`);
  const fit = () => patchFit(newFit(587), { modules: [
    { type_id: 1, slot: 'high' as const, state: 'active' as const, charge_type_id: null },
    { type_id: 2, slot: 'mid' as const, state: 'active' as const, charge_type_id: null },
    { type_id: 3, slot: 'high' as const, state: 'active' as const, charge_type_id: null },
    { type_id: 4, slot: 'high' as const, state: 'active' as const, charge_type_id: null },
    { type_id: 5, slot: 'low' as const, state: 'active' as const, charge_type_id: null },
  ] });
  it('web.unit.module-move: rack position swap and move to the end of the rack; other racks and other slots untouched', async () => {
    const { moveModule } = await import('./model');
    expect(mods(moveModule(fit(), 0, 3))).toEqual(['high:4', 'mid:2', 'high:3', 'high:1', 'low:5']);
    expect(mods(moveModule(fit(), 0, null))).toEqual(['mid:2', 'high:3', 'high:4', 'high:1', 'low:5']);
    expect(mods(moveModule(fit(), 0, 1))).toEqual(mods(fit())); // another rack: no change
    expect(moveModule(fit(), 2, 2).fit.modules).toHaveLength(5);
  });
});

describe('fit/model alternatives + branches', () => {
  const fit = () => patchFit(newFit(587), {
    modules: [
      { type_id: 440, slot: 'high' as const, state: 'active' as const, charge_type_id: 21896, group: 1 },
      { type_id: 440, slot: 'high' as const, state: 'active' as const, charge_type_id: 21896, group: 1 },
      { type_id: 12066, slot: 'mid' as const, state: 'active' as const, charge_type_id: null },
    ],
    drones: [{ type_id: 2456, quantity: 5, active: 5, mutation: null }],
  });
  it('web.unit.alternatives-branches: addAlternative groups siblings, capture/apply branch, diverged marker, option switch', async () => {
    const { addAlternative, applyBranch, branchDiverged, captureBranch } = await import('@exfa/format');
    const { applyAlternativeOption } = await import('./model');
    // group-1 modules share the alternative; both get alt_id, options seeded from the current item
    let f = addAlternative(fit(), { list: 'modules', index: 0 }, [442, 448]);
    expect(f.alternatives).toHaveLength(1);
    expect(f.alternatives[0].options.map((o) => o.type_id)).toEqual([440, 442, 448]);
    expect(f.fit.modules[0].alt_id).toBe(f.alternatives[0].id);
    expect(f.fit.modules[1].alt_id).toBe(f.alternatives[0].id);
    expect(f.fit.modules[2].alt_id).toBeUndefined();
    // a drone alternative is independent
    f = addAlternative(f, { list: 'drones', index: 0 }, [2473]);
    expect(f.alternatives).toHaveLength(2);
    // capture two branches and switch between them
    const base = captureBranch(f, 'base');
    const alt = applyAlternativeOption(f, f.alternatives[0].id, 1);
    expect(alt.fit.modules[0].type_id).toBe(442);
    expect(alt.fit.modules[1].type_id).toBe(442); // grouped siblings switch together
    expect(alt.fit.modules[2].type_id).toBe(12066);
    const switched = captureBranch(alt, 'switched');
    const d = { ...base, branches: [...base.branches, ...switched.branches] };
    const applied = applyBranch(d, switched.branches[0].id);
    expect(applied.fit.modules[0].type_id).toBe(442);
    expect(applied.active_branch).toBe(switched.branches[0].id);
    expect(branchDiverged(applied)).toBe(false);
    // diverged once the user edits away from the branch pick
    const edited = patchFit(applied, { modules: applied.fit.modules.map((m, i) => (i === 0 ? { ...m, type_id: 440 } : m)) });
    expect(branchDiverged(edited)).toBe(true);
    const restored = applyBranch(d, base.branches[0].id);
    expect(restored.fit.modules[0].type_id).toBe(440);
  });
});
