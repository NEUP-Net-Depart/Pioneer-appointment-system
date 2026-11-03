import {wrangler} from './cli.mjs';
import {remoteOptions} from './release-guard.mjs';
import {releasePlan,assertCleanRelease} from './release-plan.mjs';
import {verifyRemoteCutover} from './prepare-staff-cutover.mjs';
const options=remoteOptions(process.argv.slice(2));
const plan=await releasePlan('apply-d1-migrations',options);
console.log(JSON.stringify({...plan,mode:options.execute ? 'approved-execution' : 'plan-only'},null,2));
if(options.execute){
  assertCleanRelease(plan);
  console.log(JSON.stringify(await verifyRemoteCutover(options)));
  wrangler(['d1','migrations','apply','DB','--remote','--config',plan.wranglerConfig,...(options.preview ? ['--env','preview'] : [])]);
}
