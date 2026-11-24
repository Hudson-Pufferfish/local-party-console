import path from 'node:path';
import solid from '@solidjs/vite-plugin';
import { defineConfig } from 'vitest/config';

const root = path.resolve(import.meta.dirname, '..');

export default defineConfig({
  plugins: [solid({ ssr: true })],
  server: {
    fs: {
      allow: [root],
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
