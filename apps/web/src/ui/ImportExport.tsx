// Import / export dialog. All text goes through the formats layer (src/formats): exfa-formats WASM when loaded,
// else the built-in parsers. Imports become structured fits before any engine call.
import { useState } from 'react';
import { t } from '../i18n';
import type { Dataset } from '../data/dataset';
import type { Fit, Library } from '../fit/model';
import type { FitStats } from '../engine/adapter';
import { exportFit, exportShipstats, formats, formatsStatus, importFits, type ExportFormat } from '../formats';
import { isSqlite } from '../formats/pyfadb';

const EXPORTS: [ExportFormat, string][] = [['eft', 'Export EFT'], ['dna', 'Export DNA'], ['esi', 'Export ESI JSON'], ['xml', 'Export XML'], ['multibuy', 'Export multibuy'], ['shipstats', 'Export ship stats']];

export function ImportExport({ ds, fit, lib, stats, calc, onImport, onClose }: {
  ds: Dataset; fit: Fit | null; lib: Library; stats: FitStats | null; calc?: ((req: unknown) => Promise<unknown>) | null;
  onImport: (f: Fit) => void; onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const fm = formats(ds);
  const st = formatsStatus();
  const totals = Object.fromEntries(Object.entries(stats?.resources?.slots ?? {}).map(([k, v]: any) => [k, v.total]));
  const doImport = (src: string, path?: string) => {
    try {
      // structured fits from the formats layer (several for a Pyfa multi-export or an XML file)
      const r = importFits(ds, src, 'auto', path);
      for (const f of r.fits) onImport(f);
      setMsg(`${t('Imported')} ${r.fits.length} ${t('fit(s)')} (${r.kind})${r.warnings.length ? ` ${t('with warnings')}: ${r.warnings.join('; ')}` : ''}`);
    } catch (e) { setMsg((e as Error).message); }
  };
  const show = (s: string) => { setText(s); setMsg(null); navigator.clipboard?.writeText(s).then(() => setMsg(t('copied to clipboard')), () => setMsg(t('select and copy the text above'))); };
  const doExport = async (f: ExportFormat) => {
    if (!fit) return;
    try {
      if (f === 'shipstats') {
        if (!calc) throw new Error(t('engine not ready'));
        show(await exportShipstats(ds, fit, lib, calc));
      } else show(exportFit(ds, fit, lib, f, { slotTotals: totals }));
    } catch (e) { setMsg((e as Error).message); }
  };
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    // a Pyfa saved-fits database brings characters, profiles and links too: it is imported by the fit library
    if (isSqlite(bytes)) { setMsg(t('This is a database (Pyfa saveddata.db): import it in Fits → Import / restore files…')); return; }
    doImport(new TextDecoder().decode(bytes), file.name);
  };
  return (
    <div className="modal" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>{t('Import / export')}</h2>
        <textarea className="eft" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Paste a fit (EFT, DNA, ESI JSON, EVE XML, EFT config …) and press Import.')} />
        <div className="row">
          <button onClick={() => doImport(text)} disabled={!text.trim()}>{t('Import')}</button>
          <button className="paste-clipboard" title={t('Read a fit from the clipboard and import it')} onClick={() => navigator.clipboard?.readText().then((c) => { setText(c); if (c.trim()) doImport(c); else setMsg(t('the clipboard is empty')); }, () => setMsg(t('clipboard not readable: paste into the box above')))}>{t('Import from clipboard')}</button>
          <label className="filebtn">{t('Import file…')} <input type="file" className="importfile" accept=".xml,.cfg,.txt,.json,.eft,.db" onChange={(e) => onFile(e.target.files?.[0])} /></label>
          {EXPORTS.filter(([f]) => fm.exportFormats.includes(f)).map(([f, l]) => <button key={f} className={`export-${f}`} disabled={!fit} onClick={() => doExport(f)}>{t(l)}</button>)}
          <button disabled={!fit} onClick={() => fit && show(`${location.origin}${location.pathname}?dna=${encodeURIComponent(exportFit(ds, fit, lib, 'dna'))}`)}>{t('Share link')}</button>
          <button onClick={onClose}>{t('Close')}</button>
        </div>
        <p className="hint formats-provider" data-provider={st.provider}>{t('Formats')}: {st.label}{st.note ? ` (${st.note})` : ''}</p>
        {msg && <p className="muted">{msg}</p>}
      </div>
    </div>
  );
}
