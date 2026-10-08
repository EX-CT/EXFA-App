// Stage C: builtin scenario seeding, scenario -> engine request shape (scenarioRequest / refs.scenario_ids),
// persistence stripping (builtin scenarios behave like builtin profiles: never stored).
import { describe, expect, it } from 'vitest';
import { scenarioRequest } from '@exfa/format';
import { BUILTIN_CHARACTERS, BUILTIN_SCENARIOS, BUILTIN_TARGETS } from '../data/presets';
import { emptyLibrary, newFit, requestFor, type Library, type Scenario } from './model';
import { mergeLibrary } from './library';
import { storedPart } from '../store/library';

const libWith = (p: Partial<Library> = {}): Library => ({
  ...emptyLibrary(),
  characters: Object.fromEntries(BUILTIN_CHARACTERS.map((c) => [c.id, c])),
  target_profiles: Object.fromEntries(BUILTIN_TARGETS.map((x) => [x.id, x])),
  scenarios: Object.fromEntries(BUILTIN_SCENARIOS.map((s) => [s.id, s])),
  ...p,
});

describe('stage C scenarios', () => {
  it('web.unit.scn-builtin: the seeded "current target · 10 km orbit" matches the spec defaults', () => {
    const s = BUILTIN_SCENARIOS.find((x) => x.id === 'orbit-10k')!;
    expect(s.builtin).toBe(true);
    expect(s.name).toBe('Current target · 10 km orbit');
    expect(s.target).toEqual({ profile_id: 'frigate' });
    expect(s.params.distance_m).toBe(10000);
    expect(s.params.tgt_speed_pct).toBe(100);
    expect(s.params.tgt_angle_deg).toBe(90);
    expect(s.params.atk_speed_pct).toBe(0);
  });

  it('web.unit.scn-request: scenarioRequest expands a profile target into the engine shape and drops null params', () => {
    const lib = libWith();
    const s = lib.scenarios['orbit-10k'];
    const r = scenarioRequest(lib, s) as Record<string, any>;
    expect(r.id).toBe('orbit-10k');
    expect(r.target.profile.signature_radius).toBe(lib.target_profiles.frigate.signature_radius);
    expect(r.params).toMatchObject({ distance_m: 10000, tgt_speed_pct: 100, atk_speed_pct: 0 });
    expect('time_s' in r.params).toBe(false);
  });

  it('web.unit.scn-fit-target: a fit target resolves to {fit, resist_mode} via the library', () => {
    const lib = libWith();
    const doc = newFit(587, 'Target Rifter');
    lib.fits[doc.id] = doc;
    const s: Scenario = { id: 's-fit', name: 'vs my rifter', target: { fit_id: doc.id }, params: { distance_m: 5000 } };
    const r = scenarioRequest(lib, s) as Record<string, any>;
    expect(r.target.fit.ship.type_id).toBe(587);
    expect(r.target.resist_mode).toBe('auto');
    expect(r.params.distance_m).toBe(5000);
  });

  it('web.unit.scn-inline-target: inline profile values pass through unchanged', () => {
    const lib = libWith();
    const s: Scenario = { id: 's-inline', name: 'custom', params: {},
      target: { profile: { em: 0.1, thermal: 0.2, kinetic: 0.3, explosive: 0.4, signature_radius: 100, max_velocity: 500, radius: 10, hp: 1e5 } } };
    const r = scenarioRequest(lib, s) as Record<string, any>;
    expect(r.target.profile).toMatchObject({ em: 0.1, signature_radius: 100, hp: 1e5 });
  });

  it('web.unit.scn-refs: doc.refs.scenario_ids lands in the calc request as scenarios[] (top level)', () => {
    const lib = libWith();
    const doc = { ...newFit(587, 'Attacker'), refs: { ...newFit(587).refs, scenario_ids: ['orbit-10k'] } };
    lib.fits[doc.id] = doc;
    const req = requestFor(lib, doc) as Record<string, any>;
    expect(req.scenarios).toHaveLength(1);
    expect(req.scenarios[0].id).toBe('orbit-10k');
    expect(req.scenarios[0].params.distance_m).toBe(10000);
    expect(req.scenarios[0].target.profile.signature_radius).toBe(lib.target_profiles.frigate.signature_radius);
  });

  it('web.unit.scn-persist: builtin scenarios are stripped from the stored index like builtin profiles', () => {
    const lib = libWith({ scenarios: { ...Object.fromEntries(BUILTIN_SCENARIOS.map((s) => [s.id, s])), mine: { id: 'mine', name: 'Mine', target: { profile_id: 'frigate' }, params: {} } } });
    const stored = storedPart(lib);
    expect(stored.scenarios['orbit-10k']).toBeUndefined();
    expect(stored.scenarios.mine.name).toBe('Mine');
  });

  it('web.unit.scn-merge: imported scenarios union into the library (mergeLibrary)', () => {
    const lib = libWith();
    const r = mergeLibrary(lib, { scenarios: { incoming: { id: 'incoming', name: 'In', target: { profile_id: 'frigate' }, params: {} } } });
    expect(r.lib.scenarios.incoming.name).toBe('In');
    expect(r.lib.scenarios['orbit-10k']).toBeDefined();
  });
});
