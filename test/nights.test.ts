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

it('nightDateFor cutoff boundary and DST start', () => {
  // 2026-11-12 05:59 CET = 04:59 UTC -> previous date; 06:00 -> same date
  expect(nightDateFor(Date.UTC(2026, 10, 12, 4, 59) / 1000)).toBe('2026-11-11');
  expect(nightDateFor(Date.UTC(2026, 10, 12, 5, 0) / 1000)).toBe('2026-11-12');
  // DST start 2026-03-29: 05:30 CEST = 03:30 UTC -> still the 28th; 06:00 CEST = 04:00 UTC -> the 29th
  expect(nightDateFor(Date.UTC(2026, 2, 29, 3, 30) / 1000)).toBe('2026-03-28');
  expect(nightDateFor(Date.UTC(2026, 2, 29, 4, 0) / 1000)).toBe('2026-03-29');
});

it('isoWeek early January belongs to week 1', () => {
  expect(isoWeek('2024-12-30')).toBe(1);
});

it('nightLabel uses 3-letter month names', () => {
  expect(nightLabel('2026-09-16')).toBe('Wk 38 · Wed 16 Sep');
});
