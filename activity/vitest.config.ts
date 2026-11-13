import { fileURLToPath } from 'node:url';

import { defineConfig, type ViteUserConfig } from 'vitest/config';

const viteUserConfig: Readonly<ViteUserConfig> = defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  assetsInclude: ['**/*.html'],
  test: {
    name: 'Activity',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'worker/**/*.ts'],
      exclude: ['**/*.d.ts'],
      reporter: ['text-summary', 'html', 'json', 'json-summary'],
      reportsDirectory: '../coverage/activity',
      thresholds: { perFile: true, statements: 90, branches: 90, functions: 90, lines: 90 }
    }
  }
});

export default viteUserConfig;
