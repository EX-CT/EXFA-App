// exfa-formats WASM (EX-CT/EXFA-Engine crate exfa-formats-wasm, same pin as engine F in engines.lock): C ABI
// alloc / dealloc / rpc with the engine's JSONL RPC protocol. Methods format_import {text, format, path?} ->
// {kind, fits: [FitRequest + name/notes]} and format_export {fit, name, format, options, stats?} -> {text}.
// Calls are synchronous and fast (no engine inside), so the module runs on the main thread.
import type { Dataset } from '../data/dataset';
import { splitEft } from './builtin';
import { requestToStructured } from './convert';
import type { ExportFormat, ExportInput, ExportOptions, FitFormats, ImportFormat, ParseResult } from './types';

export type RpcFn = (method: string, params: unknown) => any;

export async function loadFormatsRpc(url: string | ArrayBuffer | Uint8Array): Promise<RpcFn> {
  const inst = typeof url === 'string'
    ? await WebAssembly.instantiateStreaming(fetch(url), {}).catch(async () => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`formats module ${url}: HTTP ${r.status}`);
      return WebAssembly.instantiate(await r.arrayBuffer(), {});
    })
    : await WebAssembly.instantiate(url as BufferSource, {});
  const x: any = inst.instance.exports;
  if (typeof x.rpc !== 'function' || typeof x.alloc !== 'function') throw new Error('not an exfa-formats module (no rpc/alloc export)');
  const enc = new TextEncoder(), dec = new TextDecoder();
  let seq = 0;
  return (method, params) => {
    const inp = enc.encode(JSON.stringify({ id: ++seq, method, params }));
    const p = x.alloc(inp.length);
    new Uint8Array(x.memory.buffer, p, inp.length).set(inp);
    const r: bigint = x.rpc(p, inp.length);
    x.dealloc(p, inp.length);
    const op = Number(r >> 32n), ol = Number(r & 0xffffffffn);
    const out = dec.decode(new Uint8Array(x.memory.buffer, op, ol));
    x.dealloc(op, ol);
    const resp = JSON.parse(out);
    return resp.result ?? resp.error ?? null;
  };
}

const errMsg = (r: any) => `${r.error.code}: ${r.error.message ?? ''}`.trim();

export function wasmFormats(ds: Dataset, rpc: RpcFn, label = 'exfa-formats (WASM)'): FitFormats {
  return {
    id: 'exfa-formats',
    label,
    importFormats: ['auto', 'eft', 'dna', 'dna_alt', 'dna_link', 'esi', 'xml', 'eftcfg'],
    exportFormats: ['eft', 'dna', 'esi', 'xml', 'multibuy', 'shipstats'],
    parse(text: string, format: ImportFormat = 'auto', path?: string): ParseResult {
      // several EFT fits pasted at once (Pyfa multi-export): format_import reads one EFT fit, so split on the headers
      const chunks = format === 'auto' || format === 'eft' ? splitEft(text) : [text];
      const warnings: string[] = [];
      const fits: ParseResult['fits'] = [];
      let kind = '';
      for (const c of chunks) {
        const r = rpc('format_import', { text: c, format: chunks.length > 1 ? 'eft' : format, ...(path ? { path } : {}) });
        if (!r || r.error) throw new Error(r ? errMsg(r) : 'formats module returned nothing');
        if (!r.fits) throw new Error(`${r.kind ?? 'input'}: an item list, not a fit (${(r.items ?? []).length} items)`);
        kind = r.kind;
        for (const f of r.fits) fits.push(requestToStructured(ds, f, f.name, f.notes, warnings));
      }
      return { kind, fits, warnings };
    },
    export(input: ExportInput, format: ExportFormat, opts?: ExportOptions): string {
      const r = rpc('format_export', { fit: input.fit, name: input.name, format, ...(opts ? { options: opts } : {}), ...(input.stats ? { stats_json: JSON.stringify(input.stats) } : {}) });
      if (!r || r.error) throw new Error(r ? errMsg(r) : 'formats module returned nothing');
      return r.text;
    },
  };
}
