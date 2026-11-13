import type { RosterData, RosterRow } from '../db/roster';
import { AdminNav, formatDateTime } from './admin';

export const ROSTER_CSS = `
.filters{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px}
.filters a{color:var(--muted);padding:4px 10px;border-radius:6px;text-decoration:none;background:var(--panel2);font-size:13px}
.filters a.on{color:#1a1410;background:var(--gold)}
th a{color:inherit;text-decoration:none} th a.on{color:var(--gold2)}
.good{color:var(--ok)} .warn{color:var(--gold2)} .bad{color:var(--bad)}
`;

export const SORTS = ['name', 'level', 'gain', 'rank', 'online', 'played'] as const;
export type RosterSort = (typeof SORTS)[number];

const DAY = 86400;

export function ago(t: number | null, now: number): string {
  if (t === null) return '?';
  const s = now - t;
  if (s < 3600) return 'now';
  if (s < DAY) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / DAY)}d ago`;
}

export function hm(sec: number | null): string {
  if (sec === null) return '';
  if (sec < 60) return '-';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h === 0 ? `${m}m` : `${h}h${String(m).padStart(2, '0')}`;
}

const onlineClass = (t: number | null, now: number) =>
  t === null ? 'alt' : now - t < 2 * DAY ? 'good' : now - t < 7 * DAY ? 'warn' : 'bad';

export function sortRows(rows: RosterRow[], sort: RosterSort): RosterRow[] {
  const key = (r: RosterRow): number | string => {
    switch (sort) {
      case 'name': return r.display.toLowerCase();
      case 'level': return -r.level;
      case 'gain': return -r.gain;
      case 'rank': return r.rankId ?? 99;
      case 'online': return -(r.lastOnline ?? 0);
      case 'played': return -(r.seen7d ?? -1);
    }
  };
  return [...rows].sort((a, b) => {
    const x = key(a), y = key(b);
    if (x < y) return -1;
    if (x > y) return 1;
    return a.display.localeCompare(b.display);
  });
}

export const RosterPage = (p: {
  data: RosterData; now: number; maxLevel: number; sort: RosterSort; rank: number | null;
  imported?: string; error?: string; pulseText?: string;
}) => {
  const { data, now } = p;
  const rows = sortRows(p.rank === null ? data.rows : data.rows.filter((r) => r.rankId === p.rank), p.sort);
  const rankIds = [...new Set(data.rows.map((r) => r.rankId).filter((x): x is number => x !== null))].sort((a, b) => a - b);
  const rankLabel = (id: number) => data.ranks.find((r) => r.id === id)?.name ?? (id === 0 ? 'Guild Master' : `Rank ${id}`);
  const q = (o: { sort?: string; rank?: number | null }) => {
    const sp = new URLSearchParams();
    const sort = o.sort ?? p.sort, rank = o.rank === undefined ? p.rank : o.rank;
    if (sort !== 'rank') sp.set('sort', sort);
    if (rank !== null) sp.set('rank', String(rank));
    const s = sp.toString();
    return '/admin/roster' + (s ? '?' + s : '');
  };
  const Th = ({ k, label, c }: { k: RosterSort; label: string; c?: boolean }) => (
    <th class={c ? 'c' : ''}><a href={q({ sort: k })} class={p.sort === k ? 'on' : ''}>{label}</a></th>
  );
  return (
    <>
      <h1>Admin</h1>
      <AdminNav active="Roster" />
      {p.imported ? <div class="banner ok">Imported: {p.imported}</div> : null}
      {data.armoryError && (data.armoryAt === null || data.armoryError.at > data.armoryAt) ? (
        <div class="banner err">Armory polling failed {ago(data.armoryError.at, now)}: {data.armoryError.message}</div>
      ) : null}
      <div class="card">
        <h3>Guild roster</h3>
        <p class="alt" style="margin-top:0">
          Level and rank come from the armory every 3 hours ({data.armoryAt ? `last ${formatDateTime(data.armoryAt)}` : 'not polled yet'}).
          Last online and playtime come from the Guild Pulse addon ({data.pulseAt ? `last report ${formatDateTime(data.pulseAt)}` : 'no report yet'}).
          Playtime only counts time the reporter was online too.
        </p>
        <form method="post" action="/admin/roster/poll" class="row" style="margin:0 0 12px">
          <button class="btn ghost" type="submit">Poll armory now</button>
        </form>
        <div class="filters">
          <a href={q({ rank: null })} class={p.rank === null ? 'on' : ''}>All ranks</a>
          {rankIds.map((id) => <a href={q({ rank: id })} class={p.rank === id ? 'on' : ''}>{rankLabel(id)}</a>)}
        </div>
        <div class="scroll">
          <table>
            <tr>
              <Th k="name" label="Name" /><th>Class</th><Th k="level" label="Level" c /><Th k="gain" label="+7d" c />
              <Th k="rank" label="Rank" /><Th k="online" label="Last online" /><Th k="played" label="Seen 7d" c /><th class="c">Avg/day</th>
            </tr>
            {rows.map((r) => {
              const stalled = !r.partial && r.gain === 0 && r.level < p.maxLevel;
              return (
                <tr>
                  <td>{r.display}</td>
                  <td>{r.cls ?? ''}</td>
                  <td class="c">{r.level}</td>
                  <td class={'c ' + (stalled ? 'bad' : r.gain > 0 ? 'good' : '')} title={r.partial ? `Tracked since ${formatDateTime(r.firstSeen)}` : ''}>
                    {r.partial ? '~' : ''}{r.gain > 0 ? '+' : ''}{r.gain}
                  </td>
                  <td>{r.rankId === null ? '' : rankLabel(r.rankId)}</td>
                  <td class={onlineClass(r.lastOnline, now)}>{r.lastOnline === null ? '?' : ago(r.lastOnline, now)}</td>
                  <td class="c">{hm(r.seen7d)}</td>
                  <td class="c">{hm(r.avgDay)}{r.share ? <span class="alt"> {Math.round(r.share * 100)}%</span> : null}</td>
                </tr>
              );
            })}
          </table>
        </div>
        <p class="alt">
          +7d: levels gained in the last 7 days (~ = tracked for less than 7 days); red when below max level and no gain.
          Last online: green under 2 days, yellow under 7, red 7+.
        </p>
      </div>
      <div class="card">
        <h3>Guild Pulse report</h3>
        {p.error ? <div class="banner err">{p.error}</div> : null}
        <p class="alt" style="margin-top:0">In game: <code>/gpulse</code>, then <b>Export for site</b>. Copy the text with Ctrl+C and paste it here.</p>
        <form method="post" action="/admin/roster/import">
          <textarea name="pulseText" spellcheck={false}>{p.pulseText ?? ''}</textarea>
          <div class="row"><button class="btn" type="submit">Import report</button></div>
        </form>
      </div>
    </>
  );
};
