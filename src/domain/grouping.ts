import type { AwardInput } from './darklight';
import type { KillInput } from './limpus';
import { nightDateFor } from './nights';

export type NightDraft = { nightDate: string; kills: KillInput[];
  awards: (AwardInput & { instance: string | null })[] };

/** Zone of the latest kill at or before `t`, else the earliest kill's zone. Only looks at the kills passed in. */
export function assignInstance(t: number, kills: KillInput[]): string | null {
  if (kills.length === 0) return null;
  const sorted = [...kills].sort((a, b) => a.t - b.t);
  let pick = sorted[0];
  for (const kill of sorted) {
    if (kill.t <= t) pick = kill;
    else break;
  }
  return pick.zone;
}

export function groupIntoNights(kills: KillInput[], awards: AwardInput[]): NightDraft[] {
  const nights = new Map<string, NightDraft>();
  const night = (date: string) => {
    let n = nights.get(date);
    if (!n) nights.set(date, (n = { nightDate: date, kills: [], awards: [] }));
    return n;
  };
  for (const kill of kills) night(nightDateFor(kill.t)).kills.push(kill);
  for (const a of awards) night(nightDateFor(a.t)).awards.push({ ...a, instance: null });
  for (const n of nights.values()) {
    n.kills.sort((a, b) => a.t - b.t);
    for (const a of n.awards) a.instance = assignInstance(a.t, n.kills);
  }
  return [...nights.values()].sort((a, b) => a.nightDate.localeCompare(b.nightDate));
}
