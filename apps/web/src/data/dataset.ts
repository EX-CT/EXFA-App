// Engine dataset (EX-CT/EXFA-Data release asset) loaded in the UI thread for browsing, search, slot
// inference and names. Calculations never use this copy: they go through the engine adapter.

export interface TypeRow {
  name: string; group: number; category: number; market_group?: number | null; meta_group?: number | null;
  meta_level?: number | null; published?: boolean; race?: number | null; tech_level?: number | null; variation_parent?: number | null;
  attrs: Record<string, number>; effects: [number, boolean | number][]; mass?: number; volume?: number;
  capacity?: number; radius?: number;
}
export interface MarketGroup { name: string; parent?: number | null; has_types?: boolean; icon?: number | null }
export interface AttrRow { name: string; display?: string | null; unit?: number | null; published?: boolean; high_is_good?: boolean; default?: number }
export interface TraitBonus { bonus: number | null; text: string; text_zh?: string; unit?: number | null; importance?: number }
export interface Traits { role?: TraitBonus[]; misc?: TraitBonus[]; skills?: Record<string, TraitBonus[]> }
export interface Beacon { name: string; group: number; group_name: string; kind: string; dbuffs: Record<string, number> }

export interface RawDataset {
  sde: { build: number; release_date?: string };
  dataset_revision?: number;
  types: Record<string, TypeRow>;
  groups: Record<string, { name: string; category: number }>;
  categories: Record<string, { name: string }>;
  attributes: Record<string, AttrRow>;
  effects: Record<string, { name: string; category: number; fitting_usage_chance_attr?: number | null }>;
  dbuffs?: Record<string, { name: string; aggregate?: string }>;
  market_groups?: Record<string, MarketGroup>;
  meta_groups?: Record<string, { name: string }>;
  units?: Record<string, { name: string; display?: string }>;
  names?: { zh?: Record<string, string> };
  names_i18n?: { zh?: Record<string, Record<string, string>> };
  traits?: Record<string, Traits>;
  /** item description text (with EVE inline markup), keyed by type id (dataset r7+) */
  descriptions?: Record<string, string>;
  required_skills?: Record<string, [number, number][]>;
  environment?: { effect_beacons?: Record<string, Beacon>; wormhole_classes?: Record<string, string> };
  mutaplasmids?: Record<string, { attrs: Record<string, [number, number]>; mapping: { inputs: number[]; output: number }[] }>;
  fighter_abilities?: Record<string, unknown>;
}

export type Slot = 'high' | 'mid' | 'low' | 'rig' | 'subsystem' | 'service';
export type Kind = 'ship' | 'module' | 'charge' | 'drone' | 'fighter' | 'implant' | 'booster' | 'subsystem' | 'skill' | 'structure' | 'other';

const SLOT_EFFECT: Record<number, Slot> = { 12: 'high', 13: 'mid', 11: 'low', 2663: 'rig', 3772: 'subsystem', 6306: 'service' };
const CAT_KIND: Record<number, Kind> = { 6: 'ship', 7: 'module', 8: 'charge', 18: 'drone', 87: 'fighter', 20: 'implant', 32: 'subsystem', 16: 'skill', 65: 'structure', 66: 'module' };

export type Lang = 'en' | 'zh';

export class Dataset {
  readonly raw: RawDataset;
  readonly build: number;
  readonly byName = new Map<string, number>();
  readonly attrByName = new Map<string, number>();
  readonly mgChildren = new Map<number, number[]>();
  readonly mgTypes = new Map<number, number[]>();
  readonly mgRoots: number[] = [];
  readonly skills: number[] = [];
  lang: Lang = 'en';
  private searchIndex: { id: number; en: string; zh: string }[] = [];
  private varIndex: Map<number, number[]> | null = null;

  constructor(raw: RawDataset) {
    this.raw = raw;
    this.build = raw.sde.build;
    for (const [k, t] of Object.entries(raw.types)) {
      const id = +k;
      this.byName.set(t.name.toLowerCase(), id);
      if (t.published === false) continue;
      if (t.category === 16) this.skills.push(id);
      if (t.market_group != null) {
        const l = this.mgTypes.get(t.market_group) ?? [];
        l.push(id);
        this.mgTypes.set(t.market_group, l);
      }
      this.searchIndex.push({ id, en: t.name.toLowerCase(), zh: raw.names?.zh?.[k] ?? '' });
    }
    for (const [k, a] of Object.entries(raw.attributes)) this.attrByName.set(a.name, +k);
    // market tree: keep only branches that lead to types we have
    const mg = raw.market_groups ?? {};
    const alive = new Set<number>();
    for (const g of this.mgTypes.keys()) {
      let cur: number | null | undefined = g;
      while (cur != null && !alive.has(cur) && mg[cur]) { alive.add(cur); cur = mg[cur].parent; }
    }
    for (const id of alive) {
      const p = mg[id].parent;
      if (p == null || !alive.has(p)) this.mgRoots.push(id);
      else { const l = this.mgChildren.get(p) ?? []; l.push(id); this.mgChildren.set(p, l); }
    }
    const byMgName = (a: number, b: number) => (mg[a].name < mg[b].name ? -1 : 1);
    this.mgRoots.sort(byMgName);
    for (const l of this.mgChildren.values()) l.sort(byMgName);
    for (const l of this.mgTypes.values()) l.sort((a, b) => (this.metaLevel(a) - this.metaLevel(b)) || this.name(a).localeCompare(this.name(b)));
    this.skills.sort((a, b) => this.name(a).localeCompare(this.name(b)));
  }

  static async load(url: string, onProgress?: (msg: string) => void): Promise<Dataset> {
    onProgress?.('downloading dataset…');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`dataset ${url}: HTTP ${res.status}`);
    let buf = new Uint8Array(await res.arrayBuffer());
    if (buf[0] === 0x1f && buf[1] === 0x8b) {
      onProgress?.('decompressing…');
      const s = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
      buf = new Uint8Array(await new Response(s).arrayBuffer());
    }
    onProgress?.('indexing…');
    return new Dataset(JSON.parse(new TextDecoder().decode(buf)));
  }

  type(id: number): TypeRow | undefined { return this.raw.types[id]; }
  name(id: number, lang: Lang = this.lang): string {
    const t = this.raw.types[id];
    if (!t) return `#${id}`;
    return (lang === 'zh' && this.raw.names?.zh?.[id]) || t.name;
  }
  groupName(id: number): string {
    return (this.lang === 'zh' && this.raw.names_i18n?.zh?.groups?.[id]) || this.raw.groups[id]?.name || `group ${id}`;
  }
  mgName(id: number): string {
    return (this.lang === 'zh' && this.raw.names_i18n?.zh?.market_groups?.[id]) || this.raw.market_groups?.[id]?.name || `${id}`;
  }
  attrId(name: string): number | undefined { return this.attrByName.get(name); }
  attr(typeId: number, name: string): number | undefined {
    const a = this.attrByName.get(name);
    const t = this.raw.types[typeId];
    if (a == null || !t) return undefined;
    if (name === 'mass') return t.mass ?? t.attrs[a];
    if (name === 'volume') return t.volume ?? t.attrs[a];
    if (name === 'capacity') return t.capacity ?? t.attrs[a];
    if (name === 'radius') return t.radius ?? t.attrs[a];
    return t.attrs[a];
  }
  metaLevel(id: number): number { return this.raw.types[id]?.meta_level ?? 0; }
  hasEffect(id: number, effectName: string): boolean {
    const t = this.raw.types[id];
    return !!t?.effects.some(([e]) => this.raw.effects[e]?.name === effectName);
  }

  /** Warfare buffs usable as manual fleet buffs (id, name), excluding prototype/test rows. */
  warfareBuffs(): [number, string][] {
    return Object.entries(this.raw.dbuffs ?? {}).filter(([, b]) => b.name && !b.name.startsWith('[')).map(([k, b]) => [+k, b.name] as [number, string]).sort((a, b) => a[1].localeCompare(b[1]));
  }
  /** Fighter ability effects of a fighter type, with Pyfa's default on/off state (mirrors the engine). */
  fighterAbilities(id: number): { effect: number; name: string; default: boolean }[] {
    const t = this.raw.types[id];
    if (!t) return [];
    const ids = t.effects.map(([e]) => e).sort((a, b) => a - b);
    const out: { effect: number; name: string; default: boolean }[] = [];
    let stdSeen = false;
    for (const e of ids) {
      const n = this.raw.effects[e]?.name;
      if (!n || !n.startsWith('fighterAbility')) continue;
      let def = false;
      if (n === 'fighterAbilityAttackM') { def = true; stdSeen = true; }
      else if (!stdSeen && !['fighterAbilityMicroWarpDrive', 'fighterAbilityEvasiveManeuvers', 'fighterAbilityMicroJumpDrive'].includes(n)) def = true;
      out.push({ effect: e, name: n.replace(/^fighterAbility/, '').replace(/([a-z])([A-Z])/g, '$1 $2'), default: def });
    }
    return out;
  }
  /** Booster side effects (effects with a fitting-usage chance attribute): effect id, readable name, chance. */
  boosterSideEffects(id: number): { effect: number; name: string; chance: number | undefined }[] {
    const t = this.raw.types[id];
    if (!t) return [];
    return t.effects.flatMap(([e]) => {
      const ef = this.raw.effects[e];
      if (!ef?.fitting_usage_chance_attr) return [];
      const name = ef.name.replace(/^booster/, '').replace(/Penalty.*$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
      return [{ effect: e, name: name + ' penalty', chance: t.attrs[ef.fitting_usage_chance_attr] }];
    });
  }

  kind(id: number): Kind {
    const t = this.raw.types[id];
    if (!t) return 'other';
    if (t.category === 20 && /booster/i.test(this.raw.groups[t.group]?.name ?? '')) return 'booster';
    return CAT_KIND[t.category] ?? 'other';
  }
  slot(id: number): Slot | null {
    const t = this.raw.types[id];
    if (!t) return null;
    for (const [e] of t.effects) if (SLOT_EFFECT[e]) return SLOT_EFFECT[e];
    return null;
  }
  isShip(id: number) { const c = this.raw.types[id]?.category; return c === 6 || c === 65; }

  /** charges that fit a module: chargeGroup1..5 + chargeSize + capacity */
  chargesFor(moduleId: number): number[] {
    const groups = new Set<number>();
    for (let i = 1; i <= 5; i++) { const g = this.attr(moduleId, `chargeGroup${i}`); if (g) groups.add(g); }
    const g6 = this.attr(moduleId, 'chargeGroup6'); if (g6) groups.add(g6);
    if (!groups.size) return [];
    const size = this.attr(moduleId, 'chargeSize');
    const cap = this.attr(moduleId, 'capacity') ?? 0;
    const out: number[] = [];
    for (const [k, t] of Object.entries(this.raw.types)) {
      if (t.published === false || !groups.has(t.group)) continue;
      const id = +k;
      if (size != null && size > 0) { const cs = this.attr(id, 'chargeSize'); if (cs != null && cs !== size) continue; }
      if (cap > 0 && (t.volume ?? 0) > cap) continue;
      out.push(id);
    }
    return out.sort((a, b) => this.groupName(this.raw.types[a].group).localeCompare(this.groupName(this.raw.types[b].group)) || this.name(a).localeCompare(this.name(b)));
  }

  /** mutaplasmids applicable to a module (input type) */
  mutaplasmidsFor(typeId: number): { muta: number; output: number }[] {
    const out: { muta: number; output: number }[] = [];
    for (const [k, m] of Object.entries(this.raw.mutaplasmids ?? {}))
      for (const map of m.mapping) if (map.inputs.includes(typeId)) out.push({ muta: +k, output: map.output });
    return out;
  }

  search(q: string, limit = 50, kinds?: Kind[]): number[] {
    const ql = q.trim().toLowerCase();
    if (!ql) return [];
    const words = ql.split(/\s+/);
    const scored: [number, number][] = [];
    for (const r of this.searchIndex) {
      let s = -1;
      if (r.en === ql || r.zh === ql) s = 0;
      else if (r.en.startsWith(ql) || (r.zh && r.zh.startsWith(ql))) s = 1;
      else if (words.every((w) => r.en.includes(w)) || (r.zh && r.zh.includes(ql))) s = 2;
      if (s < 0) continue;
      if (kinds && !kinds.includes(this.kind(r.id))) continue;
      scored.push([s, r.id]);
    }
    scored.sort((a, b) => a[0] - b[0] || this.metaLevel(a[1]) - this.metaLevel(b[1]) || a[1] - b[1]);
    return scored.slice(0, limit).map((x) => x[1]);
  }

  /** Item description text, if the dataset carries it (r7+). EVE inline markup is left to the caller. */
  description(id: number): string | null {
    const s = this.raw.descriptions?.[id];
    return s ? s : null;
  }

  /** Meta variations of a type (same variation parent, published, incl. the type itself), by meta level then name. */
  variations(id: number): number[] {
    if (!this.varIndex) {
      this.varIndex = new Map();
      for (const [k, t] of Object.entries(this.raw.types)) {
        if (t.published === false) continue;
        const root = t.variation_parent ?? +k;
        const l = this.varIndex.get(root) ?? [];
        l.push(+k);
        this.varIndex.set(root, l);
      }
      for (const l of this.varIndex.values()) l.sort((a, b) => this.metaLevel(a) - this.metaLevel(b) || this.name(a, 'en').localeCompare(this.name(b, 'en')));
    }
    const t = this.raw.types[id];
    if (!t) return [];
    return this.varIndex.get(t.variation_parent ?? id) ?? [id];
  }

  byExactName(name: string): number | undefined { return this.byName.get(name.trim().toLowerCase()); }
}
