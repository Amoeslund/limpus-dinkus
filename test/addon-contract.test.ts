import { it, expect } from 'vitest';
import fixture from './fixtures/limpus-export.json?raw';
import { parseLimpus } from '../src/domain/limpus';

it('parseLimpus accepts the export format the LimpusAttendance addon builds', () => {
  const r = parseLimpus(fixture);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.warnings).toEqual([]);
  expect(r.value).toHaveLength(2);
  expect(r.value[0]).toMatchObject({ zone: 'Molten Core', boss: 'Lucifron' });
  expect(r.value[0].members.map(m => m.nameKey)).toEqual(['ildkule', 'mankee', 'dre"ad', 'tank\\boy']);
  expect(r.value[0].members[2].displayName).toBe('Dre"ad');
});
