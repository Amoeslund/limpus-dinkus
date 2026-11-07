import { it, expect } from 'vitest';
import { nightDateFor, isoWeek, nightLabel } from '../src/domain/nights';

it('nightDateFor handles midnight and DST', () => {
  // 2026-11-11 21:14 CET
  expect(nightDateFor(Date.UTC(2026, 10, 11, 20, 14) / 1000)).toBe('2026-11-11');
  // 2026-11-12 00:30 CET -> previous night
  expect(nightDateFor(Date.UTC(2026, 10, 11, 23, 30) / 1000)).toBe('2026-11-11');
  // 2026-11-12 06:00 CET -> new day
  expect(nightDateFor(Date.UTC(2026, 10, 12, 5, 0) / 1000)).toBe('2026-11-12');
  // DST end 2026-10-25: 05:30 CET local = 04:30 UTC -> still the 24th
  expect(nightDateFor(Date.UTC(2026, 9, 25, 4, 30) / 1000)).toBe('2026-10-24');
  // summer: 2026-07-01 23:00 CEST = 21:00 UTC
  expect(nightDateFor(Date.UTC(2026, 6, 1, 21, 0) / 1000)).toBe('2026-07-01');
});

it('isoWeek and nightLabel', () => {
  expect(isoWeek('2026-11-11')).toBe(46);
  expect(isoWeek('2027-01-01')).toBe(53);
  expect(nightLabel('2026-11-11')).toBe('Wk 46 · Wed 11 Nov');
});
