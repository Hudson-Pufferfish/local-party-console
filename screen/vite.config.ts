import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import solid from '@solidjs/vite-plugin';
import { defineConfig } from 'vite';

const repoRoot = path.resolve(import.meta.dirname, '..');

export default defineConfig({
  root: import.meta.dirname,
  base: '/screen/',
  plugins: [solid(), tailwindcss()],
  server: {
    allowedHosts: true,
    fs: {
      allow: [repoRoot],
    },
  },
});
