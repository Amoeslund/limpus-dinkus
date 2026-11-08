import { displayPr } from './epgp';

export type Status = 'member' | 'guest' | 'left';
export type StandingsInput = {
  characters: { nameKey: string; displayName: string; mainKey: string | null; status: Status }[];
  nights: { id: number; nightDate: string; counts: boolean }[];
  killPresence: { nightId: number; nameKey: string }[];
  overrides: { nightId: number; nameKey: string; present: boolean; benched: boolean }[];
};
/** EPGP Forever standings by character name key. */
export type EpgpByName = ReadonlyMap<string, { ep: number; gp: number }>;
export type Cell = 'main' | 'alt' | 'bench' | 'absent';

/**
 * Who was at one night: kill presence plus overrides. A benched override counts as attendance,
 * but a player who is otherwise present is present, not benched.
 */
export function resolveNight(killKeys: Iterable<string>, overrides: { nameKey: string; present: boolean; benched: boolean }[]):
  { present: Set<string>; benched: Set<string> } {
  const present = new Set(killKeys);
  for (const o of overrides) if (o.present && !o.benched) present.add(o.nameKey);
  for (const o of overrides) if (!o.present) present.delete(o.nameKey);
  const benched = new Set<string>();
  for (const o of overrides) if (o.present && o.benched && !present.has(o.nameKey)) benched.add(o.nameKey);
  return { present, benched };
}
export type Standing = { mainKey: string; displayName: string; alts: string[];
  raids: number; attendancePct: number; cells: Record<number, Cell>;
  /** From the EPGP Forever snapshot; null when the main has no standings row. PR is 0 below min EP. */
  ep: number | null; gp: number | null; pr: number | null; belowMinEp: boolean };

export function computeStandings(input: StandingsInput, epgp: EpgpByName = new Map()): Standing[] {
  const mainOf = (key: string) => input.characters.find(c => c.nameKey === key)?.mainKey ?? key;
  const nights = input.nights.filter(n => n.counts).sort((a, b) => a.nightDate.localeCompare(b.nightDate));

  // Effective presence per counting night, resolved to main keys.
  type Seen = { main: boolean; alt: boolean; bench: boolean };
  const presence = new Map<number, Map<string, Seen>>();
  for (const n of nights) {
    const { present, benched } = resolveNight(
      input.killPresence.filter(p => p.nightId === n.id).map(p => p.nameKey),
      input.overrides.filter(o => o.nightId === n.id));
    const byMain = new Map<string, Seen>();
    const entry = (key: string) => {
      const m = mainOf(key);
      const e = byMain.get(m) ?? { main: false, alt: false, bench: false };
      byMain.set(m, e);
      return { e, isMain: key === m };
    };
    for (const key of present) { const { e, isMain } = entry(key); if (isMain) e.main = true; else e.alt = true; }
    for (const key of benched) entry(key).e.bench = true;
    presence.set(n.id, byMain);
  }

  const result: Standing[] = [];
  for (const main of input.characters) {
    if (main.mainKey !== null || main.status !== 'member') continue;
    const alts = input.characters.filter(c => c.mainKey === main.nameKey).map(c => c.displayName);
    const cells: Record<number, Cell> = {};
    let raids = 0;
    let sinceFirst = 0;
    for (const n of nights) {
      const p = presence.get(n.id)!.get(main.nameKey);
      cells[n.id] = !p ? 'absent' : p.main ? 'main' : p.alt ? 'alt' : 'bench';
      if (p) raids++;
      if (raids > 0) sinceFirst++;
    }
    const e = epgp.get(main.nameKey);
    result.push({
      mainKey: main.nameKey,
      displayName: main.displayName,
      alts,
      raids,
      attendancePct: raids === 0 ? 0 : Math.round((100 * raids) / sinceFirst),
      cells,
      ep: e ? e.ep : null,
      gp: e ? e.gp : null,
      ...(e ? displayPr(e.ep, e.gp) : { pr: null, belowMinEp: false }),
    });
  }
  return result.sort((a, b) =>
    b.attendancePct - a.attendancePct || b.raids - a.raids || a.displayName.localeCompare(b.displayName));
}
