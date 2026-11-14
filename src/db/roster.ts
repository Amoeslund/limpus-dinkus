import { MAX_LEVEL } from '../config';
import { effortScore, sourceKind, type Effort } from '../domain/gear';
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
      `INSERT INTO roster_member (name_key, display_name, class, level, rank_id, first_seen, last_seen, left_at, slug)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
       ON CONFLICT(name_key) DO UPDATE SET display_name = excluded.display_name, class = excluded.class, level = excluded.level,
         rank_id = excluded.rank_id, last_seen = excluded.last_seen, left_at = NULL, slug = excluded.slug`,
    ).bind(m.nameKey, m.display, m.cls, m.level, m.rankId, now, now, m.slug));
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
      `INSERT INTO roster_activity (name_key, last_online, seen7d, avg_day, share, reported_at, dungeon7d, raid7d) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(name_key) DO UPDATE SET
         last_online = CASE WHEN roster_activity.last_online IS NULL OR excluded.last_online > roster_activity.last_online
                            THEN excluded.last_online ELSE roster_activity.last_online END,
         seen7d = CASE WHEN excluded.reported_at >= roster_activity.reported_at THEN excluded.seen7d ELSE roster_activity.seen7d END,
         avg_day = CASE WHEN excluded.reported_at >= roster_activity.reported_at THEN excluded.avg_day ELSE roster_activity.avg_day END,
         share = CASE WHEN excluded.reported_at >= roster_activity.reported_at THEN excluded.share ELSE roster_activity.share END,
         dungeon7d = CASE WHEN excluded.reported_at >= roster_activity.reported_at THEN excluded.dungeon7d ELSE roster_activity.dungeon7d END,
         raid7d = CASE WHEN excluded.reported_at >= roster_activity.reported_at THEN excluded.raid7d ELSE roster_activity.raid7d END,
         reported_at = MAX(excluded.reported_at, roster_activity.reported_at)`,
    ).bind(m.nameKey, m.lastOnline, Math.round(m.seen7d), Math.round(m.avgDay), m.share, r.at,
      m.dungeon7d === null ? null : Math.round(m.dungeon7d), m.raid7d === null ? null : Math.round(m.raid7d)));
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
  dungeon7d: number | null; raid7d: number | null;
  /** Average item level from the armory, its change over 7 days, and non-raid items first seen in 7 days. */
  ilvl: number | null; ilvlGain: number | null; ilvlPartial: boolean; newDungeonItems: number | null; newOtherItems: number | null;
  gearError: string | null; effort: Effort;
};

export type RosterData = {
  rows: RosterRow[]; ranks: { id: number; name: string }[];
  armoryAt: number | null; armoryError: { at: number; message: string } | null; pulseAt: number | null;
};

export async function loadRoster(db: D1Database, now: number): Promise<RosterData> {
  const [members, levels, ranks, meta, ilvls, items] = await db.batch([
    db.prepare(`SELECT m.name_key, m.display_name, m.class, m.level, m.rank_id, m.first_seen,
                  a.last_online, a.seen7d, a.avg_day, a.share, a.reported_at, a.dungeon7d, a.raid7d,
                  p.ilvl, p.armory_updated, p.polled_at, p.error AS gear_error
                FROM roster_member m LEFT JOIN roster_activity a ON a.name_key = m.name_key
                LEFT JOIN roster_profile p ON p.name_key = m.name_key
                WHERE m.left_at IS NULL`),
    db.prepare('SELECT l.name_key, l.at, l.level FROM roster_level l JOIN roster_member m ON m.name_key = l.name_key WHERE m.left_at IS NULL ORDER BY l.at'),
    db.prepare('SELECT rank_id, name FROM roster_rank ORDER BY rank_id'),
    db.prepare('SELECT k, v FROM roster_meta'),
    db.prepare('SELECT name_key, at, ilvl FROM roster_ilvl ORDER BY at'),
    db.prepare('SELECT name_key, source FROM roster_item WHERE first_seen >= ?').bind(now - 7 * 86400),
  ]);
  const ilvlHist = new Map<string, { at: number; level: number }[]>();
  for (const l of ilvls.results as any[]) {
    if (!ilvlHist.has(l.name_key)) ilvlHist.set(l.name_key, []);
    ilvlHist.get(l.name_key)!.push({ at: l.at, level: l.ilvl });
  }
  const fresh = new Map<string, { dungeon: number; other: number }>();
  for (const i of items.results as any[]) {
    const kind = sourceKind(i.source);
    if (kind === 'raid') continue;  // raid loot is not outside-raid effort
    const f = fresh.get(i.name_key) ?? { dungeon: 0, other: 0 };
    if (kind === 'dungeon') f.dungeon++; else f.other++;
    fresh.set(i.name_key, f);
  }
  const hist = new Map<string, { at: number; level: number }[]>();
  for (const l of levels.results as any[]) {
    if (!hist.has(l.name_key)) hist.set(l.name_key, []);
    hist.get(l.name_key)!.push({ at: l.at, level: l.level });
  }
  const rankName = new Map((ranks.results as any[]).map((r) => [r.rank_id as number, r.name as string]));
  const rows: RosterRow[] = (members.results as any[]).map((m) => {
    const g = levelGain(hist.get(m.name_key) ?? [], m.level, now);
    const hasGear = m.ilvl !== null && m.ilvl !== undefined;
    const ig = hasGear ? levelGain(ilvlHist.get(m.name_key) ?? [], m.ilvl, now) : null;
    const f = fresh.get(m.name_key) ?? { dungeon: 0, other: 0 };
    const seen7d = m.reported_at ? m.seen7d : null;
    const dungeon7d = m.reported_at ? m.dungeon7d ?? null : null, raid7d = m.reported_at ? m.raid7d ?? null : null;
    // The armory's "last updated" changes when the character logs out, so it is a last-online time for everyone.
    const lastOnline = Math.max(m.last_online ?? 0, m.armory_updated ?? 0) || null;
    const row = {
      nameKey: m.name_key, display: m.display_name, cls: m.class, level: m.level, rankId: m.rank_id,
      rank: m.rank_id === null ? null : rankName.get(m.rank_id) ?? null, gain: g.gain, partial: g.partial, firstSeen: m.first_seen,
      lastOnline, seen7d, avgDay: m.reported_at ? m.avg_day : null,
      share: m.reported_at ? m.share : null, reportedAt: m.reported_at ?? null, dungeon7d, raid7d,
      ilvl: hasGear ? m.ilvl : null, ilvlGain: ig ? ig.gain : null, ilvlPartial: ig ? ig.partial : true,
      newDungeonItems: hasGear ? f.dungeon : null, newOtherItems: hasGear ? f.other : null, gearError: m.gear_error ?? null,
    };
    const effort = effortScore({
      level: m.level, maxLevel: MAX_LEVEL, levelGain: g.gain, levelPartial: g.partial,
      seen7d, dungeon7d, raid7d,
      newDungeonItems: row.newDungeonItems, newOtherItems: row.newOtherItems, ilvlGain: ig && !ig.partial ? ig.gain : 0,
    });
    return { ...row, effort };
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
