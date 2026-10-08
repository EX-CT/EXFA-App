import { describe, expect, it } from 'vitest';
import { emptyLibrary, newFit, type Library } from './model';
import { allFolders, allTags, deleteFits, deleteFleet, deleteFolder, duplicateFit, fleetsOf, joinFleet, leaveFleets, makeBackup, mergeLibrary, moveFleet, moveFits, parseBackup, renameFit, renameFolder, searchFits, setFleetRole, tagFits } from './library';
import { BUILTIN_CHARACTERS } from '../data/presets';
import { id, miniDataset } from '../test/fixture';

const ds = miniDataset();
function lib(): Library {
  const a = { ...newFit(id('Rifter'), 'Brawler'), id: 'a', folder: 'PvP/Frigates', tags: ['solo'], modified: '2026-06-01T00:00:00.000Z' };
  const b = { ...newFit(id('Vexor'), 'Ratter'), id: 'b', folder: 'PvE', notes: 'for anomalies', modified: '2026-06-01T00:00:00.000Z' };
  const c = { ...newFit(id('Merlin'), 'Kiter'), id: 'c' };
  b.links.projected_fits = [{ fit_id: 'a', amount: 1, distance_m: null }];
  b.links.booster_fit_ids = ['c'];
  return { ...emptyLibrary(), fits: { a, b, c }, characters: Object.fromEntries(BUILTIN_CHARACTERS.map((x) => [x.id, x])), folders: ['Empty'] };
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
    expect(x.fits.b.links.projected_fits).toEqual([]);
    expect(x.fits.b.links.booster_fit_ids).toEqual([]);
  });
  it('web.unit.library-fleets: create/join (single membership), role, leave, delete keeps fits; deleted fits leave fleets', () => {
    let l = lib();
    const j1 = joinFleet(l, null, 'a', 'Home defence');
    const fl = j1.fleetId;
    l = j1.lib;
    expect(l.fleets[fl].members).toEqual([{ fit_id: 'a', role: 'member' }]);
    expect(fleetsOf(l, 'a').map((f) => f.id)).toEqual([fl]);
    l = setFleetRole(l, fl, 'a', 'command');
    expect(l.fleets[fl].members[0].role).toBe('command');
    l = joinFleet(l, fl, 'b').lib;
    expect(l.fleets[fl].members.map((m) => m.fit_id)).toEqual(['a', 'b']);
    // joining a second fleet moves the fit over
    const j2 = joinFleet(l, null, 'b', 'Roaming');
    l = j2.lib;
    expect(l.fleets[fl].members.map((m) => m.fit_id)).toEqual(['a']);
    expect(l.fleets[j2.fleetId].members.map((m) => m.fit_id)).toEqual(['b']);
    // moveFleet/renameFolder keep fleets with their folder; deleteFits drops dangling members
    l = moveFleet(l, fl, 'PvP/Fleets');
    expect(l.fleets[fl].folder).toBe('PvP/Fleets');
    const l2 = deleteFits(l, ['a']);
    expect(l2.fleets[fl].members).toEqual([]);
    expect(Object.keys(l2.fits)).toHaveLength(2);
    // leaveFleets clears membership; deleteFleet removes the fleet but not its fits
    const l3 = leaveFleets(l, 'b');
    expect(l3.fleets[j2.fleetId].members).toEqual([]);
    const l4 = deleteFleet(l, j2.fleetId);
    expect(l4.fleets[j2.fleetId]).toBeUndefined();
    expect(Object.keys(l4.fits)).toHaveLength(3);
  });
  it('web.unit.library-backup-merge: JSON backup v3 (no built-ins), legacy flat-fit backups still restore through migrate, restoring twice adds nothing', () => {
    const l = lib();
    const bk = makeBackup(l, [{ name: 'set' }]);
    expect(bk.version).toBe(3);
    expect(Object.keys(bk.lib.characters)).toEqual([]);
    const back = parseBackup(JSON.stringify(bk));
    expect(back.lib.folders).toEqual(['Empty']);
    const twice = mergeLibrary(l, back.lib);
    expect(twice.added).toEqual([]);
    expect(twice.skipped).toHaveLength(3);
    // a legacy (flat) backup restores through format migrate; an id collision keeps the newer modified
    const v1 = parseBackup(JSON.stringify({ format: 'eve-fit-web-library', version: 1, lib: {
      fits: { z: { id: 'z', name: 'Old flat fit', ship_type_id: id('Rifter'), modules: [], damage_pattern_id: 'em' } },
      characters: { me: { id: 'me', name: 'Me', default_level: 3, levels: {} } },
    } }));
    expect(v1.lib.fits.z.format).toBe('exfa/fit@1');
    expect(v1.lib.fits.z.refs.damage_pattern_id).toBe('em');
    expect(v1.lib.characters.me.name).toBe('Me');
    const older = { ...l.fits.b, name: 'Ratter 2', modified: '2000-01-01T00:00:00.000Z' };
    const newer = { ...l.fits.a, name: 'Brawler 2', modified: '2999-01-01T00:00:00.000Z' };
    const m = mergeLibrary(l, { fits: { a: newer, b: older, z: v1.lib.fits.z } });
    expect(m.added).toEqual(['z']);
    expect(m.updated).toEqual(['a']);
    expect(m.skipped).toEqual(['b']);
    expect(m.lib.fits.a.name).toBe('Brawler 2');
    expect(m.lib.fits.b.name).toBe('Ratter');
    expect(Object.keys(m.lib.fits)).toHaveLength(4);
    expect(() => parseBackup('{"x":1}')).toThrow();
  });
});
