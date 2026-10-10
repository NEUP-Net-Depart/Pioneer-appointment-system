import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../src/lib/passwords.js';
import { dateKey } from '../shared/time.js';
import { localVars, root, wrangler, remoteConfig } from './cli.mjs';
import {remoteOptions,requireRemoteApproval} from './release-guard.mjs';
import {releasePlan,assertCleanRelease} from './release-plan.mjs';

export async function seed({ remote = false, preview = false,execute=false,approval } = {}) {
  if (remote){
    requireRemoteApproval({preview,execute,approval});
    const plan=await releasePlan('initialize-protected-roots',{preview});
    console.log(JSON.stringify({...plan,mode:execute ? 'approved-execution' : 'plan-only'},null,2));
    if(!execute)return;
    assertCleanRelease(plan);await remoteConfig();
  }
  const vars = remote ? process.env : await localVars();
  const rows = ['root001','root002'].map((account, index) => {
    const password = vars[`${account.toUpperCase()}_PASSWORD`];
    if (typeof password !== 'string' || password.length < 16 || password.length > 128 || password.startsWith('replace-')) throw new Error(`${account.toUpperCase()}_PASSWORD must contain 16–128 characters.`);
    return `('${account}','系统负责人 ${index + 1}','superadmin','南湖','enabled',1,'${hashPassword(password)}','${dateKey()}')`;
  });
  // No public bootstrap endpoint. Re-running never resets existing root credentials.
  const dir = resolve(root, '.wrangler');
  const path = join(dir, `seed-${randomUUID()}.sql`);
  await mkdir(dir, { recursive: true });
  await writeFile(path, `INSERT INTO staff_accounts(account,name,role,home_campus,status,protected,password_hash,created_at) VALUES ${rows.join(',')} ON CONFLICT(account) DO NOTHING; INSERT OR IGNORE INTO staff_campus_grants(account,campus) SELECT account,'南湖' FROM staff_accounts WHERE protected=1; INSERT OR IGNORE INTO staff_campus_grants(account,campus) SELECT account,'浑南' FROM staff_accounts WHERE protected=1;`, { mode: 0o600 });
  try { wrangler(['d1','execute','DB', remote ? '--remote' : '--local', ...(preview ? ['--env','preview'] : []), '--file', path]); }
  finally { await rm(path, { force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const remote=process.argv.includes('--remote');
  const options=remoteOptions(process.argv.slice(2).filter(arg=>arg!=='--remote'));
  if(!remote && (options.execute || options.approval))throw new Error('Local seeding does not accept remote approval flags.');
  await seed({remote,...options});
}
