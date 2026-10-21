import {spawnSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {config,root} from './cli.mjs';
import {pagesSiteUrl,previewBranch} from './release-plan.mjs';

export function ciReleaseTarget(env){
  if(env.GITHUB_ACTIONS!=='true')throw new Error('CI releases must run in GitHub Actions.');
  if(!env.GITHUB_REF?.startsWith('refs/heads/') || env.GITHUB_EVENT_DELETED==='true')throw new Error('Only live repository branches may release.');
  if(env.GITHUB_EVENT_NAME==='push' && env.GITHUB_REF==='refs/heads/main')return 'production';
  if(['push','workflow_dispatch'].includes(env.GITHUB_EVENT_NAME) && env.GITHUB_REF!=='refs/heads/main'){
    previewBranch(env);
    return 'preview';
  }
  throw new Error('Only branch pushes or manual runs on non-main branches may release.');
}
export function ciReleasePlan(env,cfg){
  const target=ciReleaseTarget(env),branch=env.GITHUB_REF.slice('refs/heads/'.length);
  if(target==='production' && !env.SITE_URL)throw new Error('Configure SITE_URL before releasing.');
  const url=new URL(target==='production' ? env.SITE_URL : pagesSiteUrl(cfg.name,branch));
  if(url.protocol!=='https:' || url.username || url.password || url.pathname!=='/' || url.search || url.hash)throw new Error('SITE_URL must be the HTTPS site origin.');
  return {target,branch,url:url.origin};
}
function credentials(env){
  for(const key of ['CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_API_TOKEN'])if(!env[key])throw new Error(`Configure ${key} before releasing.`);
}
const execute=(env)=>(script,args)=>spawnSync(process.execPath,[resolve(root,'scripts',script),...args],{cwd:root,env,stdio:'inherit'});
function step(run,script,args,target){
  console.log(`CI ${target}: ${script}`);
  const result=run(script,args);
  if(result.error || result.status!==0)throw result.error || new Error(`${script} failed (${result.status}); release stopped.`);
}
export function runCiPreviewMigration(env=process.env,run=execute(env)){
  if(ciReleaseTarget(env)!=='preview' || previewBranch(env)!=='dev')throw new Error('Only dev may automatically migrate the shared Preview database.');
  credentials(env);
  step(run,'migrate-remote.mjs',['--preview','--execute','--approve-preview'],'preview');
}
export async function runCiRelease(env=process.env,run=execute(env)){
  const plan=ciReleasePlan(env,await config());
  credentials(env);
  if(plan.branch==='dev' && env.PREVIEW_MIGRATIONS_APPLIED!=='true')throw new Error('The dev Preview migration job must succeed before publishing.');
  const args=[...(plan.target==='preview' ? ['--preview'] : []),'--execute',`--approve-${plan.target}`];
  if(plan.target==='production')step(run,'migrate-remote.mjs',args,plan.target);
  step(run,'deploy.mjs',args,plan.target);
  step(run,'smoke.mjs',[plan.url],plan.target);
  if(env.GITHUB_OUTPUT)appendFileSync(env.GITHUB_OUTPUT,`url=${plan.url}\n`);
  console.log(`Published ${plan.branch}: ${plan.url}`);
  return plan;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  if(args.length===1 && args[0]==='--migrate-preview')runCiPreviewMigration();
  else if(!args.length)await runCiRelease();
  else{
    throw new Error('Use ci-release.mjs or --migrate-preview.');
  }
}
