import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {mkdtemp,readFile,writeFile,unlink,rmdir,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateRemoteConfig,validateStaffConfig,remoteOptions,STAFF_BRANCH} from '../scripts/release-guard.mjs';
import {assertCleanRelease,pagesSiteUrl,previewBranch,releasePlan} from '../scripts/release-plan.mjs';
import {ciReleaseTarget,ciReleasePlan,runCiRelease,runCiPreviewMigration,runCiStaffMigration} from '../scripts/ci-release.mjs';
import {config} from '../scripts/cli.mjs';
import {configureStaffSecrets} from '../scripts/staff-pages-secrets.mjs';
import {publishPages} from '../scripts/pages-deploy.mjs';

const bindings=(id,bucket)=>({d1_databases:[{binding:'DB',database_name:bucket,database_id:id}],r2_buckets:[{binding:'ATTACHMENTS',bucket_name:bucket}]});
const cfg=()=>({name:'existing-pages',...bindings('11111111-1111-4111-8111-111111111111','production-private'),env:{preview:bindings('22222222-2222-4222-8222-222222222222','preview-private')}});

const ciEnv=(event,branch)=>({GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:event,GITHUB_REF:`refs/heads/${branch}`,CLOUDFLARE_ACCOUNT_ID:'test-account',CLOUDFLARE_API_TOKEN:'test-token',SITE_URL:'https://example.test'});
test('CI releases all repository branches, with production restricted to main pushes',()=>{
  assert.equal(ciReleaseTarget(ciEnv('push','main')),'production');
  for(const branch of ['dev','feat/nfc-checkin','fix/booking-status','experiment/nested/change']){
    for(const event of ['push','workflow_dispatch'])assert.equal(ciReleaseTarget(ciEnv(event,branch)),'preview');
  }
  for(const [event,branch] of [['workflow_dispatch','main'],['pull_request','main'],['pull_request','feat/nfc-checkin'],['pull_request_target','dev']])assert.throws(()=>ciReleaseTarget(ciEnv(event,branch)));
  for(const ref of ['refs/tags/v1','refs/pull/1/merge','refs/heads/','refs/heads/feat/../main'])assert.throws(()=>ciReleaseTarget({...ciEnv('push','dev'),GITHUB_REF:ref}));
  assert.throws(()=>ciReleaseTarget({...ciEnv('push','main'),GITHUB_EVENT_DELETED:'true'}));
  assert.throws(()=>ciReleaseTarget({...ciEnv('push','main'),GITHUB_ACTIONS:'false'}));
});

test('Pages URLs use actual branch aliases and retain the production site origin',()=>{
  for(const [branch,alias] of [['dev','dev'],['feat/nfc-checkin','feat-nfc-checkin'],['fix/booking-status','fix-booking-status'],['Feat/NFC_checkin.v2','feat-nfc-checkin-v2']]){
    const expected=`https://${alias}.pioneer-appointment-system.pages.dev`;
    assert.equal(pagesSiteUrl('pioneer-appointment-system',branch),expected);
    assert.equal(ciReleasePlan({...ciEnv('push',branch),SITE_URL:'https://dev.example.test'}, {name:'pioneer-appointment-system'}).url,expected);
    assert.equal(ciReleasePlan({...ciEnv('push',branch),SITE_URL:''},{name:'pioneer-appointment-system'}).url,expected);
  }
  assert.equal(ciReleasePlan(ciEnv('push','main'),cfg()).url,'https://example.test');
  for(const url of ['http://example.test','https://user:pass@example.test','https://example.test/path','https://example.test/?branch=dev','https://example.test/#dev'])assert.throws(()=>ciReleasePlan({...ciEnv('push','main'),SITE_URL:url},cfg()),/HTTPS site origin/);
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

test('GitHub deployment links are emitted only after the branch smoke check succeeds',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'pioneer-release-output-')),output=join(dir,'github-output');
  await writeFile(output,'');
  try{
    const env={...ciEnv('push','feat/nfc-checkin'),GITHUB_OUTPUT:output};
    await runCiRelease(env,()=>({status:0}));
    assert.equal(await readFile(output,'utf8'),'url=https://feat-nfc-checkin.pioneer-appointment-system.pages.dev\n');
    await writeFile(output,'');
    await assert.rejects(()=>runCiRelease(env,script=>({status:script==='smoke.mjs' ? 1 : 0})),/release stopped/);
    assert.equal(await readFile(output,'utf8'),'');
  }finally{
    await unlink(output);
    await rmdir(dir);
  }
});

test('Preview release plans preserve real branch names while sharing D1 and private R2',async()=>{
  const plans=[];
  for(const branch of ['dev','feat/nfc-checkin','fix/booking-status']){
    const env=ciEnv('push',branch),plan=await releasePlan('publish-pages',{preview:true,env});
    assert.equal(previewBranch(env),branch);
    assert.equal(plan.branch,branch);
    assert.equal(plan.siteUrl,pagesSiteUrl(plan.project,branch));
    assert.equal(plan.automaticMigrations,branch==='dev');
    assert.equal(plan.database.name,'pioneer-appointments-preview-v2');
    assert.equal(plan.attachments.bucket,'pioneer-attachments-preview-v2');
    plans.push(plan);
  }
  for(const plan of plans.slice(1)){
    assert.deepEqual(plan.database,plans[0].database);
    assert.deepEqual(plan.attachments,plans[0].attachments);
  }
  assert.throws(()=>previewBranch(ciEnv('push','main')));
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
  const env={...process.env,GITHUB_ACTIONS:'true',GITHUB_REF:'refs/heads/feat/nfc-checkin',CLOUDFLARE_API_TOKEN:'',CLOUDFLARE_ACCOUNT_ID:'',BROWSER:'none'};
  const migrations=readdirSync('migrations').filter(file=>file.endsWith('.sql')).sort();
  for(const [script,args] of [['deploy.mjs',[]],['deploy.mjs',['--preview']],['migrate-remote.mjs',[]],['seed.mjs',['--remote']]]){
    const output=execFileSync(process.execPath,['scripts/'+script,...args],{env,encoding:'utf8'}),plan=JSON.parse(output);
    assert.equal(plan.mode,'plan-only');assert.equal(plan.project,'pioneer-appointment-system');
    assert.deepEqual(plan.migrations.map(item=>item.file),migrations);
    for(const migration of plan.migrations)assert.match(migration.sha256,/^[a-f\d]{64}$/);
    assert.deepEqual(plan.requiredSecrets,['JWT_SECRET','PII_ENCRYPTION_KEY']);assert.equal(plan.environment,args.includes('--preview') ? 'preview' : 'production');
    assert.equal(plan.branch,args.includes('--preview') ? 'feat/nfc-checkin' : 'main');
    assert.equal(plan.siteUrl,pagesSiteUrl(plan.project,plan.branch));
    const denied=spawnSync(process.execPath,['scripts/'+script,...args,'--execute'],{env,encoding:'utf8'});
    assert.equal(denied.status,1);assert.match(denied.stderr,/requires --execute --approve-/);
  }
});

test('Staff releases select a third project and reject feature, PR, tag and stale migration contexts',async()=>{
  const base=await config(),staff=await config({staffStaging:true});
  for(const event of ['push','workflow_dispatch']){
    const env={...ciEnv(event,STAFF_BRANCH),GITHUB_SHA:'reviewed-commit',STAFF_MIGRATIONS_COMMIT:'reviewed-commit'};
    assert.equal(ciReleaseTarget(env),'staff-staging');
    assert.deepEqual(ciReleasePlan(env,base,staff),{target:'staff-staging',branch:STAFF_BRANCH,url:'https://pioneer-staff-staging.pages.dev'});
    const calls=[];
    runCiStaffMigration(env,(script,args)=>{calls.push([script,args]);return {status:0};});
    await runCiRelease(env,(script,args)=>{calls.push([script,args]);return {status:0};});
    const args=['--staff-staging','--execute','--approve-staff-staging'];
    assert.deepEqual(calls,[['migrate-remote.mjs',args],['deploy.mjs',args],['smoke.mjs',['https://pioneer-staff-staging.pages.dev']]]);
    const plan=await releasePlan('publish-pages',{staffStaging:true,env});
    assert.equal(plan.wranglerConfig,'wrangler.staff-staging.jsonc');
    assert.equal(plan.database.name,'pioneer-appointments-staff-staging');
    assert.equal(plan.attachments.bucket,'pioneer-attachments-staff-staging');
    assert.equal(plan.siteUrl,'https://pioneer-staff-staging.pages.dev');
    assert.ok(plan.automaticMigrations);
  }
  for(const event of ['push','workflow_dispatch','pull_request'])assert.throws(()=>ciReleaseTarget(ciEnv(event,'feat/staff-permissions')));
  assert.throws(()=>ciReleaseTarget(ciEnv('pull_request',STAFF_BRANCH)));
  for(const branch of ['main','dev','feat/other'])assert.throws(()=>runCiStaffMigration(ciEnv('push',branch),()=>assert.fail('Unexpected Staff migration')));
  assert.throws(()=>runCiStaffMigration(ciEnv('push',STAFF_BRANCH),()=>({status:1})),/release stopped/);
  for(const stamp of [undefined,'previous-commit'])await assert.rejects(()=>runCiRelease({...ciEnv('push',STAFF_BRANCH),GITHUB_SHA:'new-commit',STAFF_MIGRATIONS_COMMIT:stamp},()=>assert.fail('Unexpected Staff release')),/same commit/);
  for(const branch of [STAFF_BRANCH,'feat/staff-permissions'])await assert.rejects(()=>releasePlan('publish-pages',{preview:true,env:ciEnv('push',branch)}),/shared Preview/);
  for(const failure of ['deploy.mjs','smoke.mjs']){
    const calls=[];
    await assert.rejects(()=>runCiRelease({...ciEnv('push',STAFF_BRANCH),GITHUB_SHA:'commit',STAFF_MIGRATIONS_COMMIT:'commit'},script=>{calls.push(script);return {status:script===failure ? 1 : 0};}),/release stopped/);
    assert.deepEqual(calls,failure==='deploy.mjs' ? [failure] : ['deploy.mjs',failure]);
  }
});

test('Staff config prevents reused resources, compatibility drift and mismatched approval',async()=>{
  const base=await config(),staff=await config({staffStaging:true});
  assert.equal(validateStaffConfig(base,staff),staff);
  for(const target of [base,base.env.preview]){
    for(const field of ['database_id','database_name']){
      const c=structuredClone(staff);c.d1_databases[0][field]=target.d1_databases[0][field];
      assert.throws(()=>validateStaffConfig(base,c));
    }
    const c=structuredClone(staff);c.r2_buckets[0].bucket_name=target.r2_buckets[0].bucket_name;
    assert.throws(()=>validateStaffConfig(base,c));
  }
  for(const change of [c=>c.name=base.name,c=>c.compatibility_flags=[],c=>c.compatibility_date='2020-01-01',c=>c.vars.MAX_R2_BYTES='0',c=>c.d1_databases[0].database_id='00000000-0000-4000-8000-000000000001',c=>c.d1_databases.push({...c.d1_databases[0]})]){
    const c=structuredClone(staff);change(c);assert.throws(()=>validateStaffConfig(base,c));
  }
  assert.ok(remoteOptions(['--staff-staging','--execute','--approve-staff-staging']).execute);
  for(const args of [['--staff-staging','--preview'],['--staff-staging','--execute','--approve-preview'],['--staff-staging','--execute','--approve-production']])assert.throws(()=>remoteOptions(args));
});

test('Staff secret injection targets only its Direct Upload project and never logs secret values',async()=>{
  const env={...ciEnv('push',STAFF_BRANCH),CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),JWT_SECRET:'j'.repeat(64),PII_ENCRYPTION_KEY:'b'.repeat(64),MAX_R2_BYTES:'536870912'};
  const calls=[];
  await configureStaffSecrets(env,async(url,options)=>{
    calls.push([url,options]);
    return {ok:true,json:async()=>({success:true,result:{production_branch:STAFF_BRANCH,source:null}})};
  });
  assert.equal(calls.length,2);
  assert.ok(calls.every(([url])=>url.endsWith('/pages/projects/pioneer-staff-staging')));
  const body=JSON.parse(calls[1][1].body);
  assert.deepEqual(Object.keys(body.deployment_configs),['production']);
  assert.equal(body.deployment_configs.production.env_vars.JWT_SECRET.type,'secret_text');
  assert.equal(body.deployment_configs.production.env_vars.PII_ENCRYPTION_KEY.value,env.PII_ENCRYPTION_KEY);
  for(const change of [{GITHUB_REF:'refs/heads/dev'},{JWT_SECRET:''},{PII_ENCRYPTION_KEY:''},{MAX_R2_BYTES:'8589934592'}])await assert.rejects(()=>configureStaffSecrets({...env,...change},()=>assert.fail('Unexpected request')));
  await assert.rejects(()=>configureStaffSecrets(env,async()=>({ok:true,json:async()=>({success:true,result:{production_branch:'main'}})})),/Direct Upload/);
});

test('Pages retains existing deployment args and uses a temporary standard config only for Staff',async()=>{
  const original=await readFile('wrangler.jsonc','utf8');
  for(const environment of ['production','preview']){
    const plan={environment,project:'pioneer-appointment-system',branch:environment==='production' ? 'main' : 'dev',commit:'reviewed-commit'};
    await publishPages(plan,(args,options)=>{
      assert.deepEqual(args,['pages','deploy','dist','--project-name',plan.project,'--branch',plan.branch,'--commit-hash',plan.commit]);
      assert.equal(options,undefined);
    });
  }
  const plan={environment:'staff-staging',project:'pioneer-staff-staging',branch:STAFF_BRANCH,commit:'reviewed-commit'};
  for(const fail of [false,true]){
    let directory;
    const operation=publishPages(plan,async(args,{cwd})=>{
      directory=cwd;
      assert.ok(!args.includes('--config'));
      assert.deepEqual(JSON.parse(await readFile(join(cwd,'wrangler.jsonc'),'utf8')),await config({staffStaging:true}));
      for(const file of ['package.json','dist/index.html','functions/api/[[path]].js','src/lib/env.js','shared/time.js'])await access(join(cwd,file));
      await assert.rejects(()=>access(join(cwd,'.dev.vars')));
      if(fail)throw new Error('Simulated Pages upload failure');
    });
    if(fail)await assert.rejects(()=>operation,/upload failure/);else await operation;
    await assert.rejects(()=>access(directory));
    assert.equal(await readFile('wrangler.jsonc','utf8'),original);
  }
  await assert.rejects(()=>publishPages({...plan,project:'pioneer-appointment-system'}),/dedicated project/);
});
