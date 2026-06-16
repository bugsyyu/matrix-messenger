import { defineConfig } from 'vite';
import path from 'node:path';

const root = path.resolve(import.meta.dirname);
const repoRoot = path.resolve(root, '..');

export default defineConfig({
  root,
  publicDir: path.resolve(repoRoot, 'public'),
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/ws': { target: 'ws://localhost:3005', ws: true, changeOrigin: true },
      '/ontology': { target: 'http://localhost:3005', changeOrigin: true },
      '/agent-sdk.js': { target: 'http://localhost:3005', changeOrigin: true },
    },
  },
  preview: { port: 5174, host: '0.0.0.0' },
  build: {
    outDir: path.resolve(repoRoot, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
  },
  resolve: { alias: { '@': path.resolve(root, 'src') } },
});
