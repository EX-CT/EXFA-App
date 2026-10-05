// Built-in fit formats (TypeScript, from the public format descriptions; no Pyfa code): EFT text (with Pyfa-style
// mutated-module blocks), DNA, ESI fitting JSON and multibuy. Names resolve through the UI dataset.
import type { Dataset, Slot } from '../data/dataset';
import { defaultState } from '../fit/states';
import { requestToStructured } from './convert';
import type { ExportFormat, ExportInput, FitFormats, ImportFormat, ParseResult, StructuredFit, StructuredMutation } from './types';

const SLOT_ORDER: Slot[] = ['low', 'mid', 'high', 'rig', 'subsystem', 'service'];
const EMPTY_LABEL: Record<Slot, string> = { low: 'Low', mid: 'Med', high: 'High', rig: 'Rig', subsystem: 'Subsystem', service: 'Service' };
const ESI_SLOT: Record<Slot, [string, number]> = { low: ['LoSlot', 11], mid: ['MedSlot', 19], high: ['HiSlot', 27], rig: ['RigSlot', 92], subsystem: ['SubSystemSlot', 125], service: ['ServiceSlot', 164] };

export function emptyFit(ship: number, name: string): StructuredFit {
  return { name, ship: { type_id: ship, mode_type_id: null }, modules: [], drones: [], fighters: [], implants: [], boosters: [], cargo: [] };
}

/** Split a paste of several EFT fits (Pyfa multi-export) on their "[Ship, Name]" headers. */
export function splitEft(text: string): string[] {
  const lines = text.replace(/\r/g, '').split('\n');
  const heads = lines.map((l, i) => (/^\[[^\],]+,[^\]]*\]\s*$/.test(l.trim()) ? i : -1)).filter((i) => i >= 0);
  return heads.length > 1 ? heads.map((h, k) => lines.slice(h, heads[k + 1] ?? lines.length).join('\n')) : [text];
}

export function parseEft(ds: Dataset, text: string, warnings: string[] = []): StructuredFit {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.trim());
  const head = lines.findIndex((l) => l.startsWith('['));
  if (head < 0) throw new Error('EFT: missing "[Ship, Name]" header');
  const m = /^\[([^,\]]+)(?:,\s*(.*))?\]$/.exec(lines[head]);
  if (!m) throw new Error('EFT: bad header ' + lines[head]);
  const ship = ds.byExactName(m[1]);
  if (ship == null || !ds.isShip(ship)) throw new Error(`EFT: unknown ship "${m[1]}"`);
  const fit = emptyFit(ship, (m[2] ?? '').trim() || 'Imported fit');
  // trailing mutation blocks: "[N] Base Name" / "  Mutaplasmid Name" / "  attrName value, attrName value"
  const muts = new Map<number, StructuredMutation>();
  let firstMut = lines.length;
  for (let i = head + 1; i < lines.length; i++) {
    const h = /^\[(\d+)\]\s*(.+)$/.exec(lines[i]);
    if (!h) continue;
    firstMut = Math.min(firstMut, i);
    const base = ds.byExactName(h[2]);
    let muta: number | undefined; const attrs: Record<string, number> = {};
    let j = i + 1;
    for (; j < lines.length && !/^\[\d+\]/.test(lines[j]); j++) {
      const l = lines[j];
      if (!l) continue;
      if (muta == null) { muta = ds.byExactName(l); if (muta == null) warnings.push(`unknown mutaplasmid "${l}"`); continue; }
      for (const kv of l.split(',')) {
        const mm = /^(\S+)\s+(-?[\d.eE+-]+)$/.exec(kv.trim());
        const aid = mm ? ds.attrId(mm[1]) : undefined;
        if (mm && aid != null) attrs[String(aid)] = +mm[2];
      }
    }
    if (base == null) warnings.push(`unknown mutated base "${h[2]}"`);
    else if (muta != null) muts.set(+h[1], { base_type_id: base, mutaplasmid_type_id: muta, attributes: attrs });
    i = j - 1;
  }
  for (const raw of lines.slice(head + 1, firstMut)) {
    if (!raw || /^\[empty .* slot\]$/i.test(raw)) continue;
    let line = raw, offline = false, mref: number | null = null;
    const mr = /\s*\[(\d+)\]$/.exec(line);
    if (mr) { mref = +mr[1]; line = line.slice(0, mr.index); }
    if (/\/offline$/i.test(line)) { offline = true; line = line.replace(/\s*\/offline$/i, ''); }
    const qm = /^(.*?)\s+x(\d+)$/.exec(line);
    if (qm) {
      const id = ds.byExactName(qm[1]);
      if (id == null) { warnings.push(`unknown item "${qm[1]}"`); continue; }
      const q = +qm[2], k = ds.kind(id);
      if (k === 'drone') fit.drones.push({ type_id: id, quantity: q, active: q });
      else if (k === 'fighter') fit.fighters.push({ type_id: id, quantity: q, active: true });
      else fit.cargo.push({ type_id: id, quantity: q });
      continue;
    }
    const [modName, chargeName] = line.split(',').map((s) => s.trim());
    const id = ds.byExactName(modName);
    if (id == null) { warnings.push(`unknown item "${modName}"`); continue; }
    const k = ds.kind(id);
    if (k === 'implant') { fit.implants.push(id); continue; }
    if (k === 'booster') { fit.boosters.push({ type_id: id }); continue; }
    if (k === 'drone') { fit.drones.push({ type_id: id, quantity: 1, active: 1 }); continue; }
    if (k === 'charge') { fit.cargo.push({ type_id: id, quantity: 1 }); continue; }
    const slot = ds.slot(id);
    if (!slot) { warnings.push(`"${modName}" is not a fittable module`); continue; }
    let charge: number | null = null;
    if (chargeName) { charge = ds.byExactName(chargeName) ?? null; if (charge == null) warnings.push(`unknown charge "${chargeName}"`); }
    let tid = id, mutation: StructuredMutation | null = null;
    if (mref != null) {
      const mu = muts.get(mref);
      if (!mu) warnings.push(`mutation [${mref}] not defined`);
      else {
        const out = ds.mutaplasmidsFor(mu.base_type_id).find((x) => x.muta === mu.mutaplasmid_type_id)?.output;
        if (out == null) warnings.push(`${ds.name(mu.mutaplasmid_type_id, 'en')} does not apply to ${modName}`);
        else { tid = out; mutation = mu; }
      }
    }
    fit.modules.push({ type_id: tid, slot, state: offline ? 'offline' : defaultState(ds, tid), charge_type_id: charge, mutation });
  }
  return fit;
}

export function exportEft(ds: Dataset, fit: StructuredFit, slotTotals?: Partial<Record<Slot, number>>): string {
  const out: string[] = [`[${ds.name(fit.ship.type_id, 'en')}, ${fit.name}]`];
  const mutated: StructuredMutation[] = [];
  for (const s of SLOT_ORDER) {
    const mods = fit.modules.filter((m) => m.slot === s);
    const total = Math.max(slotTotals?.[s] ?? 0, mods.length);
    if (total === 0) continue;
    for (const m of mods) {
      let l = ds.name(m.mutation ? m.mutation.base_type_id : m.type_id, 'en');
      if (m.charge_type_id) l += `, ${ds.name(m.charge_type_id, 'en')}`;
      if (m.state === 'offline') l += ' /OFFLINE';
      if (m.mutation) { mutated.push(m.mutation); l += ` [${mutated.length}]`; }
      out.push(l);
    }
    for (let i = mods.length; i < total; i++) out.push(`[Empty ${EMPTY_LABEL[s]} slot]`);
    out.push('');
  }
  const section = (rows: string[]) => { if (rows.length) out.push('', ...rows); };
  section(fit.drones.map((d) => `${ds.name(d.type_id, 'en')} x${d.quantity}`));
  section(fit.fighters.map((f) => `${ds.name(f.type_id, 'en')} x${f.quantity}`));
  section([...fit.implants.map((i) => ds.name(i, 'en')), ...fit.boosters.map((b) => ds.name(b.type_id, 'en'))]);
  section(fit.cargo.map((c) => `${ds.name(c.type_id, 'en')} x${c.quantity}`));
  if (mutated.length) {
    out.push('');
    mutated.forEach((mu, i) => {
      const attrs = Object.entries(mu.attributes).map(([a, v]) => [ds.raw.attributes[a]?.name ?? a, v] as const).sort((x, y) => x[0].localeCompare(y[0]));
      out.push(`[${i + 1}] ${ds.name(mu.base_type_id, 'en')}`, `  ${ds.name(mu.mutaplasmid_type_id, 'en')}`, '  ' + attrs.map(([n, v]) => `${n} ${Number(v.toPrecision(7))}`).join(', '));
      if (i < mutated.length - 1) out.push('');
    });
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export function parseDna(ds: Dataset, text: string, warnings: string[] = []): StructuredFit {
  const s = text.trim().replace(/^fitting:/, '').replace(/^<url=fitting:/, '').replace(/>.*$/, '');
  const parts = s.split(':').filter((p) => p.length);
  const ship = +parts[0];
  if (!ds.isShip(ship)) throw new Error(`DNA: ${parts[0]} is not a ship type`);
  const fit = emptyFit(ship, `${ds.name(ship, 'en')} (DNA)`);
  const charges: { id: number; q: number }[] = [];
  for (const p of parts.slice(1)) {
    const [idS, qS] = p.split(';');
    const id = +idS.replace(/_$/, ''), q = +(qS ?? 1) || 1;
    const k = ds.kind(id);
    if (!ds.type(id)) { warnings.push(`unknown type ${idS}`); continue; }
    if (k === 'drone') fit.drones.push({ type_id: id, quantity: q, active: q });
    else if (k === 'fighter') fit.fighters.push({ type_id: id, quantity: q, active: true });
    else if (k === 'implant') fit.implants.push(id);
    else if (k === 'booster') fit.boosters.push({ type_id: id });
    else if (k === 'charge') charges.push({ id, q });
    else if (idS.endsWith('_')) fit.cargo.push({ type_id: id, quantity: q });
    else {
      const slot = ds.slot(id);
      if (!slot) { fit.cargo.push({ type_id: id, quantity: q }); continue; }
      for (let i = 0; i < q; i++) fit.modules.push({ type_id: id, slot, state: defaultState(ds, id), charge_type_id: null });
    }
  }
  for (const c of charges) {
    const fits = fit.modules.filter((m) => !m.charge_type_id && ds.chargesFor(m.type_id).includes(c.id));
    for (const m of fits) m.charge_type_id = c.id;
    fit.cargo.push({ type_id: c.id, quantity: c.q });
  }
  return fit;
}

export function exportDna(fit: StructuredFit): string {
  const counts = new Map<string, number>();
  const add = (k: string, q: number) => counts.set(k, (counts.get(k) ?? 0) + q);
  for (const s of ['subsystem', 'high', 'mid', 'low', 'rig', 'service'] as Slot[])
    for (const m of fit.modules.filter((x) => x.slot === s)) add(String(m.type_id), 1);
  for (const d of fit.drones) add(String(d.type_id), d.quantity);
  for (const f of fit.fighters) add(String(f.type_id), f.quantity);
  for (const i of fit.implants) add(String(i), 1);
  for (const b of fit.boosters) add(String(b.type_id), 1);
  const charges = new Map<number, number>();
  for (const m of fit.modules) if (m.charge_type_id) charges.set(m.charge_type_id, (charges.get(m.charge_type_id) ?? 0) + 1);
  for (const c of fit.cargo) add(charges.has(c.type_id) ? String(c.type_id) : `${c.type_id}_`, c.quantity);
  for (const [c, n] of charges) if (!fit.cargo.some((x) => x.type_id === c)) add(String(c), n);
  return `${fit.ship.type_id}:` + [...counts].map(([k, q]) => `${k};${q}`).join(':') + '::';
}

export function exportEsi(fit: StructuredFit): string {
  const items: { type_id: number; flag: string; quantity: number }[] = [];
  const charges = new Map<number, number>();
  for (const s of SLOT_ORDER) fit.modules.filter((m) => m.slot === s).forEach((m, i) => {
    items.push({ type_id: m.type_id, flag: `${ESI_SLOT[s][0]}${i}`, quantity: 1 });
    if (m.charge_type_id) charges.set(m.charge_type_id, (charges.get(m.charge_type_id) ?? 0) + 1);
  });
  for (const d of fit.drones) items.push({ type_id: d.type_id, flag: 'DroneBay', quantity: d.quantity });
  for (const f of fit.fighters) items.push({ type_id: f.type_id, flag: 'FighterBay', quantity: f.quantity });
  for (const c of fit.cargo) items.push({ type_id: c.type_id, flag: 'Cargo', quantity: c.quantity });
  for (const [c, n] of charges) if (!fit.cargo.some((x) => x.type_id === c)) items.push({ type_id: c, flag: 'Cargo', quantity: n });
  return JSON.stringify({ name: fit.name, description: fit.notes ?? '', ship_type_id: fit.ship.type_id, items }, null, 2);
}

export function parseEsi(ds: Dataset, text: string, warnings: string[] = []): StructuredFit {
  const j = JSON.parse(text) as { name?: string; description?: string; ship_type_id: number; items: { type_id: number; flag: string | number; quantity: number }[] };
  if (!ds.isShip(j.ship_type_id)) throw new Error(`ESI: ${j.ship_type_id} is not a ship type`);
  const fit = emptyFit(j.ship_type_id, j.name || `${ds.name(j.ship_type_id, 'en')} (ESI)`);
  if (j.description) fit.notes = j.description;
  const slotOf = (flag: string | number): Slot | null => {
    for (const [s, [name, base]] of Object.entries(ESI_SLOT) as [Slot, [string, number]][]) {
      if (typeof flag === 'string' ? flag.startsWith(name) : flag >= base && flag < base + 8) return s;
    }
    return null;
  };
  const sorted = [...j.items].sort((a, b) => String(a.flag).localeCompare(String(b.flag), undefined, { numeric: true }));
  for (const it of sorted) {
    if (!ds.type(it.type_id)) { warnings.push(`unknown type ${it.type_id}`); continue; }
    const s = slotOf(it.flag);
    const k = ds.kind(it.type_id);
    if (s) fit.modules.push({ type_id: it.type_id, slot: s, state: defaultState(ds, it.type_id), charge_type_id: null });
    else if (it.flag === 'DroneBay' || it.flag === 87 || k === 'drone') fit.drones.push({ type_id: it.type_id, quantity: it.quantity, active: it.quantity });
    else if (it.flag === 'FighterBay' || it.flag === 158 || k === 'fighter') fit.fighters.push({ type_id: it.type_id, quantity: it.quantity, active: true });
    else fit.cargo.push({ type_id: it.type_id, quantity: it.quantity });
  }
  return fit;
}

/** Multibuy list (item totals for the in-game multibuy window): mutated modules count as base + mutaplasmid. */
export function exportMultibuy(ds: Dataset, fit: StructuredFit): string {
  const n = new Map<number, number>();
  const add = (id: number | null | undefined, q = 1) => { if (id) n.set(id, (n.get(id) ?? 0) + q); };
  add(fit.ship.type_id);
  for (const m of fit.modules) { add(m.mutation ? m.mutation.base_type_id : m.type_id); if (m.mutation) add(m.mutation.mutaplasmid_type_id); add(m.charge_type_id); }
  for (const d of fit.drones) add(d.type_id, d.quantity);
  for (const f of fit.fighters) add(f.type_id, f.quantity);
  for (const i of fit.implants) add(i);
  for (const b of fit.boosters) add(b.type_id);
  for (const c of fit.cargo) add(c.type_id, c.quantity);
  return [...n].map(([id, q]) => `${ds.name(id, 'en')} x${q}`).join('\n') + '\n';
}

export function detect(text: string): 'eft' | 'dna' | 'esi' {
  const t = text.trim();
  if (t.startsWith('{')) return 'esi';
  if (/^(fitting:)?\d+:/.test(t) || t.startsWith('<url=fitting:')) return 'dna';
  return 'eft';
}

const KIND = { eft: 'EFT', dna: 'DNA', esi: 'JSON' } as const;

/** The built-in implementation of the formats layer: the fallback when the exfa-formats WASM module is not
 *  available (local development without a Rust build, unit tests). */
export function builtinFormats(ds: Dataset): FitFormats {
  return {
    id: 'builtin-ts',
    label: 'built-in TypeScript parsers (EFT, DNA, ESI JSON; multibuy export)',
    importFormats: ['auto', 'eft', 'dna', 'esi'],
    exportFormats: ['eft', 'dna', 'esi', 'multibuy'],
    parse(text: string, format: ImportFormat = 'auto'): ParseResult {
      const f = format === 'auto' ? detect(text) : format;
      const warnings: string[] = [];
      const fits = f === 'esi' ? [parseEsi(ds, text.trim(), warnings)]
        : f === 'dna' ? [parseDna(ds, text, warnings)]
          : f === 'eft' ? splitEft(text).map((c) => parseEft(ds, c, warnings))
            : (() => { throw new Error(`format ${f} needs the exfa-formats module`); })();
      return { kind: KIND[f], fits, warnings };
    },
    export(input: ExportInput, format: ExportFormat, opts?: { slotTotals?: Partial<Record<Slot, number>> } & Record<string, unknown>): string {
      const fit = requestToStructured(ds, input.fit, input.name, input.notes);
      switch (format) {
        case 'eft': return exportEft(ds, fit, opts?.slotTotals as Partial<Record<Slot, number>> | undefined);
        case 'dna': return exportDna(fit);
        case 'esi': return exportEsi(fit);
        case 'multibuy': return exportMultibuy(ds, fit);
        default: throw new Error(`${format} export needs the exfa-formats module`);
      }
    },
  };
}
