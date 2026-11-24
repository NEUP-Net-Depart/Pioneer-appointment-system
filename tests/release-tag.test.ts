import { present } from './helpers/present.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createReleaseTag,releaseTagName} from '../scripts/release-tag.ts';
import {runCiRelease} from '../scripts/ci-release.ts';

const sha='a'.repeat(40),other='b'.repeat(40);
const env=()=>({GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/main',GITHUB_SHA:sha,DEPLOYED_SHA:sha,PRODUCTION_RESULT:'success',GITHUB_REPOSITORY:'org/repo',GITHUB_RUN_ID:'15',GH_TOKEN:'test'});
function api({target,lightweight=false,race=false}: { target?: string; lightweight?: boolean; race?: boolean }={}){
  const calls: { path: string; method?: string; body?: { object?: string; type?: string; tag?: string; ref?: string; sha?: string } }[]=[];
  let tagged=!!target;
  const fetcher: typeof fetch = async(url,options)=>{
    const path=new URL(url instanceof Request ? url.url : url).pathname.replace('/repos/org/repo/','');
    calls.push({path,method:options?.method,body:options?.body ? JSON.parse(String(options.body)) : undefined});
    if(path===`git/commits/${sha}`)return Response.json({committer:{date:'2026-11-15T16:00:00Z'}});
    if(path.startsWith('git/ref/tags/'))return tagged ? Response.json({object:{type:lightweight ? 'commit' : 'tag',sha:lightweight ? target : 'annotation'}}) : new Response('',{status:404});
    if(path==='git/tags/annotation')return Response.json({object:{type:'commit',sha:target || sha}});
    if(path==='git/tags')return Response.json({sha:'annotation'});
    if(path==='git/refs'){tagged=true;return race ? new Response('',{status:422}) : Response.json({object:{sha:'annotation',type:'tag'}});}
    assert.fail(`Unexpected GitHub call ${path}`);
  };
  return { calls, fetcher };
}
test('tag date uses Beijing and is deterministic for the deployed commit',()=>{
  assert.equal(releaseTagName(sha,'2026-11-15T16:00:00Z'),'release-20261116-aaaaaaaaaaaa');
  assert.equal(releaseTagName(sha,'2026-11-15T15:59:59Z'),'release-20261115-aaaaaaaaaaaa');
  assert.throws(()=>releaseTagName('bad','2026-11-16'));
});
test('creates an annotated tag at deployed SHA and reruns do not write another tag',async()=>{
  const fake=api();
  const tag=await createReleaseTag(env(),fake.fetcher);
  assert.equal(tag,'release-20261116-aaaaaaaaaaaa');
  const annotation=present(present(fake.calls.find(c=>c.path==='git/tags')).body);
  assert.equal(annotation.object,sha);assert.equal(annotation.type,'commit');assert.equal(annotation.tag,tag);
  assert.deepEqual(present(fake.calls.find(c=>c.path==='git/refs')).body,{ref:`refs/tags/${tag}`,sha:'annotation'});
  const before=fake.calls.filter(c=>c.method==='POST').length;
  await createReleaseTag({...env(),GITHUB_RUN_ID:'99'},fake.fetcher);
  assert.equal(fake.calls.filter(c=>c.method==='POST').length,before);
});
test('accepts existing correct tags and refuses conflicting annotated or lightweight tags',async()=>{
  for(const lightweight of [false,true]){
    const good=api({target:sha,lightweight});await createReleaseTag(env(),good.fetcher);
    assert.equal(good.calls.filter(c=>c.method==='POST').length,0);
    const bad=api({target:other,lightweight});await assert.rejects(createReleaseTag(env(),bad.fetcher),/refusing to overwrite/);
    assert.equal(bad.calls.filter(c=>c.method!=='GET').length,0);
  }
});
test('recovers a concurrent create only when the winning tag points to the deployed commit',async()=>{
  await createReleaseTag(env(),api({race:true}).fetcher);
});
test('rejects Preview, feature, PR, manual production and failed or mismatched deployment before API writes',async()=>{
  for(const patch of [{GITHUB_REF:'refs/heads/dev'},{GITHUB_REF:'refs/heads/feature'},{GITHUB_EVENT_NAME:'pull_request'},{GITHUB_EVENT_NAME:'workflow_dispatch'},{PRODUCTION_RESULT:'failure'},{PRODUCTION_RESULT:'skipped'},{DEPLOYED_SHA:other},{GITHUB_SHA:other},{DEPLOYED_SHA:''}]){
    await assert.rejects(createReleaseTag({...env(),...patch},()=>assert.fail('Unexpected API call')));
  }
});
test('production reports the deployed SHA only after migration, Pages and smoke all succeed',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'production-tag-'));
  try{
    for(const failure of ['migrate-remote.ts','deploy.ts','smoke.ts',null]){
      const output=join(directory,failure || 'success'),calls: string[]=[];
      const releaseEnv={...env(),GITHUB_OUTPUT:output,CLOUDFLARE_ACCOUNT_ID:'test',CLOUDFLARE_API_TOKEN:'test',SITE_URL:'https://example.test'};
      const run=(script: string)=>{calls.push(script);return {status:script===failure ? 1 : 0};};
      if(failure){await assert.rejects(runCiRelease(releaseEnv,run));assert.equal(existsSync(output),false);}
      else {await runCiRelease(releaseEnv,run);assert.ok(readFileSync(output,'utf8').includes(`deployed_sha=${sha}\n`));assert.deepEqual(calls,['migrate-remote.ts','deploy.ts','smoke.ts']);}
    }
  }finally{rmSync(directory,{recursive:true,force:true});}
});
