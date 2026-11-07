import type { ImportPreview, NightPreview } from '../db/importer';
import { TZ } from '../config';

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
export const formatDateTime = (unix: number): string => {
  const p = Object.fromEntries(fmt.formatToParts(new Date(unix * 1000)).map((x) => [x.type, x.value]));
  return `${p.day} ${p.month} ${p.year} ${p.hour}:${p.minute}`;
};

export const ADMIN_CSS = `
.subnav{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:16px}
.subnav a{color:var(--muted);padding:6px 12px;border-radius:6px;text-decoration:none;background:var(--panel)}
.subnav a.on,.subnav a:hover{background:var(--panel2);color:var(--text)}
textarea{width:100%;min-height:110px;background:#0e0c10;color:var(--text);border:1px solid var(--line);border-radius:6px;padding:8px;font:12px/1.4 Consolas,monospace}
.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:12px 0}
.btn{background:var(--gold);color:#1a1410;border:0;border-radius:6px;padding:8px 16px;font-weight:600;cursor:pointer;text-decoration:none}
.btn.ghost{background:var(--panel2);color:var(--text);border:1px solid var(--line)}
.preview{display:block;background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:12px;margin-top:12px}
.preview .night{padding:8px 0;border-bottom:1px solid var(--line)}
.banner{padding:10px 14px;border-radius:8px;margin-bottom:16px;border:1px solid}
.banner.ok{background:#14261a;border-color:var(--ok);color:var(--ok)}
.banner.warn{background:#2c2410;border-color:var(--gold);color:var(--gold2)}
.banner.err{background:#2c1414;border-color:var(--bad);color:var(--bad)}
select,input[type=text]{background:#0e0c10;color:var(--text);border:1px solid var(--line);border-radius:6px;padding:5px 8px;max-width:100%}
`;

const SUBNAV: [string, string][] = [
  ['Import', '/admin'], ['Nights', '/admin/nights'], ['Characters', '/admin/characters'],
  ['Items', '/admin/items'], ['Loot', '/admin/loot'], ['Admins', '/admin/admins'],
];

export const AdminNav = ({ active }: { active: string }) => (
  <div class="subnav">
    {SUBNAV.map(([label, href]) => <a href={href} class={label === active ? 'on' : ''}>{label}</a>)}
  </div>
);

export type PickState = { instance: Record<string, string>; other: Record<string, string>; countsOff: string[] };

const NightRow = ({ n, instances, st }: { n: NightPreview; instances: string[]; st: PickState }) => (
  <div class="night">
    <b>{n.label}</b>: {n.instances.length === 0 ? 'no kills in attendance export' : n.instances.map((i) => `${i.zone} (${i.bosses} ${i.bosses === 1 ? 'boss' : 'bosses'})`).join(', ')}
    <br />
    {n.players} players present · {n.newAwards} new items · {n.duplicateAwards} already imported, skipped
    {n.existing ? <span class="alt"> · night already exists</span> : null}
    <div class="row">
      {!n.existing ? (
        <label>
          <input type="checkbox" name={`counts[${n.nightDate}]`} checked={!st.countsOff.includes(n.nightDate)} /> Counts as guild raid
        </label>
      ) : null}
      {n.needsInstance ? (
        <span>
          <label>Instance for these items: </label>
          <select name={`instance[${n.nightDate}]`}>
            <option value="">Pick an instance…</option>
            {instances.map((i) => <option value={i} selected={st.instance[n.nightDate] === i}>{i}</option>)}
            <option value="__other" selected={st.instance[n.nightDate] === '__other'}>Other…</option>
          </select>{' '}
          <input type="text" name={`instanceOther[${n.nightDate}]`} placeholder="Other instance name" value={st.other[n.nightDate] ?? ''} />
        </span>
      ) : null}
    </div>
  </div>
);

export const ImportPage = (p: {
  lootText: string; attendanceText: string; lastImport: string | null; stale: boolean; staleDays: number;
  imported?: string; error?: string; preview?: ImportPreview & { ok: true }; instances: string[]; state: PickState;
}) => (
  <>
    <h1>Admin</h1>
    <p class="sub">Logged in as an officer via Discord.</p>
    <AdminNav active="Import" />
    {p.imported ? <div class="banner ok">Imported: {p.imported}</div> : null}
    <div class="card">
      <p style="margin:0">
        {p.lastImport ? `Last import: ${p.lastImport}` : 'No imports yet'}
      </p>
      {p.stale ? (
        <div class="banner warn" style="margin:10px 0 0">
          {p.lastImport ? `The last import is more than ${p.staleDays} days old, the data is stale.` : 'There has never been an import, the data is stale.'}
        </div>
      ) : null}
    </div>
    <div class="card">
      <h3>1. Import after a raid</h3>
      {p.error ? <div class="banner err">{p.error}</div> : null}
      <form method="post" action="/admin/import/preview">
        <div><b>Loot</b> <span class="alt">from <code>/dlc export</code> and then "Darklight Web (JSON)"</span></div>
        <textarea name="lootText" spellcheck={false}>{p.lootText}</textarea>
        <div class="row"><b>Attendance</b> <span class="alt">from <code>/limpus export</code></span></div>
        <textarea name="attendanceText" spellcheck={false}>{p.attendanceText}</textarea>
        <div class="row"><button class="btn" type="submit">Preview import</button></div>
      </form>
      {p.preview ? (
        <form method="post" action="/admin/import/commit" class="preview">
          <textarea name="lootText" hidden>{p.lootText}</textarea>
          <textarea name="attendanceText" hidden>{p.attendanceText}</textarea>
          {p.preview.nights.map((n) => <NightRow n={n} instances={p.instances} st={p.state} />)}
          {p.preview.newCharacters.length > 0 ? (
            <p>{p.preview.newCharacters.length} new characters need to be linked: {p.preview.newCharacters.join(', ')}</p>
          ) : null}
          {p.preview.warnings.length > 0 ? (
            <ul class="alt">{p.preview.warnings.map((w) => <li>{w}</li>)}</ul>
          ) : null}
          <div class="row">
            <button class="btn" type="submit">Save</button>
            <a class="btn ghost" href="/admin">Cancel</a>
          </div>
        </form>
      ) : null}
    </div>
  </>
);
