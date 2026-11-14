import { ARMORY, EFFORT_GEAR_LEVEL } from '../config';
import type { ParseResult } from './roster';

export type GearItem = { slot: string; itemId: number; name: string; ilvl: number | null; quality: string | null; source: number | null };
export type CharacterProfile = { ilvl: number | null; armoryUpdated: number | null; gear: GearItem[] };

/** Item context on the armory: where the item came from. */
export type SourceKind = 'dungeon' | 'raid' | 'other';
export function sourceKind(source: number | null): SourceKind {
  if (source === 1 || source === 2) return 'dungeon';
  if (source !== null && source >= 3 && source <= 6) return 'raid';
  return 'other';
}

const MARK = 'var characterProfileInitialState = ';

/**
 * The armory character page embeds its data as a script variable. Forever has no public profile API,
 * so this reads that variable from the page HTML.
 */
export function parseCharacterPage(html: string): ParseResult<CharacterProfile> {
  const i = html.indexOf(MARK);
  if (i < 0) return { ok: false, error: 'Character page has no profile data' };
  const start = i + MARK.length;
  const end = html.indexOf(';\n</script>', start);
  if (end < 0) return { ok: false, error: 'Character page profile data is cut off' };
  let state: any;
  try { state = JSON.parse(html.slice(start, end)); } catch { return { ok: false, error: 'Character page profile data is not valid JSON' }; }
  const c = state?.character;
  if (!c) return { ok: false, error: 'Character page has no character' };
  const gear: GearItem[] = [];
  for (const [key, v] of Object.entries<any>(c.gear ?? {})) {
    if (!v || !Number.isInteger(v.id) || typeof v.name !== 'string') continue;
    // Shirt and tabard carry no stats; leave them out of gear progress.
    const slot = String(v.slot?.type ?? key).toUpperCase();
    if (slot === 'SHIRT' || slot === 'TABARD') continue;
    gear.push({
      slot, itemId: v.id, name: v.name,
      ilvl: Number.isFinite(v.level?.value) ? v.level.value : null,
      quality: typeof v.quality?.type === 'string' ? v.quality.type : null,
      source: Number.isInteger(v.context) ? v.context : null,
    });
  }
  const upd = c.lastUpdatedTimestamp?.epoch;
  return {
    ok: true,
    value: {
      ilvl: Number.isFinite(c.averageItemLevel) ? c.averageItemLevel : null,
      armoryUpdated: Number.isFinite(upd) ? Math.floor(upd / 1000) : null,
      gear,
    },
  };
}

export const characterUrl = (slug: string) => `${ARMORY.characterBase}${encodeURIComponent(slug)}`;

export async function fetchCharacter(slug: string, fetchFn: typeof fetch = fetch): Promise<ParseResult<CharacterProfile>> {
  let res: Response;
  try {
    res = await fetchFn(characterUrl(slug), { headers: { 'user-agent': 'Mozilla/5.0 (limpus-dinkus roster)' } });
  } catch (e) {
    return { ok: false, error: 'Armory request failed: ' + String(e) };
  }
  // The armory answers 500 for characters it does not know.
  if (!res.ok) return { ok: false, error: `Armory HTTP ${res.status}` };
  return parseCharacterPage(await res.text());
}

/** Inputs for one member's outside-raid effort over the last 7 days. null = no data from that source. */
export type EffortInput = {
  /** levelPartial: less than 7 days of level history, so the gain is not known yet. */
  level: number; maxLevel: number; levelGain: number; levelPartial?: boolean;
  seen7d: number | null; dungeon7d: number | null; raid7d: number | null;   // seconds, from Guild Pulse
  newDungeonItems: number | null; newOtherItems: number | null; ilvlGain: number | null; // from armory gear
};
export type Effort = { score: number | null; parts: { label: string; points: number; max: number }[]; raidLogger: boolean };

/**
 * Outside-raid effort, 0-100. Parts without data are left out and the rest is scaled up, so a member
 * without Guild Pulse coverage is scored on gear (and levels) alone.
 *   Dungeons: 4 h in dungeons = 40 points.
 *   Gear: new non-raid items (dungeon item 5, other 2) and item level gain (3 per level), max 25.
 *   Online outside raids: 10 h = 20 points.
 *   Levels (below max level only): 5 per level, max 15.
 * Below EFFORT_GEAR_LEVEL only levelling counts: the score is the Levels part alone (3 levels in 7 days = 100).
 */
export function effortScore(e: EffortInput): Effort {
  const parts: Effort['parts'] = [];
  const levels = { label: 'Levels', points: Math.min(15, Math.max(0, e.levelGain) * 5), max: 15 };
  if (e.level < EFFORT_GEAR_LEVEL) {
    return { score: e.levelPartial ? null : Math.round((100 * levels.points) / levels.max), parts: [levels], raidLogger: false };
  }
  if (e.dungeon7d !== null) parts.push({ label: 'Dungeons', points: Math.min(40, e.dungeon7d / 60 / 6), max: 40 });
  if (e.newDungeonItems !== null) {
    const pts = (e.newDungeonItems ?? 0) * 5 + (e.newOtherItems ?? 0) * 2 + Math.max(0, e.ilvlGain ?? 0) * 3;
    parts.push({ label: 'Gear', points: Math.min(25, pts), max: 25 });
  }
  const outside = e.seen7d === null ? null : Math.max(0, e.seen7d - (e.raid7d ?? 0));
  if (outside !== null) parts.push({ label: 'Online outside raids', points: Math.min(20, outside / 60 / 30), max: 20 });
  if (e.level < e.maxLevel && !e.levelPartial) parts.push(levels);
  const max = parts.reduce((a, p) => a + p.max, 0);
  const got = parts.reduce((a, p) => a + p.points, 0);
  const hasData = e.seen7d !== null || e.newDungeonItems !== null;
  const raidLogger = (e.raid7d ?? 0) >= 3600 && (outside ?? 0) < 3600 && (e.dungeon7d ?? 0) < 1800 && !(e.newDungeonItems || e.newOtherItems);
  return { score: hasData && max > 0 ? Math.round((100 * got) / max) : null, parts, raidLogger };
}
