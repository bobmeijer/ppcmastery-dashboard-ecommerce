import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Only for `npm run demo:replay`, which regenerates the pre-generated AI text for demo mode.
export default defineConfig({
  test: {
    include: ['scripts/demo/generate-replay.test.ts'],
    testTimeout: 900_000,
    env: { NEXT_PUBLIC_DEMO_MODE: '1' },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      'server-only': path.resolve(__dirname, 'scripts/demo/server-only-stub.ts'),
    },
  },
});
