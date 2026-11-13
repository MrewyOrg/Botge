import { defineConfig, type ViteUserConfig } from 'vitest/config';

const viteUserConfig: Readonly<ViteUserConfig> = defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['*.config.ts', 'activity/src/**/*.ts', 'activity/worker/**/*.ts'],
      exclude: ['**/*.d.ts'],
      reporter: ['text-summary', 'html', 'json', 'json-summary'],
      reportsDirectory: 'coverage/typescript',
      thresholds: { perFile: true, statements: 90, branches: 90, functions: 90, lines: 90 }
    },
    projects: [
      {
        extends: true,
        test: {
          name: { label: 'Tooling', color: 'cyan' },
          include: ['tests/{control,tooling}/**/*.test.ts']
        }
      },
      './activity/vitest.config.ts'
    ]
  }
});

export default viteUserConfig;
