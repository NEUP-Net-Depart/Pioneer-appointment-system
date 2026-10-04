import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../src/lib/passwords.js';
import { dateKey } from '../shared/time.js';
import { localVars, root, wrangler, remoteConfig } from './cli.mjs';

export async function seed({ remote = false, preview = false } = {}) {
  if (remote) await remoteConfig(preview);
  const vars = remote ? process.env : await localVars();
  const rows = ['root001','root002'].map((account, index) => {
    const password = vars[`${account.toUpperCase()}_PASSWORD`];
    if (typeof password !== 'string' || password.length < 16 || password.length > 128 || password.startsWith('replace-')) throw new Error(`${account.toUpperCase()}_PASSWORD must contain 16–128 characters.`);
    return `('${account}','系统负责人 ${index + 1}','superadmin','南湖 / 浑南',1,1,'${hashPassword(password)}','${dateKey()}')`;
  });
  // No public bootstrap endpoint. Re-running never resets existing root credentials.
  const dir = resolve(root, '.wrangler');
  const path = join(dir, `seed-${randomUUID()}.sql`);
  await mkdir(dir, { recursive: true });
  await writeFile(path, `INSERT INTO users(account,name,role,campus,active,protected,password_hash,created_at) VALUES ${rows.join(',')} ON CONFLICT(account) DO NOTHING;`, { mode: 0o600 });
  try { wrangler(['d1','execute','DB', remote ? '--remote' : '--local', ...(preview ? ['--env','preview'] : []), '--file', path]); }
  finally { await rm(path, { force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await seed({ remote: process.argv.includes('--remote'), preview: process.argv.includes('--preview') });
}
