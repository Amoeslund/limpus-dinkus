import { displayName, nameKey } from './names';
import type { Parsed } from './darklight';

export type KillInput = { t: number; zone: string; boss: string;
  members: { nameKey: string; displayName: string }[] };

export function parseLimpus(text: string): Parsed<KillInput[]> {
  if (text.trim() === '') return { ok: true, value: [], warnings: [] };

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This is not valid JSON. Paste the full LimpusAttendance export.' };
  }
  if (!data || typeof data !== 'object' || data.addon !== 'LimpusAttendance') {
    return { ok: false, error: 'This is not a LimpusAttendance export.' };
  }
  if (data.version !== 1) {
    return { ok: false, error: `Unsupported LimpusAttendance export version "${data.version}".` };
  }
  if (!Array.isArray(data.kills)) {
    return { ok: false, error: 'The LimpusAttendance export has no kills list.' };
  }

  const value: KillInput[] = [];
  const warnings: string[] = [];
  data.kills.forEach((kill: any, i: number) => {
    const t = kill?.t;
    if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0 || !Array.isArray(kill?.raid)) {
      warnings.push(`Skipped kill ${i + 1}: missing time or raid list.`);
      return;
    }
    const seen = new Set<string>();
    const members: KillInput['members'] = [];
    for (const raw of kill.raid) {
      if (typeof raw !== 'string' || !displayName(raw)) continue;
      const key = nameKey(raw);
      if (seen.has(key)) continue;
      seen.add(key);
      members.push({ nameKey: key, displayName: displayName(raw) });
    }
    value.push({
      t,
      zone: typeof kill.zone === 'string' ? kill.zone : '',
      boss: typeof kill.boss === 'string' ? kill.boss : '',
      members,
    });
  });
  return { ok: true, value, warnings };
}
