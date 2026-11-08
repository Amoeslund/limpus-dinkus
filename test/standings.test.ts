import { it, expect } from 'vitest';
import { computeStandings, type StandingsInput } from '../src/domain/standings';

const base = (o: Partial<StandingsInput> = {}): StandingsInput => ({
  characters: [
    { nameKey: 'zefal', displayName: 'Zefal', mainKey: null, status: 'member' },
    { nameKey: 'zefalock', displayName: 'Zefalock', mainKey: 'zefal', status: 'member' },
  ],
  nights: [
    { id: 1, nightDate: '2026-11-04', counts: true },
    { id: 2, nightDate: '2026-11-11', counts: true },
  ],
  killPresence: [], overrides: [], ...o,
});

it('alt attendance rolls up to main', () => {
  const [s] = computeStandings(base({
    killPresence: [{ nightId: 1, nameKey: 'zefal' }, { nightId: 2, nameKey: 'zefalock' }],
  }));
  expect(s).toMatchObject({ mainKey: 'zefal', alts: ['Zefalock'], raids: 2, attendancePct: 100 });
  expect(s.cells).toEqual({ 1: 'main', 2: 'alt' });
});
it('non-counting nights add nothing', () => {
  const [s] = computeStandings(base({
    nights: [{ id: 1, nightDate: '2026-11-04', counts: true }, { id: 2, nightDate: '2026-11-11', counts: false }],
    killPresence: [{ nightId: 1, nameKey: 'zefal' }, { nightId: 2, nameKey: 'zefal' }],
  }));
  expect(s.raids).toBe(1);
  expect(s.cells[2]).toBeUndefined();
});
it('overrides add and remove presence', () => {
  const [s] = computeStandings(base({
    killPresence: [{ nightId: 1, nameKey: 'zefal' }],
    overrides: [{ nightId: 1, nameKey: 'zefal', present: false, benched: false }, { nightId: 2, nameKey: 'zefal', present: true, benched: false }],
  }));
  expect(s.cells).toEqual({ 1: 'absent', 2: 'main' });
  expect(s.raids).toBe(1);
});
it('guests and left hidden; 0 raids is 0%', () => {
  const r = computeStandings(base({
    characters: [
      { nameKey: 'zefal', displayName: 'Zefal', mainKey: null, status: 'member' },
      { nameKey: 'pug', displayName: 'Pug', mainKey: null, status: 'guest' },
      { nameKey: 'gone', displayName: 'Gone', mainKey: null, status: 'left' },
    ],
  }));
  expect(r.map(s => s.mainKey)).toEqual(['zefal']);
  expect(r[0]).toMatchObject({ raids: 0, attendancePct: 0 });
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
it('joins EPGP standings by the main name key; missing rows and GP 0 give null', () => {
  const r = computeStandings(base({
    characters: [
      { nameKey: 'zefal', displayName: 'Zefal', mainKey: null, status: 'member' },
      { nameKey: 'zefalock', displayName: 'Zefalock', mainKey: 'zefal', status: 'member' },
      { nameKey: 'hexa', displayName: 'Hexa', mainKey: null, status: 'member' },
      { nameKey: 'nobody', displayName: 'Nobody', mainKey: null, status: 'member' },
    ],
  }), new Map([['zefal', { ep: 1000, gp: 400 }], ['zefalock', { ep: 1, gp: 1 }], ['hexa', { ep: 50, gp: 0 }]]));
  const by = Object.fromEntries(r.map((s) => [s.mainKey, s]));
  expect(by.zefal).toMatchObject({ ep: 1000, gp: 400, pr: 2.5 });
  expect(by.hexa).toMatchObject({ ep: 50, gp: 0, pr: null });
  expect(by.nobody).toMatchObject({ ep: null, gp: null, pr: null });
  expect(r.map((s) => s.mainKey)).not.toContain('zefalock');
});

const bench = (nightId: number, nameKey: string) => ({ nightId, nameKey, present: true, benched: true });
it('a benched night counts as a raid and in attendance %, shown as bench', () => {
  const [s] = computeStandings(base({
    killPresence: [{ nightId: 1, nameKey: 'zefal' }],
    overrides: [bench(2, 'zefal')],
  }));
  expect(s.cells).toEqual({ 1: 'main', 2: 'bench' });
  expect(s.raids).toBe(2);
  expect(s.attendancePct).toBe(100);
});
it('presence wins over bench, also on an alt', () => {
  const [s] = computeStandings(base({
    killPresence: [{ nightId: 1, nameKey: 'zefal' }, { nightId: 2, nameKey: 'zefalock' }],
    overrides: [bench(1, 'zefal'), bench(2, 'zefal')],
  }));
  expect(s.cells).toEqual({ 1: 'main', 2: 'alt' });
  expect(s.raids).toBe(2);
});
it('a benched alt counts for the main', () => {
  const [s] = computeStandings(base({ overrides: [bench(2, 'zefalock')] }));
  expect(s.cells).toEqual({ 1: 'absent', 2: 'bench' });
  expect(s.raids).toBe(1);
});
