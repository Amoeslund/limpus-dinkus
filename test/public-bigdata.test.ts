import { expect, it } from 'vitest';
import type { LogRow } from '../src/db/read';
import type { Standing } from '../src/domain/standings';
import { AttendancePage, RECENT_LOOT_NIGHTS, RaidPage } from '../src/views/public';

const nights = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, nightDate: `2026-10-${String(1 + i * 7).padStart(2, '0')}` }));
const standing: Standing = { mainKey: 'mankee', displayName: 'Mankee', alts: [], raids: 6, attendancePct: 100,
  cells: Object.fromEntries(nights.map((n) => [n.id, 'main'])), ep: 1250, gp: 400.25, pr: 1250 / 400.25 };

it('attendance pins name and PR, then EP, GP, Raids, Attendance and the newest nights first', () => {
  const html = AttendancePage({ standings: [standing], nights, epgpImportedAt: null }).toString();
  expect(html.indexOf('29 Oct')).toBeLessThan(html.indexOf('1 Oct'));
  const head = html.slice(html.indexOf('<tr>'), html.indexOf('</tr>'));
  const order = ['class="pin pin-name"', 'class="c pin pin-pr"', 'data-key="ep"', 'data-key="gp"', 'data-key="raids"', 'data-key="pct"', '29 Oct'];
  for (let i = 1; i < order.length; i++) expect(head.indexOf(order[i - 1])).toBeLessThan(head.indexOf(order[i]));
  expect(html).toContain('<td class="c num pin pin-pr">3.12</td><td class="c num">1250</td><td class="c num">400.3</td>');
  expect(html).not.toContain('pin-score');
});

it('members without standings show dashes', () => {
  const html = AttendancePage({ standings: [{ ...standing, ep: null, gp: null, pr: null }], nights, epgpImportedAt: null }).toString();
  expect(html).toContain('<td class="c num pin pin-pr">—</td><td class="c num">—</td><td class="c num">—</td>');
});

it('shows when the EPGP standings were imported', () => {
  expect(AttendancePage({ standings: [standing], nights, epgpImportedAt: null }).toString())
    .toContain('No EPGP standings imported yet.');
  // 2026-11-08 18:30 UTC is 19:30 in Copenhagen.
  const at = Date.UTC(2026, 10, 8, 18, 30) / 1000;
  expect(AttendancePage({ standings: [standing], nights, epgpImportedAt: at }).toString())
    .toContain('EPGP standings as of 08 Nov 2026 19:30 (from EPGP Forever)');
  expect(RaidPage({ instance: 'Molten Core', rows: [], standings: [standing], epgpImportedAt: at }).toString())
    .toContain('EPGP standings as of 08 Nov 2026 19:30 (from EPGP Forever)');
});

it('loot log folds nights older than the most recent ones', () => {
  const rows: LogRow[] = [...nights].reverse().map((n) => ({ nightId: n.id, nightDate: n.nightDate, counts: true, itemId: n.id,
    itemName: `Item ${n.id}`, playerDisplay: 'Mankee', altName: null, response: 'BiS' }));
  const html = RaidPage({ instance: 'Molten Core', rows, standings: [standing], epgpImportedAt: null }).toString();
  const older = html.slice(html.indexOf('<details'));
  expect(html.slice(0, html.indexOf('<details'))).toContain('Item 6');
  expect(older).toContain(`Show ${nights.length - RECENT_LOOT_NIGHTS} older nights`);
  expect(older).toContain('Item 1');
  expect(older).not.toContain('Item 6');
});

it('loot log has no fold when there are few nights', () => {
  const rows: LogRow[] = [{ nightId: 1, nightDate: '2026-10-01', counts: true, itemId: 1, itemName: 'Item 1',
    playerDisplay: 'Mankee', altName: null, response: 'BiS' }];
  expect(RaidPage({ instance: 'Molten Core', rows, standings: [standing], epgpImportedAt: null }).toString()).not.toContain('<details');
});

it('benched nights show a diamond with a tooltip and a legend entry', () => {
  const html = AttendancePage({ standings: [{ ...standing, cells: { ...standing.cells, 2: 'bench' } }], nights, epgpImportedAt: null }).toString();
  expect(html).toContain('<td class="c y" title="benched">◇</td>');
  expect(html).toContain('◇ benched');
});
