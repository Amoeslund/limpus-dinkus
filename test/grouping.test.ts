import { it, expect } from 'vitest';
import { assignInstance, groupIntoNights } from '../src/domain/grouping';
import type { KillInput } from '../src/domain/limpus';
import type { AwardInput } from '../src/domain/darklight';

const k = (t: number, zone: string, boss = 'B'): KillInput => ({ t, zone, boss, members: [] });
const award = (t: number, id = String(t)): AwardInput => ({ darklightId: id, t, nameKey: 'a', displayName: 'A',
  itemId: 1, itemName: 'I', response: 'BiS' });
const ts = (iso: string) => Date.parse(iso) / 1000;

it('assignInstance uses latest kill at or before loot, else earliest kill', () => {
  const kills = [k(100, 'Molten Core'), k(500, "Zul'Gurub")];
  expect(assignInstance(300, kills)).toBe('Molten Core');
  expect(assignInstance(500, kills)).toBe("Zul'Gurub");
  expect(assignInstance(50, kills)).toBe('Molten Core');
  expect(assignInstance(50, [])).toBeNull();
});
it('groupIntoNights groups across midnight and assigns instances per night', () => {
  // CET (UTC+1) in November: Wed 11 Nov 21:00 = 20:00Z; Thu 00:30 = Wed 23:30Z
  const mc = k(ts('2026-11-11T20:00:00Z'), 'Molten Core');
  const zg = k(ts('2026-11-11T23:30:00Z'), "Zul'Gurub");
  const loot = award(ts('2026-11-11T23:40:00Z'));
  const nights = groupIntoNights([zg, mc], [loot]);
  expect(nights).toHaveLength(1);
  expect(nights[0].nightDate).toBe('2026-11-11');
  expect(nights[0].kills.map(x => x.zone)).toEqual(['Molten Core', "Zul'Gurub"]);
  expect(nights[0].awards[0].instance).toBe("Zul'Gurub");
});
it('loot on a date with no kills gets its own night with null instance, sorted by date', () => {
  const mc = k(ts('2026-11-11T20:00:00Z'), 'Molten Core');
  const early = award(ts('2026-11-04T20:00:00Z'));
  const nights = groupIntoNights([mc], [early]);
  expect(nights.map(n => n.nightDate)).toEqual(['2026-11-04', '2026-11-11']);
  expect(nights[0].kills).toEqual([]);
  expect(nights[0].awards[0].instance).toBeNull();
});
