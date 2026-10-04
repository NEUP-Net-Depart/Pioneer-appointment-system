import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { root, wrangler, config } from './cli.mjs';
async function check(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await check(path);
    else if (/\.(?:m?js)$/.test(entry.name)) {
      const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' });
      if (result.error || result.status !== 0) throw result.error || new Error(`Syntax check failed: ${path}`);
    }
  }
}
for (const dir of ['frontend','shared','src','functions','scripts','tests']) await check(join(root, dir));
const user = await readFile(join(root, 'frontend/user/index.html'), 'utf8');
const staff = await readFile(join(root, 'frontend/staff/index.html'), 'utf8');
if (user.includes('id="login-view"') || user.includes('id="staff-view"') || staff.includes('id="booking-form"') || staff.includes('id="lookup-form"')) throw new Error('Frontend boundaries violated');
const cfg = await config();
wrangler(['pages','functions','build','functions','--outdir','.wrangler/build','--compatibility-date',cfg.compatibility_date,'--compatibility-flags',...cfg.compatibility_flags]);
console.log('Syntax, frontend boundaries and Pages Functions build passed.');
