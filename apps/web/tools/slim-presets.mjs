// Slims EXFA-Data's presets.json (release asset, CCP data + MIT rules; no Pyfa data) down to what the web UI
// uses: implant sets, NPC damage profiles and NPC target profiles.
//   node tools/slim-presets.mjs presets.json public/data/presets-web.json
import { readFileSync, writeFileSync } from 'node:fs';

const [src, out] = process.argv.slice(2);
const p = JSON.parse(readFileSync(src, 'utf8'));
const r = (x, n = 4) => (x == null ? null : Math.round(x * 10 ** n) / 10 ** n);
const slim = {
  format: 'eve-fit-web-presets', source: 'EX-CT/EXFA-Data presets.json', sde_build: p.sde_build,
  licenses: p.licenses,
  implant_sets: p.implant_sets.items.map((s) => ({
    id: s.id, name: s.name, grade: s.grade, complete: s.complete,
    members: s.members.map((m) => ({ type_id: m.type_id, slot: m.slot })),
  })),
  damage: p.damage_profiles.npc.items.map((d) => ({ id: d.id, name: d.name, ratio: d.ratio.map((x) => r(x)) })),
  targets: p.target_profiles.npc.items.map((t) => ({
    id: t.id, name: t.name, resist: Object.fromEntries(Object.entries(t.resist).map(([k, v]) => [k, r(v)])),
    signature_radius: r(t.signature_radius, 1), max_velocity: r(t.max_velocity, 1), radius: r(t.radius, 1),
  })),
};
writeFileSync(out, JSON.stringify(slim) + '\n');
console.log(`${out}: ${slim.implant_sets.length} implant sets, ${slim.damage.length} damage, ${slim.targets.length} targets`);
