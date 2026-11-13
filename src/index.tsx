import { Hono } from 'hono';
import type { Env } from './env';
import { publicRoutes } from './routes/public';
import { authRoutes } from './auth/routes';
import { adminRoutes } from './routes/admin';
import { pollArmory } from './db/roster';
import { pollGear } from './db/gear';
import { ARMORY_CRON } from './config';

const app = new Hono<{ Bindings: Env }>();

app.get('/healthz', (c) => c.text('ok'));
app.route('/', publicRoutes);
app.route('/', authRoutes);
app.route('/', adminRoutes);

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    // Roster every 3 hours, gear (armory character pages, a batch per run) every hour.
    ctx.waitUntil(event.cron === ARMORY_CRON ? pollArmory(env.DB) : pollGear(env.DB));
  },
} satisfies ExportedHandler<Env>;
