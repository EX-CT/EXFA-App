// Unit-test helpers for the mini dataset (tools/make-test-dataset.mjs).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { Dataset } from '../data/dataset';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
let ds: Dataset | null = null;
export function miniDataset(): Dataset {
  return (ds ??= new Dataset(JSON.parse(gunzipSync(readFileSync(here('./fixtures/mini-dataset.json.gz'))).toString())));
}
export const id = (name: string) => { const x = miniDataset().byExactName(name); if (x == null) throw new Error(`fixture lacks ${name}`); return x; };
