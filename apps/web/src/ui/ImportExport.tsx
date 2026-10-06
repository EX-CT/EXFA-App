// Import and export content for the center dock. All format operations use the Engine WASM RPC.
import { useState } from 'react';
import { t } from '../i18n';
import type { Dataset } from '../data/dataset';
import type { Fit, Library } from '../fit/model';
import type { FitStats } from '../engine/adapter';
import { exportFit, exportShipstats, importFits, type ExportFormat } from '../formats';
import { isSqlite } from '../formats/pyfadb';

const EXPORTS: [ExportFormat, string][] = [['eft', 'Export EFT'], ['dna', 'Export DNA'], ['esi', 'Export ESI JSON'], ['xml', 'Export XML'], ['multibuy', 'Export multibuy'], ['shipstats', 'Export ship stats']];

export function ImportExport({ ds, fit, lib, stats, calc, onImport }: {
  ds: Dataset; fit: Fit | null; lib: Library; stats: FitStats | null; calc?: ((req: unknown) => Promise<unknown>) | null;
  onImport: (f: Fit) => void;
}) {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const doImport = async (src: string, path?: string) => {
    setBusy(true);
    try {
      const r = await importFits(ds, src, 'auto', path);
      for (const f of r.fits) onImport(f);
      setMsg(`${t('Imported')} ${r.fits.length} ${t('fit(s)')} (${r.kind})${r.warnings.length ? ` ${t('with warnings')}: ${r.warnings.join('; ')}` : ''}`);
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  };
  const show = (s: string) => {
    setText(s); setMsg(null);
    navigator.clipboard?.writeText(s).then(() => setMsg(t('copied to clipboard')), () => setMsg(t('select and copy the text above')));
  };
  const doExport = async (format: ExportFormat) => {
    if (!fit) return;
    setBusy(true);
    try {
      if (format === 'shipstats') {
        if (!calc) throw new Error(t('engine not ready'));
        show(await exportShipstats(ds, fit, lib, calc));
      } else show(await exportFit(ds, fit, lib, format, { stats }));
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  };
  const share = async () => {
    if (!fit) return;
    try {
      const dna = await exportFit(ds, fit, lib, 'dna');
      show(`${location.origin}${location.pathname}?dna=${encodeURIComponent(dna)}`);
    } catch (e) { setMsg((e as Error).message); }
  };
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (isSqlite(bytes)) { setMsg(t('This is a database (Pyfa saveddata.db): import it in Fits → Import / restore files…')); return; }
    await doImport(new TextDecoder().decode(bytes), file.name);
  };
  return (
    <div className="import-export">
      <textarea className="eft" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Paste a fit (EFT, DNA, ESI JSON, EVE XML, EFT config …) and press Import.')} />
      <div className="row">
        <button onClick={() => void doImport(text)} disabled={busy || !text.trim()}>{t('Import')}</button>
        <button className="paste-clipboard" title={t('Read a fit from the clipboard and import it')} onClick={() => navigator.clipboard?.readText().then((c) => { setText(c); if (c.trim()) void doImport(c); else setMsg(t('the clipboard is empty')); }, () => setMsg(t('clipboard not readable: paste into the box above')))}>{t('Import from clipboard')}</button>
        <label className="filebtn">{t('Import file…')} <input type="file" className="importfile" accept=".xml,.cfg,.txt,.json,.eft,.db" onChange={(e) => void onFile(e.target.files?.[0])} /></label>
        {EXPORTS.map(([format, label]) => <button key={format} className={`export-${format}`} disabled={busy || !fit} onClick={() => void doExport(format)}>{t(label)}</button>)}
        <button disabled={busy || !fit} onClick={() => void share()}>{t('Share link')}</button>
      </div>
      <p className="hint formats-provider" data-provider="engine-wasm">{t('Formats are provided by Engine v0.2.0 WASM RPC.')}</p>
      {busy && <span className="muted">{t('engine computing…')}</span>}
      {msg && <p className="muted">{msg}</p>}
      <span className="sr-only" aria-hidden>{stats?.meta?.engine ?? ''}</span>
    </div>
  );
}
