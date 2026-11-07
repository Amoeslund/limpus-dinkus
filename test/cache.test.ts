import { env, SELF } from 'cloudflare:test';
import { beforeEach, expect, it } from 'vitest';
import { Hono } from 'hono';
import { commitImport } from '../src/db/importer';
import { pageCache } from '../src/http/page-cache';
import { adminCookie } from './helpers';

// Own host so cached pages never leak into other test files.
const BASE = 'https://cache-test.example';

beforeEach(async () => {
  for (const t of ['award', 'item', 'kill_member', 'kill', 'night_override', 'raid_night', 'character', 'import_log'])
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  for (const p of ['/', '/raid', '/admin']) await caches.default.delete(BASE + p);
});

it('public pages are cached for 60 seconds', async () => {
  const first = await SELF.fetch(BASE + '/');
  expect(first.status).toBe(200);
  expect(first.headers.get('cache-control')).toBe('public, max-age=60');
  const body = await first.text();
  expect(body).toContain('No attendance yet.');
  await commitImport(env.DB, { lootText: '', instancePicks: {}, countsOff: [], attendanceText: JSON.stringify(
    { addon: 'LimpusAttendance', version: 1, kills: [{ t: 1762290000, zone: 'Molten Core', boss: 'Lucifron', raid: ['Mankee'] }] }) }, '111');
  // Uncached, the page would now list Mankee.
  const second = await SELF.fetch(BASE + '/');
  expect(await second.text()).toBe(body);
});

it('admin pages are never cached', async () => {
  const cookie = await adminCookie();
  const r = await SELF.fetch(BASE + '/admin', { headers: { cookie } });
  expect(r.status).toBe(200);
  expect(r.headers.get('cache-control') ?? '').not.toContain('public');
  await r.text();
  expect(await caches.default.match(BASE + '/admin')).toBeUndefined();
});

it('non-200 public responses are not cached', async () => {
  const r = await SELF.fetch(BASE + '/raid/nope');
  expect(r.status).toBe(404);
  expect(r.headers.get('cache-control')).toBeNull();
  await r.text();
  expect(await caches.default.match(BASE + '/raid/nope')).toBeUndefined();
});

it('works without a Cache API', async () => {
  const app = new Hono();
  let renders = 0;
  app.get('/', pageCache(() => undefined), (c) => { renders++; return c.text('page'); });
  const broken = { match: () => Promise.reject(new Error('x')), put: () => Promise.reject(new Error('x')) } as unknown as Cache;
  app.get('/b', pageCache(() => broken), (c) => { renders++; return c.text('page'); });
  for (const p of ['/', '/', '/b']) {
    const r = await app.request(p);
    expect(await r.text()).toBe('page');
    expect(r.headers.get('cache-control')).toBe('public, max-age=60');
  }
  expect(renders).toBe(3);
});

it('query strings share the cached page, so they cannot bypass the cache', async () => {
  const first = await (await SELF.fetch(BASE + '/?x=1')).text();
  await commitImport(env.DB, { lootText: '', instancePicks: {}, countsOff: [], attendanceText: JSON.stringify(
    { addon: 'LimpusAttendance', version: 1, kills: [{ t: 1762290000, zone: 'Molten Core', boss: 'Lucifron', raid: ['Mankee'] }] }) }, '111');
  expect(await (await SELF.fetch(BASE + '/?x=2')).text()).toBe(first);
  expect(await (await SELF.fetch(BASE + '/')).text()).toBe(first);
});
