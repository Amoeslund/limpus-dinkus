import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { effortScore, parseCharacterPage } from '../src/domain/gear';
import { pollGear } from '../src/db/gear';
import { loadRoster, pollArmory, saveGuildPulse } from '../src/db/roster';
import { parseGuildPulse } from '../src/domain/roster';
import { adminCookie } from './helpers';

const DAY = 86400;

const item = (slot: string, id: number, name: string, ilvl: number, context: number, quality = 'RARE') =>
  ({ id, name, slot: { type: slot, name: slot }, level: { value: ilvl }, quality: { type: quality }, context });
const page = (ilvl: number, items: any[], updated = 1794537969000) =>
  `<html><script type="text/javascript" id="character-profile-mount-initial-state">var characterProfileInitialState = ${JSON.stringify({
    character: {
      averageItemLevel: ilvl, lastUpdatedTimestamp: { epoch: updated, iso8601: 'x' },
      gear: Object.fromEntries(items.map((i) => [i.slot.type.toLowerCase(), i])),
    },
  })};\n</script></html>`;
const armory = (roster: any[]) => ({ data: { Guild: { roster } } });
const member = (name: string, surname: string, level: number) =>
  ({ rank: { rankId: 3 }, character: { _id: `eu-${name}-${surname}`.toLowerCase(), name, surname, level, class: { name: 'Rogue' } } });
const json = (j: unknown) => (async () => new Response(JSON.stringify(j))) as unknown as typeof fetch;
/** Serves character pages by slug. */
const pages = (bySlug: Record<string, string>) =>
  (async (url: string) => {
    const slug = String(url).split('/').pop()!;
    return bySlug[slug] ? new Response(bySlug[slug]) : new Response('nope', { status: 500 });
  }) as unknown as typeof fetch;

beforeEach(async () => {
  for (const t of ['roster_member', 'roster_level', 'roster_activity', 'roster_rank', 'roster_meta',
    'roster_profile', 'roster_gear', 'roster_item', 'roster_ilvl'])
    await env.DB.prepare(`DELETE FROM ${t}`).run();
});

describe('character page parsing', () => {
  it('reads item level, gear and the last update time', () => {
    const r = parseCharacterPage(page(48, [item('HEAD', 1, 'Bad Mojo Mask', 50, 1), item('TABARD', 2, 'Tabard', 20, 11)]));
    expect(r).toEqual({
      ok: true,
      value: { ilvl: 48, armoryUpdated: 1794537969, gear: [{ slot: 'HEAD', itemId: 1, name: 'Bad Mojo Mask', ilvl: 50, quality: 'RARE', source: 1 }] },
    });
    expect(parseCharacterPage('<html></html>').ok).toBe(false);
  });
});

describe('effort score', () => {
  const base = { level: 60, maxLevel: 60, levelGain: 0, seen7d: null, dungeon7d: null, raid7d: null, newDungeonItems: null, newOtherItems: null, ilvlGain: null };
  it('scales the parts that have data to 100', () => {
    expect(effortScore(base).score).toBeNull();
    // Gear only: 2 dungeon items (10) + 1 ilvl (3) = 13 of 25.
    expect(effortScore({ ...base, newDungeonItems: 2, newOtherItems: 0, ilvlGain: 1 }).score).toBe(52);
    // 4 h dungeons + 10 h outside raids + 25 gear = 85 of 85.
    expect(effortScore({ ...base, seen7d: 14 * 3600, raid7d: 4 * 3600, dungeon7d: 4 * 3600, newDungeonItems: 5, newOtherItems: 0, ilvlGain: 0 }).score).toBe(100);
  });
  it('counts only levels below 55', () => {
    const low = { ...base, level: 40, seen7d: 20 * 3600, dungeon7d: 10 * 3600, newDungeonItems: 5, newOtherItems: 0, ilvlGain: 5 };
    expect(effortScore({ ...low, levelGain: 0 }).score).toBe(0);
    expect(effortScore({ ...low, levelGain: 2 }).score).toBe(67);
    expect(effortScore({ ...low, levelGain: 4 }).score).toBe(100);
    expect(effortScore({ ...low, levelGain: 1, levelPartial: true }).score).toBeNull();
    expect(effortScore({ ...low, levelGain: 2 }).parts.map((p) => p.label)).toEqual(['Levels']);
  });

  it('flags raid-loggers', () => {
    const e = effortScore({ ...base, seen7d: 3 * 3600, raid7d: 3 * 3600, dungeon7d: 0, newDungeonItems: 0, newOtherItems: 0, ilvlGain: 0 });
    expect(e.raidLogger).toBe(true);
    expect(e.score).toBe(0);
  });
});

describe('gear polling', () => {
  it('stores gear, treats the first fetch as baseline and counts new non-raid items', async () => {
    const now = Math.floor(Date.now() / 1000);
    await pollArmory(env.DB, now - 9 * DAY, json(armory([member('Exi', 'Liria', 58), member('Bank', 'Alt', 1)])));
    const first = await pollGear(env.DB, now - 8 * DAY, pages({ 'exi-liria': page(40, [item('HEAD', 1, 'Old Hat', 40, 11)]) }));
    expect(first).toEqual({ fetched: 1, errors: 0 });  // the level 1 alt is skipped
    await pollGear(env.DB, now - DAY, pages({
      'exi-liria': page(44, [item('HEAD', 2, 'Bad Mojo Mask', 50, 1), item('CHEST', 3, 'Raid Robe', 60, 3), item('FEET', 4, 'Quest Boots', 45, 11)]),
    }));
    const row = (await loadRoster(env.DB, now)).rows.find((r) => r.nameKey === 'exi liria')!;
    expect(row).toMatchObject({ ilvl: 44, ilvlGain: 4, ilvlPartial: false, newDungeonItems: 1, newOtherItems: 1 });
    expect(row.lastOnline).toBe(1794537969);
  });

  it('records a failed fetch and moves on', async () => {
    const now = Math.floor(Date.now() / 1000);
    await pollArmory(env.DB, now, json(armory([member('Gone', 'Guy', 30)])));
    expect(await pollGear(env.DB, now, pages({}))).toEqual({ fetched: 0, errors: 1 });
    const row = (await loadRoster(env.DB, now)).rows[0];
    expect(row.gearError).toContain('500');
  });
});

describe('dungeon time and the member page', () => {
  it('imports dungeon/raid time and shows the gear page', async () => {
    const now = Math.floor(Date.now() / 1000);
    await pollArmory(env.DB, now - 60, json(armory([member('Exi', 'Liria', 58)])));
    await pollGear(env.DB, now, pages({ 'exi-liria': page(48, [item('HEAD', 7, 'Bad Mojo Mask', 50, 1)]) }));
    const rep = parseGuildPulse(JSON.stringify({ addon: 'GuildPulse', version: 1, at: now,
      members: [{ name: 'Exi Liria', level: 58, seen7d: 7200, dungeon7d: 3600, raid7d: 0 }] }), now);
    if (!rep.ok) throw new Error(rep.error);
    await saveGuildPulse(env.DB, rep.value);
    const row = (await loadRoster(env.DB, now)).rows[0];
    expect(row).toMatchObject({ dungeon7d: 3600, raid7d: 0 });
    expect(row.effort.score).not.toBeNull();

    const cookie = await adminCookie();
    const list = await (await SELF.fetch('https://x/admin/roster?sort=effort', { headers: { cookie } })).text();
    expect(list).toContain('/admin/roster/member/exi%20liria');
    expect(list).toContain('1h00');
    const r = await SELF.fetch('https://x/admin/roster/member/exi%20liria', { headers: { cookie } });
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('Bad Mojo Mask');
    expect(html).toContain('Dungeon');
    expect(html).toContain('before tracking');
  });

  it('treats reports from older Guild Pulse versions as unknown dungeon time', async () => {
    const rep = parseGuildPulse(JSON.stringify({ addon: 'GuildPulse', version: 1, at: 1, members: [{ name: 'A B', seen7d: 60 }] }), 10);
    expect(rep.ok && rep.value.members[0].dungeon7d).toBeNull();
  });
});
