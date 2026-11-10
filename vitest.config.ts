import { defineConfig, type ViteUserConfig } from 'vitest/config';

const viteUserConfig: Readonly<ViteUserConfig> = defineConfig({
  test: {
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
