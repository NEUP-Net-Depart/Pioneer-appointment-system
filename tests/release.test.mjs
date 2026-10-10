import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {validateRemoteConfig,remoteOptions} from '../scripts/release-guard.mjs';
import {assertCleanRelease} from '../scripts/release-plan.mjs';

const bindings=(id,bucket)=>({d1_databases:[{binding:'DB',database_name:bucket,database_id:id}],r2_buckets:[{binding:'ATTACHMENTS',bucket_name:bucket}]});
const cfg=()=>({name:'existing-pages',...bindings('11111111-1111-4111-8111-111111111111','production-private'),env:{preview:bindings('22222222-2222-4222-8222-222222222222','preview-private')}});
test('remote operations reject shared or incomplete resources for either target',()=>{
  assert.equal(validateRemoteConfig(cfg()).name,'existing-pages');
  for(const change of [
    c=>c.env.preview.d1_databases[0].database_id=c.d1_databases[0].database_id,
    c=>c.env.preview.r2_buckets[0].bucket_name=c.r2_buckets[0].bucket_name,
    c=>c.d1_databases[0].database_id='00000000-0000-4000-8000-000000000001',
    c=>delete c.env.preview,
    c=>c.env.preview.d1_databases.push({...c.env.preview.d1_databases[0]})
  ]){const config=cfg();change(config);assert.throws(()=>validateRemoteConfig(config));}
});
test('execution needs an explicit matching approval and a clean reviewed checkout',()=>{
  assert.equal(remoteOptions([]).execute,false);
  assert.equal(remoteOptions(['--preview']).preview,true);
  assert.equal(remoteOptions(['--execute','--approve-production']).execute,true);
  assert.equal(remoteOptions(['--preview','--execute','--approve-preview']).execute,true);
  for(const args of [['--execute'],['--preview','--execute','--approve-production'],['--approve-production'],['--execute','--approve-preview','--approve-production'],['--production'],['--preview','--preview']])assert.throws(()=>remoteOptions(args));
  assert.throws(()=>assertCleanRelease({dirty:true}));assertCleanRelease({dirty:false});
});
test('deploy, migration and remote seed default to local plans without credentials or remote writes',()=>{
  const env={...process.env,CLOUDFLARE_API_TOKEN:'',CLOUDFLARE_ACCOUNT_ID:'',BROWSER:'none'};
  for(const [script,args] of [['deploy.mjs',[]],['deploy.mjs',['--preview']],['migrate-remote.mjs',[]],['seed.mjs',['--remote']]]){
    const output=execFileSync(process.execPath,['scripts/'+script,...args],{env,encoding:'utf8'}),plan=JSON.parse(output);
    assert.equal(plan.mode,'plan-only');assert.equal(plan.project,'pioneer-appointment-system');assert.equal(plan.migrations.length,1);assert.match(plan.migrations[0].sha256,/^[a-f\d]{64}$/);
    assert.deepEqual(plan.requiredSecrets,['JWT_SECRET','PII_ENCRYPTION_KEY']);assert.equal(plan.environment,args.includes('--preview') ? 'preview' : 'production');
    assert.equal(plan.branch,args.includes('--preview') ? 'dev' : 'main');
    const denied=spawnSync(process.execPath,['scripts/'+script,...args,'--execute'],{env,encoding:'utf8'});
    assert.equal(denied.status,1);assert.match(denied.stderr,/requires --execute --approve-/);
  }
});
