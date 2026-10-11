import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 1000 },
  server: {
    proxy: { '/ws': { target: 'ws://localhost:2567', ws: true } },
  },
});
