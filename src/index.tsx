import { Hono } from 'hono';
import type { Env } from './env';
import { publicRoutes } from './routes/public';
import { authRoutes } from './auth/routes';

const app = new Hono<{ Bindings: Env }>();

app.get('/healthz', (c) => c.text('ok'));
app.route('/', publicRoutes);
app.route('/', authRoutes);

export default app;
