import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(projectRoot, '..');
const basePath = process.env.TUTORIAL_BASE_PATH || '/';
if (!basePath.startsWith('/') || !basePath.endsWith('/'))
  throw new Error('TUTORIAL_BASE_PATH must start and end with /.');
const replacements = {
  'shared/api.js': 'src/simulation/api.js',
  'shared/zxing.js': 'src/simulation/zxing.js',
  'shared/telemetry-client.js': 'src/simulation/telemetry.js',
  'frontend/staff-react/web-update.js': 'src/simulation/empty.js',
  'frontend/staff-react/field/serial-ocr.js': 'src/simulation/ocr.js'
};
const assets = {
  '/assets/organization-logo.jpg': resolve(repositoryRoot, 'frontend/assets/organization-logo.jpg'),
  '/assets/volunteer-register-template.xlsx': resolve(
    repositoryRoot,
    'frontend/assets/volunteer-register-template.xlsx'
  ),
  '/assets/vendor/load-image.all.min.js': resolve(
    projectRoot,
    'node_modules/blueimp-load-image/js/load-image.all.min.js'
  )
};

export default defineConfig({
  root: projectRoot,
  base: basePath,
  plugins: [
    {
      name: 'tutorial-only-adapters',
      enforce: 'pre',
      transform(code, id) {
        if (
          !id
            .replaceAll('\\', '/')
            .startsWith(`${repositoryRoot.replaceAll('\\', '/')}/frontend/staff-react/`)
        )
          return;
        return code
          .replaceAll('/assets/', `${basePath}assets/`)
          .replaceAll('/staff/', `${basePath}staff/`);
      },
      transformIndexHtml: {
        order: 'pre',
        handler(html) {
          return html.replace('src="/assets/vendor/', `src="${basePath}assets/vendor/`);
        }
      },
      resolveId(source, importer) {
        if (!importer) return;
        const absolute = source.startsWith('/shared/')
          ? resolve(repositoryRoot, source.slice(1))
          : source.startsWith('.')
            ? resolve(dirname(importer), source)
            : source;
        for (const [original, replacement] of Object.entries(replacements)) {
          if (
            absolute.replaceAll('\\', '/') ===
            resolve(repositoryRoot, original).replaceAll('\\', '/')
          )
            return resolve(projectRoot, replacement).replaceAll('\\', '/');
        }
      },
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const filename = request.url?.split('?')[0];
          if (!assets[filename]) return next();
          response.setHeader(
            'Content-Type',
            filename.endsWith('jpg')
              ? 'image/jpeg'
              : filename.endsWith('js')
                ? 'application/javascript'
                : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          );
          response.end(readFileSync(assets[filename]));
        });
      },
      generateBundle() {
        for (const [filename, source] of Object.entries(assets))
          this.emitFile({
            type: 'asset',
            fileName: filename.slice(1),
            source: readFileSync(source)
          });
      }
    }
  ],
  define: { __WARRANTY_CAPTCHA_ORIGIN__: JSON.stringify('') },
  resolve: {
    dedupe: ['react', 'react-dom', '@tanstack/react-query'],
    alias: [
      { find: '/vendor/signature-pad.js', replacement: 'signature_pad' },
      { find: /^\/shared\//, replacement: resolve(repositoryRoot, 'shared') + '/' }
    ]
  },
  server: { fs: { allow: [repositoryRoot] } },
  build: {
    outDir: 'dist',
    target: 'es2022',
    rollupOptions: {
      input: {
        academy: resolve(projectRoot, 'index.html'),
        simulator: resolve(projectRoot, 'staff/index.html')
      }
    }
  }
});
