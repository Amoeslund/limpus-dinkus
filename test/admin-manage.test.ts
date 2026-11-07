import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { adminCookie } from './helpers';
import { signSession } from '../src/auth/session';
import { commitImport } from '../src/db/importer';
import { setMain } from '../src/db/admin';
import { loadStandingsInput } from '../src/db/read';
import { computeStandings } from '../src/domain/standings';

const T1 = 1762290000, T2 = 1762293000;
const rec = (id: string, t: number, player: string, itemId: number, response = 'BiS') =>
  ({ id, timestamp: t, player, itemId, itemName: `Item ${itemId}`, response });
const lootText = JSON.stringify({ addon: 'DarklightLC', test: false, records: [
  rec('a1', T1 + 100, 'Mankee', 100), rec('a2', T1 + 200, 'Zefal', 101, 'Upgrade'), rec('a3', T2 + 100, 'Hexa', 102, 'Offspec'),
] });
const attText = JSON.stringify({ addon: 'LimpusAttendance', version: 1, kills: [
  { t: T1, zone: 'Molten Core', boss: 'Lucifron', raid: ['Mankee', 'Zefal', 'Hexa'] },
  { t: T2, zone: 'Molten Core', boss: 'Magmadar', raid: ['Mankee', 'Zefal'] },
] });
const NIGHT = '2025-11-04';

const post = async (path: string, fields: Record<string, string | string[]>, cookie?: string) => {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) body.append(k, x);
  return SELF.fetch('https://x' + path, {
    method: 'POST', redirect: 'manual',
    headers: { cookie: cookie ?? (await adminCookie()), 'content-type': 'application/x-www-form-urlencoded' }, body,
  });
};
const get = async (path: string) => SELF.fetch('https://x' + path, { headers: { cookie: await adminCookie() } });
const count = async (table: string) => (await env.DB.prepare(`SELECT count(*) n FROM ${table}`).first<{ n: number }>())!.n;
const nightId = async (date = NIGHT) => (await env.DB.prepare('SELECT id FROM raid_night WHERE night_date = ?').bind(date).first<{ id: number }>())!.id;
const standing = async (name: string) =>
  computeStandings(await loadStandingsInput(env.DB)).find((s) => s.displayName === name);

beforeEach(async () => {
  for (const t of ['award', 'item', 'kill_member', 'kill', 'night_override', 'raid_night', 'character', 'import_log', 'admin'])
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  const r = await commitImport(env.DB, { lootText, attendanceText: attText, instancePicks: {}, countsOff: [] }, '111');
  expect(r.ok).toBe(true);
});

describe('characters', () => {
  it('cannot make a character with alts into an alt', async () => {
    expect((await setMain(env.DB, 'hexa', 'zefal')).ok).toBe(true);
    const r = await setMain(env.DB, 'zefal', 'mankee');
    expect(r).toEqual({ ok: false, error: 'Zefal has alts; unlink them first' });
    const res = await post('/admin/characters/zefal', { main: 'mankee' });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Zefal has alts; unlink them first');
  });

  it('cannot set a character as its own main or point to an alt', async () => {
    expect((await setMain(env.DB, 'hexa', 'hexa')).ok).toBe(false);
    expect((await setMain(env.DB, 'hexa', 'zefal')).ok).toBe(true);
    expect((await setMain(env.DB, 'mankee', 'hexa')).ok).toBe(false);
    expect((await post('/admin/characters/mankee', { main: 'hexa' })).status).toBe(400);
    expect((await post('/admin/characters/mankee', { main: 'nobody' })).status).toBe(400);
  });

  it('links an alt and unlinks it again via the form; status only on mains', async () => {
    expect((await post('/admin/characters/hexa', { main: 'zefal' })).status).toBe(302);
    expect((await standing('Hexa'))).toBeUndefined();
    const bad = await post('/admin/characters/hexa', { main: 'zefal', status: 'guest' });
    expect(bad.status).toBe(400);
    expect((await post('/admin/characters/hexa', { main: '' })).status).toBe(302);
    expect((await post('/admin/characters/hexa', { main: '', status: 'left' })).status).toBe(302);
    expect(await standing('Hexa')).toBeUndefined(); // status left hides from tables
    expect((await post('/admin/characters/hexa', { status: 'bogus' })).status).toBe(400);
  });

  it('lists characters, flags new ones, shows status only for mains', async () => {
    await setMain(env.DB, 'hexa', 'zefal');
    const html = await (await get('/admin/characters')).text();
    expect(html).toContain('Mankee');
    expect(html).toContain('new');
    expect(html.match(/name="status"/g)!.length).toBe(2); // Mankee + Zefal, not the alt Hexa
  });
});

describe('nights', () => {
  it('toggling counts changes standings', async () => {
    expect((await standing('Mankee'))!.raids).toBe(1);
    const id = await nightId();
    const r = await post(`/admin/nights/${id}/counts`, {});
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/admin/nights');
    expect((await standing('Mankee'))!.raids).toBe(0);
    await post(`/admin/nights/${id}/counts`, {});
    expect((await standing('Mankee'))!.raids).toBe(1);
  });

  it('lists nights with label, instances and players', async () => {
    const html = await (await get('/admin/nights')).text();
    expect(html).toContain('Wk 45 · Tue 4 Nov');
    expect(html).toContain('Molten Core');
    expect(html).toContain('<td class="c">3</td>');
  });

  it('manual night with ticked players counts as attendance', async () => {
    const before = (await standing('Mankee'))!.raids;
    const r = await post('/admin/nights/new', { date: '2025-11-08', instances: 'ZG, AQ', 'present[]': ['mankee', 'hexa'] });
    expect(r.status).toBe(302);
    const n = await env.DB.prepare('SELECT counts, manual, instances FROM raid_night WHERE night_date = ?').bind('2025-11-08').first<any>();
    expect(n).toEqual({ counts: 1, manual: 1, instances: 'ZG, AQ' });
    expect((await standing('Mankee'))!.raids).toBe(before + 1);
    expect((await standing('Zefal'))!.raids).toBe(1);
    expect((await standing('Hexa'))!.raids).toBe(2);
  });

  it('manual night validation', async () => {
    const dup = await post('/admin/nights/new', { date: NIGHT, instances: '' });
    expect(dup.status).toBe(400);
    expect(await dup.text()).toContain('A raid night for Wk 45 · Tue 4 Nov already exists');
    expect((await post('/admin/nights/new', { date: '4/11/2025' })).status).toBe(400);
    expect((await post('/admin/nights/new', { date: '2025-02-31' })).status).toBe(400);
    expect((await post('/admin/nights/new', { date: '2025-11-09', 'present[]': 'ghost' })).status).toBe(400);
    await setMain(env.DB, 'hexa', 'zefal');
    expect((await post('/admin/nights/new', { date: '2025-11-09', 'present[]': 'hexa' })).status).toBe(400);
    expect(await count('raid_night')).toBe(1);
  });

  it('presence override removes a player from a night', async () => {
    const id = await nightId();
    expect((await standing('Hexa'))!.raids).toBe(1);
    const r = await post(`/admin/nights/${id}/presence`, { nameKey: 'hexa', present: '0' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe(`/admin/nights/${id}`);
    expect((await standing('Hexa'))!.raids).toBe(0);
    const html = await (await get(`/admin/nights/${id}`)).text();
    expect(html).not.toContain('value="hexa"');
    expect(html).toContain('value="mankee"');
  });

  it('presence override for an unknown name creates a member character', async () => {
    const id = await nightId();
    await post(`/admin/nights/${id}/presence`, { nameKey: 'Newbie-Realm', present: '1' });
    const c = await env.DB.prepare('SELECT display_name, status, main_key, created_at FROM character WHERE name_key = ?').bind('newbie').first<any>();
    expect(c.display_name).toBe('Newbie');
    expect(c.status).toBe('member');
    expect(c.main_key).toBeNull();
    expect(Math.abs(c.created_at - Date.now() / 1000)).toBeLessThan(60);
    expect((await standing('Newbie'))!.raids).toBe(1);
    expect((await post(`/admin/nights/${id}/presence`, { nameKey: '  ', present: '1' })).status).toBe(400);
    expect((await post('/admin/nights/9999/presence', { nameKey: 'x', present: '1' })).status).toBe(400);
  });

  it('deleting a night cascades to kills and awards', async () => {
    const id = await nightId();
    expect(await count('award')).toBe(3);
    expect(await count('kill_member')).toBeGreaterThan(0);
    const r = await post(`/admin/nights/${id}/delete`, {});
    expect(r.status).toBe(302);
    for (const t of ['raid_night', 'kill', 'kill_member', 'award', 'night_override']) expect(await count(t)).toBe(0);
  });

  it('detail of an unknown night is 404', async () => {
    expect((await get('/admin/nights/9999')).status).toBe(404);
  });
});

describe('items', () => {
  it('item points change updates score; instance change moves awards', async () => {
    expect((await standing('Mankee'))!.score).toBe(1);
    const r = await post('/admin/items/100', { points: '3', instance: 'Blackwing Lair' });
    expect(r.status).toBe(302);
    expect((await standing('Mankee'))!.score).toBe(3);
    const a = await env.DB.prepare("SELECT instance FROM award WHERE darklight_id = 'a1'").first<any>();
    expect(a.instance).toBe('Blackwing Lair');
    const other = await env.DB.prepare("SELECT instance FROM award WHERE darklight_id = 'a2'").first<any>();
    expect(other.instance).toBe('Molten Core');
    expect(await (await SELF.fetch('https://x/raid/blackwing-lair')).text()).toContain('Item 100');
  });

  it('rejects bad points', async () => {
    expect((await post('/admin/items/100', { points: '-1', instance: 'X' })).status).toBe(400);
    expect((await post('/admin/items/100', { points: 'abc', instance: 'X' })).status).toBe(400);
    expect((await post('/admin/items/100', { points: '', instance: 'X' })).status).toBe(400);
    expect((await post('/admin/items/555', { points: '1', instance: 'X' })).status).toBe(400);
    expect((await post('/admin/items/100', { points: '0', instance: '' })).status).toBe(302);
  });

  it('lists sorted by name with drop counts and filters by q', async () => {
    await env.DB.prepare("UPDATE item SET name = 'zeta' WHERE item_id = 100").run();
    await env.DB.prepare("UPDATE item SET name = 'Alpha Blade' WHERE item_id = 101").run();
    const html = await (await get('/admin/items')).text();
    expect(html.indexOf('Alpha Blade')).toBeLessThan(html.indexOf('Item 102'));
    expect(html.indexOf('Item 102')).toBeLessThan(html.indexOf('zeta'));
    const f = await (await get('/admin/items?q=ALPHA')).text();
    expect(f).toContain('Alpha Blade');
    expect(f).not.toContain('zeta');
    expect(await (await get('/admin/items?q=%25')).text()).not.toContain('zeta');
  });
});

describe('loot', () => {
  it('deleted award no longer counts', async () => {
    expect((await standing('Mankee'))!.points).toBe(1);
    const r = await post('/admin/loot/a1', { nameKey: 'mankee', deleted: 'on' });
    expect(r.status).toBe(302);
    expect((await standing('Mankee'))!.points).toBe(0);
    await post('/admin/loot/a1', { nameKey: 'mankee' });
    expect((await standing('Mankee'))!.points).toBe(1);
  });

  it('reassigns an award and rejects unknown characters', async () => {
    await post('/admin/loot/a1', { nameKey: 'Zefal' });
    expect((await standing('Zefal'))!.points).toBe(2);
    const bad = await post('/admin/loot/a1', { nameKey: 'nobody' });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain('Unknown character');
    expect((await post('/admin/loot/zzz', { nameKey: 'zefal' })).status).toBe(400);
  });

  it('lists latest 100', async () => {
    const html = await (await get('/admin/loot')).text();
    expect(html).toContain('Item 100');
    expect(html).toContain('action="/admin/loot/a1"');
  });
});

describe('admins', () => {
  it('added admin can pass requireAdmin; bootstrap cannot be deleted', async () => {
    const other = `ld_session=${await signSession({ id: '222', name: 'Other' }, 'test-secret')}`;
    expect((await SELF.fetch('https://x/admin', { headers: { cookie: other }, redirect: 'manual' })).status).toBe(403);
    const r = await post('/admin/admins', { discordId: '222', name: 'Other' });
    expect(r.status).toBe(302);
    expect((await SELF.fetch('https://x/admin', { headers: { cookie: other } })).status).toBe(200);
    const list = await (await get('/admin/admins')).text();
    expect(list).toContain('Other');
    expect(list).toContain('111');
    expect(list).not.toContain('/admin/admins/111/delete');
    const del = await post('/admin/admins/111/delete', {});
    expect(del.status).toBe(400);
    expect((await post('/admin/admins/222/delete', {})).status).toBe(302);
    expect(await count('admin')).toBe(0);
    expect((await SELF.fetch('https://x/admin', { headers: { cookie: other }, redirect: 'manual' })).status).toBe(403);
  });

  it('rejects non-digit ids and empty names; escapes messages', async () => {
    const bad = await post('/admin/admins', { discordId: '12ab', name: 'X' });
    expect(bad.status).toBe(400);
    expect((await post('/admin/admins', { discordId: '', name: 'X' })).status).toBe(400);
    expect((await post('/admin/admins', { discordId: '123', name: ' ' })).status).toBe(400);
    const xss = await post('/admin/nights/new', { date: '<script>alert(1)</script>' });
    expect(xss.status).toBe(400);
    const html = await xss.text();
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('Admin');
  });
});

describe('auth guard', () => {
  it('all admin routes reject requests without session', async () => {
    const reqs: [string, string][] = [
      ['GET', '/admin/nights'], ['POST', '/admin/nights/new'], ['POST', '/admin/nights/1/counts'],
      ['GET', '/admin/nights/1'], ['POST', '/admin/nights/1/presence'], ['POST', '/admin/nights/1/delete'],
      ['GET', '/admin/characters'], ['POST', '/admin/characters/zefal'],
      ['GET', '/admin/items'], ['POST', '/admin/items/1'],
      ['GET', '/admin/loot'], ['POST', '/admin/loot/a1'],
      ['GET', '/admin/admins'], ['POST', '/admin/admins'], ['POST', '/admin/admins/1/delete'],
    ];
    for (const [method, path] of reqs) {
      const r = await SELF.fetch('https://x' + path, { method, redirect: 'manual' });
      expect(r.status, `${method} ${path}`).toBe(302);
      expect(r.headers.get('location'), `${method} ${path}`).toBe('/auth/login');
    }
  });
});
