// docs/27 §7: configuration groups (compileGroup into exfa/compute@1 batch), §5.4 workspaces (doc.ui.ws +
// index ws map) and package import (mergePackage into the active workspace).
import { describe, expect, it } from 'vitest';
import { compileGroup, packageFit, type Group } from '@exfa/format';
import { emptyLibrary, newFit, type Library } from './model';
import {
  DEFAULT_WS, addGroupActor, docWs, entityWs, filterWorkspace, importPackage, mergeLibrary, newGroupDoc,
  removeGroup, removeGroupActor, setDocWs, setEntityWs, updateGroupRelation, upsertGroupRelation,
  upsertWorkspace, removeWorkspace, workspacesOf, wsCounts, wsFolders, wsRegister, wsTags,
} from './library';
import { BUILTIN_CHARACTERS } from '../data/presets';
import { id } from '../test/fixture';

function lib(): Library {
  const a = { ...newFit(id('Rifter'), 'Brawler'), id: 'a', folder: 'PvP', tags: ['solo'], modified: '2026-06-01T00:00:00.000Z' };
  const b = { ...newFit(id('Vexor'), 'Ratter'), id: 'b', modified: '2026-06-01T00:00:00.000Z' };
  return { ...emptyLibrary(), fits: { a, b }, characters: Object.fromEntries(BUILTIN_CHARACTERS.map((x) => [x.id, x])) };
}

const withGroup = (l: Library, g: Group) => ({ ...l, groups: { ...l.groups, [g.id]: g } });

describe('fit/library groups', () => {
  it('web.unit.groups-crud: upsert/actors/relations; removing an actor drops its edges', () => {
    let l = lib();
    const g = newGroupDoc('Recon pair');
    l = withGroup(l, g);
    l = addGroupActor(l, g.id, 'a', 'lead', 'DPS').lib;
    l = addGroupActor(l, g.id, 'b', 'support', '后勤').lib;
    const [lead, sup] = l.groups[g.id].actors;
    l = upsertGroupRelation(l, g.id, { id: 'r1', kind: 'project', source: sup.id, targets: [lead.id], enabled: true });
    l = updateGroupRelation(l, g.id, 'r1', { amount: 2, distance_m: 30000 });
    const rel = l.groups[g.id].relations.find((r) => r.id === 'r1');
    expect(rel).toMatchObject({ kind: 'project', amount: 2, distance_m: 30000 });
    // removing the source drops the whole edge
    l = removeGroupActor(l, g.id, sup.id);
    expect(l.groups[g.id].actors.map((a) => a.fit_id)).toEqual(['a']);
    expect(l.groups[g.id].relations).toEqual([]);
    // removeGroup also clears its workspace tag
    l = setEntityWs(l, g.id, 'ws2');
    l = removeGroup(l, g.id);
    expect(l.groups[g.id]).toBeUndefined();
    expect((l as { ws?: Record<string, string> }).ws?.[g.id]).toBeUndefined();
  });

  it('web.unit.groups-compile: compileGroup lowers actors + relations into one batch request with issues for gaps', () => {
    let l = lib();
    const g = { ...newGroupDoc('pair'), id: 'g1' };
    l = withGroup(l, g);
    l = addGroupActor(l, g.id, 'a').lib;
    l = addGroupActor(l, g.id, 'b').lib;
    l = addGroupActor(l, g.id, 'missing-fit').lib; // dangling actor -> issue, no batch entry
    const [a1, a2] = l.groups.g1.actors;
    l = upsertGroupRelation(l, 'g1', { id: 'r1', kind: 'command', source: a1.id, targets: [a2.id], enabled: true });
    const { request, issues } = compileGroup(l, l.groups.g1, {});
    expect(request.format).toBe('exfa/compute@1');
    expect(request.operation).toBe('batch');
    const batch = request.batch as { fits: { id: string; fit: { ship: { type_id: number }; fleet?: { booster_fits?: unknown[] } } }[] };
    expect(batch.fits.map((f) => f.id)).toEqual([a1.id, a2.id]);
    expect(batch.fits[1].fit.fleet?.booster_fits).toHaveLength(1); // command edge: a1 boosts a2
    expect(issues.some((s) => s.includes('missing-fit'))).toBe(true);
  });
});

describe('fit/library workspaces (docs/27 §5.4)', () => {
  it('web.unit.ws-membership: docs carry ui.ws, groups/fleets the index ws map; default workspace for untagged', () => {
    let l = lib();
    expect(docWs(l.fits.a)).toBe(DEFAULT_WS);
    expect(workspacesOf(l).map((w) => w.id)).toEqual([DEFAULT_WS]);
    l = { ...l, fits: { ...l.fits, a: setDocWs(l.fits.a, 'ws2') } };
    const g = newGroupDoc('g');
    l = setEntityWs(withGroup(l, g), g.id, 'ws2');
    expect(entityWs(l, g.id)).toBe('ws2');
    const view = filterWorkspace(l, 'ws2');
    expect(Object.keys(view.fits)).toEqual(['a']);
    expect(Object.keys(view.groups)).toEqual([g.id]);
    expect(Object.keys(filterWorkspace(l, DEFAULT_WS).fits)).toEqual(['b']);
    expect(wsCounts(l)).toEqual({ [DEFAULT_WS]: 1, ws2: 2 });
  });
  it('web.unit.ws-registry-folders-tags: registry upsert/remove, ws folder+tag pickers union meta and usage', () => {
    let l = lib();
    l = { ...l, fits: { ...l.fits, a: setDocWs(l.fits.a, 'ws2') } };
    l = wsRegister(upsertWorkspace(l, { id: 'ws2', name: ' roam', created: 'x' }), 'ws2', { folders: ['Wormhole'], tags: ['wh'] });
    expect(workspacesOf(l).map((w) => w.id).sort()).toEqual([DEFAULT_WS, 'ws2']);
    expect(wsFolders(l, 'ws2')).toEqual(['PvP', 'Wormhole']); // meta + in-use
    expect(wsTags(l, 'ws2')).toEqual(['solo', 'wh']);
    // a workspace is deleted only when empty: move the fit back first (the UI refuses otherwise)
    l = { ...l, fits: { ...l.fits, a: setDocWs(l.fits.a, DEFAULT_WS) } };
    l = removeWorkspace(l, 'ws2');
    expect(workspacesOf(l).map((w) => w.id)).toEqual([DEFAULT_WS]);
    expect(removeWorkspace(l, DEFAULT_WS)).toBe(l); // default cannot be removed
  });
  it('web.unit.ws-merge: mergeLibrary(ws) tags imported docs and group/fleet entities into the active workspace', () => {
    const l = lib();
    const inc = { ...newFit(id('Merlin'), 'In'), id: 'in1', modified: '2026-06-01T00:00:00.000Z' };
    const g = { ...newGroupDoc('imported'), id: 'gIn' };
    const m = mergeLibrary(l, { fits: { in1: inc }, groups: { gIn: g } }, 'ws2');
    expect(m.added).toEqual(['in1']);
    expect(docWs(m.lib.fits.in1)).toBe('ws2');
    expect(entityWs(m.lib, 'gIn')).toBe('ws2');
    // the same merge again skips the identical doc
    expect(mergeLibrary(m.lib, { fits: { in1: inc } }, 'ws2').skipped).toEqual(['in1']);
  });
  it('web.unit.ws-package: importPackage merges a fit package (rename-on-conflict) into the active workspace', () => {
    const src = lib();
    const pkg = packageFit(src, src.fits.a);
    expect(pkg.format).toBe('exfa/package@1');
    // a foreign library (no 'a'): fit lands tagged ws2
    const dst = { ...lib(), fits: { b: lib().fits.b } };
    const r = importPackage(dst, pkg, 'ws2');
    expect(docWs(r.lib.fits.a)).toBe('ws2');
    // same id + different content -> rename policy mints a new id and reports it
    const clash = { ...lib(), fits: { a: { ...src.fits.a, name: 'Different', modified: '2000-01-01T00:00:00.000Z' } } };
    const r2 = importPackage(clash, pkg, 'ws2');
    expect(r2.lib.fits.a.name).toBe('Different');
    const imported = Object.entries(r2.lib.fits).find(([k]) => k.startsWith('imp-'));
    expect(imported?.[1].name).toBe('Brawler');
    expect(Object.keys(r2.lib.fits)).toHaveLength(2);
    expect(r2.issues.length).toBeGreaterThan(0);
  });
});
