import { displayName, nameKey } from '../domain/names';
import { nightLabel } from '../domain/nights';
import { resolveNight, type Status } from '../domain/standings';

export type Result = { ok: true } | { ok: false; error: string };
const ok: Result = { ok: true };
const fail = (error: string): Result => ({ ok: false, error });

export const STATUSES: Status[] = ['member', 'guest', 'left'];
export const NEW_CHARACTER_DAYS = 14;

// ---------- nights ----------

export type NightRow = { id: number; nightDate: string; label: string; counts: boolean; manual: boolean; instances: string; players: number };

type OverrideRow = { night_id: number; name_key: string; present: number; benched: number };
const toOverride = (r: OverrideRow) => ({ nameKey: r.name_key, present: !!r.present, benched: !!r.benched });

async function effectiveRoster(db: D1Database, nightId: number): Promise<{ present: Set<string>; benched: Set<string> }> {
  const [kills, ov] = await db.batch([
    db.prepare('SELECT DISTINCT km.name_key FROM kill_member km JOIN kill k ON k.id = km.kill_id WHERE k.night_id = ?').bind(nightId),
    db.prepare('SELECT night_id, name_key, present, benched FROM night_override WHERE night_id = ?').bind(nightId),
  ]);
  return resolveNight((kills.results as any[]).map((r) => r.name_key as string), (ov.results as OverrideRow[]).map(toOverride));
}

export async function listNights(db: D1Database): Promise<NightRow[]> {
  const [nights, zones, kills, ov] = await db.batch([
    db.prepare('SELECT id, night_date, counts, manual, instances FROM raid_night ORDER BY night_date DESC'),
    db.prepare('SELECT DISTINCT night_id, zone FROM kill ORDER BY zone'),
    db.prepare('SELECT DISTINCT k.night_id, km.name_key FROM kill_member km JOIN kill k ON k.id = km.kill_id'),
    db.prepare('SELECT night_id, name_key, present, benched FROM night_override'),
  ]);
  const killKeys = new Map<number, string[]>();
  for (const r of kills.results as any[]) killKeys.set(r.night_id, [...(killKeys.get(r.night_id) ?? []), r.name_key]);
  const ovs = new Map<number, OverrideRow[]>();
  for (const r of ov.results as OverrideRow[]) ovs.set(r.night_id, [...(ovs.get(r.night_id) ?? []), r]);
  // Players = present plus benched, since both count as attendance.
  const players = (id: number) => {
    const { present, benched } = resolveNight(killKeys.get(id) ?? [], (ovs.get(id) ?? []).map(toOverride));
    return present.size + benched.size;
  };
  const zoneMap = new Map<number, string[]>();
  for (const r of zones.results as any[]) zoneMap.set(r.night_id, [...(zoneMap.get(r.night_id) ?? []), r.zone]);
  return (nights.results as any[]).map((r) => ({
    id: r.id, nightDate: r.night_date, label: nightLabel(r.night_date), counts: !!r.counts, manual: !!r.manual,
    instances: r.instances ?? (zoneMap.get(r.id) ?? []).join(', '), players: players(r.id),
  }));
}

export async function toggleCounts(db: D1Database, id: number): Promise<Result> {
  const r = await db.prepare('UPDATE raid_night SET counts = 1 - counts WHERE id = ?').bind(id).run();
  return r.meta.changes ? ok : fail('Unknown raid night');
}

export async function createManualNight(db: D1Database, date: string, instances: string, present: string[], bench: string[] = []): Promise<Result> {
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(date + 'T12:00:00Z') : null;
  if (!dt || Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== date) return fail('Date must be a valid YYYY-MM-DD');
  if (await db.prepare('SELECT 1 AS x FROM raid_night WHERE night_date = ?').bind(date).first())
    return fail(`A raid night for ${nightLabel(date)} already exists — open it on the Nights page to add players.`);
  const keys = [...new Set(present)];
  // Ticked as both present and benched: present wins.
  const benchKeys = [...new Set(bench)].filter((k) => !keys.includes(k));
  for (const k of [...keys, ...benchKeys]) {
    const c = await db.prepare('SELECT status, main_key FROM character WHERE name_key = ?').bind(k).first<{ status: string; main_key: string | null }>();
    if (!c || c.status !== 'member' || c.main_key !== null) return fail('Only member mains can be ticked as present or benched');
  }
  const inst = instances.trim();
  await db.batch([
    db.prepare('INSERT INTO raid_night (night_date, counts, manual, instances) VALUES (?, 1, 1, ?)').bind(date, inst || null),
    ...keys.map((k) => db.prepare('INSERT INTO night_override (night_id, name_key, present) VALUES ((SELECT id FROM raid_night WHERE night_date = ?), ?, 1)').bind(date, k)),
    ...benchKeys.map((k) => db.prepare('INSERT INTO night_override (night_id, name_key, present, benched) VALUES ((SELECT id FROM raid_night WHERE night_date = ?), ?, 1, 1)').bind(date, k)),
  ]);
  return ok;
}

export async function getNight(db: D1Database, id: number) {
  const n = await db.prepare('SELECT id, night_date, counts, manual, instances FROM raid_night WHERE id = ?').bind(id).first<any>();
  if (!n) return null;
  const { present, benched } = await effectiveRoster(db, id);
  const chars = (await db.prepare('SELECT name_key, display_name, main_key FROM character').all<any>()).results;
  const byKey = new Map(chars.map((c) => [c.name_key as string, c]));
  const roster = [...present, ...benched].map((k) => ({ nameKey: k, display: (byKey.get(k)?.display_name ?? k) as string,
    isAlt: !!byKey.get(k)?.main_key, benched: benched.has(k) }))
    .sort((a, b) => a.display.localeCompare(b.display));
  return { id: n.id as number, nightDate: n.night_date as string, label: nightLabel(n.night_date), counts: !!n.counts,
    manual: !!n.manual, instances: (n.instances ?? '') as string, roster };
}

export async function setPresence(db: D1Database, nightId: number, rawName: string, present: boolean): Promise<Result> {
  const key = nameKey(rawName);
  if (!key) return fail('Enter a character name');
  if (!(await db.prepare('SELECT 1 AS x FROM raid_night WHERE id = ?').bind(nightId).first())) return fail('Unknown raid night');
  const stmts = [];
  if (present) {
    stmts.push(db.prepare("INSERT OR IGNORE INTO character (name_key, display_name, status, created_at) VALUES (?, ?, 'member', ?)")
      .bind(key, displayName(rawName), Math.floor(Date.now() / 1000)));
  }
  stmts.push(db.prepare('INSERT INTO night_override (night_id, name_key, present, benched) VALUES (?, ?, ?, 0) ON CONFLICT(night_id, name_key) DO UPDATE SET present = excluded.present, benched = 0')
    .bind(nightId, key, present ? 1 : 0));
  await db.batch(stmts);
  return ok;
}

/** Benches a player for a night (counts as attendance), or takes the bench away again. */
export async function setBench(db: D1Database, nightId: number, rawName: string, benched: boolean): Promise<Result> {
  const key = nameKey(rawName);
  if (!key) return fail('Enter a character name');
  if (!(await db.prepare('SELECT 1 AS x FROM raid_night WHERE id = ?').bind(nightId).first())) return fail('Unknown raid night');
  if (!benched) {
    // Only the bench goes; presence from kills (or a present override) is left alone.
    await db.prepare('DELETE FROM night_override WHERE night_id = ? AND name_key = ? AND benched = 1').bind(nightId, key).run();
    return ok;
  }
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO character (name_key, display_name, status, created_at) VALUES (?, ?, 'member', ?)")
      .bind(key, displayName(rawName), Math.floor(Date.now() / 1000)),
    db.prepare('INSERT INTO night_override (night_id, name_key, present, benched) VALUES (?, ?, 1, 1) ON CONFLICT(night_id, name_key) DO UPDATE SET present = 1, benched = 1')
      .bind(nightId, key),
  ]);
  return ok;
}

export async function deleteNight(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM raid_night WHERE id = ?').bind(id).run();
}

// ---------- characters ----------

export type CharRow = { nameKey: string; display: string; mainKey: string | null; status: Status; isNew: boolean; hasAlts: boolean };

export async function listCharacters(db: D1Database): Promise<CharRow[]> {
  const rows = (await db.prepare('SELECT name_key, display_name, main_key, status, created_at FROM character ORDER BY display_name COLLATE NOCASE').all<any>()).results;
  const withAlts = new Set(rows.filter((r) => r.main_key).map((r) => r.main_key as string));
  const cutoff = Date.now() / 1000 - NEW_CHARACTER_DAYS * 86400;
  return rows.map((r) => ({ nameKey: r.name_key, display: r.display_name, mainKey: r.main_key ?? null, status: r.status as Status,
    isNew: r.created_at >= cutoff, hasAlts: withAlts.has(r.name_key) }));
}

export async function setMain(db: D1Database, key: string, mainKey: string | null): Promise<Result> {
  const c = await db.prepare('SELECT display_name FROM character WHERE name_key = ?').bind(key).first<{ display_name: string }>();
  if (!c) return fail('Unknown character');
  if (mainKey === null) {
    await db.prepare('UPDATE character SET main_key = NULL WHERE name_key = ?').bind(key).run();
    return ok;
  }
  if (mainKey === key) return fail('A character cannot be its own main');
  const m = await db.prepare('SELECT main_key FROM character WHERE name_key = ?').bind(mainKey).first<{ main_key: string | null }>();
  if (!m) return fail('Unknown main character');
  if (m.main_key !== null) return fail('The chosen main is itself an alt');
  const alts = await db.prepare('SELECT 1 AS x FROM character WHERE main_key = ? LIMIT 1').bind(key).first();
  if (alts) return fail(`${c.display_name} has alts; unlink them first`);
  await db.prepare('UPDATE character SET main_key = ? WHERE name_key = ?').bind(mainKey, key).run();
  return ok;
}

export async function setStatus(db: D1Database, key: string, status: string): Promise<Result> {
  if (!(STATUSES as string[]).includes(status)) return fail('Invalid status');
  const c = await db.prepare('SELECT main_key FROM character WHERE name_key = ?').bind(key).first<{ main_key: string | null }>();
  if (!c) return fail('Unknown character');
  if (c.main_key !== null) return fail('Status can only be set on a main');
  await db.prepare('UPDATE character SET status = ? WHERE name_key = ?').bind(status, key).run();
  return ok;
}

/** Validates main and status first, then writes both, so a 400 never leaves partial state. */
export async function updateCharacter(db: D1Database, key: string, main: string | null | undefined, status: string | undefined): Promise<Result> {
  const c = await db.prepare('SELECT display_name, main_key FROM character WHERE name_key = ?').bind(key).first<{ display_name: string; main_key: string | null }>();
  if (!c) return fail('Unknown character');
  if (status !== undefined) {
    if (!(STATUSES as string[]).includes(status)) return fail('Invalid status');
    if (c.main_key !== null) return fail('Status can only be set on a main');
  }
  if (main) {
    if (main === key) return fail('A character cannot be its own main');
    const m = await db.prepare('SELECT main_key FROM character WHERE name_key = ?').bind(main).first<{ main_key: string | null }>();
    if (!m) return fail('Unknown main character');
    if (m.main_key !== null) return fail('The chosen main is itself an alt');
    if (await db.prepare('SELECT 1 AS x FROM character WHERE main_key = ? LIMIT 1').bind(key).first())
      return fail(`${c.display_name} has alts; unlink them first`);
  }
  const stmts = [];
  if (status !== undefined) stmts.push(db.prepare('UPDATE character SET status = ? WHERE name_key = ?').bind(status, key));
  if (main !== undefined) stmts.push(db.prepare('UPDATE character SET main_key = ? WHERE name_key = ?').bind(main || null, key));
  if (stmts.length) await db.batch(stmts);
  return ok;
}

// ---------- items ----------

export type ItemRow = { itemId: number; name: string; instance: string; drops: number };

export async function listItems(db: D1Database, q: string): Promise<ItemRow[]> {
  const rows = (await db.prepare(
    `SELECT i.item_id, i.name, i.instance,
            (SELECT count(*) FROM award a WHERE a.item_id = i.item_id AND a.deleted = 0) AS drops
     FROM item i WHERE (? = '' OR instr(lower(i.name), lower(?)) > 0) ORDER BY i.name COLLATE NOCASE, i.item_id`).bind(q, q).all<any>()).results;
  return rows.map((r) => ({ itemId: r.item_id, name: r.name, instance: r.instance ?? '', drops: r.drops }));
}

export async function updateItem(db: D1Database, id: number, instance: string): Promise<Result> {
  const cur = await db.prepare('SELECT instance FROM item WHERE item_id = ?').bind(id).first<{ instance: string | null }>();
  if (!cur) return fail('Unknown item');
  const inst = instance.trim();
  // An empty instance leaves the stored instance alone (awards need a non-empty one).
  // Awards only move when the instance actually changed.
  if (!inst || inst === (cur.instance ?? '')) return ok;
  await db.batch([
    db.prepare('UPDATE item SET instance = ? WHERE item_id = ?').bind(inst, id),
    db.prepare('UPDATE award SET instance = ? WHERE item_id = ?').bind(inst, id),
  ]);
  return ok;
}

// ---------- loot ----------

export type LootRow = { id: string; itemName: string; nameKey: string; display: string; nightLabel: string; response: string; deleted: boolean };

export async function latestLoot(db: D1Database): Promise<LootRow[]> {
  const rows = (await db.prepare(
    `SELECT a.darklight_id, a.name_key, a.response, a.deleted, i.name AS item_name, n.night_date, c.display_name
     FROM award a JOIN item i ON i.item_id = a.item_id JOIN raid_night n ON n.id = a.night_id
     LEFT JOIN character c ON c.name_key = a.name_key
     ORDER BY a.t DESC, a.darklight_id DESC LIMIT 100`).all<any>()).results;
  return rows.map((r) => ({ id: r.darklight_id, itemName: r.item_name, nameKey: r.name_key, display: r.display_name ?? r.name_key,
    nightLabel: nightLabel(r.night_date), response: r.response, deleted: !!r.deleted }));
}

export async function updateLoot(db: D1Database, id: string, rawName: string, deleted: boolean): Promise<Result> {
  const key = nameKey(rawName);
  if (!(await db.prepare('SELECT 1 AS x FROM award WHERE darklight_id = ?').bind(id).first())) return fail('Unknown loot record');
  if (!(await db.prepare('SELECT 1 AS x FROM character WHERE name_key = ?').bind(key).first())) return fail('Unknown character');
  await db.prepare('UPDATE award SET name_key = ?, deleted = ? WHERE darklight_id = ?').bind(key, deleted ? 1 : 0, id).run();
  return ok;
}

// ---------- admins ----------

export async function listAdmins(db: D1Database): Promise<{ discordId: string; name: string }[]> {
  return (await db.prepare('SELECT discord_id, name FROM admin ORDER BY name COLLATE NOCASE').all<any>()).results
    .map((r) => ({ discordId: r.discord_id, name: r.name }));
}

export async function addAdmin(db: D1Database, discordId: string, name: string): Promise<Result> {
  const id = discordId.trim();
  if (!/^\d+$/.test(id)) return fail('Discord ID must be digits only');
  const n = name.trim();
  if (!n) return fail('Enter a name');
  await db.prepare('INSERT INTO admin (discord_id, name) VALUES (?, ?) ON CONFLICT(discord_id) DO UPDATE SET name = excluded.name').bind(id, n).run();
  return ok;
}

export async function removeAdmin(db: D1Database, id: string, bootstrapId: string): Promise<Result> {
  if (id === bootstrapId) return fail('The bootstrap admin cannot be removed');
  await db.prepare('DELETE FROM admin WHERE discord_id = ?').bind(id).run();
  return ok;
}
