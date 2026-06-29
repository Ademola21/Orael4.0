import { defineConfig } from 'vite';

// For GitHub Pages project sites, assets must be served from /<repo-name>/.
// Default to '/' for local dev; CI overrides via BASE_PATH env var.
const BASE = process.env.BASE_PATH || '/';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  base: BASE,
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
