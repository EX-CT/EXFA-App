import { defineConfig } from 'vitest/config';

// Unit tests (node): src/**/*.test.ts. Test names carry stable ids `web.unit.<slug>: <description>`.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node', testTimeout: 20000 },
});
