import type { Response } from '../domain/darklight';
import type { Status, StandingsInput } from '../domain/standings';

export async function loadStandingsInput(db: D1Database): Promise<StandingsInput> {
  const [chars, nights, kills, overrides] = await db.batch([
    db.prepare('SELECT name_key, display_name, main_key, status FROM character'),
    db.prepare('SELECT id, night_date, counts FROM raid_night ORDER BY night_date'),
    db.prepare('SELECT DISTINCT k.night_id, km.name_key FROM kill_member km JOIN kill k ON k.id = km.kill_id'),
    db.prepare('SELECT night_id, name_key, present, benched FROM night_override'),
  ]);
  return {
    characters: (chars.results as any[]).map((r) => ({ nameKey: r.name_key, displayName: r.display_name,
      mainKey: r.main_key ?? null, status: r.status as Status })),
    nights: (nights.results as any[]).map((r) => ({ id: r.id, nightDate: r.night_date, counts: !!r.counts })),
    killPresence: (kills.results as any[]).map((r) => ({ nightId: r.night_id, nameKey: r.name_key })),
    overrides: (overrides.results as any[]).map((r) => ({ nightId: r.night_id, nameKey: r.name_key, present: !!r.present, benched: !!r.benched })),
  };
}

export const slugify = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export async function listInstances(db: D1Database): Promise<{ name: string; slug: string }[]> {
  const res = await db.prepare('SELECT DISTINCT instance FROM award WHERE deleted = 0 ORDER BY instance').all<{ instance: string }>();
  return res.results.map((r) => ({ name: r.instance, slug: slugify(r.instance) }));
}

export type LogRow = { nightId: number; nightDate: string; counts: boolean; itemId: number; itemName: string;
  playerDisplay: string; altName: string | null; response: Response };

export async function loadRaidLog(db: D1Database, slug: string): Promise<{ instance: string; rows: LogRow[] } | null> {
  const instance = (await listInstances(db)).find((i) => i.slug === slug);
  if (!instance) return null;
  const res = await db.prepare(
    `SELECT a.night_id, n.night_date, n.counts, a.item_id, i.name AS item_name, a.response,
            c.display_name AS char_display, c.name_key AS char_key,
            m.display_name AS main_display, m.name_key AS main_key
     FROM award a
     JOIN raid_night n ON n.id = a.night_id
     JOIN item i ON i.item_id = a.item_id
     LEFT JOIN character c ON c.name_key = a.name_key
     LEFT JOIN character m ON m.name_key = COALESCE(c.main_key, c.name_key)
     WHERE a.deleted = 0 AND a.instance = ?
     ORDER BY n.night_date DESC, a.t ASC, a.darklight_id ASC`).bind(instance.name).all<any>();
  const rows: LogRow[] = res.results.map((r) => {
    const player = r.main_display ?? r.char_display ?? '';
    const alt = r.char_display && r.main_key && r.char_key !== r.main_key ? r.char_display : null;
    return { nightId: r.night_id, nightDate: r.night_date, counts: !!r.counts, itemId: r.item_id, itemName: r.item_name,
      playerDisplay: player, altName: alt, response: r.response as Response };
  });
  return { instance: instance.name, rows };
}

export async function lastImportAt(db: D1Database): Promise<number | null> {
  const r = await db.prepare('SELECT MAX(at) AS at FROM import_log').first<{ at: number | null }>();
  return r?.at ?? null;
}

export type EpgpStanding = { ep: number; gp: number; class: string | null };

/** The latest EPGP Forever standings snapshot, keyed by character name key. */
export async function loadEpgp(db: D1Database): Promise<{ rows: Map<string, EpgpStanding>; importedAt: number | null }> {
  const [rows, meta] = await db.batch([
    db.prepare('SELECT name_key, class, ep, gp FROM epgp_standing ORDER BY name_key'),
    db.prepare('SELECT imported_at FROM epgp_meta WHERE id = 1'),
  ]);
  return {
    rows: new Map((rows.results as any[]).map((r) => [r.name_key as string, { ep: r.ep, gp: r.gp, class: r.class ?? null }])),
    importedAt: (meta.results as any[])[0]?.imported_at ?? null,
  };
}
