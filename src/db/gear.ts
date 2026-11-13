import { GEAR_BATCH, GEAR_MIN_LEVEL } from '../config';
import { fetchCharacter, type CharacterProfile } from '../domain/gear';

/** Stores one character fetch: current gear, newly seen items, item level history. */
export async function saveCharacter(db: D1Database, key: string, p: CharacterProfile, now: number) {
  const [items, lastIlvl] = await db.batch([
    db.prepare('SELECT COUNT(*) AS n FROM roster_item WHERE name_key = ?').bind(key),
    db.prepare('SELECT ilvl FROM roster_ilvl WHERE name_key = ? ORDER BY at DESC LIMIT 1').bind(key),
  ]);
  // The first fetch is the baseline: those items were not "new this week".
  const firstSeen = ((items.results[0] as any)?.n ?? 0) > 0 ? now : 0;
  const st: D1PreparedStatement[] = [db.prepare('DELETE FROM roster_gear WHERE name_key = ?').bind(key)];
  for (const g of p.gear) {
    st.push(db.prepare('INSERT OR REPLACE INTO roster_gear (name_key, slot, item_id, name, ilvl, quality, source) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(key, g.slot, g.itemId, g.name, g.ilvl, g.quality, g.source));
    st.push(db.prepare('INSERT OR IGNORE INTO roster_item (name_key, item_id, first_seen, name, ilvl, source) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(key, g.itemId, firstSeen, g.name, g.ilvl, g.source));
  }
  const prev = (lastIlvl.results[0] as any)?.ilvl ?? null;
  if (p.ilvl !== null && p.ilvl !== prev) {
    st.push(db.prepare('INSERT OR REPLACE INTO roster_ilvl (name_key, at, ilvl) VALUES (?, ?, ?)').bind(key, now, p.ilvl));
  }
  st.push(db.prepare(
    `INSERT INTO roster_profile (name_key, ilvl, armory_updated, polled_at, error) VALUES (?, ?, ?, ?, NULL)
     ON CONFLICT(name_key) DO UPDATE SET ilvl = excluded.ilvl, armory_updated = excluded.armory_updated,
       polled_at = excluded.polled_at, error = NULL`,
  ).bind(key, p.ilvl, p.armoryUpdated, now));
  await db.batch(st);
}

/**
 * Hourly cron: fetches the armory pages of the members whose gear is oldest. One run stays far below the
 * Worker subrequest limit; the whole guild cycles through every few hours.
 */
export async function pollGear(db: D1Database, now = Math.floor(Date.now() / 1000), fetchFn: typeof fetch = fetch, batch = GEAR_BATCH) {
  const due = await db.prepare(
    `SELECT m.name_key, m.slug FROM roster_member m LEFT JOIN roster_profile p ON p.name_key = m.name_key
     WHERE m.left_at IS NULL AND m.slug IS NOT NULL AND m.level >= ?
     ORDER BY COALESCE(p.polled_at, 0), m.name_key LIMIT ?`,
  ).bind(GEAR_MIN_LEVEL, batch).all<{ name_key: string; slug: string }>();
  let fetched = 0, errors = 0;
  for (const m of due.results) {
    const res = await fetchCharacter(m.slug, fetchFn);
    if (res.ok) {
      await saveCharacter(db, m.name_key, res.value, now);
      fetched++;
    } else {
      errors++;
      await db.prepare(
        `INSERT INTO roster_profile (name_key, polled_at, error) VALUES (?, ?, ?)
         ON CONFLICT(name_key) DO UPDATE SET polled_at = excluded.polled_at, error = excluded.error`,
      ).bind(m.name_key, now, res.error).run();
    }
  }
  return { fetched, errors };
}

export type GearRow = { slot: string; itemId: number; name: string; ilvl: number | null; quality: string | null; source: number | null; firstSeen: number | null };

export async function loadGear(db: D1Database, key: string) {
  const [gear, profile, newItems] = await db.batch([
    db.prepare(
      `SELECT g.slot, g.item_id, g.name, g.ilvl, g.quality, g.source, i.first_seen FROM roster_gear g
       LEFT JOIN roster_item i ON i.name_key = g.name_key AND i.item_id = g.item_id WHERE g.name_key = ?`,
    ).bind(key),
    db.prepare('SELECT ilvl, armory_updated, polled_at, error FROM roster_profile WHERE name_key = ?').bind(key),
    db.prepare('SELECT item_id, name, ilvl, source, first_seen FROM roster_item WHERE name_key = ? AND first_seen > 0 ORDER BY first_seen DESC LIMIT 30').bind(key),
  ]);
  return {
    gear: (gear.results as any[]).map((g): GearRow => ({
      slot: g.slot, itemId: g.item_id, name: g.name, ilvl: g.ilvl, quality: g.quality, source: g.source, firstSeen: g.first_seen,
    })),
    profile: (profile.results[0] as any) ?? null as null | { ilvl: number | null; armory_updated: number | null; polled_at: number; error: string | null },
    history: (newItems.results as any[]).map((i) => ({ itemId: i.item_id as number, name: i.name as string, ilvl: i.ilvl as number | null, source: i.source as number | null, firstSeen: i.first_seen as number })),
  };
}
