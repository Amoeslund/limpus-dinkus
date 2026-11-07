import { displayName, nameKey } from './names';

export type Response = 'BiS' | 'Upgrade' | 'Offspec';
export type AwardInput = { darklightId: string; t: number; nameKey: string; displayName: string;
  itemId: number; itemName: string; response: Response };
export type Parsed<T> = { ok: true; value: T; warnings: string[] } | { ok: false; error: string };

const RESPONSES: readonly string[] = ['BiS', 'Upgrade', 'Offspec'];

export function parseDarklight(text: string): Parsed<AwardInput[]> {
  if (text.trim() === '') return { ok: true, value: [], warnings: [] };

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This is not valid JSON. Paste the full Darklight Web (JSON) export.' };
  }
  if (!data || typeof data !== 'object' || data.addon !== 'DarklightLC') {
    return { ok: false, error: 'This is not a Darklight LootCouncil export.' };
  }
  if (data.test === true) {
    return { ok: false, error: 'This is a Darklight test-mode export. Turn off test mode and export again.' };
  }
  if (!Array.isArray(data.records)) {
    return { ok: false, error: 'The Darklight export has no records list.' };
  }

  const value: AwardInput[] = [];
  const warnings: string[] = [];
  data.records.forEach((rec: any, i: number) => {
    const player = typeof rec?.player === 'string' ? rec.player : '';
    const itemId = rec?.itemId;
    const t = rec?.timestamp;
    if (!displayName(player) || !Number.isInteger(itemId) || itemId <= 0 || typeof t !== 'number' || !Number.isFinite(t) || t <= 0) {
      warnings.push(`Skipped record ${i + 1}: missing player, item or timestamp.`);
      return;
    }
    let response: Response;
    if (RESPONSES.includes(rec.response)) {
      response = rec.response;
    } else {
      response = 'Upgrade';
      warnings.push(`Unknown response "${rec.response}" for ${displayName(player)} (record ${i + 1}); treated as Upgrade.`);
    }
    value.push({
      darklightId: typeof rec.id === 'string' && rec.id ? rec.id : `${t}_${displayName(player)}_${itemId}_${rec.distributionId ?? ''}`,
      t,
      nameKey: nameKey(player),
      displayName: displayName(player),
      itemId,
      itemName: typeof rec.itemName === 'string' ? rec.itemName : '',
      response,
    });
  });
  return { ok: true, value, warnings };
}
