import type { MiddlewareHandler } from 'hono';

export const PAGE_MAX_AGE = 60;

/** The Workers edge cache, or undefined where the Cache API is not available. */
export function defaultCache(): Cache | undefined {
  try {
    return (globalThis as { caches?: CacheStorage & { default?: Cache } }).caches?.default;
  } catch {
    return undefined;
  }
}

/**
 * Caches successful (200) GET pages for PAGE_MAX_AGE seconds, keyed by URL, so repeat
 * page views do not re-read D1. The query string is ignored. Only for public pages: never put it on admin or auth routes.
 */
export function pageCache(getCache: () => Cache | undefined = defaultCache): MiddlewareHandler {
  return async (c, next) => {
    const cache = getCache();
    // Key on origin + path only, so adding ?anything cannot bypass the cache and hit D1.
    const url = new URL(c.req.url);
    const key = new Request(url.origin + url.pathname, { method: 'GET' });
    if (cache) {
      try {
        const hit = await cache.match(key);
        if (hit) return hit;
      } catch { /* cache unavailable: render normally */ }
    }
    await next();
    if (c.res.status !== 200) return;
    c.res.headers.set('Cache-Control', `public, max-age=${PAGE_MAX_AGE}`);
    if (cache) {
      try {
        await cache.put(key, c.res.clone());
      } catch { /* not cached this time */ }
    }
  };
}
