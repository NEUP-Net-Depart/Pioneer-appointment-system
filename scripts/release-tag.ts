import { isObject } from '../shared/api-types.ts';

interface GitObject {
  type: 'tag' | 'commit' | 'tree' | 'blob';
  sha: string;
}
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function releaseTagName(sha: string,date: string){
  if(!/^[a-f0-9]{40}$/.test(sha))throw new Error('Invalid deployed commit SHA.');
  const parsed=new Date(date);
  if(!Number.isFinite(parsed.getTime()))throw new Error('Invalid deployed commit date.');
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(parsed).map(p=>[p.type,p.value]));
  return `release-${parts.year}${parts.month}${parts.day}-${sha.slice(0,12)}`;
}
export async function createReleaseTag(env=process.env,fetcher=fetch){
  if(env.GITHUB_ACTIONS!=='true' || env.GITHUB_EVENT_NAME!=='push' || env.GITHUB_REF!=='refs/heads/main' || env.PRODUCTION_RESULT!=='success')throw new Error('Only a successful main production deployment may create a release tag.');
  const sha=env.DEPLOYED_SHA;
  if(!sha || sha!==env.GITHUB_SHA || !/^[a-f0-9]{40}$/.test(sha))throw new Error('Deployed SHA must match this main push.');
  if(!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? '') || !env.GH_TOKEN)throw new Error('Repository and Actions token are required.');
  const api=async <T>(path: string,method='GET',body?: object): Promise<T> =>{
    const response=await fetcher(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/${path}`,{
      method,headers:{Authorization:`Bearer ${env.GH_TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(body ? {'Content-Type':'application/json'} : {})},
      ...(body ? {body:JSON.stringify(body)} : {}),signal:AbortSignal.timeout(20000),redirect:'error',
    });
    if(!response.ok)throw Object.assign(new Error(`GitHub ${method} ${path}: ${response.status}`),{status:response.status});
    return response.json() as Promise<T>;
  };
  const commit=await api<{ committer: { date: string } }>(`git/commits/${sha}`);
  // The immutable deployed commit date makes retries across Beijing midnight
  // and different workflow runs for the same commit choose the same tag.
  const tag=releaseTagName(sha,commit.committer.date);
  const existing=async()=>{
    let ref;
    try{ref=await api<{ object: GitObject }>(`git/ref/tags/${tag}`);}catch(error){if(isObject(error) && error.status===404)return false;throw error;}
    let object=ref.object;
    for(let depth=0;object.type==='tag' && depth<16;depth++)object=(await api<{ object: GitObject }>(`git/tags/${object.sha}`)).object;
    if(object.type!=='commit' || object.sha!==sha)throw new Error(`Tag ${tag} exists at another object; refusing to overwrite.`);
    return true;
  };
  if(await existing())return tag;
  const annotation=await api<{ sha: string }>('git/tags','POST',{
    tag,message:`Production deployment verified for ${sha}\nhttps://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
    object:sha,type:'commit',tagger:{name:'github-actions[bot]',email:'41898282+github-actions[bot]@users.noreply.github.com',date:commit.committer.date},
  });
  try{await api('git/refs','POST',{ref:`refs/tags/${tag}`,sha:annotation.sha});}
  catch(error){if(!isObject(error) || error.status!==422 || !await existing())throw error;}
  return tag;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(`Production tag: ${await createReleaseTag()}`);
