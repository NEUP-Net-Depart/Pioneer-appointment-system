import {wrangler} from './cli.mjs';

export async function publishPages(plan,run=wrangler){
  const args=['pages','deploy',plan.directory || 'dist','--project-name',plan.project,'--branch',plan.branch,'--commit-hash',plan.commit];
  return plan.cwd ? run(args,{cwd:plan.cwd}) : run(args);
}
