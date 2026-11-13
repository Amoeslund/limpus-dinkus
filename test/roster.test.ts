import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { levelGain, parseArmoryRoster, parseGuildPulse } from '../src/domain/roster';
import { loadRoster, pollArmory } from '../src/db/roster';
import { adminCookie } from './helpers';

const DAY = 86400;
const T0 = 1762290000;

const member = (name: string, surname: string, level: number, rankId: number, cls = 'Warlock') =>
  ({ rank: { rankId, name: null }, character: { name, surname, level, class: { name: cls } } });
const armory = (roster: any[]) => ({ data: { Guild: { roster } } });
const fakeFetch = (json: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(json), { status })) as unknown as typeof fetch;

const pulse = (at: number, members: any[]) => JSON.stringify({ addon: 'GuildPulse', version: 1, at, members });

beforeEach(async () => {
  for (const t of ['roster_member', 'roster_level', 'roster_activity', 'roster_rank', 'roster_meta'])
    await env.DB.prepare(`DELETE FROM ${t}`).run();
});

describe('roster parsing', () => {
  it('joins first name and surname like the game does', () => {
    const r = parseArmoryRoster(armory([member('Prim', 'Ordial', 36, 3)]));
    expect(r).toEqual({ ok: true, value: [{ nameKey: 'prim ordial', display: 'Prim Ordial', cls: 'Warlock', level: 36, rankId: 3 }] });
  });

  it('reports armory errors', () => {
    expect(parseArmoryRoster({ errors: [{ message: 'PersistedQueryNotFound' }] })).toMatchObject({ ok: false, error: expect.stringContaining('PersistedQueryNotFound') });
    expect(parseArmoryRoster({ data: { Guild: null } }).ok).toBe(false);
  });

  it('parses a Guild Pulse export and collects rank names', () => {
    const r = parseGuildPulse(pulse(T0, [{ name: 'Prim Ordial', level: 36, rank: 'Raider', rankIndex: 3, lastOnline: T0 - 100, seen7d: 7200, avgDay: 3600, share: 0.5 }]), T0);
    expect(r.ok && r.value.members[0]).toMatchObject({ nameKey: 'prim ordial', lastOnline: T0 - 100, seen7d: 7200 });
    expect(r.ok && r.value.ranks).toEqual([{ id: 3, name: 'Raider' }]);
    expect(parseGuildPulse('{"addon":"Other","members":[]}', T0).ok).toBe(false);
    expect(parseGuildPulse('nope', T0).ok).toBe(false);
  });

  it('computes level gain over 7 days', () => {
    const h = [{ at: T0, level: 30 }, { at: T0 + 2 * DAY, level: 32 }, { at: T0 + 9 * DAY, level: 35 }];
    expect(levelGain(h, 35, T0 + 10 * DAY)).toEqual({ gain: 3, partial: false });
    expect(levelGain(h.slice(0, 1), 30, T0 + DAY)).toEqual({ gain: 0, partial: true });
  });
});

describe('armory polling', () => {
  it('stores snapshots, level changes and members who left', async () => {
    await pollArmory(env.DB, T0, fakeFetch(armory([member('Prim', 'Ordial', 30, 3), member('Knee', 'Punter', 20, 4)])));
    const r2 = await pollArmory(env.DB, T0 + 8 * DAY, fakeFetch(armory([member('Prim', 'Ordial', 34, 3)])));
    expect(r2).toEqual({ ok: true, value: { members: 1, levelChanges: 1 } });
    const data = await loadRoster(env.DB, T0 + 8 * DAY);
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0]).toMatchObject({ display: 'Prim Ordial', level: 34, gain: 4, partial: false });
    expect(data.armoryAt).toBe(T0 + 8 * DAY);
  });

  it('records a failed poll without touching the roster', async () => {
    const r = await pollArmory(env.DB, T0, fakeFetch({ errors: [{ message: 'PersistedQueryNotFound' }] }));
    expect(r.ok).toBe(false);
    const data = await loadRoster(env.DB, T0);
    expect(data.rows).toHaveLength(0);
    expect(data.armoryError?.message).toContain('PersistedQueryNotFound');
  });
});

describe('admin roster page', () => {
  const post = async (path: string, fields: Record<string, string>) =>
    SELF.fetch('https://x' + path, {
      method: 'POST', redirect: 'manual',
      headers: { cookie: await adminCookie(), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields),
    });

  it('requires login', async () => {
    const r = await SELF.fetch('https://x/admin/roster', { redirect: 'manual' });
    expect(r.status).toBe(302);
  });

  it('imports a Guild Pulse report and shows it next to the armory data', async () => {
    const now = Math.floor(Date.now() / 1000);
    await pollArmory(env.DB, now - 60, fakeFetch(armory([member('Prim', 'Ordial', 36, 3)])));
    const r = await post('/admin/roster/import', {
      pulseText: pulse(now, [{ name: 'Prim Ordial', level: 36, rank: 'Raider', rankIndex: 3, lastOnline: now - 3 * DAY, seen7d: 5400, avgDay: 1800, share: 0.25 }]),
    });
    expect(r.status).toBe(302);
    const page = await SELF.fetch('https://x/admin/roster?rank=3', { headers: { cookie: await adminCookie() } });
    const html = await page.text();
    expect(html).toContain('Prim Ordial');
    expect(html).toContain('Raider');
    expect(html).toContain('3d ago');
    expect(html).toContain('1h30');
  });

  it('rejects a bad report and keeps the text', async () => {
    const r = await post('/admin/roster/import', { pulseText: 'not json' });
    expect(r.status).toBe(400);
    expect(await r.text()).toContain('not valid JSON');
  });

  it('keeps the newest last-online value across reports', async () => {
    const now = Math.floor(Date.now() / 1000);
    await pollArmory(env.DB, now - 60, fakeFetch(armory([member('Prim', 'Ordial', 36, 3)])));
    await post('/admin/roster/import', { pulseText: pulse(now - 100, [{ name: 'Prim Ordial', lastOnline: now - 200, seen7d: 100 }]) });
    await post('/admin/roster/import', { pulseText: pulse(now - 500, [{ name: 'Prim Ordial', lastOnline: now - 9 * DAY, seen7d: 999 }]) });
    const row = (await loadRoster(env.DB, now)).rows[0];
    expect(row.lastOnline).toBe(now - 200);
    expect(row.seen7d).toBe(100);
  });
});
