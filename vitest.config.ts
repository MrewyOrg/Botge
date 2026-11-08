// cspell:words testge

import { defineConfig, type ViteUserConfig } from 'vitest/config';

const viteUserConfig: Readonly<ViteUserConfig> = defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    name: { label: 'Testge', color: 'cyan' },
    include: ['tests/**/*.test.ts'],
    // Bound memory and startup contention while the policy suite loads TypeScript and ESLint.
    maxWorkers: 4,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text-summary', 'html', 'json', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: { perFile: true, statements: 80, branches: 80, functions: 80, lines: 80 }
    }
  }
});

export default viteUserConfig;
