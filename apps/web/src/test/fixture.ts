// Unit-test helpers: the mini dataset (tools/make-test-dataset.mjs) and, when built, the exfa-formats module.
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { Dataset } from '../data/dataset';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
let ds: Dataset | null = null;
export function miniDataset(): Dataset {
  return (ds ??= new Dataset(JSON.parse(gunzipSync(readFileSync(here('./fixtures/mini-dataset.json.gz'))).toString())));
}
export const id = (name: string) => { const x = miniDataset().byExactName(name); if (x == null) throw new Error(`fixture lacks ${name}`); return x; };

/** public/engines/f/exfa_formats_wasm.wasm (built from the engines.lock pin), or EXFA_FORMATS_WASM. */
export const FORMATS_WASM = process.env.EXFA_FORMATS_WASM ?? here('../../public/engines/f/exfa_formats_wasm.wasm');
export const hasFormatsWasm = existsSync(FORMATS_WASM);
/** CI sets REQUIRE_FORMATS_WASM=1 so the formats-module tests cannot silently skip. */
export const requireFormatsWasm = process.env.REQUIRE_FORMATS_WASM === '1';
export const formatsWasmBytes = () => readFileSync(FORMATS_WASM);
