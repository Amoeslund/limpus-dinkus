import type { GearRow } from '../db/gear';
import type { RosterData, RosterRow } from '../db/roster';
import { ITEM_URL } from '../config';
import { characterUrl, sourceKind } from '../domain/gear';
import { AdminNav, formatDateTime } from './admin';

export const ROSTER_CSS = `
.filters{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px}
.filters a{color:var(--muted);padding:4px 10px;border-radius:6px;text-decoration:none;background:var(--panel2);font-size:13px}
.filters a.on{color:#1a1410;background:var(--gold)}
th a{color:inherit;text-decoration:none} th a.on{color:var(--gold2)}
.good{color:var(--ok)} .warn{color:var(--gold2)} .bad{color:var(--bad)}
.tag{font-size:11px;padding:1px 6px;border-radius:4px;background:var(--panel2);color:var(--bad);margin-left:4px;white-space:nowrap}
.q-POOR{color:#9d9d9d} .q-COMMON{color:#fff} .q-UNCOMMON{color:#1eff00} .q-RARE{color:#4a9eff} .q-EPIC{color:#c26cff} .q-LEGENDARY{color:#ff8000}
td a.plain{color:inherit;text-decoration:none} td a.plain:hover{text-decoration:underline}
`;

export const SORTS = ['name', 'level', 'gain', 'rank', 'online', 'played', 'dungeon', 'ilvl', 'effort'] as const;
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

const effortClass = (s: number | null) => (s === null ? 'alt' : s >= 60 ? 'good' : s >= 30 ? 'warn' : 'bad');

export const effortTitle = (r: RosterRow) =>
  r.effort.parts.map((p) => `${p.label}: ${Math.round(p.points)}/${p.max}`).join('\n') +
  (r.effort.parts.length ? '\n(missing parts are left out and the rest scaled to 100)' : '');

const signed = (n: number) => (n > 0 ? '+' : '') + n;

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
      case 'dungeon': return -(r.dungeon7d ?? -1);
      case 'ilvl': return -(r.ilvl ?? -1);
      case 'effort': return -(r.effort.score ?? -1);
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
          Guild Pulse users share data in game, so one report covers what all of them saw; playtime only counts while at least one of them was online.
        </p>
        <p class="alt" style="margin-top:0">
          Gear and item level come from each member's armory page, 15 members per hour (level 10+).
          Dungeon and raid time come from Guild Pulse 1.3+, read from the guild roster's zone column.
        </p>
        <div class="row" style="margin:0 0 12px">
          <form method="post" action="/admin/roster/poll"><button class="btn ghost" type="submit">Poll armory now</button></form>
          <form method="post" action="/admin/roster/poll-gear"><button class="btn ghost" type="submit">Poll gear now (15 members)</button></form>
        </div>
        <div class="filters">
          <a href={q({ rank: null })} class={p.rank === null ? 'on' : ''}>All ranks</a>
          {rankIds.map((id) => <a href={q({ rank: id })} class={p.rank === id ? 'on' : ''}>{rankLabel(id)}</a>)}
        </div>
        <div class="scroll">
          <table>
            <tr>
              <Th k="name" label="Name" /><th>Class</th><Th k="level" label="Level" c /><Th k="gain" label="+7d" c />
              <Th k="rank" label="Rank" /><Th k="online" label="Last online" /><Th k="played" label="Seen 7d" c /><th class="c">Avg/day</th>
              <Th k="dungeon" label="Dungeon 7d" c /><Th k="ilvl" label="iLvl" c /><th class="c">New gear 7d</th><Th k="effort" label="Effort" c />
            </tr>
            {rows.map((r) => {
              const stalled = !r.partial && r.gain === 0 && r.level < p.maxLevel;
              return (
                <tr>
                  <td><a class="plain" href={`/admin/roster/member/${encodeURIComponent(r.nameKey)}`}>{r.display}</a></td>
                  <td>{r.cls ?? ''}</td>
                  <td class="c">{r.level}</td>
                  <td class={'c ' + (stalled ? 'bad' : r.gain > 0 ? 'good' : '')} title={r.partial ? `Tracked since ${formatDateTime(r.firstSeen)}` : ''}>
                    {r.partial ? '~' : ''}{r.gain > 0 ? '+' : ''}{r.gain}
                  </td>
                  <td>{r.rankId === null ? '' : rankLabel(r.rankId)}</td>
                  <td class={onlineClass(r.lastOnline, now)}>{r.lastOnline === null ? '?' : ago(r.lastOnline, now)}</td>
                  <td class="c">{hm(r.seen7d)}</td>
                  <td class="c">{hm(r.avgDay)}{r.share ? <span class="alt"> {Math.round(r.share * 100)}%</span> : null}</td>
                  <td class="c" title={r.raid7d ? `Raids: ${hm(r.raid7d)}` : ''}>{hm(r.dungeon7d)}</td>
                  <td class="c" title={r.gearError ?? ''}>
                    {r.ilvl ?? (r.gearError ? <span class="bad">!</span> : '')}
                    {r.ilvlGain ? <span class={r.ilvlGain > 0 ? 'good' : 'bad'}> {r.ilvlPartial ? '~' : ''}{signed(r.ilvlGain)}</span> : null}
                  </td>
                  <td class="c" title="dungeon items + other non-raid items">
                    {r.newDungeonItems === null ? '' : `${r.newDungeonItems} + ${r.newOtherItems}`}
                  </td>
                  <td class={'c ' + effortClass(r.effort.score)} title={effortTitle(r)}>
                    {r.effort.score ?? ''}{r.effort.raidLogger ? <span class="tag">raid-logger?</span> : null}
                  </td>
                </tr>
              );
            })}
          </table>
        </div>
        <p class="alt">
          +7d: levels gained in the last 7 days (~ = tracked for less than 7 days); red when below max level and no gain.
          Last online: green under 2 days, yellow under 7, red 7+ (Guild Pulse or the armory's last update, whichever is newer).
          iLvl: average equipped item level, with the change over 7 days. New gear 7d: dungeon drops + other non-raid items first seen in 7 days.
        </p>
        <p class="alt">
          <b>Effort</b> (0-100, last 7 days, outside raids): dungeon time (4 h = 40), new non-raid gear and item level (max 25),
          online time outside raid zones (10 h = 20) and levels gained below max level (max 15). Below level 55 only levelling
          counts (3 levels in 7 days = 100; blank until there are 7 days of level history). Parts with no data are left out
          and the rest is scaled to 100. Hover for the breakdown. <b>raid-logger?</b> = 1 h+ in raids but under 1 h online
          elsewhere, under 30 min in dungeons and no new gear.
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

const SOURCE_LABEL = { dungeon: 'Dungeon', raid: 'Raid', other: 'Quest/crafted/other' } as const;

export const MemberPage = (p: {
  row: RosterRow; slug: string | null; now: number;
  gear: GearRow[]; history: { itemId: number; name: string; ilvl: number | null; source: number | null; firstSeen: number }[];
  profile: { ilvl: number | null; armory_updated: number | null; polled_at: number; error: string | null } | null;
}) => {
  const { row: r, now } = p;
  const SLOT_ORDER = ['HEAD', 'NECK', 'SHOULDER', 'BACK', 'CHEST', 'WRIST', 'HANDS', 'WAIST', 'LEGS', 'FEET', 'FINGER_1', 'FINGER_2',
    'TRINKET_1', 'TRINKET_2', 'MAIN_HAND', 'OFF_HAND', 'RANGED'];
  const pos = (s: string) => { const i = SLOT_ORDER.indexOf(s); return i < 0 ? 99 : i; };
  const gear = [...p.gear].sort((a, b) => pos(a.slot) - pos(b.slot) || a.slot.localeCompare(b.slot));
  return (
    <>
      <h1>Admin</h1>
      <AdminNav active="Roster" />
      <p><a href="/admin/roster">&larr; Roster</a></p>
      <div class="card">
        <h3>{r.display}</h3>
        <p class="alt" style="margin-top:0">
          Level {r.level} {r.cls ?? ''}{r.rank ? ` · ${r.rank}` : ''}
          {p.slug ? <> · <a href={characterUrl(p.slug)} target="_blank" rel="noopener">Armory</a></> : null}
        </p>
        <table>
          <tr><td>Effort (7d)</td><td class={effortClass(r.effort.score)}>{r.effort.score ?? 'no data'}{r.effort.raidLogger ? <span class="tag">raid-logger?</span> : null}</td></tr>
          {r.effort.parts.map((x) => <tr><td class="alt">&nbsp;&nbsp;{x.label}</td><td>{Math.round(x.points)} / {x.max}</td></tr>)}
          <tr><td>Seen online 7d</td><td>{hm(r.seen7d) || 'no Guild Pulse data'}</td></tr>
          <tr><td>Dungeons / raids 7d</td><td>{r.dungeon7d === null ? 'needs Guild Pulse 1.3+' : `${hm(r.dungeon7d)} / ${hm(r.raid7d)}`}</td></tr>
          <tr><td>Item level</td><td>{r.ilvl ?? '?'}{r.ilvlGain ? ` (${r.ilvlPartial ? '~' : ''}${signed(r.ilvlGain)} in 7d)` : ''}</td></tr>
          <tr><td>Last online</td><td>{r.lastOnline === null ? '?' : ago(r.lastOnline, now)}</td></tr>
          <tr><td>Gear fetched</td><td>{p.profile ? ago(p.profile.polled_at, now) : 'not yet'}{p.profile?.error ? <span class="bad"> ({p.profile.error})</span> : null}</td></tr>
        </table>
      </div>
      <div class="card">
        <h3>Equipped</h3>
        {gear.length === 0 ? <p class="alt">No gear fetched yet.</p> : (
          <div class="scroll"><table>
            <tr><th>Slot</th><th>Item</th><th class="c">iLvl</th><th>Source</th><th>First seen</th></tr>
            {gear.map((g) => (
              <tr>
                <td class="alt">{g.slot.toLowerCase().replace(/_/g, ' ')}</td>
                <td><a class={'plain q-' + (g.quality ?? '')} href={ITEM_URL(g.itemId)} target="_blank" rel="noopener">{g.name}</a></td>
                <td class="c">{g.ilvl ?? ''}</td>
                <td>{SOURCE_LABEL[sourceKind(g.source)]}</td>
                <td class="alt">{!g.firstSeen ? 'before tracking' : ago(g.firstSeen, now)}</td>
              </tr>
            ))}
          </table></div>
        )}
      </div>
      <div class="card">
        <h3>New items</h3>
        {p.history.length === 0 ? <p class="alt">None since tracking started.</p> : (
          <div class="scroll"><table>
            <tr><th>Item</th><th class="c">iLvl</th><th>Source</th><th>First seen</th></tr>
            {p.history.map((g) => (
              <tr>
                <td><a class="plain" href={ITEM_URL(g.itemId)} target="_blank" rel="noopener">{g.name}</a></td>
                <td class="c">{g.ilvl ?? ''}</td>
                <td>{SOURCE_LABEL[sourceKind(g.source)]}</td>
                <td class="alt">{ago(g.firstSeen, now)}</td>
              </tr>
            ))}
          </table></div>
        )}
      </div>
    </>
  );
};
