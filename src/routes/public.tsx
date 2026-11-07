import { Hono } from 'hono';
import type { Env } from '../env';
import { pageCache } from '../http/page-cache';
import { listInstances, loadRaidLog, loadStandingsInput } from '../db/read';
import { computeStandings } from '../domain/standings';
import { Layout } from '../views/layout';
import { AttendancePage, NoRaidsPage, RaidPage } from '../views/public';

export const publicRoutes = new Hono<{ Bindings: Env }>();

publicRoutes.get('/', pageCache(), async (c) => {
  const input = await loadStandingsInput(c.env.DB);
  const instances = await listInstances(c.env.DB);
  const nights = input.nights.filter((n) => n.counts).sort((a, b) => a.nightDate.localeCompare(b.nightDate));
  return c.html(
    <Layout title="Limpus Dinkus" nav={{ instances, active: 'attendance' }}>
      <AttendancePage standings={computeStandings(input)} nights={nights} />
    </Layout>,
  );
});

publicRoutes.get('/raid', pageCache(), async (c) => {
  const instances = await listInstances(c.env.DB);
  if (instances.length > 0) return c.redirect(`/raid/${instances[0].slug}`);
  return c.html(<Layout title="Limpus Dinkus" nav={{ instances }}><NoRaidsPage /></Layout>);
});

publicRoutes.get('/raid/:slug', pageCache(), async (c) => {
  const slug = c.req.param('slug');
  const instances = await listInstances(c.env.DB);
  const log = await loadRaidLog(c.env.DB, slug);
  if (!log) {
    return c.html(
      <Layout title="Limpus Dinkus" nav={{ instances }}>
        <section><h1>Not found</h1><p class="sub">There is no raid page here.</p></section>
      </Layout>, 404);
  }
  const standings = computeStandings(await loadStandingsInput(c.env.DB));
  return c.html(
    <Layout title="Limpus Dinkus" nav={{ instances, active: slug }}>
      <RaidPage instance={log.instance} rows={log.rows} standings={standings} />
    </Layout>,
  );
});
