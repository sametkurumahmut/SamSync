import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

const alias = { '@shared': resolve('src/shared'), '@': resolve('src/renderer/src') };

export default defineConfig({
  main: {
    build: { externalizeDeps: true, rollupOptions: { input: { index: resolve('src/main/index.ts') } } },
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
