import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { adminCookie } from './helpers';

const T1 = 1762290000, T2 = 1762293000;
const rec = (id: string, t: number, player: string, itemId: number, response = 'BiS') =>
  ({ id, timestamp: t, player, itemId, itemName: `Item ${itemId}`, response });
const loot = (records: any[]) => JSON.stringify({ addon: 'DarklightLC', test: false, records });
const att = (kills: any[]) => JSON.stringify({ addon: 'LimpusAttendance', version: 1, kills });
const lootText = loot([rec('a1', T1 + 100, 'Mankee', 100), rec('a2', T1 + 200, 'Zefal', 101, 'Upgrade')]);
const attText = att([
  { t: T1, zone: 'Molten Core', boss: 'Lucifron', raid: ['Mankee', 'Zefal'] },
  { t: T2, zone: 'Molten Core', boss: 'Magmadar', raid: ['Mankee', 'Zefal'] },
]);
const NIGHT = '2025-11-04';

const count = async (table: string) => (await env.DB.prepare(`SELECT count(*) n FROM ${table}`).first<{ n: number }>())!.n;
const post = async (path: string, fields: Record<string, string>) =>
  SELF.fetch('https://x' + path, {
    method: 'POST', redirect: 'manual',
    headers: { cookie: await adminCookie(), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });
const get = async (path: string) => SELF.fetch('https://x' + path, { headers: { cookie: await adminCookie() } });

beforeEach(async () => {
  for (const t of ['award', 'item', 'kill_member', 'kill', 'night_override', 'raid_night', 'character', 'import_log', 'epgp_standing', 'epgp_meta'])
    await env.DB.prepare(`DELETE FROM ${t}`).run();
});

describe('admin import', () => {
  it('requires login', async () => {
    const r = await SELF.fetch('https://x/admin/import/preview', { method: 'POST', redirect: 'manual' });
    expect(r.status).toBe(302);
  });

  it('preview renders nights without writing', async () => {
    const r = await post('/admin/import/preview', { lootText, attendanceText: attText });
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('Molten Core');
    expect(html).toContain('Counts as guild raid');
    expect(html).toContain(`name="counts[${NIGHT}]"`);
    expect(html).toContain('name="lootText"');
    expect(await count('award')).toBe(0);
    expect(await count('raid_night')).toBe(0);
  });

  it('commit writes and redirects', async () => {
    const r = await post('/admin/import/commit', { lootText, attendanceText: attText, [`counts[${NIGHT}]`]: 'on' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toMatch(/^\/admin\?imported=/);
    expect(await count('award')).toBe(2);
    const n = await env.DB.prepare('SELECT counts FROM raid_night').first<{ counts: number }>();
    expect(n!.counts).toBe(1);
    const page = await get(r.headers.get('location')!);
    expect(await page.text()).toContain('1 night');
  });

  it('unchecked counts box makes the night non-counting', async () => {
    const r = await post('/admin/import/commit', { lootText, attendanceText: attText });
    expect(r.status).toBe(302);
    const n = await env.DB.prepare('SELECT counts FROM raid_night').first<{ counts: number }>();
    expect(n!.counts).toBe(0);
  });

  it('commit without instance for kill-less night is rejected', async () => {
    const r = await post('/admin/import/commit', { lootText, attendanceText: '' });
    expect(r.status).toBe(400);
    expect(await r.text()).toContain('Pick an instance for');
    expect(await count('award')).toBe(0);
  });

  it('instance pick (select or other text) lets a kill-less night commit', async () => {
    const lootDate = '2025-11-04';
    const r = await post('/admin/import/commit', { lootText, attendanceText: '', [`instance[${lootDate}]`]: '__other', [`instanceOther[${lootDate}]`]: 'Zul\'Gurub' });
    expect(r.status).toBe(302);
    const a = await env.DB.prepare('SELECT instance FROM award').first<{ instance: string }>();
    expect(a!.instance).toBe("Zul'Gurub");
  });

  it('malformed loot text shows parser error, not 500', async () => {
    const r = await post('/admin/import/preview', { lootText: '{not json', attendanceText: '' });
    expect(r.status).toBe(400);
    expect(await r.text()).toContain('Loot export');
    const c = await post('/admin/import/commit', { lootText: '{not json', attendanceText: '' });
    expect(c.status).toBe(400);
  });

  it('shows last import and stale warning after 7 days', async () => {
    let html = await (await get('/admin')).text();
    expect(html).toContain('No imports yet');
    expect(html).toContain('stale');
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare('INSERT INTO import_log (at, by_discord_id, summary) VALUES (?, ?, ?)').bind(now - 8 * 86400, '111', 's').run();
    html = await (await get('/admin')).text();
    expect(html).toContain('Last import:');
    expect(html).toContain('stale');
    await env.DB.prepare('INSERT INTO import_log (at, by_discord_id, summary) VALUES (?, ?, ?)').bind(now - 3600, '111', 's').run();
    html = await (await get('/admin')).text();
    expect(html).toContain('Last import:');
    expect(html).not.toContain('stale');
  });

  it('escapes the imported banner', async () => {
    const html = await (await get('/admin?imported=' + encodeURIComponent('<script>x</script>'))).text();
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('EPGP standings: textarea, preview counts and commit', async () => {
    expect(await (await get('/admin')).text()).toContain('name="epgpText"');
    const epgpText = 'Name,Class,EP,GP\nMankee,Warrior,100,50\nZefal,Warlock,80,40';
    const pv = await post('/admin/import/preview', { lootText: '', attendanceText: '', epgpText });
    expect(pv.status).toBe(200);
    const html = await pv.text();
    expect(html).toContain('EPGP standings: 2 rows, 2 new characters, 0 alt rows skipped');
    expect(html).toMatch(/<textarea name="epgpText" hidden[^>]*>Name,Class,EP,GP/);
    expect(await count('epgp_standing')).toBe(0);
    const r = await post('/admin/import/commit', { lootText: '', attendanceText: '', epgpText });
    expect(r.status).toBe(302);
    expect(await count('epgp_standing')).toBe(2);
  });

  it('bad EPGP CSV shows the parser error', async () => {
    const r = await post('/admin/import/preview', { lootText: '', attendanceText: '', epgpText: 'Name,EP,GP' });
    expect(r.status).toBe(400);
    expect(await r.text()).toContain('EPGP standings:');
  });
});
