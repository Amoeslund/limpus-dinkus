import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signSession, verifySession } from '../src/auth/session';
import { adminCookie } from './helpers';

const realFetch = globalThis.fetch;
const discord = (userId: string) => {
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === 'https://discord.com/api/oauth2/token') {
      return new Response(JSON.stringify({ access_token: 'tok', token_type: 'Bearer' }), { headers: { 'content-type': 'application/json' } });
    }
    if (url === 'https://discord.com/api/users/@me') {
      return new Response(JSON.stringify({ id: userId, username: 'user' + userId, global_name: 'Name ' + userId }), { headers: { 'content-type': 'application/json' } });
    }
    return realFetch(input, init);
  }) as typeof fetch;
};
afterEach(() => { globalThis.fetch = realFetch; });
beforeEach(async () => { await env.DB.prepare('DELETE FROM admin').run(); });

const startLogin = async () => {
  const r = await SELF.fetch('https://x/auth/login', { redirect: 'manual' });
  const setCookie = r.headers.get('set-cookie') ?? '';
  const state = /ld_oauth_state=([^;]+)/.exec(setCookie)![1];
  return { r, setCookie, state };
};
const callback = (state: string, cookieState = state) =>
  SELF.fetch(`https://x/auth/callback?code=c&state=${state}`, { headers: { cookie: `ld_oauth_state=${cookieState}` }, redirect: 'manual' });

describe('session', () => {
  it('round-trips and rejects tampering and expiry', async () => {
    const t = await signSession({ id: '1', name: 'A' }, 's');
    expect(await verifySession(t, 's')).toEqual({ id: '1', name: 'A' });
    expect(await verifySession(t, 'other')).toBeNull();
    const [, sig] = t.split('.');
    const forged = btoa(JSON.stringify({ id: '2', name: 'A', exp: 9999999999 })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    expect(await verifySession(`${forged}.${sig}`, 's')).toBeNull();
    const mid = Math.floor(sig.length / 2);
    const flipped = sig.slice(0, mid) + (sig[mid] === 'A' ? 'B' : 'A') + sig.slice(mid + 1);
    expect(await verifySession(`${t.split('.')[0]}.${flipped}`, 's')).toBeNull();
    expect(await verifySession('garbage', 's')).toBeNull();
    expect(await verifySession('', 's')).toBeNull();
    const expired = await signSession({ id: '1', name: 'A' }, 's', -10);
    expect(await verifySession(expired, 's')).toBeNull();
  });
});

describe('auth routes', () => {
  it('/admin without cookie redirects to /auth/login', async () => {
    const r = await SELF.fetch('https://x/admin', { redirect: 'manual' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/auth/login');
  });

  it('/admin with valid admin cookie shows Admin', async () => {
    const r = await SELF.fetch('https://x/admin', { headers: { cookie: await adminCookie() } });
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('Admin');
  });

  it('/admin with valid session for a removed admin is 403 and clears cookie', async () => {
    const cookie = `ld_session=${await signSession({ id: '999', name: 'Gone' }, 'test-secret')}`;
    const r = await SELF.fetch('https://x/admin', { headers: { cookie }, redirect: 'manual' });
    expect(r.status).toBe(403);
    expect(r.headers.get('set-cookie')).toMatch(/ld_session=;.*Max-Age=0/i);
  });

  it('admin table member passes the guard', async () => {
    await env.DB.prepare('INSERT INTO admin (discord_id, name) VALUES (?, ?)').bind('333', 'Officer').run();
    const cookie = `ld_session=${await signSession({ id: '333', name: 'Officer' }, 'test-secret')}`;
    const r = await SELF.fetch('https://x/admin', { headers: { cookie } });
    expect(r.status).toBe(200);
  });

  it('login redirects to Discord with state cookie', async () => {
    const { r, setCookie, state } = await startLogin();
    expect(r.status).toBe(302);
    const loc = new URL(r.headers.get('location')!);
    expect(loc.origin + loc.pathname).toBe('https://discord.com/oauth2/authorize');
    expect(loc.searchParams.get('client_id')).toBe('test-client-id');
    expect(loc.searchParams.get('response_type')).toBe('code');
    expect(loc.searchParams.get('scope')).toBe('identify');
    expect(loc.searchParams.get('redirect_uri')).toBe('https://x/auth/callback');
    expect(loc.searchParams.get('state')).toBe(state);
    expect(state.length).toBeGreaterThanOrEqual(32);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\/auth/);
    expect(setCookie).toMatch(/Max-Age=600/);
  });

  it('callback with bad or missing state is 400', async () => {
    const { state } = await startLogin();
    expect((await callback('wrong', state)).status).toBe(400);
    expect((await SELF.fetch(`https://x/auth/callback?code=c&state=${state}`, { redirect: 'manual' })).status).toBe(400);
    expect((await SELF.fetch(`https://x/auth/callback?state=${state}`, { headers: { cookie: `ld_oauth_state=${state}` }, redirect: 'manual' })).status).toBe(400);
  });

  it('callback with Discord error shows Login cancelled and clears state', async () => {
    const { state } = await startLogin();
    const r = await SELF.fetch(`https://x/auth/callback?error=access_denied&state=${state}`, { headers: { cookie: `ld_oauth_state=${state}` }, redirect: 'manual' });
    expect(r.status).toBe(400);
    expect(await r.text()).toContain('Login cancelled');
    expect(r.headers.get('set-cookie')).toMatch(/ld_oauth_state=;.*Max-Age=0/i);
  });

  it('callback admits bootstrap admin and rejects others', async () => {
    discord('111');
    let { state } = await startLogin();
    const ok = await callback(state);
    expect(ok.status).toBe(302);
    expect(ok.headers.get('location')).toBe('/admin');
    const sc = ok.headers.get('set-cookie')!;
    expect(sc).toMatch(/ld_session=[^;]+\..+/);
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/Secure/i);
    expect(sc).toMatch(/SameSite=Lax/i);
    expect(sc).toMatch(/Max-Age=2592000/);
    expect(sc).toMatch(/ld_oauth_state=;.*Max-Age=0/i);
    const token = /ld_session=([^;]+)/.exec(sc)![1];
    expect(await verifySession(token, 'test-secret')).toEqual({ id: '111', name: 'Name 111' });

    discord('222');
    ({ state } = await startLogin());
    const no = await callback(state);
    expect(no.status).toBe(403);
    expect(await no.text()).toContain('Not an officer');
    expect(no.headers.get('set-cookie') ?? '').not.toMatch(/ld_session=[^;]+\./);
  });

  it('callback admits an admin-table member', async () => {
    await env.DB.prepare('INSERT INTO admin (discord_id, name) VALUES (?, ?)').bind('444', 'O').run();
    discord('444');
    const { state } = await startLogin();
    expect((await callback(state)).status).toBe(302);
  });

  it('callback surfaces Discord failure as 502', async () => {
    globalThis.fetch = (async () => new Response('nope', { status: 500 })) as typeof fetch;
    const { state } = await startLogin();
    expect((await callback(state)).status).toBe(502);
  });

  it('logout clears cookie and redirects to /', async () => {
    const r = await SELF.fetch('https://x/auth/logout', { method: 'POST', redirect: 'manual' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/');
    expect(r.headers.get('set-cookie')).toMatch(/ld_session=;.*Max-Age=0/i);
  });
});
