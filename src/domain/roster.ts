import { ARMORY } from '../config';
import { displayName, nameKey } from './names';

export type ArmoryMember = { nameKey: string; display: string; cls: string | null; level: number; rankId: number | null; slug: string };
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Forever characters have a first name and a surname; the game shows both ("Prim Ordial"). */
export function parseArmoryRoster(json: unknown): ParseResult<ArmoryMember[]> {
  const d = json as any;
  if (d?.errors?.length) return { ok: false, error: 'Armory error: ' + d.errors.map((e: any) => e?.message).join(', ') };
  const roster = d?.data?.Guild?.roster;
  if (!Array.isArray(roster)) return { ok: false, error: 'Armory returned no guild roster' };
  const out: ArmoryMember[] = [];
  for (const e of roster) {
    const c = e?.character;
    if (!c || typeof c.name !== 'string' || !c.name) continue;
    const full = c.surname ? `${c.name} ${c.surname}` : c.name;
    // _id is "eu-<name>-<surname>", the armory character page slug with the region in front.
    const slug = typeof c._id === 'string' && c._id.startsWith(ARMORY.region + '-')
      ? c._id.slice(ARMORY.region.length + 1) : full.toLowerCase().replace(/\s+/g, '-');
    out.push({
      nameKey: nameKey(full), display: displayName(full), cls: c.class?.name ?? null,
      level: Number.isFinite(c.level) ? c.level : 0, rankId: Number.isInteger(e.rank?.rankId) ? e.rank.rankId : null, slug,
    });
  }
  if (out.length === 0) return { ok: false, error: 'Armory roster was empty' };
  return { ok: true, value: out };
}

export async function fetchArmoryRoster(fetchFn: typeof fetch = fetch): Promise<ParseResult<ArmoryMember[]>> {
  const body = {
    operationName: 'GetGuildRoster',
    variables: { guild: { nameSlug: ARMORY.nameSlug, region: ARMORY.region }, showMessageOfTheDay: false, showRoles: false },
    extensions: { persistedQuery: { version: 1, sha256Hash: ARMORY.rosterHash } },
  };
  let res: Response;
  try {
    res = await fetchFn(ARMORY.url, {
      method: 'POST',
      // The armory resolves the Forever variant from the page that asks, so the Referer is required.
      headers: { 'content-type': 'application/json', referer: ARMORY.referer, 'user-agent': 'Mozilla/5.0 (limpus-dinkus roster)' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, error: 'Armory request failed: ' + String(e) };
  }
  if (!res.ok) return { ok: false, error: `Armory HTTP ${res.status}` };
  try {
    return parseArmoryRoster(await res.json());
  } catch {
    return { ok: false, error: 'Armory returned invalid JSON' };
  }
}

export type PulseMember = { nameKey: string; display: string; level: number; rankIndex: number | null; rank: string | null;
  lastOnline: number | null; seen7d: number; avgDay: number; share: number; dungeon7d: number | null; raid7d: number | null };
export type PulseReport = { at: number; members: PulseMember[]; ranks: { id: number; name: string }[] };

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** The JSON from Guild Pulse's "Export for site" button. */
export function parseGuildPulse(text: string, now: number): ParseResult<PulseReport> {
  let d: any;
  try { d = JSON.parse(text); } catch { return { ok: false, error: 'Guild Pulse export is not valid JSON' }; }
  if (d?.addon !== 'GuildPulse' || !Array.isArray(d.members)) return { ok: false, error: 'This is not a Guild Pulse export' };
  const at = num(d.at, now);
  if (at > now + 3600) return { ok: false, error: 'Guild Pulse export is dated in the future' };
  const members: PulseMember[] = [];
  for (const m of d.members) {
    if (typeof m?.name !== 'string' || !m.name.trim()) continue;
    members.push({
      nameKey: nameKey(m.name), display: displayName(m.name), level: num(m.level),
      rankIndex: Number.isInteger(m.rankIndex) ? m.rankIndex : null, rank: typeof m.rank === 'string' ? m.rank : null,
      lastOnline: typeof m.lastOnline === 'number' ? Math.min(m.lastOnline, at) : null,
      seen7d: Math.max(0, num(m.seen7d)), avgDay: Math.max(0, num(m.avgDay)), share: Math.min(1, Math.max(0, num(m.share))),
      // Guild Pulse 1.3+; older versions leave these out (null = unknown, not zero).
      dungeon7d: typeof m.dungeon7d === 'number' ? Math.max(0, m.dungeon7d) : null,
      raid7d: typeof m.raid7d === 'number' ? Math.max(0, m.raid7d) : null,
    });
  }
  const ranks = new Map<number, string>();
  for (const m of members) if (m.rankIndex !== null && m.rank) ranks.set(m.rankIndex, m.rank);
  return { ok: true, value: { at, members, ranks: [...ranks].map(([id, name]) => ({ id, name })) } };
}

/** Levels gained over the last `windowSec`, from a member's level history (sorted by time). */
export function levelGain(history: { at: number; level: number }[], current: number, now: number, windowSec = 7 * 86400) {
  if (history.length === 0) return { gain: 0, partial: true };
  const cutoff = now - windowSec;
  let base: number | null = null;
  for (const h of history) { if (h.at <= cutoff) base = h.level; else break; }
  if (base === null) return { gain: current - history[0].level, partial: true };
  return { gain: current - base, partial: false };
}
