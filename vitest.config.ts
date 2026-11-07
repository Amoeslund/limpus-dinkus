import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

export default defineConfig(async () => {
  const migrations = await readD1Migrations('migrations');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            DISCORD_CLIENT_ID: 'test-client-id',
            DISCORD_CLIENT_SECRET: 'test-client-secret',
            SESSION_SECRET: 'test-secret',
            BOOTSTRAP_ADMIN_ID: '111',
          },
        },
      }),
    ],
    test: { setupFiles: ['./test/apply-migrations.ts'] },
  };
});
