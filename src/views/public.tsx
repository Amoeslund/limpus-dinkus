import { EPGP_BASE_GP, EPGP_MIN_EP, ITEM_URL } from '../config';
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

const PR_NOTE = `PR = EP ÷ (GP + ${EPGP_BASE_GP} base GP). Below ${EPGP_MIN_EP} EP shows PR 0.`;
const BELOW_MIN = `Below ${EPGP_MIN_EP} min EP`;

/** PR cell; below min EP it shows 0.00 with a muted marker, never the raw value. */
const PrCell = ({ s, cls }: { s: Standing; cls: string }) => s.belowMinEp
  ? <td class={cls} title={BELOW_MIN}>{formatPr(s.pr)}<span class="alt">*</span></td>
  : <td class={cls}>{formatPr(s.pr)}</td>;

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
                <PrCell s={s} cls="c num pin pin-pr" />
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
        <p class="alt">● present &nbsp; ◐ present on alt &nbsp; ◇ benched &nbsp; ○ absent &nbsp;·&nbsp; Click a column title to sort. {PR_NOTE} * below min EP.</p>
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
              <tr><td>{s.displayName}</td><td class="c num">{formatEpgp(s.ep)}</td><td class="c num">{formatEpgp(s.gp)}</td><PrCell s={s} cls="c num" /></tr>
            ))}
          </table>
          <p class="alt">Highest PR first. {PR_NOTE} * below min EP.</p>
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

export const AddonsPage = () => (
  <section>
    <h1>Addons</h1>
    <p class="sub">Addons the guild uses. Unzip into <code>World of Warcraft\_forever_\Interface\AddOns\</code> and type <code>/reload</code>.</p>
    <div class="card">
      <h3>Guild Pulse</h3>
      <p style="margin-top:0">
        Keeps track of the guild roster: everyone's level, when they were last online, how many levels they gained in the
        last 7 days and how much time they were seen online. Handy for checking that raiders are still levelling.
        Type <code>/gpulse</code> to open it. Click a column to sort, use the Rank button to show only Raiders, and click a
        member in the Guild window to see their stats under the member details. Officers can paste{' '}
        <b>Export for site</b> into the roster page on this site.
      </p>
      <p class="alt">
        Everyone running Guild Pulse shares what they see over a hidden guild addon channel, so the more people use it,
        the more complete the playtime gets. Playtime only counts while at least one Guild Pulse user is online, and levels
        gained show <code>~</code> until the addon has a week of history.
      </p>
      <p><a class="dl" href="/downloads/GuildPulse.zip" download>Download Guild Pulse (zip)</a></p>
      <img class="shot" src="/img/guildpulse.webp" width="965" height="664" alt="The Guild Pulse window listing guild members with level, rank, last online and playtime" loading="lazy" />
    </div>
    <div class="card">
      <h3>LimpusAttendance</h3>
      <p style="margin-top:0">Records who was in the raid at each boss kill. Only the officer recording attendance needs it.</p>
      <p><a class="dl" href="https://github.com/Amoeslund/limpus-dinkus/releases/latest">Download from the latest release</a></p>
    </div>
  </section>
);
