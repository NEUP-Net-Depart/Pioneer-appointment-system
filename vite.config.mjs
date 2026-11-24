import { defineConfig } from 'vite';
import { webUpdateNotice } from '@plugin-web-update-notification/vite';
import { fileURLToPath, URL } from 'node:url';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { env } from 'node:process';
import { captchaBridgeOrigin } from './src/services/warranty/huawei.js';

const path = (name) => fileURLToPath(new URL(name, import.meta.url));

function studentStyles() {
  const source = readFileSync(path('./frontend/user/student.css'));
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 16);
  const fileName = 'app-assets/student-' + hash + '.css';
  return {
    name: 'student-styles',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName, source });
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        return context.path === '/index.html'
          ? html.replace('/user/student.css', '/' + fileName)
          : html;
      }
    }
  };
}

function staffUpdateNotice() {
  const plugin = webUpdateNotice({
    locale: 'zh_CN',
    checkImmediately: false,
    injectFileBase: '/staff/'
  });
  const generate = plugin.generateBundle;
  const transform = plugin.transformIndexHtml.handler;
  return {
    ...plugin,
    generateBundle(...args) {
      const context = this;
      return generate.call(
        {
          emitFile(asset) {
            return context.emitFile({ ...asset, fileName: 'staff/' + asset.fileName });
          }
        },
        ...args
      );
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        return context.path === '/staff/index.html' ? transform(html, context) : html;
      }
    }
  };
}

export default defineConfig({
  root: path('./frontend/'),
  base: '/',
  publicDir: false,
  plugins: [studentStyles(), staffUpdateNotice()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    __WARRANTY_CAPTCHA_ORIGIN__: JSON.stringify(captchaBridgeOrigin(env.WARRANTY_CAPTCHA_ORIGIN))
  },
  resolve: { alias: [{ find: /^\/shared\//, replacement: path('./shared/') }] },
  build: {
    outDir: path('./dist/'),
    emptyOutDir: false,
    assetsDir: 'app-assets',
    target: 'es2022',
    manifest: true,
    minify: 'esbuild',
    sourcemap: true,
    rolldownOptions: {
      input: { student: path('./frontend/index.html'), staff: path('./frontend/staff/index.html') },
      external: [/^\/vendor\//]
    }
  }
});
