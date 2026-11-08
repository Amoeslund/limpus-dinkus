import type { Parsed } from './darklight';
import { displayName, nameKey } from './names';

/** One row of the EPGP Forever standings export. */
export type EpgpRow = { nameKey: string; displayName: string; class: string | null; ep: number; gp: number };

const NUMBER = /^\d+(\.\d+)?$/;

/** Splits one CSV line on commas. Fields may be wrapped in double quotes ("" is a literal quote). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && cur.trim() === '') { cur = ''; quoted = true; }
    else if (ch === ',') { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/**
 * Parses the EPGP Forever standings CSV: `Name,Class,EP,GP` or `Name,EP,GP`, optional header row.
 * Empty text is an empty result; text without a single valid row is an error.
 */
export function parseEpgpCsv(text: string): Parsed<EpgpRow[]> {
  if (text.trim() === '') return { ok: true, value: [], warnings: [] };
  const lines = text.split(/\r?\n/).map((l, i) => ({ n: i + 1, fields: splitCsvLine(l), blank: l.trim() === '' }))
    .filter((l) => !l.blank);

  const numbers = (f: string[]) => {
    const [ep, gp] = f.length === 4 ? [f[2], f[3]] : [f[1], f[2]];
    return { ep, gp, ok: (f.length === 3 || f.length === 4) && NUMBER.test(ep ?? '') && NUMBER.test(gp ?? '') };
  };
  // The first line is a header when it doesn't parse as data.
  if (lines.length > 0 && !numbers(lines[0].fields).ok) lines.shift();

  const rows = new Map<string, EpgpRow>();
  const warnings: string[] = [];
  for (const { n, fields } of lines) {
    if (fields.length !== 3 && fields.length !== 4) {
      warnings.push(`Skipped line ${n}: expected Name,EP,GP or Name,Class,EP,GP.`);
      continue;
    }
    const key = nameKey(fields[0]);
    if (!key) {
      warnings.push(`Skipped line ${n}: no name.`);
      continue;
    }
    const num = numbers(fields);
    if (!num.ok) {
      warnings.push(`Skipped ${displayName(fields[0])} (line ${n}): EP and GP must be numbers of 0 or more.`);
      continue;
    }
    if (rows.has(key)) {
      warnings.push(`${displayName(fields[0])} is listed twice; the last row (line ${n}) is used.`);
      rows.delete(key);
    }
    rows.set(key, {
      nameKey: key,
      displayName: displayName(fields[0]),
      class: fields.length === 4 && fields[1] ? fields[1] : null,
      ep: Number(num.ep),
      gp: Number(num.gp),
    });
  }
  if (rows.size === 0) {
    return { ok: false, error: 'No standings rows found. Paste the EPGP Forever standings CSV (Name,Class,EP,GP).' };
  }
  return { ok: true, value: [...rows.values()], warnings };
}

/** Priority = EP / GP; null when GP is 0 or less. */
export function pr(ep: number, gp: number): number | null {
  return gp > 0 ? ep / gp : null;
}

/** EP or GP for display: whole numbers as is, otherwise one decimal. */
export function formatEpgp(n: number | null): string {
  if (n === null) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** PR for display with two decimals. */
export function formatPr(p: number | null): string {
  return p === null ? '—' : p.toFixed(2);
}
