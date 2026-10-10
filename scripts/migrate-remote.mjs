import {wrangler} from './cli.mjs';
import {remoteOptions} from './release-guard.mjs';
import {releasePlan,assertCleanRelease} from './release-plan.mjs';
const options=remoteOptions(process.argv.slice(2));
const plan=await releasePlan('apply-initial-migration',options);
console.log(JSON.stringify({...plan,mode:options.execute ? 'approved-execution' : 'plan-only'},null,2));
if(options.execute){
  assertCleanRelease(plan);
  wrangler(['d1','migrations','apply','DB','--remote',...(options.preview ? ['--env','preview'] : [])]);
}
