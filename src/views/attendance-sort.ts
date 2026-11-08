/** Sort keys offered on the attendance table headers. */
export type SortKey = 'name' | 'pr' | 'ep' | 'gp' | 'raids' | 'pct';
export type SortRow = { name: string; pr: number | null; ep: number | null; gp: number | null; raids: number; pct: number };

/**
 * Orders attendance rows. Missing PR, EP or GP (no standings, or GP 0 for PR) always sorts last.
 * Runs on the server and in the browser via its source text, so it must stay self-contained.
 */
export function compareRows(a: SortRow, b: SortRow, key: SortKey, dir: 1 | -1): number {
  if (key !== 'name') {
    const va = a[key], vb = b[key];
    if ((va === null) !== (vb === null)) return va === null ? 1 : -1;
    if (va !== null && vb !== null && va !== vb) return va < vb ? -dir : dir;
  } else {
    const na = a.name.toLowerCase(), nb = b.name.toLowerCase();
    if (na !== nb) return na < nb ? -dir : dir;
  }
  return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
}

/** Default direction when a header is first clicked: names A to Z, numbers high to low. */
export const FIRST_DIR: Record<SortKey, 1 | -1> = { name: 1, pr: -1, ep: -1, gp: -1, raids: -1, pct: -1 };

/** The order the server renders: highest PR first. */
export const DEFAULT_SORT: { key: SortKey; dir: 1 | -1 } = { key: 'pr', dir: -1 };

/** localStorage key for the viewer's sort choice (renamed when the keys changed from score to EPGP). */
export const SORT_STORAGE_KEY = 'attSort2';

/** Browser script: wires header buttons, sorts rows, remembers the choice per viewer. */
export const SORT_SCRIPT = `(() => {
  const compareRows = ${compareRows.toString()};
  const FIRST = ${JSON.stringify(FIRST_DIR)};
  const DEFAULT = ${JSON.stringify(DEFAULT_SORT)};
  const STORE = ${JSON.stringify(SORT_STORAGE_KEY)};
  const table = document.querySelector('table[data-sortable]');
  if (!table) return;
  const body = table.tBodies[0] || table;
  const rows = () => [...table.querySelectorAll('tr[data-name]')];
  const num = (v) => (v === '' || v === undefined ? null : +v);
  const read = (tr) => ({ name: tr.dataset.name, pr: num(tr.dataset.pr), ep: num(tr.dataset.ep), gp: num(tr.dataset.gp),
    raids: +tr.dataset.raids, pct: +tr.dataset.pct });
  let state = null;
  const apply = (key, dir, save) => {
    rows().sort((a, b) => compareRows(read(a), read(b), key, dir)).forEach((tr) => body.appendChild(tr));
    table.querySelectorAll('button.sort').forEach((b) => {
      const on = b.dataset.key === key;
      b.classList.toggle('on', on);
      b.closest('th').setAttribute('aria-sort', on ? (dir === 1 ? 'ascending' : 'descending') : 'none');
      b.querySelector('.arrow').textContent = on ? (dir === 1 ? '▲' : '▼') : '';
    });
    state = { key, dir };
    if (save) { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) {} }
  };
  table.querySelectorAll('button.sort').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.key;
    apply(key, state && state.key === key ? -state.dir : FIRST[key], true);
  }));
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) {}
  if (saved && FIRST[saved.key]) apply(saved.key, saved.dir === -1 ? -1 : 1, false);
  else apply(DEFAULT.key, DEFAULT.dir, false);
})();`;
