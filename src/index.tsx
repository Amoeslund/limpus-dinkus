import { Hono } from 'hono';
import type { Env } from './env';
import { publicRoutes } from './routes/public';

const app = new Hono<{ Bindings: Env }>();

app.get('/healthz', (c) => c.text('ok'));
app.route('/', publicRoutes);

export default app;
