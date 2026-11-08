import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { commitImport, type ImportRequest } from '../src/db/importer';
import { lastImportAt, listInstances, loadEpgp, loadRaidLog, loadStandingsInput } from '../src/db/read';

const T1 = 1762290000, T2 = T1 + 3000, T3 = T1 + 7 * 86400; // two Nov 2025 nights, a week apart
const rec = (id: string, t: number, player: string, itemId: number, response = 'BiS') =>
  ({ id, timestamp: t, player, itemId, itemName: `Item ${itemId}`, response });
const loot = (records: any[]) => JSON.stringify({ addon: 'DarklightLC', test: false, records });
const att = (kills: any[]) => JSON.stringify({ addon: 'LimpusAttendance', version: 1, kills });

const ZG = "Zul'Gurub";
const req: ImportRequest = {
  lootText: loot([
    rec('a1', T1 + 100, 'Mankee', 100),
    rec('a2', T1 + 200, 'Zefal', 101, 'Offspec'),
    rec('a3', T3 + 100, 'Hexa', 102),
    rec('a4', T3 + 50, 'Mankee', 103, 'Upgrade'),
  ]),
  attendanceText: att([
    { t: T1, zone: 'Molten Core', boss: 'Lucifron', raid: ['Mankee', 'Zefal'] },
    { t: T2, zone: 'Molten Core', boss: 'Magmadar', raid: ['Mankee'] },
    { t: T3, zone: ZG, boss: 'Hakkar', raid: ['Mankee', 'Hexa'] },
  ]),
  instancePicks: {}, countsOff: [],
};

beforeEach(async () => {
  for (const t of ['award', 'item', 'kill_member', 'kill', 'night_override', 'raid_night', 'character', 'import_log', 'epgp_standing', 'epgp_meta'])
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  await commitImport(env.DB, req, '111');
  await env.DB.prepare("UPDATE character SET main_key='mankee' WHERE name_key='zefal'").run();
});

describe('read queries', () => {
  it('listInstances returns distinct sorted instances with slugs', async () => {
    expect(await listInstances(env.DB)).toEqual([
      { name: 'Molten Core', slug: 'molten-core' }, { name: ZG, slug: 'zul-gurub' }]);
  });

  it('listInstances ignores deleted awards', async () => {
    await env.DB.prepare('UPDATE award SET deleted=1 WHERE instance=?').bind(ZG).run();
    expect((await listInstances(env.DB)).map((i) => i.slug)).toEqual(['molten-core']);
  });

  it('loadRaidLog shows main name, alt name and response', async () => {
    const log = await loadRaidLog(env.DB, 'molten-core');
    expect(log?.instance).toBe('Molten Core');
    expect(log!.rows.map((r) => [r.itemId, r.playerDisplay, r.altName, r.response, r.counts])).toEqual([
      [100, 'Mankee', null, 'BiS', true],
      [101, 'Mankee', 'Zefal', 'Offspec', true],
    ]);
  });

  it('loadRaidLog sorts newest night first, then by time within a night', async () => {
    await env.DB.prepare("UPDATE award SET instance='Molten Core' WHERE instance=?").bind(ZG).run();
    const log = await loadRaidLog(env.DB, 'molten-core');
    expect(log!.rows.map((r) => r.itemId)).toEqual([103, 102, 100, 101]);
  });

  it('loadRaidLog hides deleted awards and returns null for unknown slug', async () => {
    await env.DB.prepare('UPDATE award SET deleted=1 WHERE darklight_id=?').bind('a1').run();
    expect((await loadRaidLog(env.DB, 'molten-core'))!.rows.map((r) => r.itemId)).toEqual([101]);
    expect(await loadRaidLog(env.DB, 'nope')).toBeNull();
  });

  it('loadStandingsInput maps all tables', async () => {
    const s = await loadStandingsInput(env.DB);
    expect(s.characters.find((c) => c.nameKey === 'zefal')).toMatchObject({ mainKey: 'mankee', status: 'member', displayName: 'Zefal' });
    expect(s.characters.find((c) => c.nameKey === 'mankee')!.mainKey).toBeNull();
    expect(s.nights).toHaveLength(2);
    expect(s.nights.every((n) => n.counts)).toBe(true);
    // distinct (night, name): Mankee+Zefal night 1, Mankee+Hexa night 2 (Mankee in two kills of night 1 counts once)
    expect(s.killPresence).toHaveLength(4);
  });

  it('loadStandingsInput reflects overrides', async () => {
    const night = (await env.DB.prepare('SELECT id FROM raid_night LIMIT 1').first<{ id: number }>())!.id;
    await env.DB.prepare('INSERT INTO night_override(night_id,name_key,present) VALUES (?,?,0)').bind(night, 'hexa').run();
    expect((await loadStandingsInput(env.DB)).overrides).toEqual([{ nightId: night, nameKey: 'hexa', present: false }]);
  });

  it('lastImportAt returns max import time or null', async () => {
    expect(await lastImportAt(env.DB)).toBeGreaterThan(1_700_000_000);
    await env.DB.prepare('DELETE FROM import_log').run();
    expect(await lastImportAt(env.DB)).toBeNull();
  });

  it('loadEpgp returns the standings by name key and the import time', async () => {
    expect(await loadEpgp(env.DB)).toEqual({ rows: new Map(), importedAt: null });
    await commitImport(env.DB, { lootText: '', attendanceText: '', epgpText: 'Name,Class,EP,GP\nMankee,Warrior,100,40\nHexa,,5.5,0',
      instancePicks: {}, countsOff: [] }, '111');
    const e = await loadEpgp(env.DB);
    expect(e.importedAt).toBeGreaterThan(1_700_000_000);
    expect([...e.rows]).toEqual([
      ['hexa', { ep: 5.5, gp: 0, class: null }],
      ['mankee', { ep: 100, gp: 40, class: 'Warrior' }],
    ]);
  });
});
