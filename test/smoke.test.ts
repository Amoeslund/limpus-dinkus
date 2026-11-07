import { env, SELF } from 'cloudflare:test';
import { it, expect } from 'vitest';

it('GET /healthz returns ok', async () => {
  const res = await SELF.fetch('https://x/healthz');
  expect(res.status).toBe(200);
  expect(await res.text()).toBe('ok');
});
it('schema exists', async () => {
  const r = await env.DB.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").first<{ n: number }>();
  expect(r!.n).toBeGreaterThanOrEqual(9);
});
