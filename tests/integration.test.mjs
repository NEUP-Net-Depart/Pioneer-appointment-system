import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomBytes, createHmac } from 'node:crypto';
import { Miniflare } from 'miniflare';
import { hashPassword } from '../src/lib/passwords.js';
import { signToken } from '../src/lib/jwt.js';
import { config, wrangler } from '../scripts/cli.mjs';
import { dateKey, addDays, serviceDay, formatDate } from '../shared/time.js';
import { attachmentRepository } from '../src/db/attachments.js';
import { appointmentRepository } from '../src/db/appointments.js';
import { attachmentService } from '../src/services/attachments.js';
import { storageLimit } from '../src/lib/env.js';
import { cleanupAttachments } from '../scripts/cleanup-attachments.mjs';
import { cloudflareClient } from '../scripts/cloudflare-d1.mjs';
import { userRepository } from '../src/db/users.js';

let mf, db, bucket;
const MAX_R2_BYTES = 8589934592;
const password = 'integration-test-password-only';
const JWT_SECRET = randomBytes(48).toString('base64url');
const PII_ENCRYPTION_KEY = randomBytes(32).toString('hex');
const date = [0,1,2,3].map(n => addDays(dateKey(), n)).find(serviceDay);
let serial = 200000;
const draft = (patch = {}) => ({ studentId: String(++serial), name: '测试同学', campus: '南湖', phone: '13800138000', social: 'wechat-private', deviceType: '笔记本电脑', brand: '联想', deviceModel: 'ThinkPad', warranty: '否', date, timeSlot: '19:00–20:00', faultType: '蓝屏', issue: '', agreementAt: new Date().toISOString(), ...patch });
async function request(path, { method = 'GET', body, token, accessToken, headers = {} } = {}) {
  return mf.dispatchFetch(`https://app.test${path}`, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(accessToken ? {'X-Appointment-Token':accessToken} : {}), ...headers }, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
}
async function api(path, options, status = 200) {
  const response = await request(path, options);
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
}
const book = patch => api('/api/appointments', { method: 'POST', body: draft(patch) }, 201);
async function login(account = 'root001', suppliedPassword = password) {
  return (await api('/api/auth/login', { method: 'POST', body: { account, password: suppliedPassword } })).token;
}
async function addUser(account, role = 'technician') {
  await db.prepare('INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES (?,?,?,?,?,?)').bind(account, `人员${account}`, role, '南湖', hashPassword(password), dateKey()).run();
  await db.prepare('INSERT INTO staff_campus_grants VALUES (?,?)').bind(account,'南湖').run();
  return login(account);
}
async function whitelistStaff(studentId,{name='',role='technician',authorizedCampuses=['南湖']}={}){
  const token=await login();
  await api('/api/staff-whitelist/import',{method:'POST',token,body:{csv:`studentId,expectedName\n${studentId},${name}`,expectedRole:role,authorizedCampuses}});
  return token;
}
async function applyStaff(studentId,patch={}){
  return api('/api/activation',{method:'POST',body:{studentId,name:`人员${studentId}`,homeCampus:'南湖',contact:'wechat-member',password,...patch}},201);
}
async function activateStaff(studentId,{name=`人员${studentId}`,role='technician',authorizedCampuses=['南湖']}={}){
  const token=await whitelistStaff(studentId,{name,role,authorizedCampuses});
  const application=await applyStaff(studentId,{name});
  await api('/api/activation-requests/review',{method:'POST',token,body:{ids:[application.id],status:'approved',identityVerified:true,reviewNote:'已当面核验部员身份和学生证'}});
  return (await api('/api/users',{token})).items.find(user=>user.account===studentId);
}
async function applyMigration(database, file) {
  const sql = (await readFile(`migrations/${file}`, 'utf8')).replace(/--[^\n]*/g, '');
  const statements = []; let buffer = '';
  for (const line of sql.split('\n')) {
    buffer = `${buffer}\n${line}`.trim();
    if (buffer && (buffer.startsWith('CREATE TRIGGER') ? line.trim() === 'END;' : line.trim().endsWith(';'))) {
      statements.push(buffer); buffer = '';
    }
  }
  assert.equal(buffer, '', `Incomplete migration: ${file}`);
  await database.batch(statements.map(sql => database.prepare(sql)));
}
before(async () => {
  const cfg = await config();
  wrangler(['pages','functions','build','functions','--outdir','.wrangler/test-build','--compatibility-date',cfg.compatibility_date,'--compatibility-flags',...cfg.compatibility_flags]);
  mf = new Miniflare({ telemetry: { enabled: false }, workers: [{ config: {
    name: 'pioneer-tests', compatibilityDate: cfg.compatibility_date, compatibilityFlags: cfg.compatibility_flags,
    manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: await readFile('.wrangler/test-build/index.js', 'utf8') } } },
    env: { DB: { type: 'd1', id: 'test-db' }, MIGRATION_DB: { type: 'd1', id: 'migration-db' }, ATTACHMENTS: { type: 'r2', name: 'test-attachments' },
      JWT_SECRET: { type: 'text', value: JWT_SECRET }, PII_ENCRYPTION_KEY: { type: 'text', value: PII_ENCRYPTION_KEY } }
  } }] });
  db = await mf.getD1Database('DB'); bucket = await mf.getR2Bucket('ATTACHMENTS');
  for (const file of (await readdir('migrations')).filter(name => name.endsWith('.sql')).sort()) {
    await applyMigration(db, file);
  }
  await db.prepare('INSERT INTO staff_accounts(account,name,role,home_campus,protected,password_hash,created_at) VALUES (?,?,?,?,?,?,?)').bind('root001', '系统负责人', 'superadmin', '南湖', 1, hashPassword(password), dateKey()).run();
  await db.batch(['南湖','浑南'].map(campus=>db.prepare('INSERT INTO staff_campus_grants VALUES (?,?)').bind('root001',campus)));
});
after(async () => { await mf?.dispose(); });
beforeEach(async () => {
  await db.batch(['DELETE FROM credential_recoveries','DELETE FROM activation_requests','DELETE FROM staff_whitelist','DELETE FROM attachment_storage','DELETE FROM appointment_attachments','DELETE FROM appointments',"DELETE FROM staff_accounts WHERE protected=0",'DELETE FROM rate_limits'].map(sql => db.prepare(sql)));
  await db.prepare('UPDATE storage_quota SET used_bytes=0 WHERE id=1').run();
  const objects = await bucket.list();
  if (objects.objects.length) await bucket.delete(objects.objects.map(object => object.key));
});

test('health verifies D1 schema and R2; API paths return JSON and security headers', async () => {
  assert.deepEqual(await api('/api/health'), { ok: true, service: 'pioneer-repair-api', database: 'd1', attachments: 'r2' });
  for (const path of ['/api','/api/unknown']) await api(path, {}, 404);
  const response = await request('/api/health');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});
test('guest booking, encrypted contacts, lookup, queue and cancellation', async () => {
  const item = await book();
  assert.match(item.id, /^0\d{8}-01$/);
  const row = await db.prepare('SELECT phone,social FROM appointments WHERE id=?').bind(item.id).first();
  assert.match(row.phone, /^enc\$/); assert.match(row.social, /^enc\$/); assert.ok(!row.social.includes('wechat-private'));
  const found = await api(`/api/appointments/${item.id}`,{accessToken:item.accessToken});
  assert.equal(found.social, 'wechat-private'); assert.equal(found.phone, '13800138000');
  await api(`/api/appointments/${item.id}`,{accessToken:'x'.repeat(43)},404);
  await api('/api/appointments', {}, 401);
  const live = await api(`/api/live/summary?appointmentId=${item.id}`,{accessToken:item.accessToken});
  assert.equal(live.position, 1); assert.equal(live.capacity, 20); assert.equal(live.slotTotal, 1);
  const cancelled = await api(`/api/appointments/${item.id}/status`, { method: 'PATCH', accessToken:item.accessToken, body: { status: 'cancelled', studentId: item.studentId, assignedTo: 'root001', repairNote: 'injection' } });
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.assignedTo, ''); assert.equal(cancelled.repairNote, '');
  assert.ok((await book({ studentId: item.studentId })).id.endsWith('-02'));
});
test('validation rejects invalid dates, windows, fields, MIME, JSON and cross-site writes', async () => {
  for (const patch of [{ date: '2026-02-30' }, { date: addDays(dateKey(), 4) }, { campus: '其他' }, { timeSlot: '10:00-11:00' }, { studentId: 'abc' }, { social: ' ' }, { issue: 'x'.repeat(10001) }, { agreementAt: 'invalid' }]) {
    await api('/api/appointments', { method: 'POST', body: draft(patch) }, 400);
  }
  await api('/api/appointments', { method: 'POST', body: '{broken' }, 400);
  await api('/api/appointments', { method: 'POST', body: [] }, 400);
  await api('/api/appointments', { method: 'POST', body: draft(), headers: { 'Content-Type': 'text/plain' } }, 415);
  await api('/api/appointments', { method: 'POST', body: draft(), headers: { Origin: 'https://other.test' } }, 403);
  const oversized=JSON.stringify({padding:'x'.repeat(1024*1024)});
  await api('/api/appointments',{method:'POST',body:oversized,headers:{'Content-Length':String(Buffer.byteLength(oversized))}},413);
  const normalized = await book({ timeSlot: '19:00-20:00', social: 'enc$literal-user-input' });
  assert.equal(normalized.timeSlot, '19:00–20:00'); assert.equal(normalized.social, 'enc$literal-user-input');
});
test('simultaneous reservations cannot exceed capacity and retain sequential unique IDs', async () => {
  const results = await Promise.all(Array.from({ length: 25 }, () => request('/api/appointments', { method: 'POST', body: draft() })));
  assert.equal(results.filter(r => r.status === 201).length, 20);
  assert.equal(results.filter(r => r.status === 409).length, 5);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM appointments').first()).n, 20);
  const ids = (await db.prepare('SELECT id FROM appointments ORDER BY id').all()).results.map(row => row.id);
  assert.equal(new Set(ids).size, 20); assert.ok(ids.at(-1).endsWith('-20'));
  const live = await api(`/api/live/summary?date=${date}&campus=${encodeURIComponent('南湖')}`);
  assert.equal(live.slots['19:00–20:00'], 20);
});
test('duplicate check spans campuses and is atomic', async () => {
  const input = draft();
  const responses = await Promise.all(['南湖','浑南'].map(campus => request('/api/appointments', { method: 'POST', body: { ...input, campus } })));
  assert.deepEqual(responses.map(r => r.status).sort(), [201,409]);
});
test('reactivating cancelled appointments still enforces D1 capacity and duplicate constraints', async () => {
  const root = await login(), old = await book();
  await api(`/api/appointments/${old.id}/status`, { method: 'PATCH', token: root, body: { status: 'cancelled' } });
  await book({ studentId: old.studentId });
  await api(`/api/appointments/${old.id}/status`, { method: 'PATCH', token: root, body: { status: 'pending' } }, 409);
  for (let n = 0; n < 19; n++) await book();
  await api(`/api/appointments/${old.id}/status`, { method: 'PATCH', token: root, body: { status: 'pending' } }, 409);
});
test('simultaneous claims have one winner; technician ownership and transitions hold', async () => {
  const item = await book();
  const tokens = await Promise.all([addUser('300001'), addUser('300002')]);
  const results = await Promise.all(tokens.map(token => request(`/api/appointments/${item.id}/status`, { method: 'PATCH', token, body: { status: 'claimed' } })));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.ok(results.some(r => [403,409].includes(r.status)));
  const winner = results.findIndex(r => r.status === 200), token = tokens[winner];
  await api(`/api/appointments/${item.id}/status`, { method: 'PATCH', token: tokens[1-winner], body: { status: 'completed' } }, 403);
  await api(`/api/appointments/${item.id}/status`, { method: 'PATCH', accessToken:item.accessToken, body: { status: 'cancelled', studentId: item.studentId } }, 409);
  await api(`/api/appointments/${item.id}/status`, { method: 'PATCH', token, body: { assignedTo: '' } }, 403);
  await api(`/api/appointments/${item.id}/status`, { method: 'PATCH', token, body: { status: 'pending' } }, 409);
  await api(`/api/appointments/${item.id}/status`, { method: 'PATCH', token, body: { status: 'in_progress' } });
  const done = await api(`/api/appointments/${item.id}/status`, { method: 'PATCH', token, body: { status: 'completed', repairNote: '已完成测试' } });
  assert.equal(done.repairNote, '已完成测试');
  await api(`/api/appointments/${item.id}/status`, { method: 'PATCH', token, body: { status: 'claimed' } }, 409);
});
test('staff account model separates role, status, home campus and grants', async () => {
  const root = await login();
  const created=await activateStaff('400001',{name:'测试人员',authorizedCampuses:['浑南']});
  assert.equal(created.role,'technician'); assert.equal(created.status,'enabled');
  assert.equal(created.homeCampus,'南湖'); assert.deepEqual(created.authorizedCampuses,['浑南']);
  assert.ok(!created.passwordHash);
  const technician=await login('400001');
  await api('/api/users',{token:technician},403);
  await api('/api/stats/summary',{token:technician},403);
  await api('/api/users/400001',{method:'PATCH',token:root,body:{role:'admin'}});
  await api('/api/auth/me',{token:technician},401);
  const admin=await login('400001');
  await api('/api/users/root001',{method:'DELETE',token:root},404);
  await api('/api/users/root001',{method:'PATCH',token:root,body:{password:'different-password'}},403);
  await api('/api/users/400001',{method:'PATCH',token:root,body:{status:'disabled'}});
  await api('/api/auth/me',{token:admin},401);
  await api('/api/auth/login',{method:'POST',body:{account:'400001',password}},401);
  await api('/api/users/400001',{method:'PATCH',token:root,body:{status:'enabled',password:'new-test-password'}});
  await login('400001','new-test-password');
  await api('/api/users/400001',{method:'PATCH',token:root,body:{role:'student'}},400);
});

test('JWT signatures, expiry, exact format and logout revocation', async () => {
  const token = await login();
  await api('/api/auth/me', { token });
  await api('/api/auth/me', { token: token + '.extra' }, 401);
  await api('/api/auth/me', { token: token.slice(0, -8) + 'tampered' }, 401);
  const wrongSecret = signToken({ account: 'root001', role: 'superadmin', tokenVersion: 0 }, 'wrong-secret');
  await api('/api/auth/me', { token: wrongSecret }, 401);
  const [header, originalPayload] = token.split('.');
  const expiredPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(originalPayload, 'base64url')), exp: Math.floor(Date.now() / 1000) - 1 })).toString('base64url');
  const expiredData = `${header}.${expiredPayload}`;
  const expired = `${expiredData}.${createHmac('sha256', JWT_SECRET).update(expiredData).digest('base64url')}`;
  await api('/api/auth/me', { token: expired }, 401);
  await api('/api/auth/logout', { method: 'POST', token });
  await api('/api/auth/me', { token }, 401);
});
test('R2 upload/download preserves bytes, enforces credentials and hides storage keys', async () => {
  const item = await book(), other = await book();
  const bytes = Buffer.from('附件中文测试\nrepair notes');
  const input = { studentId: item.studentId, filename: '../维修记录.txt', mimeType: 'text/plain', data: bytes.toString('base64') };
  const base = `/api/appointments/${item.id}/attachments`;
  const attachment = await api(base, { accessToken:item.accessToken, method: 'POST', body: input }, 201);
  assert.equal(attachment.filename, '维修记录.txt'); assert.ok(!attachment.objectKey);
  assert.equal(Date.parse(attachment.expiresAt) - Date.parse(attachment.createdAt), 180 * 86400000);
  assert.equal((await db.prepare('SELECT used_bytes FROM storage_quota').first()).used_bytes, bytes.length);
  assert.equal((await bucket.list()).objects.length, 1);
  await api(base, {}, 404);
  await api(base, { accessToken:other.accessToken, method: 'POST', body: { ...input, studentId: '999999' } }, 404);
  await api(`${base}/${attachment.id}`,{accessToken:other.accessToken},404);
  await api(`/api/appointments/${other.id}/attachments/${attachment.id}`,{accessToken:other.accessToken},404);
  const response = await request(`${base}/${attachment.id}`,{accessToken:item.accessToken});
  assert.equal(response.status, 200); assert.ok(response.headers.get('content-disposition').includes("filename*=UTF-8''"));
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  const token = await addUser('500001');
  await api(`${base}/${attachment.id}`,{token},403);
  await api(`/api/appointments/${item.id}/status`,{method:'PATCH',token,body:{status:'claimed'}});
  assert.equal((await request(`${base}/${attachment.id}`, { token })).status, 200);
  await api(base, { accessToken:item.accessToken, method: 'POST', body: { ...input, mimeType: 'text/html' } }, 400);
  await api(base, { accessToken:item.accessToken, method: 'POST', body: { ...input, mimeType: 'image/png' } }, 400);
  await api(base, { accessToken:item.accessToken, method: 'POST', body: { ...input, data: '%%%=' } }, 400);
  await api(base, { accessToken:item.accessToken, method: 'POST', body: { ...input, data: Buffer.alloc(5 * 1024 * 1024 + 1, 65).toString('base64') } }, 400);
});
test('R2 write is compensated when D1 metadata fails', async () => {
  const item = await book();
  await db.prepare("CREATE TRIGGER test_attachment_failure BEFORE INSERT ON appointment_attachments BEGIN SELECT RAISE(ABORT,'test failure'); END").run();
  try {
    await api(`/api/appointments/${item.id}/attachments`, { accessToken:item.accessToken, method: 'POST', body: { studentId: item.studentId, filename: 'a.txt', mimeType: 'text/plain', data: 'dGVzdA==' } }, 500);
    assert.equal((await bucket.list()).objects.length, 0);
    assert.equal((await db.prepare('SELECT used_bytes FROM storage_quota').first()).used_bytes, 0);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM attachment_storage').first()).n, 0);
  } finally { await db.prepare('DROP TRIGGER test_attachment_failure').run(); }
});
test('statistics and CSV retain history when staff is disabled', async () => {
  const root = await login(), technician = await addUser('600001');
  const item = await book({ name: '=SUM(1,1)' });
  await api(`/api/appointments/${item.id}/status`, { method: 'PATCH', token: technician, body: { status: 'claimed' } });
  await api(`/api/appointments/${item.id}/status`, { method: 'PATCH', token: technician, body: { status: 'completed', repairNote: '完成' } });
  await api('/api/users/600001', { method: 'PATCH', token: root, body: { status: 'disabled' } });
  const stats = await api('/api/stats/summary?range=all', { token: root });
  assert.equal(stats.completed, 1); assert.equal(stats.faults['蓝屏'], 1); assert.equal(stats.technicians['600001'].completed, 1);
  const response = await request('/api/export/appointments.csv', { token: root });
  assert.equal(response.status, 200); assert.ok((await response.text()).includes("'\u003dSUM(1,1)"));
});
test('D1 rate limits survive separate requests and do not trust forwarded IPs', async () => {
  for (let n = 0; n < 20; n++) await api('/api/auth/login', { method: 'POST', body: { account: 'nobody', password }, headers: { 'X-Real-IP': `fake-${n}` } }, 401);
  await api('/api/auth/login', { method: 'POST', body: { account: 'nobody', password } }, 429);
});

test('concurrent uploads atomically reserve the last bytes and reject excess before R2 writes', async () => {
  const item = await book();
  await db.prepare('UPDATE storage_quota SET used_bytes=?').bind(MAX_R2_BYTES - 4).run();
  const input = { studentId: item.studentId, filename: 'a.txt', mimeType: 'text/plain', data: 'dGVzdA==' };
  const responses = await Promise.all(Array.from({ length: 10 }, () => request(`/api/appointments/${item.id}/attachments`, {accessToken:item.accessToken,method: 'POST', body: input })));
  assert.equal(responses.filter(response => response.status === 201).length, 1);
  assert.equal(responses.filter(response => response.status === 507).length, 9);
  assert.equal((await responses.find(response => response.status === 507).json()).error, '附件存储空间已满');
  assert.equal((await bucket.list()).objects.length, 1);
  assert.equal((await db.prepare('SELECT used_bytes FROM storage_quota').first()).used_bytes, MAX_R2_BYTES);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM attachment_storage').first()).n, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM appointment_attachments').first()).n, 1);
});

test('failed R2 puts release quota only after confirmed compensation; failed compensation is retried', async () => {
  const item = await book(), repository = attachmentRepository(db);
  const input = { filename: 'a.txt', mimeType: 'text/plain', bytes: Buffer.from('test') };
  const appointments = appointmentRepository(db);
  const failingPut = attachmentService(appointments, repository, {
    async put() { throw new Error('put failed'); }, delete: key => bucket.delete(key)
  }, MAX_R2_BYTES);
  await assert.rejects(failingPut.upload(item.id, input, null, item.accessToken), /put failed/);
  assert.equal((await db.prepare('SELECT used_bytes FROM storage_quota').first()).used_bytes, 0);
  const ambiguousPut = attachmentService(appointments, repository, {
    async put(...args) { await bucket.put(...args); throw new Error('put response lost'); },
    async delete() { throw new Error('delete failed'); }
  }, MAX_R2_BYTES);
  await assert.rejects(ambiguousPut.upload(item.id, input, null, item.accessToken), /put response lost/);
  assert.equal((await db.prepare('SELECT used_bytes FROM storage_quota').first()).used_bytes, 4);
  assert.equal((await bucket.list()).objects.length, 1);
  assert.equal((await db.prepare('SELECT state FROM attachment_storage').first()).state, 'deleting');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM appointment_attachments').first()).n, 0);
  // R2 can delete successfully while the D1 response fails. Retain quota for retry.
  const failed = await cleanupAttachments({ ...repository, async release() { throw new Error('D1 failure'); } }, key => bucket.delete(key), { apply: true, onError() {} });
  assert.equal(failed.failed, 1); assert.equal((await bucket.list()).objects.length, 0);
  assert.equal((await db.prepare('SELECT used_bytes FROM storage_quota').first()).used_bytes, 4);
  assert.equal((await db.prepare('SELECT state FROM attachment_storage').first()).state, 'deleting');
  const retry = await cleanupAttachments(repository, key => bucket.delete(key), { apply: true });
  assert.equal(retry.deleted, 1); assert.equal(retry.failed, 0);
  assert.equal((await db.prepare('SELECT used_bytes FROM storage_quota').first()).used_bytes, 0);
  assert.equal((await cleanupAttachments(repository, key => bucket.delete(key), { apply: true })).deleted, 0);
});

test('expired attachments disappear for guests and staff without releasing quota until physical deletion', async () => {
  const item = await book(), token = await login(), base = `/api/appointments/${item.id}/attachments`;
  const file = await api(base, { accessToken:item.accessToken, method: 'POST', body: { studentId: item.studentId, filename: 'a.txt', mimeType: 'text/plain', data: 'dGVzdA==' } }, 201);
  const expires = new Date().toISOString();
  await db.batch([
    db.prepare('UPDATE appointment_attachments SET expires_at=?').bind(expires),
    db.prepare('UPDATE attachment_storage SET expires_at=?').bind(expires)
  ]);
  for (const options of [{accessToken:item.accessToken}, { token }]) {
    assert.deepEqual((await api(base,options)).items, []);
    await api(`${base}/${file.id}`,options,404);
  }
  assert.deepEqual((await api(`/api/appointments/${item.id}`,{accessToken:item.accessToken})).attachments, []);
  assert.equal((await bucket.list()).objects.length, 1);
  assert.equal((await db.prepare('SELECT used_bytes FROM storage_quota').first()).used_bytes, 4);
  const repository = attachmentRepository(db);
  const dryRun = await cleanupAttachments(repository, () => assert.fail('dry-run must not delete'));
  assert.equal(dryRun.scanned, 1); assert.equal(dryRun.deleted, 0); assert.equal(dryRun.dryRun, true);
  assert.equal((await db.prepare('SELECT state FROM attachment_storage').first()).state, 'complete');
  const result = await cleanupAttachments(repository, key => bucket.delete(key), { apply: true });
  assert.equal(result.deleted, 1); assert.equal(result.failed, 0);
  assert.equal((await bucket.list()).objects.length, 0);
  assert.equal((await db.prepare('SELECT used_bytes FROM storage_quota').first()).used_bytes, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM appointment_attachments').first()).n, 0);
});

test('cleanup paginates past failed objects, handles lifecycle deletions and releases each allocation once', async () => {
  const item = await book();
  const created = new Date(Date.now() - 181 * 86400000).toISOString(), expires = new Date(Date.now() - 86400000).toISOString();
  const statements = [];
  for (let n = 0; n < 105; n++) {
    const id = `cleanup-${String(n).padStart(3, '0')}`, key = `appointments/${item.id}/${id}`;
    statements.push(db.prepare("INSERT INTO attachment_storage VALUES (?,?,1,'complete',?,?)").bind(id, key, created, expires));
    statements.push(db.prepare("INSERT INTO appointment_attachments(id,appointment_id,filename,mime_type,size,object_key,created_at,expires_at) VALUES (?,?,'a.txt','text/plain',1,?,?,?)").bind(id, item.id, key, created, expires));
  }
  await db.batch(statements);
  const repository = attachmentRepository(db);
  const first = await cleanupAttachments(repository, async key => {
    if (key.endsWith('cleanup-000')) throw new Error('R2 failure');
    await bucket.delete(key); // Already absent, as after lifecycle deletion.
  }, { apply: true, onError() {} });
  assert.deepEqual(first, { scanned: 105, deleted: 104, failed: 1, dryRun: false });
  assert.equal((await db.prepare('SELECT used_bytes FROM storage_quota').first()).used_bytes, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM appointment_attachments').first()).n, 1);
  const second = await cleanupAttachments(repository, key => bucket.delete(key), { apply: true });
  assert.equal(second.deleted, 1);
  assert.equal((await db.prepare('SELECT used_bytes FROM storage_quota').first()).used_bytes, 0);
  assert.equal((await cleanupAttachments(repository, key => bucket.delete(key), { apply: true })).deleted, 0);
});

test('storage limits validate configuration and honor the smaller Preview quota', async () => {
  assert.equal(storageLimit({}), MAX_R2_BYTES);
  for (const value of ['', '0', '-1', '1.5', 'NaN', '9007199254740992', 1024]) assert.throws(() => storageLimit({ MAX_R2_BYTES: value }), /Invalid/);
  const cfg = await config();
  assert.equal(storageLimit(cfg.vars), MAX_R2_BYTES);
  const previewLimit = storageLimit(cfg.env.preview.vars);
  assert.equal(previewLimit, 536870912);
  const item = await book();
  await db.prepare('UPDATE storage_quota SET used_bytes=?').bind(previewLimit - 1).run();
  const service = attachmentService(appointmentRepository(db), attachmentRepository(db), bucket, previewLimit);
  await assert.rejects(service.upload(item.id, { filename: 'a.txt', mimeType: 'text/plain', bytes: Buffer.from('test') }, null, item.accessToken), error => error.status === 507);
  assert.equal((await bucket.list()).objects.length, 0);
});

test('fresh schema rejects retired roles and constrains activation and credentials', async () => {
  const columns=(await db.prepare('PRAGMA table_info(staff_accounts)').all()).results.map(row=>row.name);
  assert.ok(!columns.includes('campus') && !columns.includes('active'));
  await assert.rejects(addUser('700001','student'),/CHECK constraint/);
  const item=await book();
  const row=await db.prepare('SELECT access_token_hash FROM appointments WHERE id=?').bind(item.id).first();
  assert.match(row.access_token_hash,/^[a-f0-9]{64}$/);
  assert.equal(item.accessToken.length,43);
  assert.ok(!JSON.stringify(item).includes(row.access_token_hash));
  assert.equal((await db.prepare('SELECT used_bytes FROM storage_quota').first()).used_bytes,0);
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
});

test('HTTP D1 maintenance adapter reuses real repositories and rejects API errors', async () => {
  const item = await book(), repository = attachmentRepository(db);
  const createdAt = new Date(Date.now() - 2 * 86400000).toISOString();
  await repository.reserve({ id: 'abandoned', objectKey: `appointments/${item.id}/abandoned`, size: 4, createdAt, expiresAt: new Date(Date.now() + 178 * 86400000).toISOString() }, MAX_R2_BYTES);
  const account = 'a'.repeat(32), token = 'test-only-api-token';
  const client = cloudflareClient(account, token, async (url, options) => {
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    if (url.endsWith('/r2/buckets/test-bucket')) return Response.json({ success: true, result: { name: 'test-bucket' } });
    assert.equal(url, `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/test-database/query`);
    const { batch } = JSON.parse(options.body);
    assert.ok(batch.every(item => item.params.every(value => typeof value === 'string')));
    const result = await db.batch(batch.map(item => db.prepare(item.sql).bind(...item.params)));
    return Response.json({ success: true, result });
  });
  await client.checkBucket('test-bucket');
  const remoteRepository = attachmentRepository(client.database('test-database'));
  const result = await cleanupAttachments(remoteRepository, key => bucket.delete(key), { apply: true });
  assert.equal(result.deleted, 1); assert.equal(result.failed, 0);
  assert.equal((await db.prepare('SELECT used_bytes FROM storage_quota').first()).used_bytes, 0);
  for (const response of [() => new Response('', { status: 403 }), () => Response.json({ success: false }), () => Response.json({ success: true, result: [{ success: false }] })]) {
    const failing = cloudflareClient(account, token, async () => response()).database('test-database');
    await assert.rejects(failing.prepare('SELECT 1').first(), /Cloudflare|D1/);
  }
  assert.throws(() => cloudflareClient('', ''), /CLOUDFLARE/);
});

test('metadata failure with unsuccessful R2 compensation keeps an invisible counted object', async () => {
  const item = await book(), repository = attachmentRepository(db);
  await db.prepare("CREATE TRIGGER test_attachment_failure BEFORE INSERT ON appointment_attachments BEGIN SELECT RAISE(ABORT,'test failure'); END").run();
  try {
    const service = attachmentService(appointmentRepository(db), repository, {
      put: (...args) => bucket.put(...args), async delete() { throw new Error('R2 delete unavailable'); }
    }, MAX_R2_BYTES);
    await assert.rejects(service.upload(item.id, { filename: 'a.txt', mimeType: 'text/plain', bytes: Buffer.from('test') }, null, item.accessToken));
    assert.equal((await bucket.list()).objects.length, 1);
    assert.equal((await db.prepare('SELECT used_bytes FROM storage_quota').first()).used_bytes, 4);
    assert.equal((await db.prepare('SELECT state FROM attachment_storage').first()).state, 'deleting');
    assert.deepEqual((await service.list(item.id, null, item.accessToken)).items, []);
  } finally { await db.prepare('DROP TRIGGER test_attachment_failure').run(); }
});

test('lost metadata responses leave failed compensation hidden and immediately retryable', async () => {
  const item = await book(), repository = attachmentRepository(db);
  for (const failure of ['delete', 'release']) {
    const service = attachmentService(appointmentRepository(db), {
      ...repository,
      async create(value) { await repository.create(value); throw new Error('D1 response lost after commit'); },
      async release(id) { if (failure === 'release') throw new Error('D1 release unavailable'); await repository.release(id); }
    }, {
      put: (...args) => bucket.put(...args),
      async delete(key) { if (failure === 'delete') throw new Error('R2 delete unavailable'); await bucket.delete(key); }
    }, MAX_R2_BYTES);
    await assert.rejects(service.upload(item.id, { filename: 'a.txt', mimeType: 'text/plain', bytes: Buffer.from('test') }, null, item.accessToken), /D1 response lost after commit/);
    const allocation = await db.prepare('SELECT * FROM attachment_storage').first();
    assert.equal(allocation.state, 'deleting');
    assert.equal((await db.prepare('SELECT used_bytes FROM storage_quota').first()).used_bytes, 4);
    assert.equal((await bucket.list()).objects.length, failure === 'delete' ? 1 : 0);
    const base = `/api/appointments/${item.id}/attachments`;
    assert.deepEqual((await api(base,{accessToken:item.accessToken})).items, []);
    await api(`${base}/${allocation.id}`,{accessToken:item.accessToken},404);
    const result = await cleanupAttachments(repository, key => bucket.delete(key), { apply: true });
    assert.equal(result.deleted, 1); assert.equal(result.failed, 0);
    assert.equal((await db.prepare('SELECT used_bytes FROM storage_quota').first()).used_bytes, 0);
    assert.equal((await bucket.list()).objects.length, 0);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM appointment_attachments').first()).n, 0);
  }
});

test('write, lookup and upload limits are independent and shared by their routes', async () => {
  const item = await book(); // One write request in the shared IP bucket.
  const base = `/api/appointments/${item.id}/attachments`;
  const lookup = `/api/appointments/${item.id}`;
  for (let n = 1; n < 30; n++) {
    const path = n % 2 ? '/api/appointments' : `/api/appointments/${item.id}/status`;
    await api(path, { method: n % 2 ? 'POST' : 'PATCH', body: { status: 'invalid' } }, 400);
  }
  await api('/api/appointments', { method: 'POST', body: draft() }, 429);
  await api(`/api/appointments/${item.id}/status`, { method: 'PATCH', body: {} }, 429);
  for (let n = 0; n < 30; n++) {
    const paths = [lookup, base, `${base}/missing`];
    await api(paths[n % 3], {accessToken:item.accessToken}, n % 3 === 2 ? 404 : 200);
  }
  for (const path of [lookup, base, `${base}/missing`]) await api(path, {}, 429);
  for (let n = 0; n < 15; n++) await api(base, { accessToken:item.accessToken, method: 'POST', body: {} }, 400);
  await api(base, { accessToken:item.accessToken, method: 'POST', body: {} }, 429);
  await login(); // Login still has its own quota.
});

test('valid live polling does not consume quota; guessing shares the lookup limit',async()=>{
  const item=await book(),path=`/api/live/summary?appointmentId=${item.id}`;
  const snapshot=async()=>(await db.prepare('SELECT * FROM rate_limits ORDER BY key').all()).results;
  const before=await snapshot();
  for(let n=0;n<181;n++)await api(path,{accessToken:item.accessToken});
  await api(`/api/live/summary?date=${item.date}`);
  assert.deepEqual(await snapshot(),before);
  await api(`/api/appointments/${item.id}`,{accessToken:item.accessToken});
  for(let n=0;n<29;n++)await api(path,{accessToken:'x'.repeat(43)},404);
  await api(path,{accessToken:item.accessToken},429);
  await api(`/api/live/summary?date=${item.date}`);
  await db.prepare('UPDATE rate_limits SET expires_at=0').run();
  await api(path,{accessToken:item.accessToken});
});

test('Shanghai dates stay correct at UTC day boundaries', () => {
  assert.equal(dateKey(new Date('2026-10-04T15:59:59Z')), '2026-10-04');
  assert.equal(dateKey(new Date('2026-10-04T16:01:00Z')), '2026-10-05');
  assert.equal(formatDate('2026-10-04T16:01:00Z'), '2026年10月5日');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(serviceDay('2026-10-05'), true);
  assert.equal(serviceDay('2026-10-04'), false);
});

test('only the matching credential grants guest access and recovery revokes every old route',async()=>{
  const item=await book(),other=await book(),root=await login();
  const file=await api(`/api/appointments/${item.id}/attachments`,{method:'POST',accessToken:item.accessToken,body:{filename:'a.txt',mimeType:'text/plain',data:'dGVzdA=='}},201);
  const paths=[`/api/appointments/${item.id}`,`/api/appointments/${item.id}/attachments`,`/api/appointments/${item.id}/attachments/${file.id}`,`/api/live/summary?appointmentId=${item.id}`];
  for(const path of paths){
    await api(path,{accessToken:other.accessToken},404);
    await api(path,{},404);
  }
  await api(`/api/appointments/${item.id}?studentId=${item.studentId}`,{},404);
  await api(`/api/appointments/${item.id}?accessToken=${item.accessToken}`,{},404);
  await api(`/api/appointments/${item.id}/status`,{method:'PATCH',body:{studentId:item.studentId,status:'cancelled'}},404);
  await api(`/api/live/summary?studentId=${item.studentId}`,{},400);
  const technician=await addUser('690001');
  await api(`/api/appointments/${item.id}/credential`,{method:'POST',token:technician,body:{}},403);
  await api(`/api/appointments/${item.id}/credential`,{method:'POST',token:root,body:{identityVerified:false,reason:'已当面核验学生证和联系方式'}},400);
  const recovered=await api(`/api/appointments/${item.id}/credential`,{method:'POST',token:root,body:{identityVerified:true,reason:'已当面核验学生证和联系方式'}});
  assert.notEqual(item.accessToken,recovered.accessToken);
  for(const path of paths)await api(path,{accessToken:item.accessToken},404);
  await api(`/api/appointments/${item.id}`,{accessToken:recovered.accessToken});
  assert.equal((await request(`/api/appointments/${item.id}/attachments/${file.id}`,{accessToken:recovered.accessToken})).status,200);
  await api(`/api/appointments/${item.id}/status`,{method:'PATCH',accessToken:item.accessToken,body:{status:'cancelled'}},404);
  await api(`/api/appointments/${item.id}/status`,{method:'PATCH',accessToken:recovered.accessToken,body:{status:'cancelled'}});
  const audit=await db.prepare('SELECT * FROM credential_recoveries').first();
  assert.equal(audit.actor,'root001');assert.ok(!JSON.stringify(audit).includes(recovered.accessToken));
});

test('two requests for the final slot have one winner and cancellation releases capacity', async () => {
  for (let n = 0; n < 19; n++) await book();
  const attempts = await Promise.all([draft(), draft()].map(body => request('/api/appointments', { method: 'POST', body })));
  assert.deepEqual(attempts.map(response => response.status).sort(), [201,409]);
  const winner = await attempts.find(response => response.status === 201).json();
  await api(`/api/appointments/${winner.id}/status`, { method: 'PATCH', accessToken:winner.accessToken, body: { status: 'cancelled', studentId: winner.studentId } });
  await book();
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM appointments WHERE status NOT IN ('cancelled','no_show')").first()).n, 20);
});

test('SQL staff filters preserve literal searches, status groups and totals', async () => {
  const root = await login();
  const first = await book({ deviceModel: 'A%_Device' }), second = await book({ campus: '浑南' });
  await api(`/api/appointments/${first.id}/status`, { method: 'PATCH', token: root, body: { status: 'awaiting_claim' } });
  await api(`/api/appointments/${second.id}/status`, { method: 'PATCH', token: root, body: { status: 'completed' } });
  const filtered = await api(`/api/appointments?${new URLSearchParams({ q: '%_', campus: '南湖', date, status: 'pending' })}`, { token: root });
  assert.deepEqual(filtered.items.map(item => item.id), [first.id]);
  assert.deepEqual(filtered.counts, { all: 2, pending: 1, in_progress: 0, completed: 1 });
  assert.equal((await api('/api/appointments?q=no-match', { token: root })).items.length, 0);
  for (const query of ['status=invalid','date=2026-02-30','campus=invalid']) await api(`/api/appointments?${query}`, { token: root }, 400);
});

test('SQL queue counts use campus/slot scopes, deterministic ties and active status rules', async () => {
  const root = await login();
  const first = await book(), second = await book();
  await book({ campus: '浑南' });
  await book({ timeSlot: '20:00–21:00' });
  const ended = await book();
  await api(`/api/appointments/${ended.id}/status`, { method: 'PATCH', token: root, body: { status: 'no_show' } });
  await db.prepare('UPDATE appointments SET created_at=? WHERE id IN (?,?)').bind('2026-10-04T16:00:00.000Z', first.id, second.id).run();
  const summary = await api(`/api/live/summary?appointmentId=${second.id}`,{accessToken:second.accessToken});
  assert.equal(summary.dayTotal, 4); assert.equal(summary.campusDayTotal, 3); assert.equal(summary.slotTotal, 2);
  assert.equal(summary.queueTotal, 2); assert.equal(summary.ahead, 1); assert.equal(summary.position, 2);
  assert.deepEqual(summary.slots, { '19:00–20:00': 2, '20:00–21:00': 1 });
  await api(`/api/appointments/${first.id}/status`, { method: 'PATCH', token: root, body: { status: 'completed' } });
  assert.equal((await api(`/api/live/summary?appointmentId=${second.id}`,{accessToken:second.accessToken})).ahead, 1);
  await api(`/api/appointments/${first.id}/status`, { method: 'PATCH', token: root, body: { status: 'cancelled' } });
  assert.equal((await api(`/api/live/summary?appointmentId=${second.id}`,{accessToken:second.accessToken})).position, 1);
  assert.equal((await api(`/api/live/summary?appointmentId=${first.id}`,{accessToken:first.accessToken})).position, null);
});

test('SQL statistics aggregate date windows and workload without reading contact ciphertext', async () => {
  const root = await login();
  await addUser('650001');
  const recent = await book({ faultType: '蓝屏' }), older = await book({ faultType: '硬盘' }), skipped = await book();
  const today = dateKey(), past = addDays(today, -31);
  await db.prepare("UPDATE appointments SET date=?,status='completed',assigned_to='650001',social='unreadable' WHERE id=?").bind(today, recent.id).run();
  await db.prepare("UPDATE appointments SET date=?,status='completed',assigned_to='650001' WHERE id=?").bind(past, older.id).run();
  await db.prepare("UPDATE appointments SET date=?,status='no_show' WHERE id=?").bind(today, skipped.id).run();
  const current = await api('/api/stats/summary?range=7', { token: root });
  assert.equal(current.total, 2); assert.equal(current.completed, 1); assert.equal(current.noShow, 1);
  assert.deepEqual(current.daily, { [today]: { total: 2, completed: 1 } });
  assert.deepEqual(current.faults, { '蓝屏': 1 });
  assert.deepEqual(current.technicians, { '650001': { claimed: 1, completed: 1 } });
  const selected = await api(`/api/stats/summary?range=7&day=${past}`, { token: root });
  assert.equal(selected.total, 1); assert.deepEqual(selected.faults, { '硬盘': 1 });
  const all = await api('/api/stats/summary?range=all', { token: root });
  assert.equal(all.total, 3); assert.equal(all.completed, 2);
  const users = (await api('/api/users', { token: root })).items;
  assert.equal(users.find(user => user.account === '650001').workload, 2);
});

test('CSV streams multiple D1 pages without omitting or duplicating tied timestamps', async () => {
  const root = await login(), template = await book();
  const columns = (await db.prepare('PRAGMA table_info(appointments)').all()).results.map(row => row.name);
  // Generate history directly in D1; cancelled records do not consume live capacity.
  const select = columns.map(column => column === 'id' ? '?' : column === 'status' ? "'cancelled'" : column === 'access_token_hash' ? 'lower(hex(randomblob(32)))' : column).join(',');
  await db.batch(Array.from({ length: 205 }, (_, n) => db.prepare(`INSERT INTO appointments(${columns.join(',')}) SELECT ${select} FROM appointments WHERE id=?`).bind(`history-${String(n).padStart(4, '0')}`, template.id)));
  const response = await request('/api/export/appointments.csv', { token: root });
  assert.equal(response.status, 200);
  const lines = (await response.text()).trim().split('\r\n');
  assert.equal(lines.length, 207);
  const ids = lines.slice(1).map(line => line.split(',')[0]);
  assert.equal(new Set(ids).size, 206);
  assert.ok(ids.includes('"history-0000"') && ids.includes('"history-0204"'));
});

test('retired creation API is removed and activation rejects oversized identity fields',async()=>{
  const root=await login();
  await api('/api/users',{method:'POST',token:root,body:{}},404);
  for(const patch of [{studentId:'8'.repeat(21)},{name:'名'.repeat(81)}]){
    await api('/api/activation',{method:'POST',body:{studentId:'800001',name:'测试人员',homeCampus:'南湖',contact:'联系管理员核验',password,...patch}},400);
  }
});

test('technicians see campus summaries before claiming and only their own private records after',async()=>{
  const own=await book(),other=await book(),foreign=await book({campus:'浑南'});
  const token=await addUser('710001'),colleague=await addUser('710002');
  const listed=await api('/api/appointments',{token});
  assert.equal((await api(`/api/appointments?q=${own.studentId}`,{token})).items.length,0);
  assert.equal(listed.counts.all,2);assert.ok(!listed.items.some(item=>item.id===foreign.id));
  for(const item of listed.items){for(const field of ['studentId','name','phone','social','issue','serial','note','agreementAt','repairNote'])assert.ok(!Object.hasOwn(item,field),field);}
  await api(`/api/appointments/${foreign.id}/status`,{method:'PATCH',token,body:{status:'claimed'}},403);
  await api(`/api/appointments/${own.id}/attachments`,{token,accessToken:own.accessToken},403);
  await api(`/api/appointments/${other.id}/status`,{method:'PATCH',token:colleague,body:{status:'claimed'}});
  await api(`/api/appointments/${own.id}/status`,{method:'PATCH',token,body:{status:'claimed'}});
  const after=await api('/api/appointments',{token});
  assert.deepEqual(after.items.map(item=>item.id),[own.id]);assert.equal(after.items[0].social,'wechat-private');
  await api(`/api/appointments/${other.id}/attachments`,{token},403);
  await api(`/api/appointments/${other.id}/status`,{method:'PATCH',token,body:{repairNote:'越权修改'}},403);
  await api(`/api/appointments/${own.id}/status`,{method:'PATCH',token,body:{assignedTo:'710002'}},403);
});

test('admin campus grants constrain list, attachments, recovery, dispatch, statistics, export and account management',async()=>{
  const root=await login(),admin=await addUser('720001','admin');
  const local=await book(),foreign=await book({campus:'浑南'});
  assert.deepEqual((await api('/api/appointments',{token:admin})).items.map(item=>item.id),[local.id]);
  assert.equal((await api('/api/appointments?campus=浑南',{token:admin})).items.length,0);
  assert.equal((await api('/api/stats/summary?range=all',{token:admin})).total,1);
  const csv=await request('/api/export/appointments.csv',{token:admin});
  const text=await csv.text();assert.ok(text.includes(local.id) && !text.includes(foreign.id));
  await api(`/api/appointments/${foreign.id}/attachments`,{token:admin},403);
  await api(`/api/appointments/${foreign.id}/credential`,{method:'POST',token:admin,body:{identityVerified:true,reason:'已当面核验学生证和联系方式'}},403);
  await api(`/api/appointments/${foreign.id}/status`,{method:'PATCH',token:admin,body:{status:'claimed'}},403);
  await addUser('720002');
  await api('/api/users/720002',{method:'PATCH',token:root,body:{authorizedCampuses:['浑南']}});
  await api('/api/users/720002',{method:'PATCH',token:admin,body:{status:'disabled'}},403);
  await api(`/api/appointments/${local.id}/status`,{method:'PATCH',token:admin,body:{assignedTo:'720002'}},403);
  await api('/api/users/720001',{method:'PATCH',token:root,body:{authorizedCampuses:['浑南']}});
  await api('/api/auth/me',{token:admin},401);
  const changed=await login('720001');
  const info=await api('/api/auth/me',{token:changed});assert.equal(info.homeCampus,'南湖');assert.deepEqual(info.authorizedCampuses,['浑南']);
  assert.deepEqual((await api('/api/appointments',{token:changed})).items.map(item=>item.id),[foreign.id]);
});

test('self password change includes protected root, checks current password and revokes all sessions',async()=>{
  const root=await login(),second=await login();
  await api('/api/auth/password',{method:'PATCH',token:root,body:{currentPassword:'wrong',newPassword:'new-root-password'}},400);
  await api('/api/auth/password',{method:'PATCH',token:root,body:{currentPassword:password,newPassword:'new-root-password'}});
  try{
    await api('/api/auth/me',{token:root},401);await api('/api/auth/me',{token:second},401);
    await api('/api/auth/login',{method:'POST',body:{account:'root001',password}},401);
    const fresh=await login('root001','new-root-password');
    assert.equal((await db.prepare('SELECT protected FROM staff_accounts WHERE account=?').bind('root001').first()).protected,1);
    await api('/api/auth/revoke',{method:'POST',token:fresh});await api('/api/auth/me',{token:fresh},401);
  }finally{await db.prepare('UPDATE staff_accounts SET password_hash=? WHERE account=?').bind(hashPassword(password),'root001').run();}
});

test('stale concurrent account updates cannot replace campus grants or restore revoked privileges',async()=>{
  await addUser('730001');
  const repository=userRepository(db),original=await repository.find('730001');
  const results=await Promise.all([
    repository.update(original,{authorizedCampuses:['浑南']}),
    repository.update(original,{authorizedCampuses:['南湖','浑南'],role:'admin'})
  ]);
  assert.equal(results.filter(Boolean).length,1);
  const winner=results.find(Boolean),stored=await repository.find('730001');
  assert.deepEqual(stored.authorizedCampuses,winner.authorizedCampuses);assert.equal(stored.role,winner.role);
  assert.equal(stored.tokenVersion,original.tokenVersion+1);
});

test('whitelist application is separate from login and approval atomically installs only roster grants',async()=>{
  const token=await whitelistStaff('810001',{name:'真实部员',authorizedCampuses:['浑南']});
  const application=await applyStaff('810001',{name:'真实部员',role:'superadmin',authorizedCampuses:['南湖','浑南'],protected:true});
  await api('/api/auth/login',{method:'POST',body:{account:'810001',password}},401);
  assert.equal(await db.prepare('SELECT * FROM staff_accounts WHERE account=?').bind('810001').first(),null);
  const stored=await db.prepare('SELECT * FROM activation_requests WHERE id=?').bind(application.id).first();
  assert.ok(stored.password_hash.startsWith('scrypt$'));assert.ok(!stored.contact.includes('wechat-member'));
  assert.ok(!stored.receipt_hash.includes(application.receipt));
  await api(`/api/activation/${application.id}`,{},404);
  assert.equal((await api(`/api/activation/${application.id}`,{headers:{'X-Activation-Receipt':application.receipt}})).status,'pending');
  await api('/api/activation-requests/review',{method:'POST',token,body:{ids:[application.id],status:'approved',reviewNote:'已当面核验部员身份和学生证'}},400);
  await api('/api/activation-requests/review',{method:'POST',token,body:{ids:[application.id],status:'approved',identityVerified:true,reviewNote:'已当面核验部员身份和学生证'}});
  const user=await api('/api/auth/me',{token:await login('810001')});
  assert.equal(user.role,'technician');assert.deepEqual(user.authorizedCampuses,['浑南']);assert.equal(user.homeCampus,'南湖');
  assert.equal((await db.prepare('SELECT status FROM staff_whitelist WHERE student_id=?').bind('810001').first()).status,'activated');
  assert.equal((await db.prepare('SELECT password_hash FROM activation_requests WHERE id=?').bind(application.id).first()).password_hash,'');
  await api('/api/activation',{method:'POST',body:{studentId:'810001',name:'真实部员',homeCampus:'南湖',contact:'私密联系方式',password}},400);
});

test('concurrent activation submissions and approvals have exactly one winner',async()=>{
  const token=await whitelistStaff('820001');
  const body={studentId:'820001',name:'真实部员',homeCampus:'南湖',contact:'wechat-member',password};
  const submitted=await Promise.all([request('/api/activation',{method:'POST',body}),request('/api/activation',{method:'POST',body})]);
  assert.deepEqual(submitted.map(response=>response.status).sort(),[201,409]);
  const application=await submitted.find(response=>response.status===201).json();
  const review={ids:[application.id],status:'approved',identityVerified:true,reviewNote:'已当面核验部员身份和学生证'};
  const results=await Promise.all([request('/api/activation-requests/review',{method:'POST',token,body:review}),request('/api/activation-requests/review',{method:'POST',token,body:review})]);
  assert.deepEqual(results.map(response=>response.status).sort(),[200,409]);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM staff_accounts WHERE account=?').bind('820001').first()).n,1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM staff_campus_grants WHERE account=?').bind('820001').first()).n,1);
});

test('identity mismatch, duplicate pending attempts, rejection and reapplication do not reserve a staff account',async()=>{
  const token=await whitelistStaff('830001',{name:'真实部员'});
  await api('/api/activation',{method:'POST',body:{studentId:'830001',name:'冒名部员',homeCampus:'南湖',contact:'伪造联系',password}},400);
  const first=await applyStaff('830001',{name:'真实部员'});
  await api('/api/activation',{method:'POST',body:{studentId:'830001',name:'真实部员',homeCampus:'南湖',contact:'其他联系',password}},409);
  await api('/api/activation-requests/review',{method:'POST',token,body:{ids:[first.id],status:'rejected',reviewNote:'申请人未通过线下身份核验'}});
  const second=await applyStaff('830001',{name:'真实部员'});assert.notEqual(first.id,second.id);
  assert.equal((await api(`/api/activation/${first.id}`,{headers:{'X-Activation-Receipt':first.receipt}})).status,'rejected');
  await api('/api/auth/login',{method:'POST',body:{account:'830001',password}},401);
  await api('/api/staff-whitelist/830001',{method:'PATCH',token,body:{status:'revoked'}});
  assert.equal((await api(`/api/activation/${second.id}`,{headers:{'X-Activation-Receipt':second.receipt}})).status,'rejected');
  await api('/api/activation-requests/review',{method:'POST',token,body:{ids:[second.id],status:'approved',identityVerified:true,reviewNote:'已当面核验部员身份和学生证'}},409);
});

test('CSV import validates the entire roster, handles quoted cells and never overwrites existing eligibility',async()=>{
  const token=await login();
  const csv='\uFEFFstudentId,expectedName,expectedRole,authorizedCampuses\r\n840001,"张三,成员",technician,南湖|浑南\r\n840002,李四,admin,浑南';
  const result=await api('/api/staff-whitelist/import',{method:'POST',token,body:{csv}});assert.equal(result.imported.length,2);
  assert.equal((await api('/api/staff-whitelist',{token})).items.find(item=>item.studentId==='840001').expectedName,'张三,成员');
  assert.equal((await api('/api/staff-whitelist/import',{method:'POST',token,body:{csv}})).skipped.length,2);
  for(const invalid of ['studentId\n840003\nBAD','studentId\n840003\n840003','studentId,expectedRole\n840003,superadmin','studentId,name\n840003,张三','studentId\n"840003']){
    await api('/api/staff-whitelist/import',{method:'POST',token,body:{csv:invalid,authorizedCampuses:['南湖']}},400);
  }
  assert.equal(await db.prepare('SELECT student_id FROM staff_whitelist WHERE student_id=?').bind('840003').first(),null);
});

test('activation management rejects role and campus escalation and supports batch review',async()=>{
  const root=await login(),admin=await addUser('850001','admin'),technician=await addUser('850002');
  await api('/api/staff-whitelist',{token:technician},403);
  await api('/api/activation-requests',{token:technician},403);
  await api('/api/staff-whitelist/import',{method:'POST',token:admin,body:{csv:'studentId\n850003',expectedRole:'admin',authorizedCampuses:['南湖']}},403);
  await api('/api/staff-whitelist/import',{method:'POST',token:admin,body:{csv:'studentId\n850003',authorizedCampuses:['浑南']}},403);
  await api('/api/staff-whitelist/import',{method:'POST',token:root,body:{csv:'studentId\n850003\n850004',authorizedCampuses:['浑南']}});
  const first=await applyStaff('850003'),second=await applyStaff('850004');
  await api('/api/activation-requests/review',{method:'POST',token:admin,body:{ids:[first.id],status:'approved',identityVerified:true,reviewNote:'已当面核验部员身份和学生证'}},403);
  const result=await api('/api/activation-requests/review',{method:'POST',token:root,body:{ids:[first.id,second.id],status:'approved',identityVerified:true,reviewNote:'已分别当面核验两名部员和学生证'}});
  assert.equal(result.applied.length,2);await login('850003');await login('850004');
});

test('failed account grant creation rolls back approval, account and whitelist consumption together',async()=>{
  const token=await whitelistStaff('860001'),application=await applyStaff('860001');
  await db.prepare("CREATE TRIGGER test_activation_failure BEFORE INSERT ON staff_campus_grants WHEN NEW.account='860001' BEGIN SELECT RAISE(ABORT,'test failure'); END").run();
  try{
    await api('/api/activation-requests/review',{method:'POST',token,body:{ids:[application.id],status:'approved',identityVerified:true,reviewNote:'已当面核验部员身份和学生证'}},500);
    assert.equal(await db.prepare('SELECT account FROM staff_accounts WHERE account=?').bind('860001').first(),null);
    assert.equal((await db.prepare('SELECT status FROM activation_requests WHERE id=?').bind(application.id).first()).status,'pending');
    assert.equal((await db.prepare('SELECT status FROM staff_whitelist WHERE student_id=?').bind('860001').first()).status,'open');
  }finally{await db.prepare('DROP TRIGGER test_activation_failure').run();}
});
