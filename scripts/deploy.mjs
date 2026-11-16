import {publishPages} from './pages-deploy.mjs';
import {remoteOptions} from './release-guard.mjs';
import {releasePlan,assertCleanRelease} from './release-plan.mjs';
import {config} from './cli.mjs';
import {warrantyDeployment,prepareWarrantyDeployment,publishWarrantyVerifier} from './warranty-deploy.mjs';
const options=remoteOptions(process.argv.slice(2));
const plan=await releasePlan('publish-pages',options);
const warranty=warrantyDeployment(plan);
console.log(JSON.stringify({...plan,warranty,mode:options.execute ? 'approved-execution' : 'plan-only'},null,2));
if(options.execute){
  assertCleanRelease(plan);
  process.env.TELEMETRY_ENVIRONMENT=plan.environment;
  process.env.TELEMETRY_RELEASE=plan.commit;
  const prepared=await prepareWarrantyDeployment(plan,await config(),warranty);
  try{
    process.env.WARRANTY_CAPTCHA_ORIGIN=warranty.origin;
    await import('./build.mjs');
    // Publish the separate static origin before enabling it in the workbench.
    await publishWarrantyVerifier(prepared);
    await publishPages(prepared.workbench);
  }finally{await prepared.cleanup();}
  console.log(`Pages ${plan.environment}: ${plan.siteUrl}`);
}
