// EXFA example workspace (docs/27 §5): one-click demo fleet that exercises configuration groups —
// 1 logistics cruiser whose remote reps are split across specific targets, 3 attack frigates and 1
// command-burst battlecruiser. Everything lives in its own workspace so the demo never touches user data.
import { addItemToFit, newFit, patchFit, uid, type FitDoc, type GroupRelation, type Library } from '../fit/model';
import {
  addGroupActor, newGroupDoc, setDocWs, setEntityWs, upsertGroup, upsertGroupRelation, upsertWorkspace,
  workspacesOf, wsRegister, entityWs,
} from '../fit/library';
import type { Dataset } from './dataset';

export const DEMO_WS = 'exfa-demo';
export const DEMO_WS_NAME = 'EXFA 示例';
const DEMO_FOLDER = '示例舰队';

const RIFTER = 587, EXEQUROR = 634, CYCLONE = 16231;
const AUTO2 = 2889, AB1 = 438, AB10 = 12058, GYRO2 = 519, DC2 = 2048, CPR2 = 1447;
const MAR2 = 3530, MRAR2 = 26913, SKIRMISH2 = 43556, ARMOR2 = 43552;

/** One demo fit: modules added through the normal market path (correct slots/states/item ids). */
function demoFit(ds: Dataset, ship: number, name: string, mods: { type: number; charge?: number }[]): FitDoc | null {
  let doc: FitDoc | null = newFit(ship, name);
  for (const m of mods) {
    if (!doc) return null;
    doc = addItemToFit(ds, doc, m.type);
    if (doc && m.charge != null) {
      doc = patchFit(doc, { modules: doc.fit.modules.map((x) => (x.type_id === m.type ? { ...x, charge_type_id: m.charge } : x)) });
    }
  }
  return doc;
}

const firstCharge = (ds: Dataset, type: number): number | undefined => ds.chargesFor(type)[0];

/**
 * Ensures the "EXFA 示例" workspace exists and returns { lib, ws, groupId } to switch to and open.
 * Idempotent: if the workspace already exists nothing is re-seeded — the first group in it is returned.
 */
export function seedDemoWorkspace(ds: Dataset, lib: Library): { lib: Library; ws: string; groupId: string | null } {
  if (workspacesOf(lib).some((w) => w.id === DEMO_WS)) {
    const existing = Object.keys(lib.groups ?? {}).find((id) => entityWs(lib, id) === DEMO_WS) ?? null;
    return { lib, ws: DEMO_WS, groupId: existing };
  }
  const charge = (t: number) => ({ type: t, charge: firstCharge(ds, t) });
  const docs: FitDoc[] = [
    demoFit(ds, RIFTER, 'D01 攻击 Rifter', [{ type: AUTO2 }, { type: AUTO2 }, { type: AB1 }, { type: GYRO2 }, { type: DC2 }]),
    demoFit(ds, RIFTER, 'D02 攻击 Rifter', [{ type: AUTO2 }, { type: AUTO2 }, { type: AB1 }, { type: GYRO2 }, { type: DC2 }]),
    demoFit(ds, RIFTER, 'D03 攻击 Rifter', [{ type: AUTO2 }, { type: AUTO2 }, { type: AB1 }, { type: GYRO2 }, { type: DC2 }]),
    demoFit(ds, EXEQUROR, 'L01 后勤 Exequror', [{ type: MRAR2 }, { type: MRAR2 }, { type: MRAR2 }, { type: AB10 }, { type: MAR2 }, { type: DC2 }, { type: CPR2 }]),
    demoFit(ds, CYCLONE, 'C01 指挥 Cyclone', [charge(SKIRMISH2), charge(ARMOR2), { type: AB10 }, { type: MAR2 }, { type: DC2 }, { type: CPR2 }]),
  ].filter((d): d is FitDoc => !!d);
  if (docs.length < 5) return { lib, ws: DEMO_WS, groupId: null };

  const [d01, d02, d03, l01, c01] = docs;
  const group = newGroupDoc('示例舰队');
  let next = upsertWorkspace(lib, { id: DEMO_WS, name: DEMO_WS_NAME, created: new Date().toISOString(), folders: [DEMO_FOLDER] });
  next = { ...next, fits: { ...next.fits, ...Object.fromEntries(docs.map((d) => [d.id, setDocWs({ ...d, folder: DEMO_FOLDER }, DEMO_WS)])) } };
  next = setEntityWs(upsertGroup(next, group), group.id, DEMO_WS);
  next = wsRegister(next, DEMO_WS, { folders: [DEMO_FOLDER] });

  const actor = (fit: FitDoc, label: string, role: string) => {
    const r = addGroupActor(next, group.id, fit.id, label, role);
    next = r.lib;
    return r.actorId;
  };
  const aD01 = actor(d01, 'D01 攻击', 'DPS');
  const aD02 = actor(d02, 'D02 攻击', 'DPS');
  const aD03 = actor(d03, 'D03 攻击', 'DPS');
  const aL01 = actor(l01, 'L01 后勤', '后勤');
  const aC01 = actor(c01, 'C01 指挥', '指挥');

  // rep module item ids on the logistics fit (assigned by addItemToFit) — the demo's directed assignment.
  const reps = l01.fit.modules.filter((m) => m.type_id === MRAR2).map((m) => m.id!).filter(Boolean);
  const rel = (r: Pick<GroupRelation, 'kind' | 'source' | 'targets'> & Partial<GroupRelation>) => {
    next = upsertGroupRelation(next, group.id, { enabled: true, ...r, id: uid() });
  };
  rel({ kind: 'command', source: aC01, targets: [aL01, aD01, aD02, aD03], notes: 'Cyclone 指挥脉冲覆盖全队（skirmish + armor）' });
  if (reps.length >= 3) {
    rel({ kind: 'project', source: aL01, targets: [aD01], source_item_ids: [reps[0], reps[1]], distance_m: 5000, notes: '两台中型远程修甲器分配至 D01' });
    rel({ kind: 'project', source: aL01, targets: [aD02], source_item_ids: [reps[2]], distance_m: 15000, notes: '一台分配至 D02 · 15km 演示距离衰减' });
  }
  return { lib: next, ws: DEMO_WS, groupId: group.id };
}
