// Demo workspace seeding (docs/27 §5): uses the real public dataset because the mini fixture
// lacks the demo hulls/modules.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { compileGroup } from '@exfa/format';
import { Dataset } from './dataset';
import { DEMO_WS, seedDemoWorkspace } from './demo';
import { emptyLibrary, newFit, type Library } from '../fit/model';
import { docWs, entityWs, workspacesOf, DEFAULT_WS } from '../fit/library';

const ds = new Dataset(JSON.parse(gunzipSync(readFileSync(fileURLToPath(new URL('../../public/data/dataset.json.gz', import.meta.url)))).toString()));
const seeded = () => seedDemoWorkspace(ds, emptyLibrary());
type BatchEntry = { id: string; label?: string; fit: { projected?: { kind: string; select?: { module_ids?: string[] }; distance_m?: number | null }[]; fleet?: { booster_fits?: unknown[] } } };
const batchOf = (lib: Library, groupId: string): BatchEntry[] => {
  const { request, issues } = compileGroup(lib, lib.groups![groupId], {});
  expect(issues).toEqual([]);
  expect(request.format).toBe('exfa/compute@1');
  expect(request.operation).toBe('batch');
  return (request.batch as { fits: BatchEntry[] }).fits;
};

describe('data/demo', () => {
  it('web.unit.demo-seed: creates the example workspace with 5 fits, 5 actors and 3 directed relations', () => {
    const { lib, ws, groupId } = seeded();
    expect(ws).toBe(DEMO_WS);
    expect(workspacesOf(lib).map((w) => w.id)).toContain(DEMO_WS);
    const fits = Object.values(lib.fits).filter((f) => docWs(f) === DEMO_WS);
    expect(fits).toHaveLength(5);
    const g = lib.groups![groupId!];
    expect(entityWs(lib, g.id)).toBe(DEMO_WS);
    expect(g.actors).toHaveLength(5);
    expect(g.relations.filter((r) => r.kind === 'command')).toHaveLength(1);
    const proj = g.relations.filter((r) => r.kind === 'project');
    expect(proj).toHaveLength(2);
    expect(proj.every((r) => (r.source_item_ids?.length ?? 0) > 0)).toBe(true);
  });

  it('web.unit.demo-compile: group compiles to one batch; command boosts 4 actors, reps select 2+1 modules', () => {
    const { lib, groupId } = seeded();
    const batch = batchOf(lib, groupId!);
    expect(batch).toHaveLength(5);
    const byLabel = Object.fromEntries(batch.map((f) => [f.label, f]));
    const cmd = lib.groups![groupId!].relations.find((r) => r.kind === 'command')!;
    for (const t of cmd.targets) {
      const actor = lib.groups![groupId!].actors.find((a) => a.id === t)!;
      const entry = batch.find((f) => f.id === actor.id)!;
      expect(entry.fit.fleet?.booster_fits).toHaveLength(1);
    }
    const d01 = byLabel['D01 攻击'];
    expect(d01.fit.projected).toHaveLength(1);
    expect(d01.fit.projected[0].kind).toBe('fit');
    expect(d01.fit.projected[0].select?.module_ids).toHaveLength(2);
    const d02 = byLabel['D02 攻击'];
    expect(d02.fit.projected[0].select?.module_ids).toHaveLength(1);
    expect(d02.fit.projected[0].distance_m).toBe(15000);
    expect(byLabel['D03 攻击'].fit.projected ?? []).toHaveLength(0);
  });

  it('web.unit.demo-idempotent: re-seeding returns the same group without duplicating anything', () => {
    const a = seeded();
    const b = seedDemoWorkspace(ds, a.lib);
    expect(b.groupId).toBe(a.groupId);
    expect(b.lib).toBe(a.lib);
    expect(Object.keys(b.lib.fits)).toHaveLength(5);
  });

  it('web.unit.demo-isolation: user data in other workspaces is untouched', () => {
    const user = { ...newFit(587, 'My Rifter'), id: 'user-fit' };
    const lib0 = { ...emptyLibrary(), fits: { 'user-fit': user } };
    const { lib } = seedDemoWorkspace(ds, lib0);
    expect(lib.fits['user-fit']).toEqual(user);
    expect(docWs(lib.fits['user-fit'])).toBe(DEFAULT_WS);
  });
});
