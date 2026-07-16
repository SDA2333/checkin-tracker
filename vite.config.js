import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  root: resolve('frontend'),
  publicDir: false,
  plugins: [vue()],
  base: '/ui/',
  build: {
    outDir: resolve('public/ui'),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: resolve('frontend/main.js'),
      output: {
        entryFileNames: 'island-ui.js',
        chunkFileNames: '[name]-[hash].js',
        assetFileNames: (assetInfo) => assetInfo.name?.endsWith('.css')
          ? 'island-ui.css'
          : '[name]-[hash][extname]',
      },
    },
  },
});
