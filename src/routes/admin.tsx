import { Hono } from 'hono';
import type { Env } from '../env';
import { requireAdmin } from '../auth/routes';
import { STALE_IMPORT_DAYS } from '../config';
import { commitImport, previewImport, type ImportPreview, type ImportRequest } from '../db/importer';
import { lastImportAt, listInstances } from '../db/read';
import * as A from '../db/admin';
import { Layout } from '../views/layout';
import { AdminsPage, CharactersPage, ErrorPage, ItemsPage, LootPage, MANAGE_CSS, NightPage, NightsPage } from '../views/admin-manage';
import { ADMIN_CSS, formatDateTime, ImportPage, type PickState } from '../views/admin';

type AdminEnv = { Bindings: Env; Variables: { admin: { id: string; name: string } } };
export const adminRoutes = new Hono<AdminEnv>();
adminRoutes.use('/admin', requireAdmin);
adminRoutes.use('/admin/*', requireAdmin);

const OTHER = '__other';
const emptyState = (): PickState => ({ instance: {}, other: {}, countsOff: [] });

type RenderOpts = {
  lootText?: string; attendanceText?: string; epgpText?: string; imported?: string; error?: string;
  preview?: ImportPreview & { ok: true }; state?: PickState; status?: 200 | 400;
};

async function renderImport(c: any, opts: RenderOpts) {
  const db = c.env.DB as D1Database;
  const instances = await listInstances(db);
  const at = await lastImportAt(db);
  const stale = at === null || Date.now() / 1000 - at > STALE_IMPORT_DAYS * 86400;
  return c.html(
    <Layout title="Admin" nav={{ instances }} admin>
      <style dangerouslySetInnerHTML={{ __html: ADMIN_CSS }} />
      <ImportPage
        lootText={opts.lootText ?? ''} attendanceText={opts.attendanceText ?? ''} epgpText={opts.epgpText ?? ''}
        lastImport={at === null ? null : formatDateTime(at)} stale={stale} staleDays={STALE_IMPORT_DAYS}
        imported={opts.imported} error={opts.error} preview={opts.preview}
        instances={instances.map((i) => i.name)} state={opts.state ?? emptyState()}
      />
    </Layout>,
    opts.status ?? 200,
  );
}

const str = (v: unknown): string => (typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : '');

async function readForm(c: any): Promise<{ req: ImportRequest; state: PickState }> {
  const body = (await c.req.parseBody({ all: true })) as Record<string, unknown>;
  const state = emptyState();
  const picks: Record<string, string> = {};
  for (const key of Object.keys(body)) {
    const m = /^instance\[(.+)\]$/.exec(key);
    if (!m) continue;
    const sel = str(body[key]);
    state.instance[m[1]] = sel;
    if (sel && sel !== OTHER) picks[m[1]] = sel;
  }
  // Text typed into an "Other" box wins over the select.
  for (const key of Object.keys(body)) {
    const m = /^instanceOther\[(.+)\]$/.exec(key);
    const v = m ? str(body[key]).trim() : '';
    if (m && v) { picks[m[1]] = v; state.other[m[1]] = v; }
  }
  const req: ImportRequest = { lootText: str(body.lootText), attendanceText: str(body.attendanceText), epgpText: str(body.epgpText), instancePicks: picks, countsOff: [] };
  const pv = await previewImport(c.env.DB, req);
  if (pv.ok) {
    const on = new Set(Object.keys(body).map((k) => /^counts\[(.+)\]$/.exec(k)?.[1]).filter((d): d is string => !!d));
    req.countsOff = pv.nights.map((n) => n.nightDate).filter((d) => !on.has(d));
    state.countsOff = req.countsOff;
  }
  return { req, state };
}

adminRoutes.get('/admin', (c) => renderImport(c, { imported: c.req.query('imported') }));

adminRoutes.post('/admin/import/preview', async (c) => {
  const body = (await c.req.parseBody({ all: true })) as Record<string, unknown>;
  const req: ImportRequest = { lootText: str(body.lootText), attendanceText: str(body.attendanceText), epgpText: str(body.epgpText), instancePicks: {}, countsOff: [] };
  const preview = await previewImport(c.env.DB, req);
  if (!preview.ok) return renderImport(c, { ...req, error: preview.error, status: 400 });
  return renderImport(c, { ...req, preview });
});

adminRoutes.post('/admin/import/commit', async (c) => {
  const { req, state } = await readForm(c);
  const res = await commitImport(c.env.DB, req, c.var.admin.id);
  if (res.ok) return c.redirect('/admin?imported=' + encodeURIComponent(res.summary));
  const preview = await previewImport(c.env.DB, req);
  return renderImport(c, {
    lootText: req.lootText, attendanceText: req.attendanceText, epgpText: req.epgpText, error: res.error, state, status: 400,
    preview: preview.ok ? preview : undefined,
  });
});

// ---------- management screens ----------

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? [v] : []);
const body = async (c: any) => (await c.req.parseBody({ all: true })) as Record<string, unknown>;

async function managePage(c: any, title: string, content: any, status: 200 | 400 | 404 = 200) {
  const instances = await listInstances(c.env.DB);
  return c.html(
    <Layout title={title} nav={{ instances }} admin>
      <style dangerouslySetInnerHTML={{ __html: ADMIN_CSS + MANAGE_CSS }} />
      {content}
    </Layout>,
    status,
  );
}
const bad = (c: any, message: string, active: string, back: string, status: 400 | 404 = 400) =>
  managePage(c, 'Admin', <ErrorPage message={message} active={active} back={back} />, status);
const idParam = (c: any): number => Number(c.req.param('id'));
const validId = (n: number) => Number.isInteger(n) && n > 0;
const badId = (c: any, active: string, back: string) => bad(c, 'Unknown id', active, back, 404);

// Nights
adminRoutes.get('/admin/nights', async (c) => {
  const [nights, chars] = await Promise.all([A.listNights(c.env.DB), A.listCharacters(c.env.DB)]);
  const members = chars.filter((x) => x.mainKey === null && x.status === 'member').map((x) => ({ nameKey: x.nameKey, display: x.display }));
  return managePage(c, 'Admin: nights', <NightsPage nights={nights} members={members} />);
});

adminRoutes.post('/admin/nights/new', async (c) => {
  const b = await body(c);
  const res = await A.createManualNight(c.env.DB, str(b.date).trim(), str(b.instances), strs(b['present[]'] ?? b.present),
    strs(b['bench[]'] ?? b.bench));
  return res.ok ? c.redirect('/admin/nights') : bad(c, res.error, 'Nights', '/admin/nights');
});

adminRoutes.post('/admin/nights/:id/counts', async (c) => {
  if (!validId(idParam(c))) return badId(c, 'Nights', '/admin/nights');
  const res = await A.toggleCounts(c.env.DB, idParam(c));
  return res.ok ? c.redirect('/admin/nights') : bad(c, res.error, 'Nights', '/admin/nights');
});

adminRoutes.get('/admin/nights/:id', async (c) => {
  if (!validId(idParam(c))) return badId(c, 'Nights', '/admin/nights');
  const night = await A.getNight(c.env.DB, idParam(c));
  if (!night) return bad(c, 'Unknown raid night', 'Nights', '/admin/nights', 404);
  return managePage(c, 'Admin: night', <NightPage night={night} />);
});

adminRoutes.post('/admin/nights/:id/presence', async (c) => {
  const id = idParam(c);
  if (!validId(id)) return badId(c, 'Nights', '/admin/nights');
  const b = await body(c);
  const res = await A.setPresence(c.env.DB, id, str(b.nameKey), str(b.present) === '1');
  return res.ok ? c.redirect(`/admin/nights/${id}`) : bad(c, res.error, 'Nights', `/admin/nights/${id}`);
});

adminRoutes.post('/admin/nights/:id/bench', async (c) => {
  const id = idParam(c);
  if (!validId(id)) return badId(c, 'Nights', '/admin/nights');
  const b = await body(c);
  const res = await A.setBench(c.env.DB, id, str(b.nameKey), str(b.benched) === '1');
  return res.ok ? c.redirect(`/admin/nights/${id}`) : bad(c, res.error, 'Nights', `/admin/nights/${id}`);
});

adminRoutes.post('/admin/nights/:id/delete', async (c) => {
  if (!validId(idParam(c))) return badId(c, 'Nights', '/admin/nights');
  await A.deleteNight(c.env.DB, idParam(c));
  return c.redirect('/admin/nights');
});

// Characters
adminRoutes.get('/admin/characters', async (c) =>
  managePage(c, 'Admin: characters', <CharactersPage chars={await A.listCharacters(c.env.DB)} />));

adminRoutes.post('/admin/characters/:key', async (c) => {
  const key = c.req.param('key');
  const b = await body(c);
  const fail = (m: string) => bad(c, m, 'Characters', '/admin/characters');
  const r = await A.updateCharacter(c.env.DB, key, typeof b.main === 'string' ? b.main : undefined, typeof b.status === 'string' ? b.status : undefined);
  if (!r.ok) return fail(r.error);
  return c.redirect('/admin/characters');
});

// Items
adminRoutes.get('/admin/items', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  return managePage(c, 'Admin: items', <ItemsPage items={await A.listItems(c.env.DB, q)} q={q} />);
});

adminRoutes.post('/admin/items/:id', async (c) => {
  if (!validId(idParam(c))) return badId(c, 'Items', '/admin/items');
  const b = await body(c);
  const res = await A.updateItem(c.env.DB, idParam(c), str(b.instance));
  if (!res.ok) return bad(c, res.error, 'Items', '/admin/items');
  const q = str(b.q).trim();
  return c.redirect('/admin/items' + (q ? '?q=' + encodeURIComponent(q) : ''));
});

// Loot
adminRoutes.get('/admin/loot', async (c) => managePage(c, 'Admin: loot', <LootPage rows={await A.latestLoot(c.env.DB)} />));

adminRoutes.post('/admin/loot/:id', async (c) => {
  const b = await body(c);
  const res = await A.updateLoot(c.env.DB, c.req.param('id'), str(b.nameKey), str(b.deleted) !== '');
  return res.ok ? c.redirect('/admin/loot') : bad(c, res.error, 'Loot', '/admin/loot');
});

// Admins
adminRoutes.get('/admin/admins', async (c) =>
  managePage(c, 'Admin: admins', <AdminsPage admins={await A.listAdmins(c.env.DB)} bootstrapId={c.env.BOOTSTRAP_ADMIN_ID} />));

adminRoutes.post('/admin/admins', async (c) => {
  const b = await body(c);
  const res = await A.addAdmin(c.env.DB, str(b.discordId), str(b.name));
  return res.ok ? c.redirect('/admin/admins') : bad(c, res.error, 'Admins', '/admin/admins');
});

adminRoutes.post('/admin/admins/:id/delete', async (c) => {
  const res = await A.removeAdmin(c.env.DB, c.req.param('id'), c.env.BOOTSTRAP_ADMIN_ID);
  return res.ok ? c.redirect('/admin/admins') : bad(c, res.error, 'Admins', '/admin/admins');
});
