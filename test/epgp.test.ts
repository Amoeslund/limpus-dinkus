import { describe, expect, it } from 'vitest';
import { EPGP_BASE_GP, EPGP_MIN_EP } from '../src/config';
import { displayPr, formatEpgp, formatPr, parseEpgpCsv, pr } from '../src/domain/epgp';
import fixture from './fixtures/epgp-standings.csv?raw';

describe('parseEpgpCsv', () => {
  it('parses the fixture: header, quoted fields, realm suffix, whitespace', () => {
    const r = parseEpgpCsv(fixture);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toEqual([]);
    expect(r.value).toEqual([
      { nameKey: 'mankee', displayName: 'Mankee', class: 'Warrior', ep: 1250, gp: 400 },
      { nameKey: 'zefal', displayName: 'Zefal', class: 'Warlock', ep: 980.5, gp: 350 },
      { nameKey: 'hexa', displayName: 'Hexa', class: 'Priest', ep: 600, gp: 0 },
      { nameKey: 'ildkule', displayName: 'Ildkule', class: 'Mage', ep: 300, gp: 120.25 },
    ]);
  });

  it('accepts 3 columns, no header, CRLF and blank lines', () => {
    const r = parseEpgpCsv('Mankee,10,5\r\n\r\nHexa,2.5,1\r\n');
    expect(r.ok && r.value).toEqual([
      { nameKey: 'mankee', displayName: 'Mankee', class: null, ep: 10, gp: 5 },
      { nameKey: 'hexa', displayName: 'Hexa', class: null, ep: 2.5, gp: 1 },
    ]);
  });

  it('skips a case-insensitive 3-column header', () => {
    const r = parseEpgpCsv('name,ep,gp\nMankee,10,5');
    expect(r.ok && r.value.map((x) => x.nameKey)).toEqual(['mankee']);
    expect(r.ok && r.warnings).toEqual([]);
  });

  it('handles quoted commas and escaped quotes', () => {
    const r = parseEpgpCsv('"Man,kee","War ""x""","10","5"');
    expect(r.ok && r.value[0]).toMatchObject({ displayName: 'Man,kee', class: 'War "x"', ep: 10, gp: 5 });
  });

  it('skips rows with a non-numeric or negative EP/GP and warns', () => {
    const r = parseEpgpCsv('Name,Class,EP,GP\nMankee,Warrior,abc,5\nHexa,Priest,-3,1\nZefal,Warlock,10,5');
    expect(r.ok && r.value.map((x) => x.nameKey)).toEqual(['zefal']);
    expect(r.ok && r.warnings).toHaveLength(2);
    expect(r.ok && r.warnings[0]).toContain('Mankee');
  });

  it('skips rows with the wrong column count or no name and warns', () => {
    const r = parseEpgpCsv('Name,EP,GP\nMankee,10\n,10,5\nHexa,1,2,3,4\nZefal,10,5');
    expect(r.ok && r.value.map((x) => x.nameKey)).toEqual(['zefal']);
    expect(r.ok && r.warnings).toHaveLength(3);
  });

  it('last duplicate wins with a warning', () => {
    const r = parseEpgpCsv('Mankee,10,5\nmankee-Forever,20,6');
    expect(r.ok && r.value).toEqual([{ nameKey: 'mankee', displayName: 'mankee', class: null, ep: 20, gp: 6 }]);
    expect(r.ok && r.warnings).toHaveLength(1);
    expect(r.ok && r.warnings[0]).toMatch(/twice|duplicate/i);
  });

  it('empty text is an empty result; text with no valid rows is an error', () => {
    expect(parseEpgpCsv('  \n')).toEqual({ ok: true, value: [], warnings: [] });
    expect(parseEpgpCsv('Name,Class,EP,GP\n').ok).toBe(false);
    expect(parseEpgpCsv('hello world').ok).toBe(false);
  });
});

describe('pr and formatting', () => {
  it('uses the guild settings: base GP 100, min EP 1000', () => {
    expect(EPGP_BASE_GP).toBe(100);
    expect(EPGP_MIN_EP).toBe(1000);
  });
  it('pr is EP / (GP + base GP), like EPGP Forever', () => {
    expect(pr(1000, 400)).toBe(2);
    expect(pr(500, 0)).toBe(5); // GP 0 -> EP / 100
    expect(pr(10, -100)).toBeNull();
  });
  it('displayPr is 0 below min EP and flags it', () => {
    expect(displayPr(999, 0)).toEqual({ pr: 0, belowMinEp: true });
    expect(displayPr(1000, 0)).toEqual({ pr: 10, belowMinEp: false });
    expect(displayPr(1500, 200)).toEqual({ pr: 5, belowMinEp: false });
  });
  it('formatEpgp shows whole numbers plain, else one decimal', () => {
    expect(formatEpgp(1250)).toBe('1250');
    expect(formatEpgp(980.46)).toBe('980.5');
    expect(formatEpgp(null)).toBe('—');
  });
  it('formatPr shows two decimals', () => {
    expect(formatPr(2.5)).toBe('2.50');
    expect(formatPr(1 / 3)).toBe('0.33');
    expect(formatPr(null)).toBe('—');
  });
});
