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
  for (const t of ['award', 'item', 'kill_member', 'kill', 'night_override', 'raid_night', 'character', 'import_log', 'epgp_standing', 'epgp_meta'])
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
    expect(rows.results[0].display_name).toBe('Mankee');
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
    const pv = await previewImport(env.DB, req);
    const nd = pv.ok ? pv.nights[0].nightDate : '';
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

  it('kill-assigned instance beats the night pick', async () => {
    const p = await previewImport(env.DB, req);
    const date = p.ok ? p.nights[0].nightDate : '';
    await commitImport(env.DB, { ...req, instancePicks: { [date]: 'Onyxia' } }, '111');
    const a = await env.DB.prepare("SELECT count(*) n FROM award WHERE instance <> 'Molten Core'").first<{ n: number }>();
    expect(a!.n).toBe(0);
  });

  it('existing item instance is not overwritten', async () => {
    await env.DB.prepare("INSERT INTO item (item_id, name, instance, points) VALUES (100, 'Item 100', 'Naxxramas', 3)").run();
    await commitImport(env.DB, req, '111');
    const i = await env.DB.prepare('SELECT instance, points FROM item WHERE item_id=100').first<any>();
    expect(i).toEqual({ instance: 'Naxxramas', points: 3 });
  });

  it('handles more than 80 characters and awards in one import', async () => {
    const names = Array.from({ length: 120 }, (_, i) => `Player${i}`);
    const r: ImportRequest = {
      lootText: loot(names.map((n, i) => rec(`b${i}`, T1 + i, n, 1000 + i))),
      attendanceText: att([{ t: T1 - 10, zone: 'Molten Core', boss: 'Garr', raid: names }]),
      instancePicks: {}, countsOff: [],
    };
    expect((await commitImport(env.DB, r, '111')).ok).toBe(true);
    expect(await count('award')).toBe(120);
    expect(await count('character')).toBe(120);
    expect(await count('kill_member')).toBe(120);
    const p = await previewImport(env.DB, r);
    expect(p.ok && p.nights[0].duplicateAwards).toBe(120);
    expect(p.ok && p.newCharacters).toEqual([]);
  });

  it('loot-only import after an attendance-only import uses the stored kills', async () => {
    expect((await commitImport(env.DB, { ...req, lootText: '' }, '111')).ok).toBe(true);
    const lootOnly: ImportRequest = { lootText, attendanceText: '', instancePicks: {}, countsOff: [] };
    const p = await previewImport(env.DB, lootOnly);
    expect(p.ok && p.nights[0].needsInstance).toBe(false);
    expect((await commitImport(env.DB, lootOnly, '111')).ok).toBe(true);
    const a = await env.DB.prepare('SELECT DISTINCT instance FROM award').all<{ instance: string }>();
    expect(a.results.map((x) => x.instance)).toEqual(['Molten Core']);
  });

  it('remembered item instance beats the night pick', async () => {
    await env.DB.prepare("INSERT INTO item (item_id, name, instance, points) VALUES (100, 'Item 100', 'Naxxramas', 1)").run();
    const lootOnly: ImportRequest = { lootText, attendanceText: '', instancePicks: {}, countsOff: [] };
    const p = await previewImport(env.DB, lootOnly);
    const date = p.ok ? p.nights[0].nightDate : '';
    await commitImport(env.DB, { ...lootOnly, instancePicks: { [date]: 'Onyxia' } }, '111');
    const a = await env.DB.prepare('SELECT darklight_id, instance FROM award ORDER BY darklight_id').all<any>();
    expect(a.results).toEqual([
      { darklight_id: 'a1', instance: 'Naxxramas' },
      { darklight_id: 'a2', instance: 'Onyxia' },
      { darklight_id: 'a3', instance: 'Onyxia' },
    ]);
  });

  it('a manual night with one instance is the default before the pick', async () => {
    const lootOnly: ImportRequest = { lootText, attendanceText: '', instancePicks: {}, countsOff: [] };
    const p0 = await previewImport(env.DB, lootOnly);
    const date = p0.ok ? p0.nights[0].nightDate : '';
    await env.DB.prepare("INSERT INTO raid_night (night_date, counts, manual, instances) VALUES (?, 1, 1, 'Zul''Gurub')").bind(date).run();
    const p = await previewImport(env.DB, lootOnly);
    expect(p.ok && p.nights[0].needsInstance).toBe(false);
    await commitImport(env.DB, { ...lootOnly, instancePicks: { [date]: 'Onyxia' } }, '111');
    const a = await env.DB.prepare('SELECT DISTINCT instance FROM award').all<{ instance: string }>();
    expect(a.results.map((x) => x.instance)).toEqual(["Zul'Gurub"]);
  });

  it('a manual night with several instances still needs a pick', async () => {
    const lootOnly: ImportRequest = { lootText, attendanceText: '', instancePicks: {}, countsOff: [] };
    const p0 = await previewImport(env.DB, lootOnly);
    const date = p0.ok ? p0.nights[0].nightDate : '';
    await env.DB.prepare("INSERT INTO raid_night (night_date, counts, manual, instances) VALUES (?, 1, 1, 'Molten Core, Onyxia')").bind(date).run();
    const p = await previewImport(env.DB, lootOnly);
    expect(p.ok && p.nights[0].needsInstance).toBe(true);
  });

  it('warns when a new night has no attendance', async () => {
    const p = await previewImport(env.DB, { lootText, attendanceText: '', instancePicks: {}, countsOff: [] });
    const label = p.ok ? p.nights[0].label : '';
    expect(p.ok && p.warnings).toContain(`No attendance for ${label}: untick Counts, or add players on the Nights page after saving.`);
    const q = await previewImport(env.DB, req);
    expect(q.ok && q.warnings.some((w) => w.startsWith('No attendance'))).toBe(false);
  });

  describe('EPGP standings', () => {
    const epgpOnly = (epgpText: string): ImportRequest => ({ lootText: '', attendanceText: '', epgpText, instancePicks: {}, countsOff: [] });
    const standings = async () =>
      (await env.DB.prepare('SELECT name_key, class, ep, gp FROM epgp_standing ORDER BY name_key').all<any>()).results;

    it('preview counts rows, new characters and skipped alts without writing', async () => {
      await env.DB.prepare("INSERT INTO character (name_key, display_name, created_at) VALUES ('mankee', 'Mankee', 1)").run();
      await env.DB.prepare("INSERT INTO character (name_key, display_name, main_key, created_at) VALUES ('mankeealt', 'Mankeealt', 'mankee', 1)").run();
      const p = await previewImport(env.DB, epgpOnly('Name,Class,EP,GP\nMankee,Warrior,100,50\nMankeealt,Mage,100,50\nNewbie-Forever,Rogue,10,5'));
      expect(p.ok).toBe(true);
      if (!p.ok) return;
      expect(p.epgp).toEqual({ rows: 2, newCharacters: 1, altsSkipped: 1 });
      expect(p.newCharacters).toEqual(['Newbie']);
      expect(p.nights).toEqual([]);
      expect(await count('epgp_standing')).toBe(0);
      expect(await count('character')).toBe(2);
    });

    it('preview has no epgp section when the CSV is empty', async () => {
      const p = await previewImport(env.DB, req);
      expect(p.ok && p.epgp).toBeNull();
    });

    it('commit replaces the previous snapshot, skips alts, creates mains and stores the time', async () => {
      await env.DB.prepare("INSERT INTO character (name_key, display_name, created_at) VALUES ('mankee', 'Mankee', 1)").run();
      await env.DB.prepare("INSERT INTO character (name_key, display_name, main_key, created_at) VALUES ('mankeealt', 'Mankeealt', 'mankee', 1)").run();
      expect((await commitImport(env.DB, epgpOnly('Mankee,100,50\nOld,1,1'), '111')).ok).toBe(true);
      const before = Math.floor(Date.now() / 1000);
      const r = await commitImport(env.DB, epgpOnly('Name,Class,EP,GP\nMankee,Warrior,120.5,60\nMankeealt,Mage,1,1\nNewbie,Rogue,10,0'), '111');
      expect(r.ok).toBe(true);
      expect(await standings()).toEqual([
        { name_key: 'mankee', class: 'Warrior', ep: 120.5, gp: 60 },
        { name_key: 'newbie', class: 'Rogue', ep: 10, gp: 0 },
      ]);
      const meta = await env.DB.prepare('SELECT id, imported_at FROM epgp_meta').all<any>();
      expect(meta.results).toHaveLength(1);
      expect(meta.results[0].imported_at).toBeGreaterThanOrEqual(before);
      const newbie = await env.DB.prepare("SELECT display_name, main_key, status FROM character WHERE name_key='newbie'").first<any>();
      expect(newbie).toEqual({ display_name: 'Newbie', main_key: null, status: 'member' });
      expect(r.ok && r.summary).toBe('1 new character, 2 EPGP standings');
    });

    it('an import without EPGP leaves the standings alone', async () => {
      await commitImport(env.DB, epgpOnly('Mankee,100,50'), '111');
      await commitImport(env.DB, req, '111');
      expect(await count('epgp_standing')).toBe(1);
    });

    it('commit together with loot and attendance in one go', async () => {
      const r = await commitImport(env.DB, { ...req, epgpText: 'Mankee,100,50\nZefal,80,40' }, '111');
      expect(r.ok).toBe(true);
      expect(await count('award')).toBe(3);
      expect(await count('epgp_standing')).toBe(2);
      expect(await count('character')).toBe(3);
    });

    it('prefixes parser errors and accepts EPGP as the only export', async () => {
      const e = await previewImport(env.DB, epgpOnly('Name,Class,EP,GP\n'));
      expect(!e.ok && e.error.startsWith('EPGP standings: ')).toBe(true);
      const w = await previewImport(env.DB, epgpOnly('Zefal,1,1\nMankee,abc,5'));
      expect(w.ok && w.warnings.some((x) => x.includes('Mankee'))).toBe(true);
    });
  });
});
