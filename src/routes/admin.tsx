import { Hono } from 'hono';
import type { Env } from '../env';
import { requireAdmin } from '../auth/routes';
import { STALE_IMPORT_DAYS } from '../config';
import { commitImport, previewImport, type ImportPreview, type ImportRequest } from '../db/importer';
import { lastImportAt, listInstances } from '../db/read';
import { Layout } from '../views/layout';
import { ADMIN_CSS, formatDateTime, ImportPage, type PickState } from '../views/admin';

type AdminEnv = { Bindings: Env; Variables: { admin: { id: string; name: string } } };
export const adminRoutes = new Hono<AdminEnv>();
adminRoutes.use('/admin', requireAdmin);
adminRoutes.use('/admin/*', requireAdmin);

const OTHER = '__other';
const emptyState = (): PickState => ({ instance: {}, other: {}, countsOff: [] });

type RenderOpts = {
  lootText?: string; attendanceText?: string; imported?: string; error?: string;
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
        lootText={opts.lootText ?? ''} attendanceText={opts.attendanceText ?? ''}
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
  const req: ImportRequest = { lootText: str(body.lootText), attendanceText: str(body.attendanceText), instancePicks: picks, countsOff: [] };
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
  const req: ImportRequest = { lootText: str(body.lootText), attendanceText: str(body.attendanceText), instancePicks: {}, countsOff: [] };
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
    lootText: req.lootText, attendanceText: req.attendanceText, error: res.error, state, status: 400,
    preview: preview.ok ? preview : undefined,
  });
});
