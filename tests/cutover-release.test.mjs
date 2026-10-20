import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { smoke } from '../scripts/smoke.mjs';
import { rehearseSnapshot } from '../scripts/rehearse-preview.mjs';
import { STAFF_RELEASE } from '../src/db/staff-readiness.js';

async function baselineDump({ deployed = false } = {}) {
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
      for (const name of (await readdir('migrations')).filter(name => name.endsWith('.sql') && name >= '0010').sort()) {
        db.exec(await readFile('migrations/'+name,'utf8'));db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(name);
      }
      for (const [account,role] of [['20260003','admin'],['20260004','technician']]) {
        db.prepare('INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES(?,?,?,?,?,?)').run(account,'独立授权成员',role,'南湖','preserved-password-hash','2026-01-01');
        db.prepare("INSERT INTO staff_campus_grants VALUES(?,'南湖')").run(account);
      }
      db.exec("DELETE FROM member_roles WHERE member_id='member-20260004';");
    }
    const objects = db.prepare("SELECT name,sql,type FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type='trigger',type='index'").all();
    const quote = value => value === null ? 'NULL' : typeof value === 'number' ? String(value) : "'" + String(value).replaceAll("'", "''") + "'";
    const tables = objects.filter(row => row.type === 'table');
    return [
      ...tables.map(row => row.sql + ';'),
      ...tables.flatMap(table => db.prepare(`SELECT * FROM "${table.name}"`).all().map(row => `INSERT INTO "${table.name}" VALUES(${Object.values(row).map(quote).join(',')});`)),
      ...objects.filter(row => row.type !== 'table').map(row => row.sql + ';'),
    ].join('\n');
  } finally { db.close(); }
}

test('the existing Preview migration ledger and populated accounts rehearse through the full cutover', async () => {
  const result = await rehearseSnapshot(await baselineDump());
  assert.ok(result.applied > 0);
  assert.equal(result.preservedTables, 7);
  assert.equal(result.accounts['technician → technician'], 1);
  assert.equal(result.accounts['admin → legacy_admin'], 1);
  assert.equal(result.accounts['superadmin → superadmin'], 1);
});

test('later deployments respect deliberately ungranted administrators and revoked technician roles',async()=>{
  const report=await rehearseSnapshot(await baselineDump({deployed:true}));
  assert.equal(report.applied,0);assert.equal(report.accounts['admin → '],1);assert.equal(report.accounts['technician → '],1);
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
test('smoke rejects stale assets, a legacy entry, incomplete migrations and missing workflow routes', async () => {
  for (const [path, response] of [
    ['/staff/', () => new Response('<div id="login-form"></div>', { headers: { 'Content-Type': 'text/html' } })],
    ['/api/health', () => Response.json({ ok: true })],
    ['/api/field/home', () => Response.json({ error: 'not found' }, { status: 404 })],
  ]) await assert.rejects(smoke('https://deployment.test', url => url.pathname === path ? response() : deploymentFetch(url)));
  await assert.rejects(smoke('https://deployment.test', url => url.pathname.startsWith('/staff/assets/') && url.pathname.endsWith('.js') ? new Response('stale bundle', { headers: { 'Content-Type': 'text/javascript' } }) : deploymentFetch(url)));
});
