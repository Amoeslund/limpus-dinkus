import { Hono } from 'hono';
import type { Env } from './env';
import { publicRoutes } from './routes/public';
import { authRoutes } from './auth/routes';
import { adminRoutes } from './routes/admin';

const app = new Hono<{ Bindings: Env }>();

app.get('/healthz', (c) => c.text('ok'));
app.route('/', publicRoutes);
app.route('/', authRoutes);
app.route('/', adminRoutes);

export default app;
