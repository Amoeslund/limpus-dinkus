import { pr } from './epgp';

export type Status = 'member' | 'guest' | 'left';
export type StandingsInput = {
  characters: { nameKey: string; displayName: string; mainKey: string | null; status: Status }[];
  nights: { id: number; nightDate: string; counts: boolean }[];
  killPresence: { nightId: number; nameKey: string }[];
  overrides: { nightId: number; nameKey: string; present: boolean }[];
};
/** EPGP Forever standings by character name key. */
export type EpgpByName = ReadonlyMap<string, { ep: number; gp: number }>;
export type Cell = 'main' | 'alt' | 'absent';
export type Standing = { mainKey: string; displayName: string; alts: string[];
  raids: number; attendancePct: number; cells: Record<number, Cell>;
  /** From the EPGP Forever snapshot; null when the main has no standings row. PR is also null when GP <= 0. */
  ep: number | null; gp: number | null; pr: number | null };

export function computeStandings(input: StandingsInput, epgp: EpgpByName = new Map()): Standing[] {
  const mainOf = (key: string) => input.characters.find(c => c.nameKey === key)?.mainKey ?? key;
  const nights = input.nights.filter(n => n.counts).sort((a, b) => a.nightDate.localeCompare(b.nightDate));

  // Effective presence per counting night, resolved to main keys.
  const presence = new Map<number, Map<string, { main: boolean; alt: boolean }>>();
  for (const n of nights) {
    const present = new Set<string>();
    for (const p of input.killPresence) if (p.nightId === n.id) present.add(p.nameKey);
    for (const o of input.overrides) if (o.nightId === n.id && o.present) present.add(o.nameKey);
    for (const o of input.overrides) if (o.nightId === n.id && !o.present) present.delete(o.nameKey);
    const byMain = new Map<string, { main: boolean; alt: boolean }>();
    for (const key of present) {
      const m = mainOf(key);
      const e = byMain.get(m) ?? { main: false, alt: false };
      if (key === m) e.main = true; else e.alt = true;
      byMain.set(m, e);
    }
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
      cells[n.id] = p ? (p.main ? 'main' : 'alt') : 'absent';
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
      pr: e ? pr(e.ep, e.gp) : null,
    });
  }
  return result.sort((a, b) =>
    b.attendancePct - a.attendancePct || b.raids - a.raids || a.displayName.localeCompare(b.displayName));
}
