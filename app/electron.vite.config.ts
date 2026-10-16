import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

const alias = { '@shared': resolve('src/shared'), '@': resolve('src/renderer/src') };

export default defineConfig({
  main: {
    // app.ts is loaded by index.ts with a dynamic import, so it becomes a chunk of its own: it must stay next
    // to index.js (not in chunks/), because it finds the preload, the renderer and the resources from __dirname
    build: { externalizeDeps: true, rollupOptions: { input: { index: resolve('src/main/index.ts') }, output: { chunkFileNames: '[name]-[hash].js' } } },
    resolve: { alias },
  },
  preload: {
    build: { externalizeDeps: true, rollupOptions: { input: { index: resolve('src/preload/index.ts') } } },
    resolve: { alias },
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias },
    plugins: [react()],
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } },
    server: { port: 5199, strictPort: false },
  },
});
