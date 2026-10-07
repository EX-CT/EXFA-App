import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZH } from './i18n-zh';
import { setUiLang, t } from './i18n';
import { METRICS } from './fit/metrics';

const SRC = fileURLToPath(new URL('.', import.meta.url));
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? (f === 'test' ? [] : files(p)) : /\.tsx?$/.test(f) && !f.includes('.test.') && f !== 'i18n-zh.ts' ? [p] : [];
});
const sources = files(SRC).map((p) => ({ p: p.slice(SRC.length).replace(/\\/g, '/'), s: readFileSync(p, 'utf8') }));
const unq = (q: string) => q.slice(1, -1).replace(/\\(.)/g, '$1');

/** Keys used dynamically (t(variable)): label tables, enum values and templated keys. */
function dynamicKeys(): string[] {
  const keys = METRICS.map((m) => m.label);
  for (const { p, s } of sources) {
    // ['id', 'Label'] tuples in the UI label tables (graph kinds, slots, exports, market filters)
    if (/ui\/(Graphs|Fitting|ImportExport|Market)\.tsx$/.test(p)) for (const m of s.matchAll(/\[\s*'[a-z_]+'\s*,\s*'([^']+)'\s*[\],]/g)) { if (/[A-Z ]/.test(m[1])) keys.push(m[1]); }
    // engine violation labels and outgoing-rep rows (stats panel)
    if (/ui\/Stats\.tsx$/.test(p)) {
      for (const m of s.matchAll(/\b[A-Z_]{4,}: '([^']+)'/g)) keys.push(m[1]);
      for (const m of s.matchAll(/\['[a-z_]+', '([^']+)', '[^']+'\]/g)) keys.push(m[1]);
    }
    // price panel label tables (sections, sources, override targets) and "my prices" validation messages
    if (/ui\/PriceBox\.tsx$/.test(p)) for (const l of s.split('\n').filter((x) => /^const [A-Z_]+_LABEL\b/.test(x))) for (const m of l.matchAll(/\b[a-z_]+: '([^']+)'/g)) keys.push(m[1]);
    if (/data\/prices\.ts$/.test(p)) for (const m of s.matchAll(/return '([^']+)'/g)) keys.push(m[1]);
    // chart axis labels and series names (graph views)
    if (/(ui\/Graphs\.tsx|fit\/graphs\.ts)$/.test(p)) for (const m of s.matchAll(/\b(?:x|y|name): '([^']+)'/g)) if (/[A-Z %]/.test(m[1])) keys.push(m[1]);
  }
  keys.push(...['All', 'Ships', 'Modules', 'Charges', 'Drones', 'Fighters', 'Implants', 'Boosters']);
  for (const slot of ['high', 'mid', 'low', 'rig', 'subsystem', 'service']) keys.push(slot, `[empty ${slot} slot]`);
  keys.push('ship', 'module', 'charge', 'drone', 'fighter', 'implant', 'booster', 'skill', 'structure', 'other');
  keys.push('offline', 'online', 'active', 'overheated', 'em', 'thermal', 'kinetic', 'explosive', 'shield', 'armor', 'hull');
  keys.push('passive shield', 'shield repair', 'armor repair', 'hull repair', 'radar', 'ladar', 'magnetometric', 'gravimetric');
  keys.push('weapons', 'drones', 'total');
  keys.push('IndexedDB', 'localStorage', 'memory only', 'loading…'); // FitBrowser STORE_LABEL
  keys.push('neut_gj_s', 'web_pct', 'ecm_strength', 'damp_lock_range_pct', 'td_optimal_pct', 'gd_range_pct', 'tp_sig_pct');
  return keys;
}

describe('i18n zh-CN coverage', () => {
  it('web.unit.i18n-coverage: every t()/tr() literal and every dynamic label key has a zh-CN translation', () => {
    const used = new Set<string>();
    for (const { s } of sources) for (const m of s.matchAll(/\b(?:t|tr)\(\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\s*[,)]/g)) used.add(unq(m[1]));
    expect(used.size).toBeGreaterThan(200);
    for (const k of dynamicKeys()) used.add(k);
    const missing = [...used].filter((k) => !(k in ZH)).sort();
    expect(missing).toEqual([]);
    expect(Object.entries(ZH).filter(([, v]) => !v.trim()).map(([k]) => k)).toEqual([]);
  });

  it('web.unit.i18n-jsx-literals: no untranslated English text nodes or placeholder/title attributes in the UI', () => {
    const ALLOW = new Set(['EXFA Web', 'English', 'DPS', 'HP', 'EHP', '(crate exfa-formats-wasm)', '· LGPL-3.0-or-later', 'Promise']);
    const bad: string[] = [];
    for (const { p, s } of sources.filter((x) => x.p.endsWith('.tsx'))) {
      for (const m of s.matchAll(/>([^<>{}\n]*[A-Za-z]{3,}[^<>{}\n]*)</g)) {
        const txt = m[1].trim();
        if (!txt || /[;=()?:&|]/.test(txt) || ALLOW.has(txt) || /^(EX-CT\/)?(eve-[a-z-]+|EXFA-[A-Za-z-]+)$/.test(txt)) continue;
        bad.push(`${p}: >${txt}<`);
      }
      for (const m of s.matchAll(/\b(?:placeholder|title)="([^"]*[A-Za-z]{3,}[^"]*)"/g)) if (!/^https?:/.test(m[1])) bad.push(`${p}: "${m[1]}"`);
    }
    expect(bad).toEqual([]);
  });

  it('web.unit.i18n-switch: t() returns Chinese only in zh mode and falls back to the key', () => {
    setUiLang('zh');
    expect(t('Graphs')).toBe('图表');
    expect(t('What-if')).toBe('假设分析');
    expect(t('no such key')).toBe('no such key');
    setUiLang('en');
    expect(t('Graphs')).toBe('Graphs');
  });
});
