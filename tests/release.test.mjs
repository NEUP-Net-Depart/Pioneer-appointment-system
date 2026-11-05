import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateRemoteConfig} from '../scripts/release-guard.mjs';
import {pagesSiteUrl} from '../scripts/release-plan.mjs';
import {ciReleaseTarget,runCiRelease as release,runCiPreviewMigration} from '../scripts/ci-release.mjs';
import {STAFF_RELEASE} from '../src/db/staff-readiness.js';

const bindings=(id,bucket)=>({d1_databases:[{binding:'DB',database_name:bucket,database_id:id}],r2_buckets:[{binding:'ATTACHMENTS',bucket_name:bucket}]});
const cfg=()=>({name:'existing-pages',...bindings('11111111-1111-4111-8111-111111111111','production-private'),env:{preview:bindings('22222222-2222-4222-8222-222222222222','preview-private')}});

const ciEnv=(event,branch)=>({GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:event,GITHUB_REF:`refs/heads/${branch}`,CLOUDFLARE_ACCOUNT_ID:'test-account',CLOUDFLARE_API_TOKEN:'test-token',SITE_URL:'https://example.test'});
const readyPreview=async()=>Response.json({ok:true,staffRelease:STAFF_RELEASE,workflow:'staff-platform'});
const runCiRelease=(env,run)=>release(env,run,readyPreview);

test('CI releases all repository branches, with production restricted to main pushes',()=>{
  assert.equal(ciReleaseTarget(ciEnv('push','main')),'production');
  for(const branch of ['dev','feat/nfc-checkin','fix/booking-status','experiment/nested/change','feat/staff-permissions']){
    for(const event of ['push','workflow_dispatch'])assert.equal(ciReleaseTarget(ciEnv(event,branch)),'preview');
  }
  for(const [event,branch] of [['workflow_dispatch','main'],['pull_request','main'],['pull_request','feat/nfc-checkin'],['pull_request_target','dev']])assert.throws(()=>ciReleaseTarget(ciEnv(event,branch)));
  for(const ref of ['refs/tags/v1','refs/pull/1/merge','refs/heads/','refs/heads/feat/../main'])assert.throws(()=>ciReleaseTarget({...ciEnv('push','dev'),GITHUB_REF:ref}));
  assert.throws(()=>ciReleaseTarget({...ciEnv('push','main'),GITHUB_EVENT_DELETED:'true'}));
  assert.throws(()=>ciReleaseTarget({...ciEnv('push','main'),GITHUB_ACTIONS:'false'}));
});

test('CI migrates production in place and publishes all previews after any dev migration job',async()=>{
  for(const [event,branch,target] of [['push','main','production'],['push','dev','preview'],['workflow_dispatch','dev','preview'],['push','feat/nfc-checkin','preview'],['workflow_dispatch','fix/booking-status','preview']]){
    const calls=[];
    const plan=await runCiRelease({...ciEnv(event,branch),PREVIEW_MIGRATIONS_APPLIED:branch==='dev' ? 'true' : 'false'},(script,args)=>{calls.push([script,args]);return {status:0};});
    const args=[...(target==='preview' ? ['--preview'] : []),'--execute',`--approve-${target}`];
    const url=target==='production' ? 'https://example.test' : pagesSiteUrl('pioneer-appointment-system',branch);
    assert.deepEqual(calls,[...(target==='production' ? [['migrate-remote.mjs',args]] : []),['deploy.mjs',args],['smoke.mjs',[url]]]);
    assert.equal(plan.url,url);
  }
});

test('only dev can run the shared Preview migration, and publishing dev requires its success',async()=>{
  for(const event of ['push','workflow_dispatch']){
    const calls=[];
    runCiPreviewMigration(ciEnv(event,'dev'),(script,args)=>{calls.push([script,args]);return {status:0};});
    assert.deepEqual(calls,[['migrate-remote.mjs',['--preview','--execute','--approve-preview']]]);
  }
  for(const branch of ['main','feat/nfc-checkin','fix/booking-status'])assert.throws(()=>runCiPreviewMigration(ciEnv('push',branch),()=>assert.fail('Unexpected migration')),/Only dev/);
  assert.throws(()=>runCiPreviewMigration(ciEnv('pull_request','dev'),()=>assert.fail('Unexpected migration')));
  assert.throws(()=>runCiPreviewMigration(ciEnv('push','dev'),()=>({status:1})),/release stopped/);
  await assert.rejects(()=>runCiRelease(ciEnv('push','dev'),()=>assert.fail('Unexpected publication')),/migration job must succeed/);
});

test('branch publication waits for the shared dev schema without migrating or publishing incompatible code',async()=>{
  for(const branch of ['fix/perm','feat/staff-permissions']){
    const calls=[],requests=[];
    const plan=await release({...ciEnv('push',branch),PREVIEW_MIGRATIONS_APPLIED:'false'},(script,args)=>{calls.push([script,args]);return {status:0};},async url=>{
      requests.push(url.href);
      return Response.json({ok:true,staffRelease:'staff-react-0031',workflow:'staff-platform'});
    });
    assert.equal(plan.skipped,true);
    assert.deepEqual(calls,[]);
    assert.deepEqual(requests,['https://dev.pioneer-appointment-system.pages.dev/api/health']);
  }
  for(const fetcher of [async()=>new Response('unavailable',{status:500}),async()=>Response.json({ok:true}),async()=>{throw new Error('network unavailable');}]){
    await assert.rejects(release(ciEnv('push','fix/perm'),()=>assert.fail('Unexpected publication'),fetcher));
  }
  for(const branch of ['dev','main'])await release({...ciEnv('push',branch),PREVIEW_MIGRATIONS_APPLIED:'true'},()=>({status:0}),()=>assert.fail('Do not use dev readiness to gate migrated releases'));
});

test('CI stops on failed migrations, publication or smoke and rejects missing credentials before execution',async()=>{
  for(const failure of ['migrate-remote.mjs','deploy.mjs']){
    const calls=[];
    await assert.rejects(()=>runCiRelease(ciEnv('push','main'),script=>{calls.push(script);return {status:script===failure ? 1 : 0};}),/release stopped/);
    assert.deepEqual(calls,failure==='migrate-remote.mjs' ? [failure] : ['migrate-remote.mjs',failure]);
  }
  for(const failure of ['deploy.mjs','smoke.mjs']){
    const calls=[];
    await assert.rejects(()=>runCiRelease(ciEnv('push','feat/nfc-checkin'),script=>{calls.push(script);return {status:script===failure ? 1 : 0};}),/release stopped/);
    assert.deepEqual(calls,failure==='deploy.mjs' ? [failure] : ['deploy.mjs',failure]);
  }
  for(const key of ['CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_API_TOKEN','SITE_URL']){
    await assert.rejects(()=>runCiRelease({...ciEnv('push','main'),[key]:''},()=>assert.fail('Unexpected release execution')),new RegExp(key));
  }
  for(const key of ['CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_API_TOKEN'])assert.throws(()=>runCiPreviewMigration({...ciEnv('push','dev'),[key]:''},()=>assert.fail('Unexpected migration')),new RegExp(key));
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
