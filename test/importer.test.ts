import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { commitImport, previewImport, type ImportRequest } from '../src/db/importer';

const T1 = 1762290000, T2 = 1762293000; // same raid night (Nov 2025)

const rec = (id: string, t: number, player: string, itemId: number, response = 'BiS') =>
  ({ id, timestamp: t, player, itemId, itemName: `Item ${itemId}`, response });
const loot = (records: any[]) => JSON.stringify({ addon: 'DarklightLC', test: false, records });
const att = (kills: any[]) => JSON.stringify({ addon: 'LimpusAttendance', version: 1, kills });

const lootText = loot([
  rec('a1', T1 + 100, 'Mankee', 100),
  rec('a2', T1 + 200, 'Zefal-Forever', 101, 'Upgrade'),
  rec('a3', T2 + 100, 'Hexa', 102, 'Offspec'),
]);
const attText = att([
  { t: T1, zone: 'Molten Core', boss: 'Lucifron', raid: ['mankee-Forever', 'Zefal', 'Hexa'] },
  { t: T2, zone: 'Molten Core', boss: 'Magmadar', raid: ['Mankee', 'Zefal'] },
]);
const req: ImportRequest = { lootText, attendanceText: attText, instancePicks: {}, countsOff: [] };

const count = async (table: string) =>
  (await env.DB.prepare(`SELECT count(*) n FROM ${table}`).first<{ n: number }>())!.n;

beforeEach(async () => {
  for (const t of ['award', 'item', 'kill_member', 'kill', 'night_override', 'raid_night', 'character', 'import_log'])
    await env.DB.prepare(`DELETE FROM ${t}`).run();
});

describe('importer', () => {
  it('preview reports nights, new characters and new awards without writing', async () => {
    const p = await previewImport(env.DB, req);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.nights).toHaveLength(1);
    const n = p.nights[0];
    expect(n.instances).toEqual([{ zone: 'Molten Core', bosses: 2 }]);
    expect(n.players).toBe(3);
    expect(n.newAwards).toBe(3);
    expect(n.duplicateAwards).toBe(0);
    expect(n.needsInstance).toBe(false);
    expect(n.existing).toBe(false);
    expect(p.newCharacters.sort()).toEqual(['Hexa', 'Mankee', 'Zefal']);
    expect(await count('award')).toBe(0);
    expect(await count('character')).toBe(0);
  });

  it('commit is idempotent', async () => {
    const r = await commitImport(env.DB, req, '111');
    expect(r.ok).toBe(true);
    await commitImport(env.DB, req, '111');
    expect(await count('award')).toBe(3);
    expect(await count('kill')).toBe(2);
    expect(await count('kill_member')).toBe(5);
    expect(await count('character')).toBe(3);
    const p = await previewImport(env.DB, req);
    expect(p.ok && p.nights[0].duplicateAwards).toBe(3);
    expect(p.ok && p.nights[0].newAwards).toBe(0);
    expect(p.ok && p.nights[0].existing).toBe(true);
    expect(p.ok && p.newCharacters).toEqual([]);
  });

  it('import merges name variants', async () => {
    await commitImport(env.DB, req, '111');
    const rows = await env.DB.prepare("SELECT * FROM character WHERE name_key='mankee'").all<any>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0].created_at).toBeGreaterThan(1_700_000_000);
    expect(rows.results[0].status).toBe('member');
  });

  it('loot-only night needs an instance pick', async () => {
    const lootOnly: ImportRequest = { lootText, attendanceText: '', instancePicks: {}, countsOff: [] };
    const p = await previewImport(env.DB, lootOnly);
    expect(p.ok && p.nights[0].needsInstance).toBe(true);
    const date = p.ok ? p.nights[0].nightDate : '';
    const bad = await commitImport(env.DB, lootOnly, '111');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/^Pick an instance for Wk /);
    expect(await count('award')).toBe(0);
    const good = await commitImport(env.DB, { ...lootOnly, instancePicks: { [date]: 'Blackwing Lair' } }, '111');
    expect(good.ok).toBe(true);
    const a = await env.DB.prepare('SELECT instance FROM award').all<{ instance: string }>();
    expect(a.results.map((x) => x.instance)).toEqual(['Blackwing Lair', 'Blackwing Lair', 'Blackwing Lair']);
  });

  it('empty zone is not used as an instance', async () => {
    const att2 = att([{ t: T1, zone: '', boss: 'X', raid: ['Mankee'] }]);
    const r: ImportRequest = { lootText, attendanceText: att2, instancePicks: {}, countsOff: [] };
    const p = await previewImport(env.DB, r);
    expect(p.ok && p.nights[0].needsInstance).toBe(true);
    const date = p.ok ? p.nights[0].nightDate : '';
    await commitImport(env.DB, { ...r, instancePicks: { [date]: 'Onyxia' } }, '111');
    const a = await env.DB.prepare("SELECT count(*) n FROM award WHERE instance='' OR instance<>'Onyxia'").first<{ n: number }>();
    expect(a!.n).toBe(0);
  });

  it('countsOff marks new nights as not counting but leaves existing nights alone', async () => {
    const date = '2025-11-04';
    const pv = await previewImport(env.DB, req);
    const nd = pv.ok ? pv.nights[0].nightDate : date;
    await commitImport(env.DB, { ...req, countsOff: [nd] }, '111');
    expect((await env.DB.prepare('SELECT counts FROM raid_night').first<{ counts: number }>())!.counts).toBe(0);
    await env.DB.prepare('UPDATE raid_night SET counts=1').run();
    await commitImport(env.DB, { ...req, countsOff: [nd] }, '111');
    expect((await env.DB.prepare('SELECT counts FROM raid_night').first<{ counts: number }>())!.counts).toBe(1);
  });

  it('new items default to 1 point', async () => {
    await commitImport(env.DB, req, '111');
    const items = await env.DB.prepare('SELECT points, instance FROM item').all<any>();
    expect(items.results).toHaveLength(3);
    expect(items.results.every((i) => i.points === 1 && i.instance === 'Molten Core')).toBe(true);
  });

  it('rejects empty input and prefixes parser errors', async () => {
    const e = await previewImport(env.DB, { ...req, lootText: '', attendanceText: '  ' });
    expect(e).toEqual({ ok: false, error: 'Paste at least one export.' });
    const l = await previewImport(env.DB, { ...req, lootText: 'nope' });
    expect(!l.ok && l.error.startsWith('Loot export: ')).toBe(true);
    const a = await previewImport(env.DB, { ...req, attendanceText: 'nope' });
    expect(!a.ok && a.error.startsWith('Attendance export: ')).toBe(true);
  });

  it('writes an import_log row', async () => {
    const r = await commitImport(env.DB, req, '111');
    const log = await env.DB.prepare('SELECT * FROM import_log').first<any>();
    expect(log.by_discord_id).toBe('111');
    expect(r.ok && r.summary).toBe(log.summary);
    expect(log.summary).toBe('1 night, 3 new items, 3 new characters');
  });
});
