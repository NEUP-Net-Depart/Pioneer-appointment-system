import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { env } from 'node:process';
import { captchaBridgeOrigin } from './src/services/warranty/huawei.js';
export default defineConfig({
  root: fileURLToPath(new URL('./frontend/staff-react', import.meta.url)),
  base: '/staff/', publicDir: false,
  define: { 'process.env.NODE_ENV': JSON.stringify('production'), __WARRANTY_CAPTCHA_ORIGIN__: JSON.stringify(captchaBridgeOrigin(env.WARRANTY_CAPTCHA_ORIGIN)) },
  resolve: { alias: [{ find: /^\/shared\//, replacement: fileURLToPath(new URL('./shared/', import.meta.url)) }] },
  build: {
    outDir: fileURLToPath(new URL('./dist/staff', import.meta.url)),
    emptyOutDir: true, target: 'es2022', manifest: true, minify: 'esbuild',
    rolldownOptions: { external: [/^\/vendor\//] },
  },
});
