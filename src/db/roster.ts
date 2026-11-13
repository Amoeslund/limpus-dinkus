import { fetchArmoryRoster, levelGain, type ArmoryMember, type PulseReport } from '../domain/roster';

const META_ARMORY_AT = 'armory_at';
const META_ARMORY_ERROR = 'armory_error';
const META_PULSE_AT = 'pulse_at';

const setMeta = (db: D1Database, k: string, v: string) =>
  db.prepare('INSERT INTO roster_meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(k, v);

/** Stores one armory snapshot: upserts members, appends level changes, marks members who left. */
export async function saveArmorySnapshot(db: D1Database, members: ArmoryMember[], now: number) {
  const prev = await db.prepare('SELECT name_key, level, left_at FROM roster_member').all<{ name_key: string; level: number; left_at: number | null }>();
  const known = new Map(prev.results.map((r) => [r.name_key, r]));
  const present = new Set(members.map((m) => m.nameKey));
  const st: D1PreparedStatement[] = [];
  let changed = 0;
  for (const m of members) {
    const p = known.get(m.nameKey);
    st.push(db.prepare(
      `INSERT INTO roster_member (name_key, display_name, class, level, rank_id, first_seen, last_seen, left_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(name_key) DO UPDATE SET display_name = excluded.display_name, class = excluded.class, level = excluded.level,
         rank_id = excluded.rank_id, last_seen = excluded.last_seen, left_at = NULL`,
    ).bind(m.nameKey, m.display, m.cls, m.level, m.rankId, now, now));
    if (!p || p.level !== m.level) {
      st.push(db.prepare('INSERT OR REPLACE INTO roster_level (name_key, at, level) VALUES (?, ?, ?)').bind(m.nameKey, now, m.level));
      if (p) changed++;
    }
  }
  for (const [key, p] of known) {
    if (!present.has(key) && p.left_at === null) st.push(db.prepare('UPDATE roster_member SET left_at = ? WHERE name_key = ?').bind(now, key));
  }
  st.push(setMeta(db, META_ARMORY_AT, String(now)), setMeta(db, META_ARMORY_ERROR, ''));
  await db.batch(st);
  return { members: members.length, levelChanges: changed };
}

/** Cron entry point: fetch the armory roster and store it; failures are recorded for the admin page. */
export async function pollArmory(db: D1Database, now = Math.floor(Date.now() / 1000), fetchFn: typeof fetch = fetch) {
  const res = await fetchArmoryRoster(fetchFn);
  if (!res.ok) {
    await setMeta(db, META_ARMORY_ERROR, `${now}|${res.error}`).run();
    return res;
  }
  return { ok: true as const, value: await saveArmorySnapshot(db, res.value, now) };
}

/** Stores a Guild Pulse report. Last online keeps the newest value seen; playtime takes the newer report. */
export async function saveGuildPulse(db: D1Database, r: PulseReport) {
  const st: D1PreparedStatement[] = [];
  for (const m of r.members) {
    st.push(db.prepare(
      `INSERT INTO roster_activity (name_key, last_online, seen7d, avg_day, share, reported_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(name_key) DO UPDATE SET
         last_online = CASE WHEN roster_activity.last_online IS NULL OR excluded.last_online > roster_activity.last_online
                            THEN excluded.last_online ELSE roster_activity.last_online END,
         seen7d = CASE WHEN excluded.reported_at >= roster_activity.reported_at THEN excluded.seen7d ELSE roster_activity.seen7d END,
         avg_day = CASE WHEN excluded.reported_at >= roster_activity.reported_at THEN excluded.avg_day ELSE roster_activity.avg_day END,
         share = CASE WHEN excluded.reported_at >= roster_activity.reported_at THEN excluded.share ELSE roster_activity.share END,
         reported_at = MAX(excluded.reported_at, roster_activity.reported_at)`,
    ).bind(m.nameKey, m.lastOnline, Math.round(m.seen7d), Math.round(m.avgDay), m.share, r.at));
  }
  for (const k of r.ranks) {
    st.push(db.prepare('INSERT INTO roster_rank (rank_id, name) VALUES (?, ?) ON CONFLICT(rank_id) DO UPDATE SET name = excluded.name').bind(k.id, k.name));
  }
  st.push(setMeta(db, META_PULSE_AT, String(r.at)));
  if (st.length) await db.batch(st);
  return { members: r.members.length };
}

export type RosterRow = {
  nameKey: string; display: string; cls: string | null; level: number; rankId: number | null; rank: string | null;
  gain: number; partial: boolean; firstSeen: number;
  lastOnline: number | null; seen7d: number | null; avgDay: number | null; share: number | null; reportedAt: number | null;
};

export type RosterData = {
  rows: RosterRow[]; ranks: { id: number; name: string }[];
  armoryAt: number | null; armoryError: { at: number; message: string } | null; pulseAt: number | null;
};

export async function loadRoster(db: D1Database, now: number): Promise<RosterData> {
  const [members, levels, ranks, meta] = await db.batch([
    db.prepare(`SELECT m.name_key, m.display_name, m.class, m.level, m.rank_id, m.first_seen,
                  a.last_online, a.seen7d, a.avg_day, a.share, a.reported_at
                FROM roster_member m LEFT JOIN roster_activity a ON a.name_key = m.name_key
                WHERE m.left_at IS NULL`),
    db.prepare('SELECT l.name_key, l.at, l.level FROM roster_level l JOIN roster_member m ON m.name_key = l.name_key WHERE m.left_at IS NULL ORDER BY l.at'),
    db.prepare('SELECT rank_id, name FROM roster_rank ORDER BY rank_id'),
    db.prepare('SELECT k, v FROM roster_meta'),
  ]);
  const hist = new Map<string, { at: number; level: number }[]>();
  for (const l of levels.results as any[]) {
    if (!hist.has(l.name_key)) hist.set(l.name_key, []);
    hist.get(l.name_key)!.push({ at: l.at, level: l.level });
  }
  const rankName = new Map((ranks.results as any[]).map((r) => [r.rank_id as number, r.name as string]));
  const rows: RosterRow[] = (members.results as any[]).map((m) => {
    const g = levelGain(hist.get(m.name_key) ?? [], m.level, now);
    return {
      nameKey: m.name_key, display: m.display_name, cls: m.class, level: m.level, rankId: m.rank_id,
      rank: m.rank_id === null ? null : rankName.get(m.rank_id) ?? null, gain: g.gain, partial: g.partial, firstSeen: m.first_seen,
      lastOnline: m.last_online ?? null, seen7d: m.reported_at ? m.seen7d : null, avgDay: m.reported_at ? m.avg_day : null,
      share: m.reported_at ? m.share : null, reportedAt: m.reported_at ?? null,
    };
  });
  const kv = new Map((meta.results as any[]).map((r) => [r.k as string, r.v as string]));
  const errRaw = kv.get(META_ARMORY_ERROR);
  let armoryError: RosterData['armoryError'] = null;
  if (errRaw) {
    const i = errRaw.indexOf('|');
    armoryError = { at: Number(errRaw.slice(0, i)), message: errRaw.slice(i + 1) };
  }
  const n = (k: string) => (kv.has(k) && kv.get(k) !== '' ? Number(kv.get(k)) : null);
  return {
    rows, ranks: [...rankName].map(([id, name]) => ({ id, name })),
    armoryAt: n(META_ARMORY_AT), armoryError, pulseAt: n(META_PULSE_AT),
  };
}
