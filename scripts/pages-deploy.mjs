import {cp,mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {root,remoteConfig,wrangler} from './cli.mjs';
import {STAFF_BRANCH,STAFF_PROJECT} from './release-guard.mjs';

export async function publishPages(plan,run=wrangler){
  const args=['pages','deploy','dist','--project-name',plan.project,'--branch',plan.branch,'--commit-hash',plan.commit];
  if(plan.environment!=='staff-staging')return run(args);
  if(plan.project!==STAFF_PROJECT || plan.branch!==STAFF_BRANCH)throw new Error('Staff Pages deployment must target its dedicated project and branch.');
  // Pages rejects --config. Load the dedicated source as a standard filename in
  // an isolated package root; never replace the existing main/dev config.
  const cfg=await remoteConfig({staffStaging:true});
  const parent=resolve(root,'.wrangler');
  await mkdir(parent,{recursive:true});
  const dir=await mkdtemp(resolve(parent,'staff-pages-')),inside=relative(parent,dir);
  if(!inside || inside.startsWith('..') || isAbsolute(inside))throw new Error('Unsafe Staff Pages deployment directory');
  try{
    await writeFile(resolve(dir,'package.json'),JSON.stringify({private:true,type:'module'}));
    await writeFile(resolve(dir,'wrangler.jsonc'),JSON.stringify(cfg));
    for(const area of ['dist','functions','src','shared'])await cp(resolve(root,area),resolve(dir,area),{recursive:true});
    return await run(args,{cwd:dir});
  }finally{await rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
}
