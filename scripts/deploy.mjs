import {publishPages} from './pages-deploy.mjs';
import {remoteOptions} from './release-guard.mjs';
import {releasePlan,assertCleanRelease} from './release-plan.mjs';
const options=remoteOptions(process.argv.slice(2));
const plan=await releasePlan('publish-pages',options);
console.log(JSON.stringify({...plan,mode:options.execute ? 'approved-execution' : 'plan-only'},null,2));
if(options.execute){
  assertCleanRelease(plan);
  await import('./build.mjs');
  // Migration and root initialization are separate, reviewed operations.
  await publishPages(plan);
  console.log(`Pages ${plan.environment}: ${plan.siteUrl}`);
}
