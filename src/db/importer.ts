import { DEFAULT_POINTS } from '../config';
import { parseDarklight, type AwardInput } from '../domain/darklight';
import { groupIntoNights, type NightDraft } from '../domain/grouping';
import { parseLimpus } from '../domain/limpus';
import { nightLabel } from '../domain/nights';

export type ImportRequest = { lootText: string; attendanceText: string;
  instancePicks: Record<string /*nightDate*/, string>; countsOff: string[] /*nightDates*/ };
export type NightPreview = { nightDate: string; label: string; instances: { zone: string; bosses: number }[];
  players: number; newAwards: number; duplicateAwards: number; needsInstance: boolean; existing: boolean };
export type ImportPreview = { ok: true; nights: NightPreview[]; newCharacters: string[]; warnings: string[] }
  | { ok: false; error: string };

type PlannedAward = AwardInput & { instance: string | null; isNew: boolean };
type Plan = {
  nights: (NightDraft & { preview: NightPreview; planned: PlannedAward[] })[];
  newCharacters: { nameKey: string; displayName: string }[];
  newItems: Map<number, { name: string; instance: string | null }>;
  warnings: string[];
};

const CHUNK = 80; // D1 allows at most 100 bound parameters per statement

async function selectIn<T>(db: D1Database, sql: (ph: string) => string, values: (string | number)[]): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < values.length; i += CHUNK) {
    const part = values.slice(i, i + CHUNK);
    const res = await db.prepare(sql(part.map(() => '?').join(','))).bind(...part).all<T>();
    out.push(...res.results);
  }
  return out;
}

async function plan(db: D1Database, req: ImportRequest): Promise<Plan | { error: string }> {
  if (req.lootText.trim() === '' && req.attendanceText.trim() === '') return { error: 'Paste at least one export.' };
  const loot = parseDarklight(req.lootText);
  if (!loot.ok) return { error: `Loot export: ${loot.error}` };
  const att = parseLimpus(req.attendanceText);
  if (!att.ok) return { error: `Attendance export: ${att.error}` };

  // The same award id twice in one paste counts once.
  const seenIds = new Set<string>();
  const awards = loot.value.filter((a) => {
    if (seenIds.has(a.darklightId)) return false;
    seenIds.add(a.darklightId);
    return true;
  });
  const drafts = groupIntoNights(att.value, awards);

  const existingNights = new Set(
    (await selectIn<{ night_date: string }>(db, (ph) => `SELECT night_date FROM raid_night WHERE night_date IN (${ph})`,
      drafts.map((d) => d.nightDate))).map((r) => r.night_date));
  const existingAwards = new Set(
    (await selectIn<{ darklight_id: string }>(db, (ph) => `SELECT darklight_id FROM award WHERE darklight_id IN (${ph})`,
      awards.map((a) => a.darklightId))).map((r) => r.darklight_id));
  const itemRows = await selectIn<{ item_id: number; instance: string | null }>(
    db, (ph) => `SELECT item_id, instance FROM item WHERE item_id IN (${ph})`, [...new Set(awards.map((a) => a.itemId))]);
  const itemInstance = new Map(itemRows.map((r) => [r.item_id, r.instance]));

  const seenChars = new Map<string, string>();
  for (const d of drafts) for (const a of d.awards) if (!seenChars.has(a.nameKey)) seenChars.set(a.nameKey, a.displayName);
  for (const d of drafts) for (const k of d.kills) for (const m of k.members) if (!seenChars.has(m.nameKey)) seenChars.set(m.nameKey, m.displayName);
  const knownChars = new Set(
    (await selectIn<{ name_key: string }>(db, (ph) => `SELECT name_key FROM character WHERE name_key IN (${ph})`,
      [...seenChars.keys()])).map((r) => r.name_key));
  const newCharacters = [...seenChars].filter(([k]) => !knownChars.has(k)).map(([nameKey, displayName]) => ({ nameKey, displayName }));

  const newItems = new Map<number, { name: string; instance: string | null }>();
  const nights = drafts.map((d) => {
    const pick = req.instancePicks[d.nightDate] || null;
    const planned: PlannedAward[] = d.awards.map((a) => {
      const assigned = a.instance || null; // an empty zone counts as no instance
      const instance = assigned ?? pick ?? itemInstance.get(a.itemId) ?? null;
      return { ...a, instance, isNew: !existingAwards.has(a.darklightId) };
    });
    for (const a of planned) {
      if (!a.isNew || itemInstance.has(a.itemId)) continue;
      const cur = newItems.get(a.itemId);
      if (!cur) newItems.set(a.itemId, { name: a.itemName, instance: a.instance });
      else if (cur.instance === null && a.instance) cur.instance = a.instance;
    }
    const zones = new Map<string, number>();
    for (const k of d.kills) if (k.zone) zones.set(k.zone, (zones.get(k.zone) ?? 0) + 1);
    const players = new Set<string>();
    for (const k of d.kills) for (const m of k.members) players.add(m.nameKey);
    const preview: NightPreview = {
      nightDate: d.nightDate, label: nightLabel(d.nightDate),
      instances: [...zones].map(([zone, bosses]) => ({ zone, bosses })),
      players: players.size,
      newAwards: planned.filter((a) => a.isNew).length,
      duplicateAwards: planned.filter((a) => !a.isNew).length,
      needsInstance: planned.some((a) => a.isNew && a.instance === null),
      existing: existingNights.has(d.nightDate),
    };
    return { ...d, preview, planned };
  });
  return { nights, newCharacters, newItems, warnings: [...loot.warnings, ...att.warnings] };
}

export async function previewImport(db: D1Database, req: ImportRequest): Promise<ImportPreview> {
  const p = await plan(db, req);
  if ('error' in p) return { ok: false, error: p.error };
  return { ok: true, nights: p.nights.map((n) => n.preview), newCharacters: p.newCharacters.map((c) => c.displayName), warnings: p.warnings };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export async function commitImport(db: D1Database, req: ImportRequest, byDiscordId: string):
  Promise<{ ok: true; summary: string } | { ok: false; error: string }> {
  const p = await plan(db, req);
  if ('error' in p) return { ok: false, error: p.error };
  for (const n of p.nights) {
    if (n.preview.needsInstance && !req.instancePicks[n.nightDate]) {
      return { ok: false, error: `Pick an instance for ${n.preview.label}` };
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const off = new Set(req.countsOff);
  const st: D1PreparedStatement[] = [];
  for (const c of p.newCharacters) {
    st.push(db.prepare('INSERT OR IGNORE INTO character (name_key, display_name, created_at) VALUES (?, ?, ?)')
      .bind(c.nameKey, c.displayName, now));
  }
  for (const [itemId, it] of p.newItems) {
    st.push(db.prepare('INSERT OR IGNORE INTO item (item_id, name, instance, points) VALUES (?, ?, ?, ?)')
      .bind(itemId, it.name, it.instance, DEFAULT_POINTS));
  }
  const nightId = '(SELECT id FROM raid_night WHERE night_date = ?)';
  for (const n of p.nights) {
    st.push(db.prepare('INSERT OR IGNORE INTO raid_night (night_date, counts) VALUES (?, ?)')
      .bind(n.nightDate, off.has(n.nightDate) ? 0 : 1));
    for (const k of n.kills) {
      st.push(db.prepare(`INSERT OR IGNORE INTO kill (night_id, t, zone, boss) VALUES (${nightId}, ?, ?, ?)`)
        .bind(n.nightDate, k.t, k.zone, k.boss));
      for (const m of k.members) {
        st.push(db.prepare('INSERT OR IGNORE INTO kill_member (kill_id, name_key) VALUES ((SELECT id FROM kill WHERE t = ? AND boss = ?), ?)')
          .bind(k.t, k.boss, m.nameKey));
      }
    }
    for (const a of n.planned) {
      if (!a.isNew) continue;
      st.push(db.prepare(`INSERT OR IGNORE INTO award (darklight_id, night_id, t, name_key, item_id, response, instance) VALUES (?, ${nightId}, ?, ?, ?, ?, ?)`)
        .bind(a.darklightId, n.nightDate, a.t, a.nameKey, a.itemId, a.response, a.instance!));
    }
  }
  const newAwards = p.nights.reduce((s, n) => s + n.preview.newAwards, 0);
  const summary = `${plural(p.nights.length, 'night', 'nights')}, ${plural(newAwards, 'new item', 'new items')}, ${plural(p.newCharacters.length, 'new character', 'new characters')}`;
  st.push(db.prepare('INSERT INTO import_log (at, by_discord_id, summary) VALUES (?, ?, ?)').bind(now, byDiscordId, summary));
  await db.batch(st);
  return { ok: true, summary };
}
