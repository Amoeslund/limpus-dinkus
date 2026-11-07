import { it, expect } from 'vitest';
import { parseDarklight } from '../src/domain/darklight';
import fixtureObj from './fixtures/darklight.json';

const fixture = JSON.stringify(fixtureObj);
const withRecords = (records: unknown[]) => JSON.stringify({ ...fixtureObj, records });

it('parses records', () => {
  const r = parseDarklight(fixture);
  expect(r.ok && r.value).toHaveLength(3);
  expect(r.ok && r.value[0]).toMatchObject({ darklightId: '1762295000_Mankee_18820_s12', t: 1762295000,
    nameKey: 'mankee', displayName: 'Mankee', itemId: 18820, itemName: 'Talisman of Ephemeral Power', response: 'BiS' });
  expect(r.ok && r.warnings).toEqual([]);
});
it('strips realm suffix', () => {
  const r = parseDarklight(fixture);
  expect(r.ok && r.value[1]).toMatchObject({ nameKey: 'zefal', displayName: 'Zefal', response: 'Upgrade' });
  expect(r.ok && r.value[2].response).toBe('Offspec');
});
it('rejects test-mode exports', () => {
  const r = parseDarklight(JSON.stringify({ ...fixtureObj, test: true }));
  expect(r).toEqual({ ok: false, error: 'This is a Darklight test-mode export. Turn off test mode and export again.' });
});
it('unknown response becomes Upgrade with a warning', () => {
  const r = parseDarklight(withRecords([{ ...fixtureObj.records[0], response: 'Major Upgrade' }]));
  expect(r.ok && r.value[0].response).toBe('Upgrade');
  expect(r.ok && r.warnings[0]).toContain('Major Upgrade');
});
it('rejects non-JSON and wrong addon', () => {
  expect(parseDarklight('hello').ok).toBe(false);
  expect(parseDarklight('{"addon":"Other","records":[]}').ok).toBe(false);
  expect(parseDarklight('{"addon":"DarklightLC"}').ok).toBe(false);
});
it('skips records without player or itemId, with a warning each', () => {
  const r = parseDarklight(withRecords([
    { ...fixtureObj.records[0], player: undefined },
    { ...fixtureObj.records[1], itemId: undefined },
    fixtureObj.records[2],
  ]));
  expect(r.ok && r.value).toHaveLength(1);
  expect(r.ok && r.warnings).toHaveLength(2);
});
it('empty input is an empty list', () => {
  expect(parseDarklight('  ')).toEqual({ ok: true, value: [], warnings: [] });
});
