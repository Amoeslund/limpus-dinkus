import { it, expect } from 'vitest';
import { computeStandings, formatScore, pointsFor, type StandingsInput } from '../src/domain/standings';

const base = (o: Partial<StandingsInput> = {}): StandingsInput => ({
  characters: [
    { nameKey: 'zefal', displayName: 'Zefal', mainKey: null, status: 'member' },
    { nameKey: 'zefalock', displayName: 'Zefalock', mainKey: 'zefal', status: 'member' },
  ],
  nights: [
    { id: 1, nightDate: '2026-11-04', counts: true },
    { id: 2, nightDate: '2026-11-11', counts: true },
  ],
  killPresence: [], overrides: [], awards: [], ...o,
});
const award = (nightId: number, nameKey: string, o = {}) =>
  ({ nightId, nameKey, response: 'BiS' as const, itemPoints: 1, deleted: false, ...o });

it('pointsFor', () => {
  expect(pointsFor('BiS', 3)).toBe(3);
  expect(pointsFor('Upgrade', 2)).toBe(2);
  expect(pointsFor('Offspec', 3)).toBe(0);
});
it('alt attendance and loot roll up to main', () => {
  const [s] = computeStandings(base({
    killPresence: [{ nightId: 1, nameKey: 'zefal' }, { nightId: 2, nameKey: 'zefalock' }],
    awards: [award(2, 'zefalock')],
  }));
  expect(s).toMatchObject({ mainKey: 'zefal', alts: ['Zefalock'], raids: 2, points: 1, score: 0.5, attendancePct: 100 });
  expect(s.cells).toEqual({ 1: 'main', 2: 'alt' });
});
it('non-counting nights add nothing', () => {
  const [s] = computeStandings(base({
    nights: [{ id: 1, nightDate: '2026-11-04', counts: true }, { id: 2, nightDate: '2026-11-11', counts: false }],
    killPresence: [{ nightId: 1, nameKey: 'zefal' }, { nightId: 2, nameKey: 'zefal' }],
    awards: [award(2, 'zefal')],
  }));
  expect(s.raids).toBe(1);
  expect(s.points).toBe(0);
  expect(s.cells[2]).toBeUndefined();
});
it('overrides add and remove presence', () => {
  const [s] = computeStandings(base({
    killPresence: [{ nightId: 1, nameKey: 'zefal' }],
    overrides: [{ nightId: 1, nameKey: 'zefal', present: false }, { nightId: 2, nameKey: 'zefal', present: true }],
  }));
  expect(s.cells).toEqual({ 1: 'absent', 2: 'main' });
  expect(s.raids).toBe(1);
});
it('deleted awards ignored', () => {
  const [s] = computeStandings(base({
    killPresence: [{ nightId: 1, nameKey: 'zefal' }],
    awards: [award(1, 'zefal', { deleted: true }), award(1, 'zefal', { response: 'Offspec' })],
  }));
  expect(s.points).toBe(0);
});
it('guests and left hidden; score null with 0 raids', () => {
  const r = computeStandings(base({
    characters: [
      { nameKey: 'zefal', displayName: 'Zefal', mainKey: null, status: 'member' },
      { nameKey: 'pug', displayName: 'Pug', mainKey: null, status: 'guest' },
      { nameKey: 'gone', displayName: 'Gone', mainKey: null, status: 'left' },
    ],
  }));
  expect(r.map(s => s.mainKey)).toEqual(['zefal']);
  expect(r[0]).toMatchObject({ raids: 0, score: null, attendancePct: 0 });
});
it('attendancePct counts from first attended night', () => {
  const [s] = computeStandings(base({
    nights: [1, 2, 3, 4].map(id => ({ id, nightDate: `2026-11-0${id}`, counts: true })),
    killPresence: [{ nightId: 3, nameKey: 'zefal' }, { nightId: 4, nameKey: 'zefal' }],
  }));
  expect(s.attendancePct).toBe(100);
  expect(s.raids).toBe(2);
});
it('sorts by attendance, then raids, then name', () => {
  const r = computeStandings(base({
    characters: [
      { nameKey: 'b', displayName: 'B', mainKey: null, status: 'member' },
      { nameKey: 'a', displayName: 'A', mainKey: null, status: 'member' },
    ],
    killPresence: [{ nightId: 1, nameKey: 'a' }, { nightId: 1, nameKey: 'b' }, { nightId: 2, nameKey: 'b' }],
  }));
  expect(r.map(s => s.mainKey)).toEqual(['b', 'a']);
});
it('formatScore', () => {
  expect(formatScore(1.58333)).toBe('1.58');
  expect(formatScore(null)).toBe('—');
});
