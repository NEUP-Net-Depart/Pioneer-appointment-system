import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {validateRemoteConfig,remoteOptions} from '../scripts/release-guard.mjs';
import {assertCleanRelease} from '../scripts/release-plan.mjs';
import {ciReleaseTarget,runCiRelease} from '../scripts/ci-release.mjs';

const bindings=(id,bucket)=>({d1_databases:[{binding:'DB',database_name:bucket,database_id:id}],r2_buckets:[{binding:'ATTACHMENTS',bucket_name:bucket}]});
const cfg=()=>({name:'existing-pages',...bindings('11111111-1111-4111-8111-111111111111','production-private'),env:{preview:bindings('22222222-2222-4222-8222-222222222222','preview-private')}});

const ciEnv=(event,branch)=>({GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:event,GITHUB_REF:`refs/heads/${branch}`,CLOUDFLARE_ACCOUNT_ID:'test-account',CLOUDFLARE_API_TOKEN:'test-token',SITE_URL:'https://example.test'});
test('CI releases restrict production to main pushes and preview to manual dev runs',()=>{
  assert.equal(ciReleaseTarget(ciEnv('push','main')),'production');
  assert.equal(ciReleaseTarget(ciEnv('workflow_dispatch','dev')),'preview');
  for(const [event,branch] of [['push','dev'],['workflow_dispatch','main'],['workflow_dispatch','feature'],['pull_request','main']])assert.throws(()=>ciReleaseTarget(ciEnv(event,branch)));
  assert.throws(()=>ciReleaseTarget({...ciEnv('push','main'),GITHUB_ACTIONS:'false'}));
});
test('CI uses matching target flags and migrates before publishing and smoke testing',()=>{
  for(const [event,branch,target] of [['push','main','production'],['workflow_dispatch','dev','preview']]){
    const calls=[];
    runCiRelease(ciEnv(event,branch),(script,args)=>{calls.push([script,args]);return {status:0};});
    const args=[...(target==='preview' ? ['--preview'] : []),'--execute',`--approve-${target}`];
    assert.deepEqual(calls,[['migrate-remote.mjs',args],['deploy.mjs',args],['smoke.mjs',['https://example.test']]]);
  }
});
test('CI stops on failed migrations or publication and rejects missing credentials before execution',()=>{
  for(const failure of ['migrate-remote.mjs','deploy.mjs']){
    const calls=[];
    assert.throws(()=>runCiRelease(ciEnv('push','main'),script=>{calls.push(script);return {status:script===failure ? 1 : 0};}),/release stopped/);
    assert.deepEqual(calls,failure==='migrate-remote.mjs' ? [failure] : ['migrate-remote.mjs',failure]);
  }
  for(const key of ['CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_API_TOKEN','SITE_URL']){
    assert.throws(()=>runCiRelease({...ciEnv('push','main'),[key]:''},()=>assert.fail('Unexpected release execution')),new RegExp(key));
  }
});
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
  const migrations=readdirSync('migrations').filter(file=>file.endsWith('.sql')).sort();
  for(const [script,args] of [['deploy.mjs',[]],['deploy.mjs',['--preview']],['migrate-remote.mjs',[]],['seed.mjs',['--remote']]]){
    const output=execFileSync(process.execPath,['scripts/'+script,...args],{env,encoding:'utf8'}),plan=JSON.parse(output);
    assert.equal(plan.mode,'plan-only');assert.equal(plan.project,'pioneer-appointment-system');
    assert.deepEqual(plan.migrations.map(item=>item.file),migrations);
    for(const migration of plan.migrations)assert.match(migration.sha256,/^[a-f\d]{64}$/);
    assert.deepEqual(plan.requiredSecrets,['JWT_SECRET','PII_ENCRYPTION_KEY']);assert.equal(plan.environment,args.includes('--preview') ? 'preview' : 'production');
    assert.equal(plan.branch,args.includes('--preview') ? 'dev' : 'main');
    const denied=spawnSync(process.execPath,['scripts/'+script,...args,'--execute'],{env,encoding:'utf8'});
    assert.equal(denied.status,1);assert.match(denied.stderr,/requires --execute --approve-/);
  }
});
