import { expect, it } from 'vitest';
import type { LogRow } from '../src/db/read';
import type { Standing } from '../src/domain/standings';
import { AttendancePage, RECENT_LOOT_NIGHTS, RaidPage } from '../src/views/public';

const nights = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, nightDate: `2026-10-${String(1 + i * 7).padStart(2, '0')}` }));
const standing: Standing = { mainKey: 'mankee', displayName: 'Mankee', alts: [], raids: 6, points: 3, score: 0.5, attendancePct: 100,
  cells: Object.fromEntries(nights.map((n) => [n.id, 'main'])) };

it('attendance shows newest nights first, next to the pinned name and score', () => {
  const html = AttendancePage({ standings: [standing], nights }).toString();
  expect(html.indexOf('29 Oct')).toBeLessThan(html.indexOf('1 Oct'));
  const head = html.slice(html.indexOf('<tr>'), html.indexOf('</tr>'));
  expect(head.indexOf('class="pin pin-name"')).toBeLessThan(head.indexOf('class="c pin pin-score"'));
  expect(head.indexOf('class="c pin pin-score"')).toBeLessThan(head.indexOf('29 Oct'));
  expect(html).toContain('<td class="c num pin pin-score">0.50</td>');
});

it('loot log folds nights older than the most recent ones', () => {
  const rows: LogRow[] = [...nights].reverse().map((n) => ({ nightId: n.id, nightDate: n.nightDate, counts: true, itemId: n.id,
    itemName: `Item ${n.id}`, playerDisplay: 'Mankee', altName: null, response: 'BiS', points: 1 }));
  const html = RaidPage({ instance: 'Molten Core', rows, standings: [standing] }).toString();
  const older = html.slice(html.indexOf('<details'));
  expect(html.slice(0, html.indexOf('<details'))).toContain('Item 6');
  expect(older).toContain(`Show ${nights.length - RECENT_LOOT_NIGHTS} older nights`);
  expect(older).toContain('Item 1');
  expect(older).not.toContain('Item 6');
});

it('loot log has no fold when there are few nights', () => {
  const rows: LogRow[] = [{ nightId: 1, nightDate: '2026-10-01', counts: true, itemId: 1, itemName: 'Item 1',
    playerDisplay: 'Mankee', altName: null, response: 'BiS', points: 1 }];
  expect(RaidPage({ instance: 'Molten Core', rows, standings: [standing] }).toString()).not.toContain('<details');
});
