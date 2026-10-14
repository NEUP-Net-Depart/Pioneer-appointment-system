import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { config, wrangler } from '../scripts/cli.mjs';
import { hashPassword } from '../src/lib/passwords.js';
import { dateKey } from '../shared/time.js';

let mf;
async function applyMigration(database, file) {
  const sql = (await readFile(`migrations/${file}`, 'utf8')).replace(/--[^\n]*/g, '');
  const statements = []; let buffer = '';
  for (const line of sql.split('\n')) {
    buffer = `${buffer}\n${line}`.trim();
    if (buffer && (buffer.startsWith('CREATE TRIGGER') ? line.trim() === 'END;' : line.trim().endsWith(';'))) { statements.push(buffer); buffer = ''; }
  }
  assert.equal(buffer, '', `Incomplete migration: ${file}`);
  await database.batch(statements.map(statement => database.prepare(statement)));
}

before(async () => {
  const cfg = await config();
  wrangler(['pages','functions','build','functions','--outdir','.wrangler/staff-platform-test-build','--compatibility-date',cfg.compatibility_date,'--compatibility-flags',...cfg.compatibility_flags]);
  mf = new Miniflare({ telemetry: { enabled: false }, workers: [{ config: {
    name: 'pioneer-staff-platform-tests', compatibilityDate: cfg.compatibility_date, compatibilityFlags: cfg.compatibility_flags,
    manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: await readFile('.wrangler/staff-platform-test-build/index.js', 'utf8') } } },
    env: { DB: { type: 'd1', id: 'staff-platform-tests' }, ATTACHMENTS: { type: 'r2', name: 'staff-platform-tests' },
      JWT_SECRET: { type: 'text', value: 'staff-platform-test-secret-012345678901' }, PII_ENCRYPTION_KEY: { type: 'text', value: '0123456789012345678901234567890101234567890123456789012345678901' } }
  } }] });
  const database = await mf.getD1Database('DB');
  for (const file of (await readdir('migrations')).filter(file => file.endsWith('.sql')).sort()) await applyMigration(database, file);
  await database.prepare('INSERT INTO staff_accounts(account,name,role,home_campus,protected,password_hash,created_at) VALUES(?,?,?,?,?,?,?)')
    .bind('root001', '系统负责人', 'superadmin', '南湖', 1, hashPassword('staff-platform-password'), dateKey()).run();
  await database.batch(['南湖','浑南'].map(campus => database.prepare('INSERT INTO staff_campus_grants VALUES (?,?)').bind('root001', campus)));
});
after(async () => mf?.dispose());

async function request(path, options = {}) {
  const response = await mf.dispatchFetch(`https://staff.test${path}`, { ...options, headers: { ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
  const body = await response.json();
  return { response, body };
}

test('staff platform auth context, modular permissions and policy attendance are wired end to end', async () => {
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ account: 'root001', password: 'staff-platform-password' }) });
  assert.equal(login.response.status, 200, JSON.stringify(login.body));
  const headers = { Authorization: `Bearer ${login.body.token}` };
  const context = await request('/api/auth/me', { headers });
  assert.equal(context.response.status, 200, JSON.stringify(context.body));
  assert.equal(context.body.actor.memberId, 'member-root001');
  assert.ok(context.body.grants.some(grant => grant.permissionCode === 'attendance.session.manage'));
  assert.ok(context.body.modules.some(module => module.code === 'meetings' && module.contractVersion === '1'));

  const campuses = await request('/api/organization/campuses', { headers });
  assert.equal(campuses.response.status, 200);
  assert.deepEqual(campuses.body.items.map(item => item.id), ['campus-nanhu', 'campus-hunnan']);
  const detail = await request('/api/members/member-root001', { headers });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.account.account, 'root001');
  const preview = await request('/api/members/import', { method: 'POST', headers, body: JSON.stringify({ csv: 'studentId,name,homeCampusId\n"900001","张三,成员",campus-nanhu' }) });
  assert.equal(preview.response.status, 200);
  assert.equal(preview.body.mode, 'preview');
  const imported = await request('/api/members/import', { method: 'POST', headers, body: JSON.stringify({ confirm: true, csv: 'studentId,name,homeCampusId\n"900001","张三,成员",campus-nanhu' }) });
  assert.equal(imported.response.status, 200, JSON.stringify(imported.body));
  assert.equal(imported.body.count, 1);

  const permissions = await request('/api/permissions', { headers });
  assert.equal(permissions.response.status, 200);
  assert.ok(permissions.body.items.some(permission => permission.code === 'repair.start'));

  const now = Date.now();
  const event = await request('/api/attendance/events', { method: 'POST', headers, body: JSON.stringify({
    type: 'duty', campusId: 'campus-nanhu', businessDate: dateKey(), startsAt: new Date(now - 60_000).toISOString(), endsAt: new Date(now + 3_600_000).toISOString(), requestId: 'attendance-event-001'
  }) });
  assert.equal(event.response.status, 201, JSON.stringify(event.body));
  const token = await request(`/api/attendance/events/${event.body.id}/token`, { method: 'POST', headers, body: JSON.stringify({ revision: event.body.revision }) });
  assert.equal(token.response.status, 200, JSON.stringify(token.body));
  const first = await request('/api/attendance/check-ins', { method: 'POST', headers, body: JSON.stringify({ token: token.body.token, method: 'qr', requestId: 'attendance-checkin-001' }) });
  assert.equal(first.response.status, 200, JSON.stringify(first.body));
  const duplicate = await request('/api/attendance/check-ins', { method: 'POST', headers, body: JSON.stringify({ token: token.body.token, method: 'nfc' }) });
  assert.equal(duplicate.response.status, 200, JSON.stringify(duplicate.body));
  assert.equal(duplicate.body.isExisting, true);
  const records = await request('/api/me/attendance', { headers });
  assert.equal(records.response.status, 200);
  assert.equal(records.body.items.length, 1);
  const exportResponse = await mf.dispatchFetch(`https://staff.test/api/attendance/export.csv?month=${dateKey().slice(0, 7)}`, { headers });
  assert.equal(exportResponse.status, 200);
  assert.match(await exportResponse.text(), /校区,人员,学号,签到次数,部门/);
  const presenceEvents = await (await mf.getD1Database('DB')).prepare('SELECT COUNT(*) AS total FROM presence_events').first();
  assert.equal(presenceEvents.total, 1);
});
