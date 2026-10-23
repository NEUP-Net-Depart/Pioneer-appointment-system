import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { smoke } from '../scripts/smoke.mjs';
import { rehearseSnapshot } from '../scripts/rehearse-preview.mjs';
import { STAFF_RELEASE } from '../src/db/staff-readiness.js';

async function baselineDump({ deployed = false, interleaved = false, beforeLoginScope = false, withAliases = false, explicitAuthorization = false, withAppointments = false } = {}) {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE,applied_at TEXT DEFAULT CURRENT_TIMESTAMP);');
    for (const name of (await readdir('migrations')).filter(name => name.endsWith('.sql') && name < '0010').sort()) {
      db.exec(await readFile(`migrations/${name}`, 'utf8'));
      db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(name);
    }
    for (const [account, role, protectedAccount] of [['root001', 'superadmin', 1], ['20260001', 'admin', 0], ['20260002', 'technician', 0]]) {
      db.prepare('INSERT INTO staff_accounts(account,name,role,home_campus,protected,password_hash,created_at) VALUES(?,?,?,?,?,?,?)').run(account, '历史成员', role, '南湖', protectedAccount, 'preserved-password-hash', '2026-01-01');
      db.prepare("INSERT INTO staff_campus_grants VALUES(?,'南湖')").run(account);
    }
    if (deployed) {
      for (const name of (await readdir('migrations')).filter(name => name.endsWith('.sql') && name >= '0010' && (!beforeLoginScope || name < '0031')).sort()) {
        db.exec(await readFile('migrations/'+name,'utf8'));db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(name);
      }
      for (const [account,role] of [['20260003','admin'],['20260004','technician']]) {
        db.prepare('INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES(?,?,?,?,?,?)').run(account,'独立授权成员',role,'南湖','preserved-password-hash','2026-01-01');
        db.prepare("INSERT INTO staff_campus_grants VALUES(?,'南湖')").run(account);
      }
      db.exec("DELETE FROM member_roles WHERE member_id='member-20260004';");
      if (withAliases) {
        db.prepare("INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at,member_id) VALUES('20260005','同校区维修别名','technician','南湖','preserved-password-hash','2026-01-01','member-20260001')").run();
        db.prepare("INSERT INTO staff_campus_grants VALUES('20260005','南湖')").run();
      }
      if(explicitAuthorization){
        for(const role of ['repair-lead','technician'])db.prepare("INSERT INTO member_roles(id,member_id,role_id,scope_bindings,effective_from,effective_to) VALUES(?,'member-20260001',?,'{\"campusIds\":[\"campus-nanhu\"]}','2025-01-01','2026-01-01')").run('explicit-'+role,'role-'+role);
        db.prepare("INSERT INTO member_work_profiles(id,member_id,profile_code,effective_from,effective_to) VALUES('explicit-repair','member-20260001','repair','2025-01-01','2026-01-01')").run();
        db.prepare("UPDATE role_grants SET condition_spec='[{\"code\":\"signedDutyPresence\",\"version\":1},{\"code\":\"activeDepartmentMembership\",\"parameters\":{\"departmentId\":\"dept-hardware\"}}]',revision=1 WHERE id='grant-repair-lead-correct'").run();
      }
    }
    if (withAppointments) {
      db.exec("INSERT INTO service_locations(campus,date,location,updated_at) VALUES('南湖','2026-10-12','历史维修地点','2026-10-01');");
      for (const [index, [status, expiresAt]] of [['booked','2026-10-12T13:30:00.000Z'],['booked','2026-10-12T14:00:00.000Z'],['completed','2026-10-12T13:30:00.000Z']].entries()) {
        db.prepare(`INSERT INTO appointments(id,student_id,name,campus,social,device_type,brand,device_model,warranty,fault_type,
          date,time_slot,status,outcome,expires_at,access_token_hash,credential_rotated_at,created_at,agreement_at,agreement_version)
          VALUES(?,?,'历史客户','南湖','private','笔记本','联想','T14','否','蓝屏','2026-10-12','19:00–19:30',?,?,?,?,
          '2026-10-12T02:00:00.000Z','2026-10-12T02:00:00.000Z','2026-10-12T02:00:00.000Z','v1')`)
          .run(`history-${index}`,String(20260010+index),status,status === 'completed' ? 'repaired' : null,expiresAt,String(index).padStart(64,'0'));
      }
    }
    const objects = db.prepare("SELECT name,sql,type FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type='trigger',type='index'").all();
    const quote = value => value === null ? 'NULL' : typeof value === 'number' ? String(value) : "'" + String(value).replaceAll("'", "''") + "'";
    const tables = objects.filter(row => row.type === 'table');
    return [
      ...(interleaved ? tables.flatMap(table => [table.sql+';',...db.prepare(`SELECT * FROM "${table.name}"`).all().map(row => `INSERT INTO "${table.name}" VALUES(${Object.values(row).map(quote).join(',')});`)]) : [...tables.map(row => row.sql + ';'),...tables.flatMap(table => db.prepare(`SELECT * FROM "${table.name}"`).all().map(row => `INSERT INTO "${table.name}" VALUES(${Object.values(row).map(quote).join(',')});`))]),
      ...objects.filter(row => row.type !== 'table').map(row => row.sql + ';'),
    ].join('\n');
  } finally { db.close(); }
}

test('the existing Preview migration ledger and populated accounts rehearse through the full cutover', async () => {
  const result = await rehearseSnapshot(await baselineDump());
  assert.ok(result.applied > 0);
  assert.equal(result.preservedTables, 7);
  assert.equal(result.accounts['technician → technician'], 1);
  assert.equal(result.accounts['admin → repair_lead+technician'], 1);
  assert.equal(result.accounts['superadmin → superadmin'], 1);
});

test('later deployments respect deliberately ungranted administrators and revoked technician roles',async()=>{
  const report=await rehearseSnapshot(await baselineDump({deployed:true}));
  assert.equal(report.applied,0);assert.equal(report.accounts['admin → '],1);assert.equal(report.accounts['technician → '],1);
});

test('already applied 0030 upgrades forward to explicit permanent manager roles',async()=>{
  const report=await rehearseSnapshot(await baselineDump({deployed:true,beforeLoginScope:true,interleaved:true}));
  assert.equal(report.applied,8);assert.equal(report.accounts['admin → repair_lead+technician'],2);
});

test('Preview rehearsal respects expired explicit authorization and custom grant conditions',async()=>{
  const report=await rehearseSnapshot(await baselineDump({deployed:true,beforeLoginScope:true,explicitAuthorization:true}));
  assert.equal(report.applied,8);
  assert.equal(report.accounts['admin → repair_lead+technician'],2);
});

test('migration rehearsal rejects multi-account members before altering authorization',async()=>{
  await assert.rejects(rehearseSnapshot(await baselineDump({deployed:true,beforeLoginScope:true,withAliases:true})),/multiple login accounts/);
});
test('Preview rehearsal advances pending default deadlines while preserving custom deadlines and completed history',async()=>{
  const report=await rehearseSnapshot(await baselineDump({deployed:true,beforeLoginScope:true,withAppointments:true}));
  assert.equal(report.applied,8);assert.equal(report.preservedTables,7);
});
test('current D1 snapshots restore with interleaved table definitions and cyclic account/member references',async()=>{
  const report=await rehearseSnapshot(await baselineDump({deployed:true,interleaved:true}));assert.equal(report.applied,0);assert.equal(report.accounts['admin → repair_lead+technician'],1);
});
test('snapshot restore rejects broken references before attempting migrations',async()=>{
  const dump=(await baselineDump({deployed:true,interleaved:true})).replace(/^INSERT INTO "members" VALUES\('member-20260002'.*;\n/m,'');
  await assert.rejects(rehearseSnapshot(dump),/snapshot has invalid foreign keys/);
});

async function deploymentFetch(url) {
  const path = url.pathname;
  if (path === '/api/health') return Response.json({ ok: true, staffRelease: STAFF_RELEASE, workflow: 'staff-platform' });
  if (path === '/api/scan/config') return Response.json({ enabled: true });
  if (['/api/field/home', '/api/field/board', '/api/roster-tasks', '/api/me/attendance', '/api/members'].includes(path)) return Response.json({ error: '请登录' }, { status: 401 });
  if (path === '/api/unknown') return Response.json({ error: '不存在' }, { status: 404 });
  const file = path === '/' ? 'index.html' : path === '/staff/' ? 'staff/index.html' : path.slice(1);
  try {
    const bytes = await readFile(new URL('../dist/' + file, import.meta.url));
    return new Response(bytes, { headers: { 'Content-Type': file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'image/jpeg' } });
  } catch { return new Response('missing', { status: 404 }); }
}
test('smoke validates built React bytes, schema readiness and the new workflow APIs', async () => {
  assert.ok((await smoke('https://deployment.test', deploymentFetch)).assets >= 4);
});
test('smoke tolerates cached legacy scripts and still checks health, authentication and private paths', async () => {
  const requested = new Set();
  const result = await smoke('https://deployment.test', url => {
    requested.add(url.pathname);
    if (['/staff/main.js', '/staff/auth.js', '/staff/scan.js'].includes(url.pathname)) return new Response('cached legacy script', { headers: { 'Content-Type': 'text/javascript' } });
    return deploymentFetch(url);
  });
  assert.ok(result.assets >= 4);
  for (const path of ['/api/health', '/api/scan/config', '/api/field/home', '/api/field/board', '/api/roster-tasks', '/api/me/attendance', '/api/members', '/api/unknown', '/.dev.vars', '/wrangler.jsonc']) assert.ok(requested.has(path), path + ' must still be checked');
});
test('smoke rejects staff HTML referencing any legacy script even with a valid React entry', async () => {
  const html = await readFile(new URL('../dist/staff/index.html', import.meta.url), 'utf8');
  for (const path of ['/staff/main.js', '/staff/auth.js?cached=1', './scan.js']) {
    await assert.rejects(smoke('https://deployment.test', url => url.pathname === '/staff/'
      ? new Response(html + `<script src="${path}"></script>`, { headers: { 'Content-Type': 'text/html' } })
      : deploymentFetch(url)), /Staff HTML must not reference legacy scripts/);
  }
});
test('smoke continues to reject exposed secrets and configuration', async () => {
  for (const path of ['/.dev.vars', '/wrangler.jsonc']) {
    await assert.rejects(smoke('https://deployment.test', url => url.pathname === path ? new Response('exposed') : deploymentFetch(url)), { code: 'ERR_ASSERTION', actual: 200, expected: 404 });
  }
});
test('smoke rejects stale assets, a legacy entry, incomplete migrations and missing workflow routes', async () => {
  for (const [path, response] of [
    ['/staff/', () => new Response('<div id="login-form"></div>', { headers: { 'Content-Type': 'text/html' } })],
    ['/api/health', () => Response.json({ ok: true })],
    ['/api/field/home', () => Response.json({ error: 'not found' }, { status: 404 })],
  ]) await assert.rejects(smoke('https://deployment.test', url => url.pathname === path ? response() : deploymentFetch(url)));
  await assert.rejects(smoke('https://deployment.test', url => url.pathname.startsWith('/staff/assets/') && url.pathname.endsWith('.js') ? new Response('stale bundle', { headers: { 'Content-Type': 'text/javascript' } }) : deploymentFetch(url)));
});
