// Prices are computed by the engine (EXFA-Docs docs/23): request `price_overrides` (here: the user's local "my prices"),
// the engine session's injected market snapshot (`prices_load`; here: the latest EXFA-Data release, opt-in)
// and the snapshot embedded in the engine (Jita). The site only stores the settings and fetches the snapshot file.

/** docs/23 §5.1 price override: exactly one target, exactly one of `price` (fixed ISK) / `multiplier`. */
export interface PriceOverride { type_id?: number; market_group_id?: number; group_id?: number; category_id?: number; price?: number; multiplier?: number }
export type OverrideTarget = 'type_id' | 'market_group_id' | 'group_id' | 'category_id';
export const TARGETS: OverrideTarget[] = ['type_id', 'market_group_id', 'group_id', 'category_id'];

/** "My prices": local overrides (e.g. self-produced items = 0) and whether to inject the latest market snapshot. */
export interface PriceSettings { mine: PriceOverride[]; update: boolean }

export const PRICE_SETTINGS_KEY = 'eve-fit-web-my-prices';
const EMPTY: PriceSettings = { mine: [], update: false };

const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
export const overrideTarget = (o: PriceOverride): OverrideTarget | null => {
  const t = TARGETS.filter((k) => o[k] != null);
  return t.length === 1 ? t[0] : null;
};
/** null if the entry is a valid docs/23 override, else the problem. */
export function overrideProblem(o: PriceOverride): string | null {
  const t = overrideTarget(o);
  if (!t) return 'needs exactly one target (type, market group, group or category)';
  if (!Number.isInteger(o[t]) || (o[t] as number) <= 0) return 'target id must be a positive integer';
  if ((o.price != null) === (o.multiplier != null)) return 'needs exactly one of price / multiplier';
  const v = o.price ?? o.multiplier;
  if (!num(v) || (v as number) < 0) return 'value must be a number >= 0';
  return null;
}
const clean = (o: PriceOverride): PriceOverride => {
  const t = overrideTarget(o)!;
  return { [t]: o[t], ...(o.price != null ? { price: o.price } : { multiplier: o.multiplier }) } as PriceOverride;
};

export function loadPriceSettings(store: Pick<Storage, 'getItem'> = localStorage): PriceSettings {
  try {
    const j = JSON.parse(store.getItem(PRICE_SETTINGS_KEY) ?? 'null');
    if (!j || typeof j !== 'object') return { ...EMPTY };
    const mine = Array.isArray(j.mine) ? (j.mine as PriceOverride[]).filter((o) => o && !overrideProblem(o)).map(clean) : [];
    return { mine, update: j.update === true };
  } catch { return { ...EMPTY }; }
}
export function savePriceSettings(s: PriceSettings, store: Pick<Storage, 'setItem'> = localStorage) {
  try { store.setItem(PRICE_SETTINGS_KEY, JSON.stringify({ mine: s.mine.filter((o) => !overrideProblem(o)).map(clean), update: s.update })); } catch { /* quota */ }
}
/** Set (or replace) the fixed price of one type; `null` removes the type's override. */
export function setTypePrice(s: PriceSettings, typeId: number, price: number | null): PriceSettings {
  const mine = s.mine.filter((o) => o.type_id !== typeId);
  return { ...s, mine: price == null ? mine : [...mine, { type_id: typeId, price }] };
}

// ---- latest EXFA-Data snapshot (eve-price-snapshot v1, gzip JSON) ----

/** Deployed with the site by CI from the latest https://github.com/EX-CT/EXFA-Data release (release assets
 *  are not CORS-readable from a browser, so the site serves its own copy, refreshed by an hourly rebuild). */
export const SNAPSHOT_URL = `${import.meta.env?.BASE_URL ?? '/'}prices/latest.json.gz`;
export const SNAPSHOT_RELEASES = 'https://github.com/EX-CT/EXFA-Data/releases';
/** While "update prices" is on the client re-polls SNAPSHOT_URL on this interval. */
export const PRICE_REFRESH_MS = 60 * 60 * 1000;

export interface Snapshot { data: Record<string, any>; id: string; market_time: string; types: number }

/** Parse an eve-price-snapshot v1 file (gzip or plain JSON bytes). */
export async function parseSnapshot(bytes: Uint8Array): Promise<Snapshot> {
  let text: string;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const s = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    text = await new Response(s).text();
  } else text = new TextDecoder().decode(bytes);
  const data = JSON.parse(text);
  if (data?.schema !== 'eve-price-snapshot' || String(data.schema_version) !== '1') throw new Error('not an eve-price-snapshot v1 file');
  if (!data.types || typeof data.types !== 'object') throw new Error('snapshot has no types');
  return { data, id: String(data.snapshot_id ?? ''), market_time: String(data.market_time ?? ''), types: Object.keys(data.types).length };
}

let cache: { url: string; p: Promise<Snapshot> } | null = null;
/** Fetch the deployed snapshot; `fresh` bypasses the module cache (hourly re-poll, manual refresh). */
export function fetchLatestSnapshot(url = SNAPSHOT_URL, fresh = false): Promise<Snapshot> {
  const load = async () => {
    const u = fresh ? `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}` : url;
    const r = await fetch(u, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`price snapshot: HTTP ${r.status}`);
    return parseSnapshot(new Uint8Array(await r.arrayBuffer()));
  };
  if (fresh) return load();
  if (cache?.url === url) return cache.p;
  const p = load();
  cache = { url, p };
  return p.catch((e) => { if (cache?.p === p) cache = null; throw e; });
}
