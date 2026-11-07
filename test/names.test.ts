import { it, expect } from 'vitest';
import { nameKey, displayName } from '../src/domain/names';

it('nameKey normalises realm suffix and case', () => {
  expect(nameKey('Mankee')).toBe('mankee');
  expect(nameKey('mankee-Forever')).toBe('mankee');
  expect(nameKey('  Mankee ')).toBe('mankee');
  expect(displayName('Mankee-Forever')).toBe('Mankee');
});

it('collapses internal whitespace and keeps case in displayName', () => {
  expect(nameKey('Man   kee')).toBe('man kee');
  expect(displayName('  Man   Kee - Forever')).toBe('Man Kee');
});
