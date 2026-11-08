import { parseDarklight, type AwardInput } from '../domain/darklight';
import { parseEpgpCsv, type EpgpRow } from '../domain/epgp';
import { assignInstance, groupIntoNights, type NightDraft } from '../domain/grouping';
import type { KillInput } from '../domain/limpus';
import { parseLimpus } from '../domain/limpus';
import { nightLabel } from '../domain/nights';

export type ImportRequest = { lootText: string; attendanceText: string; epgpText?: string;
  instancePicks: Record<string /*nightDate*/, string>; countsOff: string[] /*nightDates*/ };
export type NightPreview = { nightDate: string; label: string; instances: { zone: string; bosses: number }[];
  players: number; newAwards: number; duplicateAwards: number; needsInstance: boolean; existing: boolean };
/** EPGP standings in this import: rows to store, rows for characters not seen before, alt rows skipped. */
export type EpgpPreview = { rows: number; newCharacters: number; altsSkipped: number };
export type ImportPreview = { ok: true; nights: NightPreview[]; newCharacters: string[]; epgp: EpgpPreview | null; warnings: string[] }
  | { ok: false; error: string };

type PlannedAward = AwardInput & { instance: string | null; isNew: boolean };
type Plan = {
  nights: (NightDraft & { preview: NightPreview; planned: PlannedAward[] })[];
  newCharacters: { nameKey: string; displayName: string }[];
  newItems: Map<number, { name: string; instance: string | null }>;
  /** Null when no EPGP CSV was pasted (the stored standings are then left alone). */
  epgp: { rows: EpgpRow[]; preview: EpgpPreview } | null;
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
  const epgpText = req.epgpText ?? '';
  if (req.lootText.trim() === '' && req.attendanceText.trim() === '' && epgpText.trim() === '') return { error: 'Paste at least one export.' };
  const loot = parseDarklight(req.lootText);
  if (!loot.ok) return { error: `Loot export: ${loot.error}` };
  const att = parseLimpus(req.attendanceText);
  if (!att.ok) return { error: `Attendance export: ${att.error}` };
  const epgp = parseEpgpCsv(epgpText);
  if (!epgp.ok) return { error: `EPGP standings: ${epgp.error}` };

  // The same award id twice in one paste counts once.
  const seenIds = new Set<string>();
  const awards = loot.value.filter((a) => {
    if (seenIds.has(a.darklightId)) return false;
    seenIds.add(a.darklightId);
    return true;
  });
  const drafts = groupIntoNights(att.value, awards);

  const nightDates = drafts.map((d) => d.nightDate);
  const existingNights = new Map(
    (await selectIn<{ night_date: string; manual: number; instances: string | null }>(db,
      (ph) => `SELECT night_date, manual, instances FROM raid_night WHERE night_date IN (${ph})`, nightDates))
      .map((r) => [r.night_date, r]));
  // Kills stored by earlier imports also decide award instances (e.g. attendance first, loot later).
  const storedKills = new Map<string, KillInput[]>();
  for (const r of await selectIn<{ night_date: string; t: number; zone: string; boss: string }>(db,
    (ph) => `SELECT n.night_date, k.t, k.zone, k.boss FROM kill k JOIN raid_night n ON n.id = k.night_id WHERE n.night_date IN (${ph})`,
    nightDates)) {
    const list = storedKills.get(r.night_date) ?? [];
    list.push({ t: r.t, zone: r.zone, boss: r.boss, members: [] });
    storedKills.set(r.night_date, list);
  }
  const existingAwards = new Set(
    (await selectIn<{ darklight_id: string }>(db, (ph) => `SELECT darklight_id FROM award WHERE darklight_id IN (${ph})`,
      awards.map((a) => a.darklightId))).map((r) => r.darklight_id));
  const itemRows = await selectIn<{ item_id: number; instance: string | null }>(
    db, (ph) => `SELECT item_id, instance FROM item WHERE item_id IN (${ph})`, [...new Set(awards.map((a) => a.itemId))]);
  const itemInstance = new Map(itemRows.map((r) => [r.item_id, r.instance]));

  const seenChars = new Map<string, string>();
  for (const d of drafts) for (const a of d.awards) if (!seenChars.has(a.nameKey)) seenChars.set(a.nameKey, a.displayName);
  for (const d of drafts) for (const k of d.kills) for (const m of k.members) if (!seenChars.has(m.nameKey)) seenChars.set(m.nameKey, m.displayName);
  for (const r of epgp.value) if (!seenChars.has(r.nameKey)) seenChars.set(r.nameKey, r.displayName);
  const knownRows = await selectIn<{ name_key: string; main_key: string | null }>(db,
    (ph) => `SELECT name_key, main_key FROM character WHERE name_key IN (${ph})`, [...seenChars.keys()]);
  const knownChars = new Set(knownRows.map((r) => r.name_key));
  // EPGP Forever shares a main's balance with its alts, so alt rows would duplicate it.
  const alts = new Set(knownRows.filter((r) => r.main_key !== null).map((r) => r.name_key));
  const epgpRows = epgp.value.filter((r) => !alts.has(r.nameKey));
  const newCharacters = [...seenChars].filter(([k]) => !knownChars.has(k)).map(([nameKey, displayName]) => ({ nameKey, displayName }));

  const newItems = new Map<number, { name: string; instance: string | null }>();
  const nights = drafts.map((d) => {
    const pick = req.instancePicks[d.nightDate] || null;
    const existing = existingNights.get(d.nightDate);
    const manualZones = existing?.manual ? (existing.instances ?? '').split(',').map((z) => z.trim()).filter(Boolean) : [];
    const nightDefault = manualZones.length === 1 ? manualZones[0] : null;
    const seenKills = new Set(d.kills.map((k) => `${k.t}|${k.boss}`));
    const allKills = [...d.kills, ...(storedKills.get(d.nightDate) ?? []).filter((k) => !seenKills.has(`${k.t}|${k.boss}`))];
    const planned: PlannedAward[] = d.awards.map((a) => {
      const assigned = assignInstance(a.t, allKills) || null; // an empty zone counts as no instance
      // Kill zone, then the item's remembered instance, then a manual night's single instance, then the pick.
      const instance = assigned ?? itemInstance.get(a.itemId) ?? nightDefault ?? pick;
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
      existing: existing !== undefined,
    };
    return { ...d, preview, planned };
  });
  const noAttendance = nights.filter((n) => !n.preview.existing && n.preview.players === 0)
    .map((n) => `No attendance for ${n.preview.label}: untick Counts, or add players on the Nights page after saving.`);
  const epgpPlan = epgpText.trim() === '' ? null : {
    rows: epgpRows,
    preview: { rows: epgpRows.length, newCharacters: epgpRows.filter((r) => !knownChars.has(r.nameKey)).length,
      altsSkipped: epgp.value.length - epgpRows.length },
  };
  return { nights, newCharacters, newItems, epgp: epgpPlan,
    warnings: [...loot.warnings, ...att.warnings, ...epgp.warnings, ...noAttendance] };
}

export async function previewImport(db: D1Database, req: ImportRequest): Promise<ImportPreview> {
  const p = await plan(db, req);
  if ('error' in p) return { ok: false, error: p.error };
  return { ok: true, nights: p.nights.map((n) => n.preview), newCharacters: p.newCharacters.map((c) => c.displayName),
    epgp: p.epgp?.preview ?? null, warnings: p.warnings };
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
    st.push(db.prepare('INSERT OR IGNORE INTO item (item_id, name, instance) VALUES (?, ?, ?)')
      .bind(itemId, it.name, it.instance));
  }
  const nightId = '(SELECT id FROM raid_night WHERE night_date = ?)';
  for (const n of p.nights) {
    st.push(db.prepare('INSERT OR IGNORE INTO raid_night (night_date, counts) VALUES (?, ?)')
      .bind(n.nightDate, off.has(n.nightDate) ? 0 : 1));
    for (const k of n.kills) {
      st.push(db.prepare(`INSERT OR IGNORE INTO kill (night_id, t, zone, boss) VALUES (${nightId}, ?, ?, ?)`)
        .bind(n.nightDate, k.t, k.zone, k.boss));
      st.push(db.prepare('INSERT OR IGNORE INTO kill_member (kill_id, name_key) SELECT (SELECT id FROM kill WHERE t = ? AND boss = ?), value FROM json_each(?)')
        .bind(k.t, k.boss, JSON.stringify(k.members.map((m) => m.nameKey))));
    }
    for (const a of n.planned) {
      if (!a.isNew) continue;
      st.push(db.prepare(`INSERT OR IGNORE INTO award (darklight_id, night_id, t, name_key, item_id, response, instance) VALUES (?, ${nightId}, ?, ?, ?, ?, ?)`)
        .bind(a.darklightId, n.nightDate, a.t, a.nameKey, a.itemId, a.response, a.instance!)); // non-null: commit rejected needsInstance above
    }
  }
  if (p.epgp) {
    // The standings are a snapshot: the new CSV replaces the old one completely.
    st.push(db.prepare('DELETE FROM epgp_standing'));
    for (const r of p.epgp.rows) {
      st.push(db.prepare('INSERT INTO epgp_standing (name_key, class, ep, gp) VALUES (?, ?, ?, ?)').bind(r.nameKey, r.class, r.ep, r.gp));
    }
    st.push(db.prepare('INSERT INTO epgp_meta (id, imported_at) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET imported_at = excluded.imported_at').bind(now));
  }
  const newAwards = p.nights.reduce((s, n) => s + n.preview.newAwards, 0);
  const parts: string[] = [];
  if (req.lootText.trim() !== '' || req.attendanceText.trim() !== '') {
    parts.push(plural(p.nights.length, 'night', 'nights'), plural(newAwards, 'new item', 'new items'));
  }
  parts.push(plural(p.newCharacters.length, 'new character', 'new characters'));
  if (p.epgp) parts.push(plural(p.epgp.rows.length, 'EPGP standing', 'EPGP standings'));
  const summary = parts.join(', ');
  st.push(db.prepare('INSERT INTO import_log (at, by_discord_id, summary) VALUES (?, ?, ?)').bind(now, byDiscordId, summary));
  try {
    await db.batch(st);
  } catch (e) {
    return { ok: false, error: 'Import failed: ' + (e instanceof Error ? e.message : String(e)) };
  }
  return { ok: true, summary };
}
