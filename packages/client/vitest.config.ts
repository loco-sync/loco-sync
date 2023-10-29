import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'client',
    dir: './src',
    watch: false,
    environment: 'jsdom',
    globals: true,
    coverage: { provider: 'istanbul' },
    passWithNoTests: true,
  },
});
