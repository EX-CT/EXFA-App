// Stage D-3 smoke: library folder tree (nested folders, drag-drop, inline new folder), fleet nodes
// (members, roles, context menus) and expandable fit rows (branches via applyBranch, history restore).
//   node tools/smoke-d3.mjs <url>   (CHROME=/path/to/chrome)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/EXFA-App/';
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
fs.mkdirSync(FIX, { recursive: true });

const fit = (id, name, ship, folder, extra = {}) => ({
  format: 'exfa/fit@1', id, name, folder, modified: '2026-01-01T00:00:00.000Z',
  fit: { ship: { type_id: ship, mode_type_id: null }, modules: [], drones: [], fighters: [], implants: [], boosters: [], cargo: [], projected: [], fleet_buffs: [], environment: { effect_type_ids: [], system_security: null }, options: { factor_reload: false, spool: 1, rah: 'adapt' } },
  refs: { character_id: 'all5', damage_pattern_id: 'uniform', target_profile_id: 'none', scenario_ids: [] },
  links: { booster_fit_ids: [], projected_fits: [] }, alternatives: [], branches: [], history: [], ...extra,
});
const library = {
  format: 'exfa/library@1',
  folders: ['PvP', 'PvP/Frigates', 'PvP/Frigates/T1', 'PvE'],
  fits: {
    fa: fit('fa', 'Brawler', 587, 'PvP/Frigates/T1', {
      branches: [{ id: 'br1', name: 'Scram', picks: {} }], active_branch: 'br1',
      history: [{ at: '2026-01-02T03:04:05.000Z', fit: fit('x', 'x', 587).fit }],
    }),
    fb: fit('fb', 'Ratter', 626, 'PvE'),
    fc: fit('fc', 'Kiter', 603, ''),
  },
  fleets: { fl1: { id: 'fl1', name: 'Home defence', folder: 'PvP', members: [{ fit_id: 'fa', role: 'command' }, { fit_id: 'fc', role: 'member' }] } },
  characters: {}, damage_patterns: {}, target_profiles: {}, scenarios: {},
};
const bkFile = path.join(FIX, 'smoke-d3-library.json');
fs.writeFileSync(bkFile, JSON.stringify(library));

let passed = 0, failed = 0;
const check = (name, ok, info = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` — ${info}` : ''}`); if (!ok) process.exitCode = 1; };

const b = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  const p = (await b.pages())[0];
  await p.setViewport({ width: 1600, height: 900 });
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => [...document.querySelectorAll('.tabs button')].some((x) => /^Fits|^配置/.test(x.textContent)), { timeout: 60000 });
  await p.evaluate(() => [...document.querySelectorAll('.tabs button')].find((x) => /^Fits|^配置/.test(x.textContent)).click());
  await p.waitForSelector('.fitbrowser', { timeout: 15000 });
  await (await p.$('.lib-import-file')).uploadFile(bkFile);
  await p.waitForSelector('.lib-fit[data-fit-id="fa"]', { timeout: 15000 });
  await p.select('.lib-mode', 'folder');
  await p.waitForSelector('details.lib-folder[data-folder="PvP/Frigates/T1"]', { timeout: 10000 });

  // nested folder tree
  const tree = await p.evaluate(() => ({
    t1inFr: !!document.querySelector('details[data-folder="PvP/Frigates"] details[data-folder="PvP/Frigates/T1"]'),
    frInPvp: !!document.querySelector('details[data-folder="PvP"] details[data-folder="PvP/Frigates"]'),
    fitInT1: !!document.querySelector('details[data-folder="PvP/Frigates/T1"] .lib-fit[data-fit-id="fa"]'),
    rootFit: !!document.querySelector('details[data-folder=""] .lib-fit[data-fit-id="fc"]'),
  }));
  check('web.smoke.d3.tree: nested folders render with fits at the right depth', tree.t1inFr && tree.frInPvp && tree.fitInT1 && tree.rootFit, JSON.stringify(tree));

  // fleet node
  const fleet = await p.evaluate(() => ({
    node: !!document.querySelector('details[data-folder="PvP"] .lib-fleet[data-fleet-id="fl1"]'),
    members: document.querySelectorAll('.lib-fleet .lib-member').length,
    cmd: document.querySelectorAll('.lib-fleet .role-badge.cmd').length,
    mbr: document.querySelectorAll('.lib-fleet .role-badge.mbr').length,
  }));
  check('web.smoke.d3.fleet: fleet node in its folder with members and role badges', fleet.node && fleet.members === 2 && fleet.cmd === 1 && fleet.mbr === 1, JSON.stringify(fleet));

  // fit expansion: branches + history
  await p.evaluate(() => document.querySelector('.lib-fit[data-fit-id="fa"] .lib-exp').click());
  const sub = await p.evaluate(() => ({
    branch: !!document.querySelector('.lib-fit[data-fit-id="fa"] .lib-branch[data-branch="br1"]'),
    branchOn: !!document.querySelector('.lib-fit[data-fit-id="fa"] .lib-branch.on'),
    hist: document.querySelectorAll('.lib-fit[data-fit-id="fa"] .lib-hist').length,
  }));
  check('web.smoke.d3.expand: fit expands to branch rows (active marked) and history rows', sub.branch && sub.branchOn && sub.hist === 1, JSON.stringify(sub));

  // history restore -> toast with Undo
  await p.evaluate(() => document.querySelector('.lib-fit[data-fit-id="fa"] .lib-hist-restore').click());
  await p.waitForSelector('.toast', { timeout: 5000 }).catch(() => null);
  const hist = await p.evaluate(() => ({ toast: document.querySelector('.toast')?.textContent ?? '', histN: JSON.parse(localStorage.getItem('x') ?? '{}') }));
  check('web.smoke.d3.history: restoring a history entry notifies with an undoable toast', /Restored|已恢复/.test(hist.toast), hist.toast);

  // fit context menu offers fleet actions
  await p.evaluate(() => document.querySelector('.lib-fit[data-fit-id="fb"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
  const ctx = await p.evaluate(() => [...document.querySelectorAll('.ctxmenu button')].map((x) => x.textContent));
  check('web.smoke.d3.ctx: fit context menu lists fleets and new-fleet action', ctx.some((x) => /加入编队|fleet/i.test(x)) && ctx.some((x) => /新编队|New fleet/i.test(x)), ctx.join(' | '));
  await p.keyboard.press('Escape');

  // drag a fit onto a folder -> moved (mouse.dragAndDrop drives the CDP drag; interception must be on)
  await p.setDragInterception(true);
  const from = await (await p.$('.lib-fit[data-fit-id="fb"]')).boundingBox();
  const to = await (await p.$('details.lib-folder[data-folder="PvP"] > summary')).boundingBox();
  await Promise.race([
    p.mouse.dragAndDrop({ x: from.x + 60, y: from.y + from.height / 2 }, { x: to.x + to.width / 2, y: to.y + to.height / 2 }, { delay: 100 }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('drag timed out')), 15000)),
  ]).catch((e) => console.log('drag issue:', e.message));
  await new Promise((r) => setTimeout(r, 300));
  const moved = await p.evaluate(() => document.querySelector('.lib-fit[data-fit-id="fb"]')?.closest('details')?.dataset.folder);
  check('web.smoke.d3.drag: dropping a fit on a folder moves it', moved === 'PvP', `folder=${moved}`);

  // folder context menu -> inline new subfolder
  await p.evaluate(() => document.querySelector('details.lib-folder[data-folder="PvP"] > summary').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
  await new Promise((r) => setTimeout(r, 150));
  const fctx = await p.evaluate(() => [...document.querySelectorAll('.ctxmenu button')].map((x) => x.textContent));
  console.log('   folder ctx:', fctx.join(' | ') || '(none)');
  await p.evaluate(() => [...document.querySelectorAll('.ctxmenu button')].find((x) => /subfolder|子文件夹/i.test(x.textContent))?.click());
  const inline = await p.waitForSelector('details.lib-folder[data-folder="PvP"] .lib-newfolder-inline input', { timeout: 5000 }).catch(() => null);
  if (inline) {
    await p.type('details.lib-folder[data-folder="PvP"] .lib-newfolder-inline input', 'Recon');
    await p.keyboard.press('Enter');
  }
  const sub2 = await p.waitForSelector('details.lib-folder[data-folder="PvP/Recon"]', { timeout: 5000 }).then(() => true).catch(() => false);
  check('web.smoke.d3.newfolder: inline subfolder creation inside a folder node', sub2);
} finally {
  await b.close();
}
console.log(`\n${passed} passed, ${failed} failed`);
