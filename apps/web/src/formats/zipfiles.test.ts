import { describe, expect, it } from 'vitest';
import { emptyLibrary, newFit } from '../fit/model';
import { mergeLibrary } from '../fit/library';
import { docToFile, filesToLibrary, isZip, libraryToFiles, splitPackages, unzipFiles, zipLibrary } from './zipfiles';

const lib = () => {
  const a = { ...newFit(587, 'Brawler'), id: 'a', folder: 'PvP/Frigates', modified: '2026-06-01T00:00:00.000Z' };
  const b = { ...newFit(626, 'Ratter'), id: 'b', folder: '', modified: '2026-06-01T00:00:00.000Z' };
  return { ...emptyLibrary(), fits: { a, b }, folders: ['PvP', 'PvP/Frigates'], fleets: { fl: { id: 'fl', name: 'Fleet A', folder: 'PvP', members: [{ fit_id: 'a', role: 'command' as const }] } } };
};

describe('formats/zipfiles', () => {
  it('web.unit.zipfiles-roundtrip: library -> toFiles -> zip -> unzip -> fromFiles keeps fits, folders and fleets', () => {
    const files = libraryToFiles(lib());
    expect(files.map((f) => f.path)).toContain('library.exfa.json');
    const docPaths = files.filter((f) => f.path !== 'library.exfa.json').map((f) => f.path);
    expect(docPaths.some((p) => p.includes('PvP/Frigates/'))).toBe(true);
    expect(docPaths.some((p) => /^[^/]+\.exfa\.json$/.test(p))).toBe(true);
    const zip = zipLibrary(lib());
    expect(isZip(zip)).toBe(true);
    const back = filesToLibrary(unzipFiles(zip));
    expect(back.format).toBe('exfa/library@1');
    expect(Object.keys(back.fits).sort()).toEqual(['a', 'b']);
    expect(back.fits.a.folder).toBe('PvP/Frigates');
    expect(back.fits.b.folder ?? '').toBe('');
    expect(back.fleets.fl.members).toEqual([{ fit_id: 'a', role: 'command' }]);
    // and the round-trip merges cleanly: same content is skipped
    const m = mergeLibrary(lib(), back);
    expect(m.added).toEqual([]);
    expect(m.skipped.sort()).toEqual(['a', 'b']);
  });
  it('web.unit.zipfiles-docfile: a single document exports as an exfa/package@1 file under its folder', () => {
    const l = { ...lib(), fits: { x9: { ...newFit(587, 'My Fit'), id: 'x9', folder: 'A/B' } } };
    const f = docToFile(l, l.fits.x9);
    expect(f.path).toBe('A/B/My Fit.x9.exfa.json');
    const parsed = JSON.parse(f.text);
    expect(parsed.format).toBe('exfa/package@1');
    expect(parsed.root).toEqual({ kind: 'fit', id: 'x9' });
    expect(parsed.library.fits.x9.name).toBe('My Fit');
    expect(parsed.library.fits.x9.folder).toBe('A/B');
    // import side: splitPackages routes it through mergePackage, not fromFiles
    const { packages, files } = splitPackages([f]);
    expect(packages).toHaveLength(1);
    expect(files).toHaveLength(0);
  });
});
