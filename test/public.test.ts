import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { commitImport, type ImportRequest } from '../src/db/importer';
import { adminCookie } from './helpers';

const T1 = 1762290000, T3 = T1 + 7 * 86400; // Wk 45 and Wk 46 of 2025
const rec = (id: string, t: number, player: string, itemId: number, itemName: string, response = 'BiS') =>
  ({ id, timestamp: t, player, itemId, itemName, response });
const req: ImportRequest = {
  lootText: JSON.stringify({ addon: 'DarklightLC', test: false, records: [
    rec('a1', T1 + 100, 'Mankee', 100, 'Talisman <b>X</b>'),
    rec('a2', T1 + 200, 'Zefal', 101, 'Ring of Y', 'Offspec'),
    rec('a3', T3 + 100, 'Hexa', 102, 'Staff of Z', 'Upgrade'),
  ] }),
  attendanceText: JSON.stringify({ addon: 'LimpusAttendance', version: 1, kills: [
    { t: T1, zone: 'Molten Core', boss: 'Lucifron', raid: ['Mankee', 'Zefal', 'GuestGuy'] },
    { t: T3, zone: 'Molten Core', boss: 'Magmadar', raid: ['Mankee', 'Hexa', 'GuestGuy'] },
  ] }),
  instancePicks: {}, countsOff: [],
};
const get = async (p: string) => { const r = await SELF.fetch('https://x' + p); return { status: r.status, html: await r.text() }; };
const clear = async () => {
  for (const t of ['award', 'item', 'kill_member', 'kill', 'night_override', 'raid_night', 'character', 'import_log', 'epgp_standing', 'epgp_meta'])
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  // Public pages are cached for 60 s; drop them so each test sees its own data.
  for (const p of ['/', '/raid', '/raid/molten-core']) await caches.default.delete('https://x' + p);
};

describe('public pages', () => {
  beforeEach(clear);

  it('empty database renders without error', async () => {
    expect((await get('/')).status).toBe(200);
    expect((await get('/raid')).html).toContain('No raids yet');
  });

  describe('with data', () => {
    beforeEach(async () => {
      await commitImport(env.DB, req, '111');
      await env.DB.prepare("UPDATE character SET status='member' WHERE name_key IN ('mankee','zefal','hexa')").run();
      await env.DB.prepare("UPDATE character SET status='guest' WHERE name_key='guestguy'").run();
      await env.DB.prepare("UPDATE character SET main_key='mankee' WHERE name_key='zefal'").run();
    });

    it('attendance page lists members with EPGP standings', async () => {
      await commitImport(env.DB, { lootText: '', attendanceText: '', epgpText: 'Name,Class,EP,GP\nMankee,Warrior,1000,400\nHexa,Priest,300,100',
        instancePicks: {}, countsOff: [] }, '111');
      const { html } = await get('/');
      expect(html).toContain('<td class="c num pin pin-pr">2.50</td><td class="c num">1000</td><td class="c num">400</td>');
      expect(html.indexOf('data-name="Hexa"')).toBeLessThan(html.indexOf('data-name="Mankee"')); // PR 3.00 before 2.50
      expect(html).toContain('EPGP standings as of');
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('Mankee'); expect(html).toContain('Wk 46');
      expect(html).not.toContain('GuestGuy');
      expect(html).toContain('/raid/molten-core'); expect(html).toContain('/admin');
    });

    it('raid page shows loot log and EPGP standings, highest PR first', async () => {
      await commitImport(env.DB, { lootText: '', attendanceText: '', epgpText: 'Mankee,100,100\nHexa,300,100',
        instancePicks: {}, countsOff: [] }, '111');
      const { status, html } = await get('/raid/molten-core');
      expect(status).toBe(200);
      const log = html.slice(html.indexOf('<h3>Loot log</h3>'), html.indexOf('<h3>EPGP standings</h3>'));
      expect(log).toContain('href="https://www.wowhead.com/forever/item=102"');
      expect(log).toContain('<span class="pill p-upgrade">Upgrade</span>');
      expect(log).toContain('<span class="pill p-os">Offspec</span>');
      expect(log).toContain('<span class="pill p-bis">BiS</span>');
      expect(log).toContain('Wk 46');
      expect(log).toContain('Mankee<span class="alt"> Zefal</span>'); // alt shown after the main
      expect(log).not.toContain('<span class="pill pug">');
      expect(log).not.toContain(' pt</td>');
      const epgp = html.slice(html.indexOf('<h3>EPGP standings</h3>'));
      expect(epgp).toContain('<tr><th>Player</th><th class="c">EP</th><th class="c">GP</th><th class="c">PR</th></tr>');
      expect(epgp.indexOf('Hexa')).toBeLessThan(epgp.indexOf('Mankee')); // 3.00 before 1.00
      expect(epgp).toContain('<td>Hexa</td><td class="c num">300</td><td class="c num">100</td><td class="c num">3.00</td>');
    });

    it('EPGP table puts members without standings (—) last', async () => {
      await commitImport(env.DB, { lootText: '', attendanceText: '', epgpText: 'Hexa,10,100', instancePicks: {}, countsOff: [] }, '111');
      const { html } = await get('/raid/molten-core');
      const epgp = html.slice(html.indexOf('<h3>EPGP standings</h3>'));
      expect(epgp.indexOf('Hexa')).toBeLessThan(epgp.indexOf('Mankee'));
      expect(epgp).toContain('<td>Mankee</td><td class="c num">—</td><td class="c num">—</td><td class="c num">—</td>');
    });

    it('says when no EPGP standings have been imported', async () => {
      expect((await get('/')).html).toContain('No EPGP standings imported yet.');
      expect((await get('/raid/molten-core')).html).toContain('No EPGP standings imported yet.');
    });

    it('escapes item names', async () => {
      const { html } = await get('/raid/molten-core');
      expect(html).not.toContain('<b>X</b>'); expect(html).toContain('&lt;b&gt;X&lt;/b&gt;');
    });

    it('tags non-counting nights as pug', async () => {
      await env.DB.prepare('UPDATE raid_night SET counts=0 WHERE night_date=(SELECT MIN(night_date) FROM raid_night)').run();
      const { html } = await get('/raid/molten-core');
      expect(html).toContain('<span class="pill pug">pug</span>');
    });

    it('/raid redirects to the first instance', async () => {
      const r = await SELF.fetch('https://x/raid', { redirect: 'manual' });
      expect(r.status).toBe(302); expect(r.headers.get('location')).toBe('/raid/molten-core');
    });
  });

  it('HTML pages start with a doctype (no quirks mode)', async () => {
    expect((await get('/')).html).toMatch(/^<!doctype html>/i);
    const admin = await SELF.fetch('https://x/admin', { headers: { cookie: await adminCookie() } });
    expect(admin.status).toBe(200);
    expect(await admin.text()).toMatch(/^<!doctype html>/i);
    expect((await get('/raid/nope')).html).toMatch(/^<!doctype html>/i);
  });

  it('unknown raid slug is 404', async () => { expect((await get('/raid/nope')).status).toBe(404); });
});

it('every page shows the guild logo and favicon', async () => {
  const { html } = await get('/');
  expect(html).toContain('<img src="/logo.png"');
  expect(html).toContain('<link rel="icon" type="image/png" href="/favicon.png"/>');
});
