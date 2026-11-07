import { expect, it } from 'vitest';
import { compareRows, type SortRow } from '../src/views/attendance-sort';
import { AttendancePage } from '../src/views/public';

const rows: SortRow[] = [
  { name: 'Zarry', score: 1.5, raids: 6, pct: 40 },
  { name: 'Kruse', score: null, raids: 0, pct: 0 },
  { name: 'Ildkule', score: 0.7, raids: 16, pct: 100 },
  { name: 'Audron', score: 1.5, raids: 4, pct: 25 },
];
const names = (key: Parameters<typeof compareRows>[2], dir: 1 | -1) =>
  [...rows].sort((a, b) => compareRows(a, b, key, dir)).map((r) => r.name);

it('score ascending puts lowest first, ties by name, no score last', () => {
  expect(names('score', 1)).toEqual(['Ildkule', 'Audron', 'Zarry', 'Kruse']);
});
it('score descending still keeps no score last', () => {
  expect(names('score', -1)).toEqual(['Audron', 'Zarry', 'Ildkule', 'Kruse']);
});
it('sorts by name, raids and attendance', () => {
  expect(names('name', 1)).toEqual(['Audron', 'Ildkule', 'Kruse', 'Zarry']);
  expect(names('raids', -1)).toEqual(['Ildkule', 'Zarry', 'Audron', 'Kruse']);
  expect(names('pct', -1)[0]).toBe('Ildkule');
});
it('attendance table exposes sort buttons and row data', () => {
  const html = AttendancePage({ nights: [], standings: [{ mainKey: 'zarry', displayName: 'Zarry', alts: [], raids: 6, points: 9,
    score: 1.5, attendancePct: 40, cells: {} }] }).toString();
  expect(html).toContain('data-sortable');
  for (const k of ['name', 'score', 'raids', 'pct']) expect(html).toContain(`data-key="${k}"`);
  expect(html).toContain('data-name="Zarry" data-score="1.5" data-raids="6" data-pct="40"');
  expect(html).toContain('compareRows');
});
