import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {remoteConfig} from './cli.mjs';
import {cloudflareClient} from './cloudflare-d1.mjs';
import {staffPlatformRepository} from '../src/db/staff-platform.js';
import {composeStaffPlatform} from '../src/app/compose.js';
import {staffPlatformService} from '../src/services/staff-platform.js';

export async function runRosterAutomation(db) {
  const repository=staffPlatformRepository(db),platform=composeStaffPlatform({repository});
  return staffPlatformService({repository,platform,manifests:platform.manifests}).processRosterAutomation();
}
export async function main(args=process.argv.slice(2)) {
  if(args.some(arg=>!['--staff-staging','--preview','--apply'].includes(arg))||args.includes('--staff-staging')&&args.includes('--preview'))throw new Error('Use --apply with optional --staff-staging or --preview');
  const config=await remoteConfig({staffStaging:args.includes('--staff-staging')}),bindings=args.includes('--preview')?config.env.preview:config;
  if(!args.includes('--apply'))throw new Error('Explicit --apply required');
  const client=cloudflareClient(process.env.CLOUDFLARE_ACCOUNT_ID,process.env.CLOUDFLARE_API_TOKEN);
  const result=await runRosterAutomation(client.database(bindings.d1_databases.find(item=>item.binding==='DB').database_id));
  console.log(JSON.stringify(result));
  if(result.errors.length)process.exitCode=1;
  return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
