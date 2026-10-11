import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {root} from './cli.mjs';

export function ciReleaseTarget(env){
  if(env.GITHUB_ACTIONS!=='true')throw new Error('CI releases must run in GitHub Actions.');
  if(env.GITHUB_EVENT_NAME==='push' && env.GITHUB_REF==='refs/heads/main')return 'production';
  if(env.GITHUB_EVENT_NAME==='workflow_dispatch' && env.GITHUB_REF==='refs/heads/dev')return 'preview';
  throw new Error('Only pushes to main or manual runs on dev may release.');
}
export function runCiRelease(env=process.env,run=(script,args)=>spawnSync(process.execPath,[resolve(root,'scripts',script),...args],{cwd:root,env,stdio:'inherit'})){
  const target=ciReleaseTarget(env);
  for(const key of ['CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_API_TOKEN','SITE_URL'])if(!env[key])throw new Error(`Configure ${key} before releasing.`);
  const url=new URL(env.SITE_URL);
  if(url.protocol!=='https:' || url.username || url.password || url.pathname!=='/' || url.search || url.hash)throw new Error('SITE_URL must be the HTTPS site origin.');
  const args=[...(target==='preview' ? ['--preview'] : []),'--execute',`--approve-${target}`];
  for(const [script,parameters] of [['migrate-remote.mjs',args],['deploy.mjs',args],['smoke.mjs',[url.origin]]]){
    console.log(`CI ${target}: ${script}`);
    const result=run(script,parameters);
    if(result.error || result.status!==0)throw result.error || new Error(`${script} failed (${result.status}); release stopped.`);
  }
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))runCiRelease();
