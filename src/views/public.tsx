import { ITEM_URL } from '../config';
import type { LogRow } from '../db/read';
import type { Response } from '../domain/darklight';
import { nightLabel } from '../domain/nights';
import { formatEpgp, formatPr } from '../domain/epgp';
import type { Standing } from '../domain/standings';
import { formatDateTime } from './admin';
import { compareRows, DEFAULT_SORT, SORT_SCRIPT, type SortKey, type SortRow } from './attendance-sort';

type Night = { id: number; nightDate: string };

const sortRow = (s: Standing): SortRow =>
  ({ name: s.displayName, pr: s.pr, ep: s.ep, gp: s.gp, raids: s.raids, pct: s.attendancePct });
/** Standings in the default order: highest PR first, no PR last, then by name. */
const byDefault = (standings: Standing[]) =>
  [...standings].sort((a, b) => compareRows(sortRow(a), sortRow(b), DEFAULT_SORT.key, DEFAULT_SORT.dir));
const dataNum = (n: number | null) => (n === null ? '' : String(n));

const EpgpAsOf = ({ importedAt }: { importedAt: number | null }) => (
  <p class="alt">
    {importedAt === null ? 'No EPGP standings imported yet.' : `EPGP standings as of ${formatDateTime(importedAt)} (from EPGP Forever)`}
  </p>
);

const SYMBOL = { main: '●', alt: '◐', bench: '◇', absent: '○' } as const;
const TITLE: Partial<Record<keyof typeof SYMBOL, string>> = { alt: 'on an alt', bench: 'benched' };

const SortButton = ({ k, label, on }: { k: SortKey; label: string; on?: boolean }) => (
  <button type="button" class={on ? 'sort on' : 'sort'} data-key={k}>{label}<span class="arrow" aria-hidden="true">{on ? '▼' : ''}</span></button>
);

/** Name and PR stay pinned on the left; nights scroll beside them, newest first. */
export const AttendancePage = ({ standings, nights, epgpImportedAt }:
  { standings: Standing[]; nights: Night[]; epgpImportedAt: number | null }) => {
  const newestFirst = [...nights].sort((a, b) => b.nightDate.localeCompare(a.nightDate));
  return (
    <section>
      <h1>Attendance</h1>
      <p class="sub">Each raid night counts as one raid. Alts count toward their main. Pug raids are not counted. Newest raids first.</p>
      <div class="card scroll att">
        {standings.length === 0 ? <p class="alt">No attendance yet.</p> : (
          <table data-sortable>
            <tr>
              <th class="pin pin-name"><SortButton k="name" label="Player" /></th>
              <th class="c pin pin-pr" aria-sort="descending"><SortButton k="pr" label="PR" on /></th>
              <th class="c"><SortButton k="ep" label="EP" /></th>
              <th class="c"><SortButton k="gp" label="GP" /></th>
              <th class="c"><SortButton k="raids" label="Raids" /></th>
              <th><SortButton k="pct" label="Attendance" /></th>
              {newestFirst.map((n) => {
                const [wk, day] = nightLabel(n.nightDate).split(' · ');
                return <th class="c">{wk}<br /><span class="alt">{day}</span></th>;
              })}
            </tr>
            {byDefault(standings).map((s) => (
              <tr data-name={s.displayName} data-pr={dataNum(s.pr)} data-ep={dataNum(s.ep)} data-gp={dataNum(s.gp)}
                data-raids={String(s.raids)} data-pct={String(s.attendancePct)}>
                <td class="pin pin-name">{s.displayName}{s.alts.length > 0 && <span class="alt"> + {s.alts.join(', ')}</span>}</td>
                <td class="c num pin pin-pr">{formatPr(s.pr)}</td>
                <td class="c num">{formatEpgp(s.ep)}</td>
                <td class="c num">{formatEpgp(s.gp)}</td>
                <td class="c num">{s.raids}</td>
                <td>{s.attendancePct}% <span class="bar"><i style={`width:${s.attendancePct}%`}></i></span></td>
                {newestFirst.map((n) => {
                  const cell = s.cells[n.id] ?? 'absent';
                  return <td class={cell === 'absent' ? 'c n' : 'c y'} title={TITLE[cell]}>{SYMBOL[cell]}</td>;
                })}
              </tr>
            ))}
          </table>
        )}
        <p class="alt">● present &nbsp; ◐ present on alt &nbsp; ◇ benched &nbsp; ○ absent &nbsp;·&nbsp; Click a column title to sort. PR = EP ÷ GP, highest first.</p>
        <EpgpAsOf importedAt={epgpImportedAt} />
      </div>
      <script dangerouslySetInnerHTML={{ __html: SORT_SCRIPT }} />
    </section>
  );
};

/** Raid nights shown open in the loot log; older ones fold into a "Show older" section. */
export const RECENT_LOOT_NIGHTS = 4;

type LootGroup = { nightId: number; date: string; counts: boolean; rows: LogRow[] };

const LootTable = ({ groups }: { groups: LootGroup[] }) => (
  <table class="loot">
    {groups.map((g) => (
      <>
        <tr class="wk"><td colspan={3} class="week">{nightLabel(g.date)}{!g.counts && <span class="pill pug">pug</span>}</td></tr>
        {g.rows.map((r) => {
          const [cls, label] = PILL[r.response];
          return (
            <tr class="drop">
              <td class="it"><a class="item" href={ITEM_URL(r.itemId)}>[{r.itemName}]</a></td>
              <td class="pl">{r.playerDisplay}{r.altName && <span class="alt"> {r.altName}</span>}</td>
              <td><span class={`pill ${cls}`}>{label}</span></td>
            </tr>
          );
        })}
      </>
    ))}
  </table>
);

const PILL: Record<Response, [string, string]> = {
  BiS: ['p-bis', 'BiS'], Upgrade: ['p-upgrade', 'Upgrade'], Offspec: ['p-os', 'Offspec'],
};

export const RaidPage = ({ instance, rows, standings, epgpImportedAt }:
  { instance: string; rows: LogRow[]; standings: Standing[]; epgpImportedAt: number | null }) => {
  const groups: LootGroup[] = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && last.nightId === r.nightId) last.rows.push(r);
    else groups.push({ nightId: r.nightId, date: r.nightDate, counts: r.counts, rows: [r] });
  }
  return (
    <section>
      <h1>{instance}</h1>
      <p class="sub">All drops, newest first. EPGP standings come from EPGP Forever and are the same on every raid page.</p>
      <div class="grid2">
        <div class="card scroll">
          <h3>Loot log</h3>
          {groups.length === 0 ? <p class="alt">No drops yet.</p> : <LootTable groups={groups.slice(0, RECENT_LOOT_NIGHTS)} />}
          {groups.length > RECENT_LOOT_NIGHTS && (
            <details class="older">
              <summary>Show {groups.length - RECENT_LOOT_NIGHTS} older nights</summary>
              <LootTable groups={groups.slice(RECENT_LOOT_NIGHTS)} />
            </details>
          )}
        </div>
        <div class="card scroll">
          <h3>EPGP standings</h3>
          <table>
            <tr><th>Player</th><th class="c">EP</th><th class="c">GP</th><th class="c">PR</th></tr>
            {byDefault(standings).map((s) => (
              <tr><td>{s.displayName}</td><td class="c num">{formatEpgp(s.ep)}</td><td class="c num">{formatEpgp(s.gp)}</td><td class="c num">{formatPr(s.pr)}</td></tr>
            ))}
          </table>
          <p class="alt">Highest PR (EP ÷ GP) first.</p>
          <EpgpAsOf importedAt={epgpImportedAt} />
        </div>
      </div>
    </section>
  );
};

export const NoRaidsPage = () => (
  <section>
    <h1>Raids</h1>
    <p class="sub">No raids yet.</p>
  </section>
);
