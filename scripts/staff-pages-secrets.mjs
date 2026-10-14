import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {remoteConfig} from './cli.mjs';
import {STAFF_BRANCH} from './release-guard.mjs';

// Credentials travel only in HTTPS request bodies, never CLI arguments or logs.
export async function configureStaffSecrets(env=process.env,fetchImpl=fetch){
  if(env.GITHUB_ACTIONS==='true' && env.GITHUB_REF!==`refs/heads/${STAFF_BRANCH}`)throw new Error('Only the Staff Staging branch may configure its Pages secrets.');
  const cfg=await remoteConfig({staffStaging:true});
  if(!/^[a-f\d]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID || '') || !env.CLOUDFLARE_API_TOKEN)throw new Error('Configure Cloudflare account and Pages token.');
  if((env.JWT_SECRET || '').length<32 || !/^[a-f\d]{64}$/i.test(env.PII_ENCRYPTION_KEY || '') || env.JWT_SECRET===env.PII_ENCRYPTION_KEY)throw new Error('Configure independent JWT_SECRET and PII_ENCRYPTION_KEY.');
  if(env.MAX_R2_BYTES!==cfg.vars.MAX_R2_BYTES)throw new Error('MAX_R2_BYTES must match wrangler.staff-staging.jsonc.');
  const url=`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${cfg.name}`;
  const headers={Authorization:`Bearer ${env.CLOUDFLARE_API_TOKEN}`,'Content-Type':'application/json'};
  const before=await fetchImpl(url,{headers,signal:AbortSignal.timeout(30000)});
  const current=await before.json();
  if(!before.ok || !current.success || current.result.production_branch!==STAFF_BRANCH || current.result.source)throw new Error('Staff Pages must be a dedicated Direct Upload project on next/staff-platform.');
  const response=await fetchImpl(url,{method:'PATCH',headers,signal:AbortSignal.timeout(30000),body:JSON.stringify({deployment_configs:{production:{env_vars:{JWT_SECRET:{type:'secret_text',value:env.JWT_SECRET},PII_ENCRYPTION_KEY:{type:'secret_text',value:env.PII_ENCRYPTION_KEY},MAX_R2_BYTES:{type:'plain_text',value:env.MAX_R2_BYTES}}}}})});
  const result=await response.json();
  if(!response.ok || !result.success)throw new Error(`Staff Pages secret configuration failed (${response.status}).`);
  console.log('Staff Pages secrets configured; values omitted.');
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))await configureStaffSecrets();
