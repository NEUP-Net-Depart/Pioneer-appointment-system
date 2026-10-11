import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {config,root} from './cli.mjs';
import {remoteOptions,validateRemoteConfig} from './release-guard.mjs';

function git(args){
  const result=spawnSync('git',args,{cwd:root,encoding:'utf8'});
  if(result.error || result.status!==0)throw result.error || new Error('Cannot inspect the release checkout.');
  return result.stdout.trim();
}
export function previewBranch(env=process.env){
  const branch=env.GITHUB_ACTIONS==='true' ? (env.GITHUB_REF?.startsWith('refs/heads/') ? env.GITHUB_REF.slice('refs/heads/'.length) : '') : git(['branch','--show-current']);
  if(!branch || branch==='main')throw new Error('Preview requires a non-main branch; detached checkouts need a GitHub branch ref.');
  git(['check-ref-format',`refs/heads/${branch}`]);
  return branch;
}
export function pagesSiteUrl(project,branch){
  if(!/^[a-z\d][a-z\d-]*$/.test(project))throw new Error('Configure a valid Pages project name.');
  if(branch==='main')return `https://${project}.pages.dev`;
  const alias=branch.toLowerCase().replace(/[^a-z\d]/g,'-');
  if(!alias || alias.length>63 || !/^[a-z\d].*[a-z\d]$|^[a-z\d]$/.test(alias))throw new Error('The branch must produce a valid Pages DNS alias of 1–63 characters.');
  return `https://${alias}.${project}.pages.dev`;
}
export async function releasePlan(operation,{preview=false,env=process.env}={}){
  const cfg=validateRemoteConfig(await config()),bindings=preview ? cfg.env.preview : cfg;
  const branch=preview ? previewBranch(env) : 'main',siteUrl=pagesSiteUrl(cfg.name,branch);
  const database=bindings.d1_databases.find(item=>item.binding==='DB'),bucket=bindings.r2_buckets.find(item=>item.binding==='ATTACHMENTS');
  const migrations=await Promise.all((await readdir(resolve(root,'migrations'))).filter(file=>file.endsWith('.sql')).sort().map(async file=>({file,sha256:createHash('sha256').update(await readFile(resolve(root,'migrations',file))).digest('hex')})));
  return {operation,mode:'plan-only',environment:preview ? 'preview' : 'production',project:cfg.name,branch,siteUrl,automaticMigrations:branch==='main' || branch==='dev',commit:git(['rev-parse','HEAD']),dirty:!!git(['status','--porcelain']),database:{binding:'DB',name:database.database_name,id:database.database_id},attachments:{binding:'ATTACHMENTS',bucket:bucket.bucket_name,public:false,maxBytes:bindings.vars.MAX_R2_BYTES},migrations,requiredSecrets:['JWT_SECRET','PII_ENCRYPTION_KEY'],requiredLocalRootPasswords:['ROOT001_PASSWORD','ROOT002_PASSWORD'],authorization:'Explicit human approval of the exact commit, resources and operation is required; flags alone do not grant approval.',runbook:'docs/operations.md'};
}
export function assertCleanRelease(plan){if(plan.dirty)throw new Error('Commit the reviewed release configuration before remote execution.');}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const options=remoteOptions(process.argv.slice(2));
  if(options.execute)throw new Error('release:plan never executes remote operations.');
  console.log(JSON.stringify(await releasePlan('rebuild-and-release',options),null,2));
}
