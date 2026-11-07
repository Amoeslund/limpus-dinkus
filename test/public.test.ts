import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { commitImport, type ImportRequest } from '../src/db/importer';

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
  for (const t of ['award', 'item', 'kill_member', 'kill', 'night_override', 'raid_night', 'character', 'import_log'])
    await env.DB.prepare(`DELETE FROM ${t}`).run();
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

    it('attendance page lists members with score', async () => {
      const { html } = await get('/');
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('Mankee'); expect(html).toContain('Wk 46');
      expect(html).not.toContain('GuestGuy');
      expect(html).toContain('/raid/molten-core'); expect(html).toContain('/admin');
    });

    it('raid page shows loot log and score table sorted lowest first', async () => {
      const { status, html } = await get('/raid/molten-core');
      expect(status).toBe(200);
      const log = html.slice(html.indexOf('<h3>Loot log</h3>'), html.indexOf('<h3>Score (all raids)</h3>'));
      expect(log).toContain('href="https://www.wowhead.com/forever/item=102"');
      expect(log).toContain('<span class="pill p-upgrade">Upgrade</span>');
      expect(log).toContain('<span class="pill p-os">Offspec</span>');
      expect(log).toContain('<span class="pill p-bis">BiS</span>');
      expect(log).toContain('Wk 46');
      expect(log).toContain('Mankee<span class="alt"> Zefal</span>'); // alt shown after the main
      expect(log).not.toContain('<span class="pill pug">');
      const score = html.slice(html.indexOf('<h3>Score (all raids)</h3>'));
      expect(score.indexOf('Mankee')).toBeLessThan(score.indexOf('Hexa')); // 0.50 before 1.00
    });

    it('score table puts members with no raids (—) last', async () => {
      await env.DB.prepare("INSERT INTO character (name_key, display_name, main_key, status, created_at) VALUES ('nobody','Nobody',NULL,'member',0)").run();
      const { html } = await get('/raid/molten-core');
      const score = html.slice(html.indexOf('<h3>Score (all raids)</h3>'));
      expect(score.indexOf('Hexa')).toBeLessThan(score.indexOf('Nobody'));
      expect(score).toMatch(/Nobody<\/td><td class="c num">0<\/td><td class="c num">0<\/td><td class="c num">—<\/td>/);
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

    it('loot on pug nights shows 0 pt', async () => {
      await env.DB.prepare('UPDATE raid_night SET counts=0').run();
      const { html } = await get('/raid/molten-core');
      const log = html.slice(html.indexOf('<h3>Loot log</h3>'), html.indexOf('<h3>Score (all raids)</h3>'));
      expect(log).toContain('<td class="num">0 pt</td>');
      expect(log).not.toContain('<td class="num">1 pt</td>');
    });

    it('rounds displayed points to two decimals', async () => {
      await env.DB.prepare('UPDATE item SET points = 0.1 + 0.2 WHERE item_id=100').run();
      const { html } = await get('/raid/molten-core');
      expect(html).not.toContain('0.30000000000000004');
      expect(html).toContain('<td class="num">0.3 pt</td>');
      expect(html).toMatch(/Mankee<\/td><td class="c num">\d+<\/td><td class="c num">0.3<\/td>/);
    });

    it('/raid redirects to the first instance', async () => {
      const r = await SELF.fetch('https://x/raid', { redirect: 'manual' });
      expect(r.status).toBe(302); expect(r.headers.get('location')).toBe('/raid/molten-core');
    });
  });

  it('unknown raid slug is 404', async () => { expect((await get('/raid/nope')).status).toBe(404); });
});
