import { defineConfig, type UserConfig } from 'vite';

const config: Readonly<UserConfig> = defineConfig({
  base: './',
  build: { target: ['chrome126', 'firefox133', 'safari18.4', 'ios18.4'] as const }
});

export default config;
