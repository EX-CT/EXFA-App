// Builds the unit-test fixture src/test/fixtures/mini-dataset.json.gz: a slice of the release dataset with the
// types the unit tests use (plus their meta variations and compatible charges), all groups / categories /
// market groups / units, and attributes and effects reduced to the fields the UI reads.
//   node tools/make-test-dataset.mjs [public/data/dataset.json.gz]
import fs from 'node:fs';
import zlib from 'node:zlib';

const src = process.argv[2] ?? 'public/data/dataset.json.gz';
const d = JSON.parse(zlib.gunzipSync(fs.readFileSync(src)));
const NAMES = [
  'Rifter', 'Vexor', 'Merlin', 'Thanatos', 'Svipul', 'Vedmak', 'Gyrostabilizer II', '200mm Steel Plates II', 'Small Armor Repairer II', '1MN Afterburner II',
  'Warp Scrambler II', 'Stasis Webifier II', '200mm AutoCannon II', 'Republic Fleet EMP S', 'EMP S', 'Small Projectile Burst Aerator I',
  'Small Projectile Collision Accelerator I', 'Drone Damage Amplifier II', 'Medium Armor Repairer II', 
  'Damage Control II', '10MN Afterburner II', 'Warp Disruptor II', 'Omnidirectional Tracking Link II', 'Drone Link Augmentor II',
  'Small Energy Neutralizer II', 'Heavy Neutron Blaster II', 'Void M', 'Medium Auxiliary Nano Pump I', 'Medium Capacitor Control Circuit I',
  'Hammerhead II', 'Hobgoblin II', "Inherent Implants 'Noble' Repair Proficiency RP-905", 'Improved Crash Booster',
  'Unstable Stasis Webifier Mutaplasmid', 'Light Neutron Blaster II', 'Fighter Support Unit II', 'Einherji II', 'Firbolg II',
  'Nanite Repair Paste', '5MN Microwarpdrive II', 'Small Ancillary Armor Repairer', 'Burst Jammer II', 'Gunnery', 'Small Projectile Turret',
  // Pyfa saved-fits database fixture (src/test/fixtures/pyfa-saveddata.db)
  'Svipul Defense Mode', 'Warrior II', 'Drones', 'Drone Navigation', "Zainou 'Snapshot' Heavy Missiles HM-703",
];
const byName = new Map(Object.entries(d.types).map(([k, t]) => [t.name, k]));
const keep = new Set();
for (const n of NAMES) { const k = byName.get(n); if (!k) { console.warn(`not in the dataset: ${n}`); continue; } keep.add(k); }
// meta variations of every kept module (what-if variation tests) and compatible charges
const root = (k) => String(d.types[k].variation_parent ?? k);
const roots = new Set([...keep].filter((k) => d.types[k].category === 7).map(root));
for (const [k, t] of Object.entries(d.types)) if (t.published !== false && roots.has(root(k))) keep.add(k);
const attrId = Object.fromEntries(Object.entries(d.attributes).map(([k, a]) => [a.name, k]));
for (const k of [...keep]) {
  const a = d.types[k].attrs;
  const groups = [1, 2, 3, 4, 5, 6].map((i) => a[attrId[`chargeGroup${i}`]]).filter(Boolean);
  if (!groups.length) continue;
  const size = a[attrId.chargeSize];
  for (const [c, t] of Object.entries(d.types))
    if (t.published !== false && groups.includes(t.group) && (size == null || t.attrs[attrId.chargeSize] == null || t.attrs[attrId.chargeSize] === size)) keep.add(c);
}
// abyssal outputs of kept mutaplasmids
const mutas = {};
for (const [k, m] of Object.entries(d.mutaplasmids ?? {})) if (keep.has(k)) { mutas[k] = m; for (const mp of m.mapping) keep.add(String(mp.output)); }
const types = Object.fromEntries([...keep].sort((a, b) => a - b).map((k) => [k, d.types[k]]));
const pick = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => keys.has(k)));
const out = {
  sde: d.sde, dataset_revision: d.dataset_revision, types,
  groups: d.groups, categories: d.categories, market_groups: d.market_groups, meta_groups: d.meta_groups, units: d.units,
  attributes: Object.fromEntries(Object.entries(d.attributes).map(([k, a]) => [k, { name: a.name, display: a.display, unit: a.unit, published: a.published, high_is_good: a.high_is_good, default: a.default }])),
  effects: Object.fromEntries(Object.entries(d.effects).map(([k, e]) => [k, { name: e.name, category: e.category, ...(e.fitting_usage_chance_attr ? { fitting_usage_chance_attr: e.fitting_usage_chance_attr } : {}) }])),
  dbuffs: d.dbuffs, mutaplasmids: mutas,
  names: { zh: pick(d.names?.zh ?? {}, keep) },
  names_i18n: { zh: { groups: d.names_i18n?.zh?.groups, market_groups: d.names_i18n?.zh?.market_groups, meta_groups: d.names_i18n?.zh?.meta_groups } },
  required_skills: pick(d.required_skills ?? {}, keep), traits: pick(d.traits ?? {}, keep),
  environment: d.environment,
};
const file = 'src/test/fixtures/mini-dataset.json.gz';
fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(out), { level: 9 }));
console.log(`${file}: ${Object.keys(types).length} types, ${fs.statSync(file).size} bytes (from ${src}, SDE ${d.sde.build} r${d.dataset_revision})`);
