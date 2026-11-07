import { it, expect } from 'vitest';
import { parseLimpus } from '../src/domain/limpus';

const exp = (o: object = {}) => JSON.stringify({ addon: 'LimpusAttendance', version: 1, exportedAt: 1, kills: [], ...o });

it('parseLimpus parses kills and dedupes members', () => {
  const r = parseLimpus(exp({ kills: [{ t: 100, zone: 'Molten Core', boss: 'Lucifron', raid: ['Ildkule', 'ildkule-Forever', 'Mankee'] }] }));
  expect(r.ok && r.value[0].members.map(m => m.nameKey)).toEqual(['ildkule', 'mankee']);
  expect(r.ok && r.value[0]).toMatchObject({ t: 100, zone: 'Molten Core', boss: 'Lucifron' });
  expect(r.ok && r.value[0].members[0].displayName).toBe('Ildkule');
});
it('parseLimpus rejects other addons and unknown versions', () => {
  expect(parseLimpus(exp({ addon: 'X' })).ok).toBe(false);
  expect(parseLimpus(exp({ version: 2 })).ok).toBe(false);
});
it('parseLimpus rejects invalid JSON and missing kills', () => {
  expect(parseLimpus('{nope').ok).toBe(false);
  expect(parseLimpus(JSON.stringify({ addon: 'LimpusAttendance', version: 1 })).ok).toBe(false);
});
it('parseLimpus treats empty input as no kills', () => {
  expect(parseLimpus('  ')).toEqual({ ok: true, value: [], warnings: [] });
});
it('parseLimpus skips bad kills with a warning', () => {
  const r = parseLimpus(exp({ kills: [{ t: 0, zone: 'MC', boss: 'X', raid: ['A'] }, { t: 5, zone: 'MC', boss: 'Y', raid: ['A'] }] }));
  expect(r.ok && r.value).toHaveLength(1);
  expect(r.ok && r.warnings).toHaveLength(1);
});
