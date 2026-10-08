import { describe, expect, it } from 'vitest';
import { emptyLibrary, newFit } from '../fit/model';
import { mergeLibrary } from '../fit/library';
import { docToFile, filesToLibrary, isZip, libraryToFiles, unzipFiles, zipLibrary } from './zipfiles';

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
  it('web.unit.zipfiles-docfile: a single document exports as <name>.<id>.exfa.json under its folder', () => {
    const f = docToFile({ ...newFit(587, 'My Fit'), id: 'x9', folder: 'A/B' });
    expect(f.path).toBe('A/B/My Fit.x9.exfa.json');
    const parsed = JSON.parse(f.text);
    expect(parsed.format).toBe('exfa/fit@1');
    expect(parsed.folder).toBeUndefined(); // folder lives in the path, not the document
    expect(filesToLibrary([f]).fits.x9.folder).toBe('A/B');
  });
});
