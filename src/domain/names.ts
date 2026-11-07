function base(name: string): string {
  const i = name.indexOf('-');
  const b = i >= 0 ? name.slice(0, i) : name;
  return b.trim().replace(/\s+/g, ' ');
}

/** Strip the realm suffix, trim and collapse whitespace, keeping the original case. */
export function displayName(name: string): string {
  return base(name);
}

/** Normalised lookup key: realm stripped, whitespace collapsed, lowercase. */
export function nameKey(name: string): string {
  return base(name).toLowerCase();
}
