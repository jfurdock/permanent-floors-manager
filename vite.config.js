import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build` -> dist/ (served by the Node server)
// `npm run build:demo` -> dist-demo/index.html (one self-contained file that runs entirely in the browser)
// `npm run build:pages` -> docs/ (the browser version, for free hosting on GitHub Pages)
export default defineConfig(({ mode }) => {
  const demo = mode === 'demo' || mode === 'pages';
  return {
    root: 'web',
    base: './',
    plugins: [react(), ...(demo ? [viteSingleFile()] : [])],
    define: { __DEMO__: JSON.stringify(demo) },
    resolve: { alias: { '@core': new URL('./core', import.meta.url).pathname } },
    build: {
      outDir: mode === 'pages' ? '../docs' : demo ? '../dist-demo' : '../dist',
      emptyOutDir: true,
      chunkSizeWarningLimit: 4000,
      assetsInlineLimit: demo ? 100000000 : 4096,
    },
    server: {
      port: 5173,
      host: true,
      proxy: { '/api': 'http://localhost:3000' },
      fs: { allow: ['..'] },
    },
  };
});
