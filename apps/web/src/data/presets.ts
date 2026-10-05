import type { Character, DamagePattern, TargetProfile } from '../fit/model';

export const BUILTIN_CHARACTERS: Character[] = [
  { id: 'all5', name: 'All 5', default_level: 5, levels: {}, builtin: true },
  { id: 'all4', name: 'All 4', default_level: 4, levels: {}, builtin: true },
  { id: 'all0', name: 'All 0', default_level: 0, levels: {}, builtin: true },
];

// Exact damage patterns only (uniform and one damage type, as Pyfa's Uniform / [Generic] patterns). NPC and ammo
// patterns come from the SDE (EXFA-Data presets.json, 'sde:…') or, opt-in, Pyfa's own set ('pyfa:…').
export const BUILTIN_DAMAGE: DamagePattern[] = [
  { id: 'uniform', name: 'Uniform', em: 25, thermal: 25, kinetic: 25, explosive: 25, builtin: true },
  { id: 'em', name: 'EM', em: 100, thermal: 0, kinetic: 0, explosive: 0, builtin: true },
  { id: 'thermal', name: 'Thermal', em: 0, thermal: 100, kinetic: 0, explosive: 0, builtin: true },
  { id: 'kinetic', name: 'Kinetic', em: 0, thermal: 0, kinetic: 100, explosive: 0, builtin: true },
  { id: 'explosive', name: 'Explosive', em: 0, thermal: 0, kinetic: 0, explosive: 100, builtin: true },
];

export const BUILTIN_TARGETS: TargetProfile[] = [
  { id: 'none', name: 'No target (ideal)', em: 0, thermal: 0, kinetic: 0, explosive: 0, builtin: true },
  { id: 'frigate', name: 'Frigate (35 m, 400 m/s)', em: 0, thermal: 0, kinetic: 0, explosive: 0, signature_radius: 35, max_velocity: 400, radius: 40, builtin: true },
  { id: 'cruiser', name: 'Cruiser (125 m, 250 m/s)', em: 0, thermal: 0, kinetic: 0, explosive: 0, signature_radius: 125, max_velocity: 250, radius: 150, builtin: true },
  { id: 'battleship', name: 'Battleship (400 m, 100 m/s)', em: 0, thermal: 0, kinetic: 0, explosive: 0, signature_radius: 400, max_velocity: 100, radius: 400, builtin: true },
  { id: 'uniform-50', name: 'Uniform 50% resists', em: 0.5, thermal: 0.5, kinetic: 0.5, explosive: 0.5, signature_radius: 125, max_velocity: 200, radius: 150, builtin: true },
];
