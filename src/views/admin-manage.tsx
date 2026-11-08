import type { CharRow, ItemRow, LootRow, NightRow } from '../db/admin';
import { STATUSES } from '../db/admin';
import { AdminNav } from './admin';

export const MANAGE_CSS = `
button.toggle{display:inline-block;width:34px;height:18px;border-radius:9px;background:var(--ok);position:relative;vertical-align:middle;border:0;padding:0;cursor:pointer}
button.toggle::after{content:"";position:absolute;right:2px;top:2px;width:14px;height:14px;border-radius:50%;background:#fff}
button.toggle.off{background:#4a4450}button.toggle.off::after{right:auto;left:2px}
input[type=number],input[type=date]{background:#0e0c10;color:var(--text);border:1px solid var(--line);border-radius:6px;padding:5px 8px;max-width:100%}
input[type=number]{width:80px}
.btn.small{padding:4px 10px;font-size:13px}
.checks{display:flex;gap:6px 16px;flex-wrap:wrap;max-height:220px;overflow-y:auto;margin:8px 0}
form.inline{display:inline;margin:0}
.nowrap td{white-space:normal}
`;

export const ErrorPage = ({ message, active, back }: { message: string; active: string; back: string }) => (
  <>
    <h1>Admin</h1>
    <AdminNav active={active} />
    <div class="banner err">{message}</div>
    <p><a href={back}>Back</a></p>
  </>
);

export const NightsPage = ({ nights, members }: { nights: NightRow[]; members: { nameKey: string; display: string }[] }) => (
  <>
    <h1>Admin</h1>
    <AdminNav active="Nights" />
    <div class="card">
      <h3>Raid nights</h3>
      <div class="scroll">
        <table>
          <tr><th>Night</th><th>Instances</th><th class="c">Players</th><th class="c">Counts</th></tr>
          {nights.map((n) => (
            <tr>
              <td><a href={`/admin/nights/${n.id}`}>{n.label}</a>{n.manual ? <span class="alt"> (manual)</span> : null}</td>
              <td>{n.instances}{!n.counts ? <span class="alt"> (pug)</span> : null}</td>
              <td class="c">{n.players}</td>
              <td class="c">
                <form class="inline" method="post" action={`/admin/nights/${n.id}/counts`}>
                  <button class={n.counts ? 'toggle' : 'toggle off'} type="submit" aria-label={n.counts ? 'Counts as guild raid, click to turn off' : 'Does not count, click to turn on'}></button>
                </form>
              </td>
            </tr>
          ))}
        </table>
      </div>
      <p class="alt">Click a night to add or remove players by hand.</p>
    </div>
    <div class="card">
      <h3>Add a night by hand</h3>
      <form method="post" action="/admin/nights/new">
        <div class="row">
          <label>Date <input type="date" name="date" required /></label>
          <label>Instances <input type="text" name="instances" placeholder="e.g. MC, ZG" /></label>
        </div>
        <b>Present</b>
        <div class="checks">
          {members.map((m) => <label><input type="checkbox" name="present[]" value={m.nameKey} /> {m.display}</label>)}
        </div>
        <b>Benched</b> <span class="alt">counts as attendance</span>
        <div class="checks">
          {members.map((m) => <label><input type="checkbox" name="bench[]" value={m.nameKey} /> {m.display}</label>)}
        </div>
        <div class="row"><button class="btn" type="submit">Create night</button></div>
      </form>
    </div>
  </>
);

export const NightPage = ({ night }: { night: { id: number; label: string; nightDate: string; counts: boolean; manual: boolean; instances: string;
  roster: { nameKey: string; display: string; isAlt: boolean; benched: boolean; fromKills: boolean }[] } }) => (
  <>
    <h1>Admin</h1>
    <AdminNav active="Nights" />
    <div class="card">
      <h3>{night.label}</h3>
      <p class="sub">
        {night.nightDate}{night.instances ? ` · ${night.instances}` : ''} · {night.counts ? 'counts as guild raid' : 'does not count (pug)'}
        {night.manual ? ' · manual' : ''}
      </p>
      <div class="scroll">
        <table>
          <tr><th>Player</th><th></th></tr>
          {night.roster.map((p) => (
            <tr>
              <td>{p.display}{p.isAlt ? <span class="alt"> (alt)</span> : null}{p.benched ? <span class="alt"> (benched)</span> : null}</td>
              <td>
                {p.fromKills ? null : (
                  <form class="inline" method="post" action={`/admin/nights/${night.id}/bench`}>
                    <input type="hidden" name="nameKey" value={p.nameKey} />
                    <input type="hidden" name="benched" value={p.benched ? '0' : '1'} />
                    <button class="btn ghost small" type="submit">{p.benched ? 'Unbench' : 'Bench'}</button>
                  </form>
                )}{' '}
                <form class="inline" method="post" action={`/admin/nights/${night.id}/presence`}>
                  <input type="hidden" name="nameKey" value={p.nameKey} />
                  <input type="hidden" name="present" value="0" />
                  <button class="btn ghost small" type="submit">Remove</button>
                </form>
              </td>
            </tr>
          ))}
        </table>
      </div>
      <form method="post" action={`/admin/nights/${night.id}/presence`} class="row">
        <input type="text" name="nameKey" placeholder="Add player by name" required />
        <input type="hidden" name="present" value="1" />
        <button class="btn" type="submit">Add</button>
      </form>
      <form method="post" action={`/admin/nights/${night.id}/bench`} class="row">
        <input type="text" name="nameKey" placeholder="Bench player by name" required />
        <input type="hidden" name="benched" value="1" />
        <button class="btn ghost" type="submit">Bench</button>
      </form>
      <p class="alt">Add creates an unknown name as a new member; Bench needs an existing character. Players on the boss kills can't be benched. Benched players count as attending (they get EP as standby in EPGP Forever).</p>
    </div>
    <form method="post" action={`/admin/nights/${night.id}/delete`} class="card">
      <button class="btn ghost" type="submit">Delete this night</button>
      <span class="alt"> Removes its kills and loot as well.</span>
    </form>
  </>
);

export const CharactersPage = ({ chars }: { chars: CharRow[] }) => {
  const mains = chars.filter((c) => c.mainKey === null);
  return (
    <>
      <h1>Admin</h1>
      <AdminNav active="Characters" />
      <div class="card">
        <h3>Characters</h3>
        <div class="scroll">
          <table>
            <tr><th>Character</th><th>Main</th><th>Status</th><th></th></tr>
            {chars.map((c, i) => (
              <tr>
                <td>{c.display}{c.isNew ? <span class="pill p-bis" style="margin-left:8px">new</span> : null}</td>
                <td>
                  <select name="main" form={`c${i}`} disabled={c.hasAlts}>
                    <option value="" selected={c.mainKey === null}>(is a main)</option>
                    {c.hasAlts ? null : mains.filter((m) => m.nameKey !== c.nameKey).map((m) => (
                      <option value={m.nameKey} selected={c.mainKey === m.nameKey}>{m.display}</option>
                    ))}
                  </select>
                </td>
                <td>
                  {c.mainKey === null ? (
                    <select name="status" form={`c${i}`}>
                      {STATUSES.map((s) => <option value={s} selected={c.status === s}>{s}</option>)}
                    </select>
                  ) : <span class="alt">alt</span>}
                </td>
                <td>
                  <form id={`c${i}`} class="inline" method="post" action={`/admin/characters/${encodeURIComponent(c.nameKey)}`}>
                    <button class="btn small" type="submit">Save</button>
                  </form>
                </td>
              </tr>
            ))}
          </table>
        </div>
      </div>
    </>
  );
};

const NO_INSTANCE = 'No instance';

/** Items bucketed by instance: instances alphabetical, items without one last. */
function groupByInstance(items: ItemRow[]): [string, ItemRow[]][] {
  const groups = new Map<string, ItemRow[]>();
  for (const i of items) {
    const key = i.instance || NO_INSTANCE;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  return [...groups.entries()].sort(([a], [b]) =>
    a === NO_INSTANCE ? 1 : b === NO_INSTANCE ? -1 : a.localeCompare(b, 'en'));
}

export const ItemsPage = ({ items, q }: { items: ItemRow[]; q: string }) => (
  <>
    <h1>Admin</h1>
    <AdminNav active="Items" />
    <div class="card">
      <h3>Items</h3>
      <form method="get" action="/admin/items" class="row" style="margin-top:0">
        <input type="text" name="q" value={q} placeholder="Search item..." />
        <button class="btn ghost small" type="submit">Search</button>
        <span class="alt">Change an item's instance to move it and its drops to another raid page.</span>
      </form>
      {items.length === 0 ? <p class="alt">No items found.</p> : null}
    </div>
    {groupByInstance(items).map(([instance, group]) => (
      <div class="card">
        <h3>{instance} <span class="alt">{group.length} {group.length === 1 ? 'item' : 'items'}</span></h3>
        <ItemTable items={group} q={q} />
      </div>
    ))}
  </>
);

const ItemTable = ({ items, q }: { items: ItemRow[]; q: string }) => (
  <div class="scroll">
    <table>
      <tr><th>Item</th><th>Instance</th><th class="c">Times dropped</th><th></th></tr>
      {items.map((i) => (
        <tr>
          <td>{i.name}</td>
          <td><input type="text" name="instance" form={`i${i.itemId}`} value={i.instance} /></td>
          <td class="c">{i.drops}</td>
          <td>
            <form id={`i${i.itemId}`} class="inline" method="post" action={`/admin/items/${i.itemId}`}>
              <input type="hidden" name="q" value={q} />
              <button class="btn small" type="submit">Save</button>
            </form>
          </td>
        </tr>
      ))}
    </table>
  </div>
);

export const LootPage = ({ rows }: { rows: LootRow[] }) => (
  <>
    <h1>Admin</h1>
    <AdminNav active="Loot" />
    <div class="card">
      <h3>Latest 100 drops</h3>
      <div class="scroll">
        <table>
          <tr><th>Item</th><th>Night</th><th>Response</th><th>Player</th><th>Deleted</th><th></th></tr>
          {rows.map((r, i) => (
            <tr>
              <td>{r.itemName}</td>
              <td>{r.nightLabel}</td>
              <td>{r.response}</td>
              <td><input type="text" name="nameKey" form={`l${i}`} value={r.nameKey} /></td>
              <td class="c"><input type="checkbox" name="deleted" value="1" form={`l${i}`} checked={r.deleted} /></td>
              <td>
                <form id={`l${i}`} class="inline" method="post" action={`/admin/loot/${encodeURIComponent(r.id)}`}>
                  <button class="btn small" type="submit">Save</button>
                </form>
              </td>
            </tr>
          ))}
        </table>
      </div>
    </div>
  </>
);

export const AdminsPage = ({ admins, bootstrapId }: { admins: { discordId: string; name: string }[]; bootstrapId: string }) => (
  <>
    <h1>Admin</h1>
    <AdminNav active="Admins" />
    <div class="card">
      <h3>Officers</h3>
      <div class="scroll">
        <table>
          <tr><th>Name</th><th>Discord ID</th><th></th></tr>
          <tr><td>Bootstrap admin</td><td>{bootstrapId}</td><td class="alt">cannot be removed</td></tr>
          {admins.filter((a) => a.discordId !== bootstrapId).map((a) => (
            <tr>
              <td>{a.name}</td>
              <td>{a.discordId}</td>
              <td>
                <form class="inline" method="post" action={`/admin/admins/${encodeURIComponent(a.discordId)}/delete`}>
                  <button class="btn ghost small" type="submit">Remove</button>
                </form>
              </td>
            </tr>
          ))}
        </table>
      </div>
    </div>
    <div class="card">
      <h3>Add an officer</h3>
      <form method="post" action="/admin/admins" class="row">
        <input type="text" name="discordId" placeholder="Discord user ID (digits)" inputmode="numeric" required />
        <input type="text" name="name" placeholder="Name" required />
        <button class="btn" type="submit">Add</button>
      </form>
    </div>
  </>
);
