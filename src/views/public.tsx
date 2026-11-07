import { ITEM_URL } from '../config';
import type { LogRow } from '../db/read';
import type { Response } from '../domain/darklight';
import { nightLabel } from '../domain/nights';
import { formatScore, type Standing } from '../domain/standings';
import { SORT_SCRIPT, type SortKey } from './attendance-sort';

type Night = { id: number; nightDate: string };

/** At most two decimals, no float noise (0.1 + 0.2 shows as 0.3). */
const fmtPoints = (n: number) => String(Math.round(n * 100) / 100);

const SYMBOL = { main: '●', alt: '◐', absent: '○' } as const;

const SortButton = ({ k, label }: { k: SortKey; label: string }) => (
  <button type="button" class="sort" data-key={k}>{label}<span class="arrow" aria-hidden="true"></span></button>
);

/** Name and score stay pinned on the left; nights scroll beside them, newest first. */
export const AttendancePage = ({ standings, nights }: { standings: Standing[]; nights: Night[] }) => {
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
              <th class="c pin pin-score"><SortButton k="score" label="Score" /></th>
              <th class="c"><SortButton k="raids" label="Raids" /></th>
              <th><SortButton k="pct" label="Attendance" /></th>
              {newestFirst.map((n) => {
                const [wk, day] = nightLabel(n.nightDate).split(' · ');
                return <th class="c">{wk}<br /><span class="alt">{day}</span></th>;
              })}
            </tr>
            {standings.map((s) => (
              <tr data-name={s.displayName} data-score={s.score === null ? '' : String(s.score)} data-raids={String(s.raids)} data-pct={String(s.attendancePct)}>
                <td class="pin pin-name">{s.displayName}{s.alts.length > 0 && <span class="alt"> + {s.alts.join(', ')}</span>}</td>
                <td class="c num pin pin-score">{formatScore(s.score)}</td>
                <td class="c num">{s.raids}</td>
                <td>{s.attendancePct}% <span class="bar"><i style={`width:${s.attendancePct}%`}></i></span></td>
                {newestFirst.map((n) => {
                  const cell = s.cells[n.id] ?? 'absent';
                  return <td class={cell === 'absent' ? 'c n' : 'c y'} title={cell === 'alt' ? 'on an alt' : undefined}>{SYMBOL[cell]}</td>;
                })}
              </tr>
            ))}
          </table>
        )}
        <p class="alt">● present &nbsp; ◐ present on alt &nbsp; ○ absent &nbsp;·&nbsp; Click a column title to sort. Score sorts lowest first.</p>
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
        <tr class="wk"><td colspan={4} class="week">{nightLabel(g.date)}{!g.counts && <span class="pill pug">pug</span>}</td></tr>
        {g.rows.map((r) => {
          const [cls, label] = PILL[r.response];
          return (
            <tr class="drop">
              <td class="it"><a class="item" href={ITEM_URL(r.itemId)}>[{r.itemName}]</a></td>
              <td class="pl">{r.playerDisplay}{r.altName && <span class="alt"> {r.altName}</span>}</td>
              <td><span class={`pill ${cls}`}>{label}</span></td>
              <td class="num">{g.counts ? fmtPoints(r.points) : '0'} pt</td>
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

export const RaidPage = ({ instance, rows, standings }: { instance: string; rows: LogRow[]; standings: Standing[] }) => {
  const groups: LootGroup[] = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && last.nightId === r.nightId) last.rows.push(r);
    else groups.push({ nightId: r.nightId, date: r.nightDate, counts: r.counts, rows: [r] });
  }
  const score = [...standings].sort((a, b) =>
    (a.score === null ? 1 : 0) - (b.score === null ? 1 : 0) ||
    (a.score ?? 0) - (b.score ?? 0) || a.displayName.localeCompare(b.displayName));
  return (
    <section>
      <h1>{instance}</h1>
      <p class="sub">All drops, newest first. The score is the same on every raid page: item points ÷ raids attended.</p>
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
          <h3>Score (all raids)</h3>
          <table>
            <tr><th>Player</th><th class="c">Raids</th><th class="c">Points</th><th class="c">Score</th></tr>
            {score.map((s) => (
              <tr><td>{s.displayName}</td><td class="c num">{s.raids}</td><td class="c num">{fmtPoints(s.points)}</td><td class="c num">{formatScore(s.score)}</td></tr>
            ))}
          </table>
          <p class="alt">Lowest score first, so the people who are "owed" loot are at the top.</p>
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
