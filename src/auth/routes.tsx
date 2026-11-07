import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Env } from '../env';
import { listInstances } from '../db/read';
import { Layout } from '../views/layout';
import { SESSION_COOKIE, SESSION_TTL, signSession, verifySession, type SessionUser } from './session';

const STATE_COOKIE = 'ld_oauth_state';
const STATE_PATH = '/auth';

export async function isAllowedAdmin(env: Env, id: string): Promise<boolean> {
  if (id === env.BOOTSTRAP_ADMIN_ID) return true;
  const row = await env.DB.prepare('SELECT 1 AS ok FROM admin WHERE discord_id = ?').bind(id).first();
  return row !== null;
}

export async function notOfficerPage(db: D1Database) {
  const instances = await listInstances(db);
  return (
    <Layout title="Not an officer" nav={{ instances }}>
      <h1>Not an officer</h1>
      <p class="sub">Your Discord account is not on the officer list. Ask a guild officer to add you.</p>
    </Layout>
  );
}

export const requireAdmin = createMiddleware<{ Bindings: Env; Variables: { admin: SessionUser } }>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  const user = token ? await verifySession(token, c.env.SESSION_SECRET) : null;
  if (!user) return c.redirect('/auth/login');
  if (!(await isAllowedAdmin(c.env, user.id))) {
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
    return c.html(await notOfficerPage(c.env.DB), 403);
  }
  c.set('admin', user);
  await next();
});

export const authRoutes = new Hono<{ Bindings: Env }>();

function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  const len = Math.max(ea.length, eb.length);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < len; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

const redirectUri = (url: string) => new URL(url).origin + '/auth/callback';

authRoutes.get('/auth/login', (c) => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const state = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  setCookie(c, STATE_COOKIE, state, { path: STATE_PATH, httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 600 });
  const u = new URL('https://discord.com/oauth2/authorize');
  u.searchParams.set('client_id', c.env.DISCORD_CLIENT_ID);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'identify');
  u.searchParams.set('redirect_uri', redirectUri(c.req.url));
  u.searchParams.set('state', state);
  return c.redirect(u.toString());
});

authRoutes.get('/auth/callback', async (c) => {
  const expected = getCookie(c, STATE_COOKIE);
  const state = c.req.query('state');
  const code = c.req.query('code');
  // The state cookie is single-use: clear it whatever happens next.
  deleteCookie(c, STATE_COOKIE, { path: STATE_PATH, secure: true });
  if (c.req.query('error')) return c.text('Login cancelled. Go back and try again.', 400);
  if (!expected || !state || !code || !timingSafeEqual(expected, state)) {
    return c.text('Invalid login state. Go back and try again.', 400);
  }

  let user: { id: string; name: string };
  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: c.env.DISCORD_CLIENT_ID,
        client_secret: c.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri(c.req.url),
      }),
    });
    if (!tokenRes.ok) return c.text('Discord login failed.', 502);
    const tok = (await tokenRes.json()) as { access_token?: string };
    if (!tok.access_token) return c.text('Discord login failed.', 502);
    const meRes = await fetch('https://discord.com/api/users/@me', { headers: { authorization: `Bearer ${tok.access_token}` } });
    if (!meRes.ok) return c.text('Discord login failed.', 502);
    const me = (await meRes.json()) as { id?: string; username?: string; global_name?: string | null };
    if (typeof me.id !== 'string' || !me.id) return c.text('Discord login failed.', 502);
    user = { id: me.id, name: me.global_name || me.username || me.id };
  } catch {
    return c.text('Discord login failed.', 502);
  }

  if (!(await isAllowedAdmin(c.env, user.id))) return c.html(await notOfficerPage(c.env.DB), 403);

  const session: SessionUser = { id: user.id, name: user.name };
  const token = await signSession(session, c.env.SESSION_SECRET);
  setCookie(c, SESSION_COOKIE, token, { path: '/', httpOnly: true, secure: true, sameSite: 'Lax', maxAge: SESSION_TTL });
  return c.redirect('/admin');
});

authRoutes.post('/auth/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
  return c.redirect('/');
});

authRoutes.get('/admin', requireAdmin, (c) => c.text('Admin'));
