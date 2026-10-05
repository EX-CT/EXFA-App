import { describe, expect, it } from 'vitest';
import { loadPriceSettings, overrideProblem, parseSnapshot, PRICE_SETTINGS_KEY, savePriceSettings, setTypePrice } from './prices';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };
const gzip = async (s: string) => new Uint8Array(await new Response(new Blob([s]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());

describe('my prices', () => {
  it('web.unit.my-prices-validation: docs/23 override shape (one target, one of price / multiplier, values >= 0)', () => {
    expect(overrideProblem({ type_id: 587, price: 0 })).toBeNull();
    expect(overrideProblem({ market_group_id: 9, multiplier: 0.9 })).toBeNull();
    expect(overrideProblem({ price: 1 })).toMatch(/target/);
    expect(overrideProblem({ type_id: 1, group_id: 2, price: 1 })).toMatch(/target/);
    expect(overrideProblem({ type_id: 1 })).toMatch(/price \/ multiplier/);
    expect(overrideProblem({ type_id: 1, price: 1, multiplier: 2 })).toMatch(/price \/ multiplier/);
    expect(overrideProblem({ type_id: 1, price: -1 })).toMatch(/>= 0/);
    expect(overrideProblem({ type_id: 1.5, price: 1 })).toMatch(/positive integer/);
  });
  it('web.unit.my-prices-storage: overrides and the update toggle round-trip through localStorage; invalid entries dropped', () => {
    const s = mem();
    expect(loadPriceSettings(s)).toEqual({ mine: [], update: false });
    let ps = setTypePrice({ mine: [], update: true }, 21898, 0);
    ps = setTypePrice(ps, 587, 1000);
    ps = setTypePrice(ps, 21898, 5); // replaces
    savePriceSettings({ ...ps, mine: [...ps.mine, { category_id: 6, multiplier: 1.1 }] }, s);
    expect(loadPriceSettings(s)).toEqual({ mine: [{ type_id: 587, price: 1000 }, { type_id: 21898, price: 5 }, { category_id: 6, multiplier: 1.1 }], update: true });
    expect(setTypePrice(ps, 587, null).mine).toEqual([{ type_id: 21898, price: 5 }]);
    s.setItem(PRICE_SETTINGS_KEY, JSON.stringify({ mine: [{ type_id: 1 }, { group_id: 2, price: 3, note: 'x' }], update: 'yes' }));
    expect(loadPriceSettings(s)).toEqual({ mine: [{ group_id: 2, price: 3 }], update: false });
    s.setItem(PRICE_SETTINGS_KEY, '{broken');
    expect(loadPriceSettings(s)).toEqual({ mine: [], update: false });
  });
});

describe('price snapshot', () => {
  const snap = { schema: 'eve-price-snapshot', schema_version: 1, snapshot_id: 'jita44-20261003T070857Z', market_time: '2026-10-03T07:08:57Z', types: { 587: { price: 1 }, 34: { price: null } } };
  it('web.unit.price-snapshot-parse: eve-price-snapshot v1, gzip or plain; other files rejected', async () => {
    const a = await parseSnapshot(await gzip(JSON.stringify(snap)));
    expect([a.id, a.market_time, a.types]).toEqual(['jita44-20261003T070857Z', '2026-10-03T07:08:57Z', 2]);
    expect((await parseSnapshot(new TextEncoder().encode(JSON.stringify(snap)))).id).toBe(snap.snapshot_id);
    await expect(parseSnapshot(new TextEncoder().encode(JSON.stringify({ ...snap, schema_version: 2 })))).rejects.toThrow(/v1/);
    await expect(parseSnapshot(new TextEncoder().encode(JSON.stringify({ isk: {} })))).rejects.toThrow(/v1/);
  });
});
