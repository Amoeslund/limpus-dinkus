import { expect, it } from 'vitest';
import type { Standing } from '../src/domain/standings';
import { compareRows, SORT_SCRIPT, type SortRow } from '../src/views/attendance-sort';
import { AttendancePage } from '../src/views/public';

const rows: SortRow[] = [
  { name: 'Zarry', pr: 1.5, ep: 300, gp: 200, raids: 6, pct: 40 },
  { name: 'Kruse', pr: null, ep: null, gp: null, raids: 0, pct: 0 },
  { name: 'Ildkule', pr: 0.7, ep: 70, gp: 100, raids: 16, pct: 100 },
  { name: 'Audron', pr: 1.5, ep: 150, gp: 100, raids: 4, pct: 25 },
  { name: 'Bob', pr: null, ep: 20, gp: 0, raids: 1, pct: 50 },
];
const names = (key: Parameters<typeof compareRows>[2], dir: 1 | -1) =>
  [...rows].sort((a, b) => compareRows(a, b, key, dir)).map((r) => r.name);

it('PR descending puts highest first, ties by name, no PR last', () => {
  expect(names('pr', -1)).toEqual(['Audron', 'Zarry', 'Ildkule', 'Bob', 'Kruse']);
});
it('PR ascending still keeps no PR last', () => {
  expect(names('pr', 1)).toEqual(['Ildkule', 'Audron', 'Zarry', 'Bob', 'Kruse']);
});
it('EP and GP sort with missing values last', () => {
  expect(names('ep', -1)).toEqual(['Zarry', 'Audron', 'Ildkule', 'Bob', 'Kruse']);
  expect(names('gp', -1)).toEqual(['Zarry', 'Audron', 'Ildkule', 'Bob', 'Kruse']);
  expect(names('gp', 1)).toEqual(['Bob', 'Audron', 'Ildkule', 'Zarry', 'Kruse']);
});
it('sorts by name, raids and attendance', () => {
  expect(names('name', 1)).toEqual(['Audron', 'Bob', 'Ildkule', 'Kruse', 'Zarry']);
  expect(names('name', -1)).toEqual(['Zarry', 'Kruse', 'Ildkule', 'Bob', 'Audron']);
  expect(names('raids', -1)).toEqual(['Ildkule', 'Zarry', 'Audron', 'Bob', 'Kruse']);
  expect(names('pct', -1)[0]).toBe('Ildkule');
});

const st = (displayName: string, ep: number | null, gp: number | null, pr: number | null, belowMinEp = false): Standing =>
  ({ mainKey: displayName.toLowerCase(), displayName, alts: [], raids: 6, attendancePct: 40, cells: {}, ep, gp, pr, belowMinEp });

it('below min EP (PR 0) sorts after eligible players and before no standings', () => {
  const html = AttendancePage({ nights: [], epgpImportedAt: null, standings: [
    st('Aaron', 999, 0, 0, true), st('Kruse', null, null, null), st('Zed', 1000, 9900, 0.1)] }).toString();
  expect(html.indexOf('data-name="Zed"')).toBeLessThan(html.indexOf('data-name="Aaron"'));
  expect(html.indexOf('data-name="Aaron"')).toBeLessThan(html.indexOf('data-name="Kruse"'));
  expect(html).toContain('data-name="Aaron" data-pr="0"');
});

it('attendance table exposes sort buttons and row data, PR highest first by default', () => {
  const html = AttendancePage({ nights: [], epgpImportedAt: null, standings: [
    st('Kruse', null, null, null), st('Ildkule', 70, 100, 0.7), st('Zarry', 300, 200, 1.5)] }).toString();
  expect(html).toContain('data-sortable');
  for (const k of ['name', 'pr', 'ep', 'gp', 'raids', 'pct']) expect(html).toContain(`data-key="${k}"`);
  expect(html).not.toContain('data-key="score"');
  expect(html).toContain('data-name="Zarry" data-pr="1.5" data-ep="300" data-gp="200" data-raids="6" data-pct="40"');
  expect(html).toContain('data-name="Kruse" data-pr="" data-ep="" data-gp=""');
  expect(html.indexOf('data-name="Zarry"')).toBeLessThan(html.indexOf('data-name="Ildkule"'));
  expect(html.indexOf('data-name="Ildkule"')).toBeLessThan(html.indexOf('data-name="Kruse"'));
  expect(html).toContain('compareRows');
});

it('the browser script uses a new storage key and the PR default', () => {
  expect(SORT_SCRIPT).toContain('"attSort2"');
  expect(SORT_SCRIPT).not.toContain("'attSort'");
  expect(SORT_SCRIPT).toContain('{"key":"pr","dir":-1}');
  expect(SORT_SCRIPT).toContain('"pr":-1');
  // The inlined source must parse as plain JavaScript.
  expect(() => new Function(SORT_SCRIPT)).not.toThrow();
});
