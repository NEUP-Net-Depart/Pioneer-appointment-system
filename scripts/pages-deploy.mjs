import {wrangler} from './cli.mjs';

export async function publishPages(plan,run=wrangler){
  const args=['pages','deploy','dist','--project-name',plan.project,'--branch',plan.branch,'--commit-hash',plan.commit];
  return run(args);
}
