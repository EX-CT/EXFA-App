// Import and export content for the center dock. Fit text formats (EFT, DNA, ESI JSON, XML, multibuy) go through the
// Engine WASM RPC; documents and whole libraries use the format package: single .exfa.json documents, zip archives and
// picked folders all map through toFiles/fromFiles, and every JSON import goes through migrate + mergeLibrary.
import { useState } from 'react';
import { t } from '../i18n';
import { migrateFitDocument } from '@exfa/format';
import type { Dataset } from '../data/dataset';
import { uid, type FitDoc, type Library } from '../fit/model';
import type { FitStats } from '../engine/adapter';
import { mergeLibrary, parseBackup } from '../fit/library';
import { exportFit, exportShipstats, importFits, type ExportFormat } from '../formats';
import { isSqlite } from '../formats/pyfadb';
import { dirPickerSupported, docToFile, filesToLibrary, isZip, pickDir, readLibraryFromDir, unzipFiles, writeLibraryToDir, zipLibrary } from '../formats/zipfiles';
import { notify } from './notify';

const EXPORTS: [ExportFormat, string][] = [['eft', 'Export EFT'], ['dna', 'Export DNA'], ['esi', 'Export ESI JSON'], ['xml', 'Export XML'], ['multibuy', 'Export multibuy'], ['shipstats', 'Export ship stats']];

const download = (name: string, data: string | Uint8Array, type: string) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data as BlobPart], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
const today = () => new Date().toISOString().slice(0, 10);
/** exfa/library@1, eve-fit-web-library backup or exfa/fit@1 document (not an engine text format). */
const looksLikeJson = (s: string) => /^\s*\{/.test(s) && (s.includes('exfa/fit@1') || s.includes('exfa/library@1') || s.includes('eve-fit-web-library'));

export function ImportExport({ ds, fit, lib, stats, calc, onImport, onLib }: {
  ds: Dataset; fit: FitDoc | null; lib: Library; stats: FitStats | null; calc?: ((req: unknown) => Promise<unknown>) | null;
  onImport: (f: FitDoc) => void; onLib: (l: Library) => void;
}) {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Merge a library-shaped import and report `added/updated/skipped` (merge rule: newer modified wins). */
  const mergeIntoLib = (part: Parameters<typeof mergeLibrary>[1], what: string) => {
    const m = mergeLibrary(lib, part);
    onLib(m.lib);
    const text = `${what}: ${t('导入')} ${m.added.length}，${t('更新')} ${m.updated.length}，${t('跳过')} ${m.skipped.length}`;
    setMsg(text);
    notify({ kind: m.updated.length || m.skipped.length ? 'info' : 'ok', text });
  };

  const doImport = async (src: string, path?: string) => {
    setBusy(true);
    try {
      if (looksLikeJson(src)) {
        const j = JSON.parse(src);
        if (j?.format === 'exfa/fit@1') {
          const doc = migrateFitDocument(j, uid());
          onImport(doc);
          setMsg(`${t('Imported')} 1 ${t('fit(s)')} (exfa/fit@1)`);
        } else mergeIntoLib(parseBackup(src).lib, path ?? 'JSON');
        return;
      }
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
  const exportDoc = () => {
    if (!fit) return;
    const file = docToFile(fit);
    download(file.path.slice(file.path.lastIndexOf('/') + 1), file.text, 'application/json');
  };
  const exportZip = () => {
    download(`exfa-library-${today()}.zip`, zipLibrary(lib), 'application/zip');
    setMsg(`${t('exported')}: ${Object.keys(lib.fits).length} ${t('fit(s)')} (.zip)`);
  };
  const exportDir = async () => {
    try {
      const dir = await pickDir('readwrite');
      const n = await writeLibraryToDir(lib, dir);
      setMsg(`${t('exported')}: ${n} ${t('files')} → ${dir.name ?? ''}`);
    } catch (e) { if ((e as DOMException).name !== 'AbortError') setMsg((e as Error).message); }
  };
  const importDir = async () => {
    try {
      const dir = await pickDir('read');
      const files = await readLibraryFromDir(dir);
      if (!files.length) { setMsg(t('No .exfa.json files found in that folder.')); return; }
      mergeIntoLib(filesToLibrary(files), dir.name ?? t('folder'));
    } catch (e) { if ((e as DOMException).name !== 'AbortError') setMsg((e as Error).message); }
  };
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (isSqlite(bytes)) { setMsg(t('This is a database (Pyfa saveddata.db): import it in Fits → Import / restore files…')); return; }
      if (isZip(bytes)) { mergeIntoLib(filesToLibrary(unzipFiles(bytes)), file.name); return; }
      await doImport(new TextDecoder().decode(bytes), file.name);
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div className="import-export">
      <textarea className="eft" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Paste a fit (EFT, DNA, ESI JSON, EVE XML, EFT config, .exfa.json …) and press Import.')} />
      <div className="row">
        <button onClick={() => void doImport(text)} disabled={busy || !text.trim()}>{t('Import')}</button>
        <button className="paste-clipboard" title={t('Read a fit from the clipboard and import it')} onClick={() => navigator.clipboard?.readText().then((c) => { setText(c); if (c.trim()) void doImport(c); else setMsg(t('the clipboard is empty')); }, () => setMsg(t('clipboard not readable: paste into the box above')))}>{t('Import from clipboard')}</button>
        <label className="filebtn">{t('Import file…')} <input type="file" className="importfile" accept=".xml,.cfg,.txt,.json,.eft,.db,.zip" onChange={(e) => void onFile(e.target.files?.[0])} /></label>
        {dirPickerSupported() && <button className="import-dir" onClick={() => void importDir()} title={t('Import every .exfa.json document from a picked folder')}>{t('Import folder…')}</button>}
      </div>
      <div className="row">
        {EXPORTS.map(([format, label]) => <button key={format} className={`export-${format}`} disabled={busy || !fit} onClick={() => void doExport(format)}>{t(label)}</button>)}
        <button disabled={busy || !fit} onClick={() => void share()}>{t('Share link')}</button>
      </div>
      <div className="row">
        <button className="export-exfa" disabled={!fit} title={t('Current fit as an exfa/fit@1 document')} onClick={exportDoc}>{t('Export .exfa.json')}</button>
        <button className="export-zip" title={t('Whole library as a zip (folder structure from format toFiles)')} onClick={exportZip}>{t('Export library (.zip)')}</button>
        {dirPickerSupported() && <button className="export-dir" title={t('Write the library into a picked folder (format toFiles layout)')} onClick={() => void exportDir()}>{t('Export to folder…')}</button>}
      </div>
      <p className="hint formats-provider" data-provider="engine-wasm">{t('Formats are provided by Engine v0.2.0 WASM RPC.')}</p>
      {busy && <span className="muted">{t('engine computing…')}</span>}
      {msg && <p className="muted">{msg}</p>}
      <span className="sr-only" aria-hidden>{stats?.meta?.engine ?? ''}</span>
    </div>
  );
}
