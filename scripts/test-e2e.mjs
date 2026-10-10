import {spawn,spawnSync} from 'node:child_process';
import {mkdir,writeFile,rm,cp} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import {root,config} from './cli.mjs';
import {hashPassword} from '../src/lib/passwords.js';
import {nowIso} from '../shared/time.js';

await import('./build.mjs');
const parent=resolve(root,'.wrangler'),dir=resolve(parent,'e2e-'+randomUUID()),inside=relative(parent,dir);
if(!inside || inside.startsWith('..') || isAbsolute(inside))throw new Error('Unsafe E2E directory');
await mkdir(dir,{recursive:true});
// Pages locates its build directory from the nearest package.json.
await writeFile(resolve(dir,'package.json'),JSON.stringify({private:true,type:'module'}));
for(const area of ['functions','src','shared','dist'])await cp(resolve(root,area),resolve(dir,area),{recursive:true});
const cfg=await config(),configPath=resolve(dir,'wrangler.jsonc'),state=resolve(dir,'state');
const rootPassword=randomBytes(24).toString('base64url');
const vars=`JWT_SECRET=${randomBytes(48).toString('base64url')}\nPII_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}\nROOT001_PASSWORD=${rootPassword}\n`;
await writeFile(resolve(dir,'.dev.vars'),vars,{mode:0o600});
await writeFile(resolve(dir,'.dev.vars.preview'),vars,{mode:0o600});
const bindings={
  vars:cfg.env.preview.vars,
  d1_databases:[{binding:'DB',database_name:'pioneer-local-e2e',database_id:'00000000-0000-4000-8000-000000000001',migrations_dir:resolve(root,'migrations')}],
  r2_buckets:[{binding:'ATTACHMENTS',bucket_name:'pioneer-local-e2e'}]
};
await writeFile(configPath,JSON.stringify({name:cfg.name,pages_build_output_dir:resolve(dir,'dist'),compatibility_date:cfg.compatibility_date,compatibility_flags:cfg.compatibility_flags,...bindings,env:{preview:bindings}}));
const env={...process.env,WRANGLER_SEND_METRICS:'false',BROWSER:'none'};
delete env.CLOUDFLARE_API_TOKEN;delete env.CLOUDFLARE_ACCOUNT_ID;
const cli=fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url));
function command(args){
  const result=spawnSync(process.execPath,[cli,...args,'--env','preview'],{cwd:dir,env,encoding:'utf8'});
  if(result.error || result.status!==0)throw result.error || new Error(`Local Wrangler failed: ${result.stderr.slice(-1500)}`);
}
let server,exitCode=0;
async function stopServer(){
  if(!server?.pid)return;
  if(process.platform==='win32')spawnSync('taskkill',['/PID',String(server.pid),'/T','/F'],{stdio:'ignore'});
  else{server.kill('SIGTERM');await Promise.race([new Promise(resolve=>server.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,2000))]);}
}
try{
  command(['d1','migrations','apply','DB','--local','--persist-to',state]);
  const sql=resolve(dir,'seed.sql');
  await writeFile(sql,`INSERT INTO staff_accounts(account,name,role,home_campus,protected,password_hash,created_at) VALUES ('root001','预览负责人','superadmin','南湖',1,'${hashPassword(rootPassword)}','${nowIso()}'); INSERT INTO staff_campus_grants VALUES ('root001','南湖'),('root001','浑南');`,{mode:0o600});
  command(['d1','execute','DB','--local','--persist-to',state,'--file',sql]);
  await rm(sql);
  const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
  const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const base=`http://127.0.0.1:${port}`;
  server=spawn(process.execPath,[cli,'pages','dev',resolve(dir,'dist'),'--persist-to',state,'--ip','127.0.0.1','--port',String(port)],{cwd:dir,env,stdio:['ignore','pipe','pipe']});
  // Redact generated secrets before reporting startup diagnostics.
  let diagnostics='',startup='';
  const secrets=vars.trim().split('\n').map(line=>line.slice(line.indexOf('=')+1));
  const record=chunk=>{let text=chunk.toString();for(const secret of secrets)text=text.replaceAll(secret,'[redacted]');if(startup.length<4000)startup=(startup+text).slice(0,4000);diagnostics=(diagnostics+text).slice(-1000);};
  server.stdout.on('data',record);server.stderr.on('data',record);
  let ready=false;
  for(let n=0;n<120;n++){
    if(server.exitCode!==null)throw new Error('Local Preview exited before readiness:\n'+startup+'\n'+diagnostics);
    try{const response=await fetch(base+'/api/health');if(response.ok){ready=true;break;}}catch{/* starting */}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  if(!ready)throw new Error('Local Preview did not become ready:\n'+startup+'\n'+diagnostics);
  console.log(`Isolated local Preview ready: ${base} (Preview quota; fresh D1/R2; no remote resources)`);
  if(process.argv.includes('--serve')){
    console.log(`Local root001 password is in ${resolve(dir,'.dev.vars.preview')}. Stop with Ctrl+C; temporary data is removed.`);
    await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
  }else{
    const runner=fileURLToPath(new URL('../node_modules/@playwright/test/cli.js',import.meta.url));
    exitCode=await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[runner,'test','--config','playwright.config.mjs'],{cwd:root,env:{...env,E2E_BASE_URL:base,E2E_ROOT_PASSWORD:rootPassword},stdio:'inherit'});
      child.once('error',reject);child.once('exit',code=>resolve(code ?? 1));
    });
  }
}finally{await stopServer();await rm(dir,{recursive:true,force:true});}
process.exitCode=exitCode;
