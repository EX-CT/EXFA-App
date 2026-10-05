// Presets derived from the SDE by EX-CT/EXFA-Data (presets.json, slimmed at build time to data/presets-web.json):
// implant sets, NPC damage profiles, NPC target profiles. Optional: the UI works without the file.
import { useEffect, useState } from 'react';
import type { DamagePattern, TargetProfile } from '../fit/model';

export interface ImplantSet { id: string; name: string; grade: string | null; complete: boolean; members: { type_id: number; slot: number }[]; user?: boolean }
export interface SdePresets { implant_sets: ImplantSet[]; damage: DamagePattern[]; targets: TargetProfile[] }

const EMPTY: SdePresets = { implant_sets: [], damage: [], targets: [] };
let cache: Promise<SdePresets> | null = null;

export function loadSdePresets(): Promise<SdePresets> {
  cache ??= fetch(`${import.meta.env.BASE_URL}data/presets-web.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((p: any): SdePresets => {
      if (!p) return EMPTY;
      const pct = (x: number) => Math.round(x * 1000) / 10;
      return {
        implant_sets: p.implant_sets ?? [],
        damage: (p.damage ?? []).map((d: any) => ({ id: 'sde:' + d.id, name: d.name, em: pct(d.ratio[0]), thermal: pct(d.ratio[1]), kinetic: pct(d.ratio[2]), explosive: pct(d.ratio[3]), builtin: true })),
        targets: (p.targets ?? []).map((t: any) => ({ id: 'sde:' + t.id, name: t.name, em: t.resist.em, thermal: t.resist.thermal, kinetic: t.resist.kinetic, explosive: t.resist.explosive,
          signature_radius: t.signature_radius, max_velocity: t.max_velocity, radius: t.radius, builtin: true })),
      };
    })
    .catch(() => EMPTY);
  return cache;
}

export function useSdePresets(): SdePresets {
  const [p, setP] = useState<SdePresets>(EMPTY);
  useEffect(() => { let live = true; loadSdePresets().then((x) => live && setP(x)); return () => { live = false; }; }, []);
  return p;
}

// User-saved implant sets (localStorage, separate from the fit library).
const UKEY = 'eve-fit-web:implant-sets';
export function userImplantSets(): ImplantSet[] {
  try { return JSON.parse(localStorage.getItem(UKEY) ?? '[]'); } catch { return []; }
}
export function saveUserImplantSets(sets: ImplantSet[]) { localStorage.setItem(UKEY, JSON.stringify(sets)); }

/** Replace the implants occupying the set's slots with the set members; implants in other slots stay. */
export function applyImplantSet(current: number[], set: ImplantSet, slotOf: (id: number) => number | undefined): number[] {
  const slots = new Set(set.members.map((m) => m.slot));
  return [...current.filter((id) => !slots.has(slotOf(id) ?? -1)), ...set.members.map((m) => m.type_id)];
}
