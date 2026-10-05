import { describe, expect, it } from 'vitest';
import { newFit, type Library } from './model';
import { allFolders, allTags, deleteFits, deleteFolder, duplicateFit, makeBackup, mergeLibrary, moveFits, parseBackup, renameFit, renameFolder, searchFits, tagFits } from './library';
import { BUILTIN_CHARACTERS } from '../data/presets';
import { id, miniDataset } from '../test/fixture';

const ds = miniDataset();
function lib(): Library {
  const a = { ...newFit(id('Rifter'), 'Brawler'), id: 'a', folder: 'PvP/Frigates', tags: ['solo'] };
  const b = { ...newFit(id('Vexor'), 'Ratter'), id: 'b', folder: 'PvE', notes: 'for anomalies' };
  const c = { ...newFit(id('Merlin'), 'Kiter'), id: 'c' };
  b.projected = [{ kind: 'fit', fit_id: 'a', amount: 1, distance_m: null }];
  b.fleet = { booster_fit_ids: ['c'], buffs: [] };
  return { fits: { a, b, c }, characters: Object.fromEntries(BUILTIN_CHARACTERS.map((x) => [x.id, x])), damagePatterns: {}, targetProfiles: {}, folders: ['Empty'] };
}

describe('fit/library', () => {
  it('web.unit.library-folders: folder list with parents; renaming moves subfolders and fits; deleting moves fits up', () => {
    const l = lib();
    expect(allFolders(l)).toEqual(['Empty', 'PvE', 'PvP', 'PvP/Frigates']);
    const r = renameFolder(l, 'PvP', 'Small gang');
    expect(r.fits.a.folder).toBe('Small gang/Frigates');
    expect(r.fits.a.modified).toBeTruthy();
    const d = deleteFolder(l, 'PvP/Frigates');
    expect(d.fits.a.folder).toBe('PvP');
    expect(Object.keys(d.fits)).toHaveLength(3);
    expect(moveFits(l, ['c'], ' New / Sub ').fits.c.folder).toBe('New/Sub');
    expect(moveFits(l, ['c'], 'New/Sub').folders).toContain('New/Sub');
  });
  it('web.unit.library-search-tags: search by name, ship (English), folder, notes and tag:<name>; tags normalised', () => {
    const l = tagFits(lib(), ['a', 'b'], ['pvp', ' solo '], []);
    expect(l.fits.a.tags).toEqual(['pvp', 'solo']);
    expect(allTags(l)).toEqual(['pvp', 'solo']);
    const names = (q: string) => searchFits(ds, l, q).map((f) => f.name).sort();
    expect(names('vexor')).toEqual(['Ratter']);
    expect(names('anomalies')).toEqual(['Ratter']);
    expect(names('frigates brawl')).toEqual(['Brawler']);
    expect(names('tag:solo')).toEqual(['Brawler', 'Ratter']);
    expect(names('tag:solo rifter')).toEqual(['Brawler']);
    expect(tagFits(l, ['a'], [], ['solo']).fits.a.tags).toEqual(['pvp']);
  });
  it('web.unit.library-rename-duplicate-delete: rename, duplicate (new id, folder and tags kept), delete drops links to the fit', () => {
    const l = lib();
    expect(renameFit(l, 'a', '  ').fits.a.name).toBe('Brawler');
    expect(renameFit(l, 'a', 'Renamed').fits.a.name).toBe('Renamed');
    const d = duplicateFit(l.fits.a);
    expect(d.id).not.toBe('a');
    expect([d.name, d.folder, d.tags]).toEqual(['Brawler (copy)', 'PvP/Frigates', ['solo']]);
    const x = deleteFits(l, ['a', 'c']);
    expect(Object.keys(x.fits)).toEqual(['b']);
    expect(x.fits.b.projected).toEqual([]);
    expect(x.fits.b.fleet.booster_fit_ids).toEqual([]);
  });
  it('web.unit.library-backup-merge: JSON backup v2 (no built-ins), v1 backups still restore, restoring twice adds nothing, colliding ids are remapped with their links', () => {
    const l = lib();
    const bk = makeBackup(l, [{ name: 'set' }]);
    expect(bk.version).toBe(2);
    expect(Object.keys(bk.lib.characters)).toEqual([]);
    const back = parseBackup(JSON.stringify(bk));
    expect(back.lib.folders).toEqual(['Empty']);
    expect(mergeLibrary(l, back.lib).added).toEqual([]);
    const v1 = parseBackup(JSON.stringify({ format: 'eve-fit-web-library', version: 1, lib: { fits: { a: { ...l.fits.a, name: 'Other' } } } }));
    expect(v1.lib.characters).toEqual({});
    const m = mergeLibrary(l, { fits: { a: v1.lib.fits.a, b: { ...l.fits.b, name: 'Ratter 2' } } });
    expect(m.added).toHaveLength(2);
    const nb = m.lib.fits[m.added[1]];
    expect(nb.projected[0].fit_id).toBe(m.added[0]);
    expect(Object.keys(m.lib.fits)).toHaveLength(5);
    expect(() => parseBackup('{"x":1}')).toThrow(/not an eve-fit-web backup/);
  });
});
