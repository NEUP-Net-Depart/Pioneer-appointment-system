import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('./frontend/staff-react', import.meta.url)),
  base: '/staff/', publicDir: false,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  resolve: { alias: [{ find: /^\/shared\//, replacement: fileURLToPath(new URL('./shared/', import.meta.url)) }] },
  build: {
    outDir: fileURLToPath(new URL('./dist/staff', import.meta.url)),
    emptyOutDir: true, target: 'es2022', manifest: true, minify: false,
    rolldownOptions: { external: [/^\/vendor\//] },
  },
});
