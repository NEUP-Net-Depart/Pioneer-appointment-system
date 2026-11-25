import {wrangler} from './cli.ts';

interface PagesPublishPlan {
  project: string;
  branch: string;
  commit: string;
  directory?: string;
  cwd?: string;
}

export type WranglerRunner = (args: string[], options?: { cwd?: string; capture?: boolean }) => unknown;

export async function publishPages(plan: PagesPublishPlan,run: WranglerRunner=wrangler){
  const args=['pages','deploy',plan.directory || 'dist','--project-name',plan.project,'--branch',plan.branch,'--commit-hash',plan.commit];
  return plan.cwd ? run(args,{cwd:plan.cwd}) : run(args);
}
