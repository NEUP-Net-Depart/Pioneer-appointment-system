import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = resolve(root, 'dist');
if (out !== join(root, 'dist')) throw new Error('Unsafe output directory');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const type of ['reader','writer']) {
  await build({ stdin: { contents: `export * from 'zxing-wasm/${type}';`, resolveDir: root }, bundle: true, format: 'esm', platform: 'browser', minify: true, outfile: join(out, 'vendor', `zxing-${type}.js`) });
  await cp(join(root, `node_modules/zxing-wasm/dist/${type}/zxing_${type}.wasm`), join(out, 'vendor', `zxing_${type}.wasm`));
}
await cp(join(root, 'node_modules/zxing-wasm/LICENSE'), join(out, 'vendor', 'zxing-LICENSE'));
await cp(join(root, 'public'), out, { recursive: true });
await cp(join(root, 'shared'), join(out, 'shared'), { recursive: true });
await cp(join(root, 'frontend/assets'), join(out, 'assets'), { recursive: true });
await cp(join(root, 'frontend/staff'), join(out, 'staff'), { recursive: true });
await mkdir(join(out, 'user'));
for (const name of await readdir(join(root, 'frontend/user'))) {
  if (!(await stat(join(root, 'frontend/user', name))).isFile()) continue;
  await cp(join(root, 'frontend/user', name), join(out, name === 'index.html' ? name : `user/${name}`));
}
console.log('Built dist/: / and /staff/ with shared modules; Functions remain outside public assets.');
