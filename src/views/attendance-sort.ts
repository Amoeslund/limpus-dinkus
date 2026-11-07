/** Sort keys offered on the attendance table headers. */
export type SortKey = 'name' | 'score' | 'raids' | 'pct';
export type SortRow = { name: string; score: number | null; raids: number; pct: number };

/**
 * Orders attendance rows. Missing scores (no raids yet) always sort last.
 * Runs on the server in tests and in the browser via its source text, so it must stay self-contained.
 */
export function compareRows(a: SortRow, b: SortRow, key: SortKey, dir: 1 | -1): number {
  if (key === 'score' && (a.score === null) !== (b.score === null)) return a.score === null ? 1 : -1;
  const va = key === 'name' ? a.name.toLowerCase() : (a[key] ?? 0);
  const vb = key === 'name' ? b.name.toLowerCase() : (b[key] ?? 0);
  if (va < vb) return -dir;
  if (va > vb) return dir;
  return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
}

/** Default direction when a header is first clicked: lowest score first (owed loot), most raids first. */
export const FIRST_DIR: Record<SortKey, 1 | -1> = { name: 1, score: 1, raids: -1, pct: -1 };

/** Browser script: wires header buttons, sorts rows, remembers the choice per viewer. */
export const SORT_SCRIPT = `(() => {
  const compareRows = ${compareRows.toString()};
  const FIRST = ${JSON.stringify(FIRST_DIR)};
  const table = document.querySelector('table[data-sortable]');
  if (!table) return;
  const body = table.tBodies[0] || table;
  const rows = () => [...table.querySelectorAll('tr[data-name]')];
  const read = (tr) => ({ name: tr.dataset.name, score: tr.dataset.score === '' ? null : +tr.dataset.score, raids: +tr.dataset.raids, pct: +tr.dataset.pct });
  let state = null;
  const apply = (key, dir) => {
    rows().sort((a, b) => compareRows(read(a), read(b), key, dir)).forEach((tr) => body.appendChild(tr));
    table.querySelectorAll('button.sort').forEach((b) => {
      const on = b.dataset.key === key;
      b.classList.toggle('on', on);
      b.closest('th').setAttribute('aria-sort', on ? (dir === 1 ? 'ascending' : 'descending') : 'none');
      b.querySelector('.arrow').textContent = on ? (dir === 1 ? '▲' : '▼') : '';
    });
    state = { key, dir };
    try { localStorage.setItem('attSort', JSON.stringify(state)); } catch (e) {}
  };
  table.querySelectorAll('button.sort').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.key;
    apply(key, state && state.key === key ? -state.dir : FIRST[key]);
  }));
  try { const s = JSON.parse(localStorage.getItem('attSort') || 'null'); if (s && FIRST[s.key]) apply(s.key, s.dir === -1 ? -1 : 1); } catch (e) {}
})();`;
