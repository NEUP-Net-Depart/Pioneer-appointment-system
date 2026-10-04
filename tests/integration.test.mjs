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

let mf, db, bucket;
const MAX_R2_BYTES = 8589934592;
const password = 'integration-test-password-only';
const JWT_SECRET = randomBytes(48).toString('base64url');
const PII_ENCRYPTION_KEY = randomBytes(32).toString('hex');
const date = [0,1,2,3].map(n => addDays(dateKey(), n)).find(serviceDay);
let serial = 200000;
const draft = (patch = {}) => ({ studentId: String(++serial), name: '测试同学', campus: '南湖', phone: '13800138000', social: 'wechat-private', deviceType: '笔记本电脑', brand: '联想', deviceModel: 'ThinkPad', warranty: '否', date, timeSlot: '19:00–20:00', faultType: '蓝屏', issue: '', agreementAt: new Date().toISOString(), ...patch });
async function request(path, { method = 'GET', body, token, headers = {} } = {}) {
  return mf.dispatchFetch(`https://app.test${path}`, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
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
  await db.prepare('INSERT INTO users(account,name,role,campus,password_hash,created_at) VALUES (?,?,?,?,?,?)').bind(account, `人员${account}`, role, '南湖', hashPassword(password), dateKey()).run();
  return login(account);
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
  await db.prepare('INSERT INTO users(account,name,role,campus,protected,password_hash,created_at) VALUES (?,?,?,?,?,?,?)').bind('root001', '系统负责人', 'superadmin', '南湖 / 浑南', 1, hashPassword(password), dateKey()).run();
});
after(async () => { await mf?.dispose(); });
beforeEach(async () => {
  await db.batch(['DELETE FROM attachment_storage','DELETE FROM appointment_attachments','DELETE FROM appointments',"DELETE FROM users WHERE protected=0",'DELETE FROM rate_limits'].map(sql => db.prepare(sql)));
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
  const found = await api(`/api/appointments/lookup?appointmentId=${item.id}&studentId=${item.studentId}`);
  assert.equal(found.social, 'wechat-private'); assert.equal(found.phone, '13800138000');
  await api(`/api/appointments/lookup?appointmentId=${item.id}&studentId=999999`, {}, 404);
  await api('/api/appointments', {}, 401);
  const live = await api(`/api/live/summary?appointmentId=${item.id}&studentId=${item.studentId}`);
  assert.equal(live.position, 1); assert.equal(live.capacity, 20); assert.equal(live.slotTotal, 1);
  const cancelled = await api(`/api/appointments/${item.id}/status`, { method: 'PATCH', body: { status: 'cancelled', studentId: item.studentId, assignedTo: 'root001', repairNote: 'injection' } });
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
  await api('/api/appointments', { method: 'POST', body: { padding: 'x'.repeat(1024 * 1024) } }, 413);
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
  await api(`/api/appointments/${item.id}/status`, { method: 'PATCH', body: { status: 'cancelled', studentId: item.studentId } }, 409);
  await api(`/api/appointments/${item.id}/status`, { method: 'PATCH', token, body: { assignedTo: '' } }, 403);
  await api(`/api/appointments/${item.id}/status`, { method: 'PATCH', token, body: { status: 'pending' } }, 409);
  await api(`/api/appointments/${item.id}/status`, { method: 'PATCH', token, body: { status: 'in_progress' } });
  const done = await api(`/api/appointments/${item.id}/status`, { method: 'PATCH', token, body: { status: 'completed', repairNote: '已完成测试' } });
  assert.equal(done.repairNote, '已完成测试');
  await api(`/api/appointments/${item.id}/status`, { method: 'PATCH', token, body: { status: 'claimed' } }, 409);
});
test('account lifecycle, RBAC, role revocation, password reset and protected root', async () => {
  const root = await login();
  const created = await api('/api/users', { method: 'POST', token: root, body: { account: '400001', name: '测试人员', campus: '南湖', password, role: 'superadmin', protected: true } }, 201);
  assert.equal(created.role, 'student'); assert.equal(created.protected, false); assert.ok(!created.passwordHash);
  const student = await login('400001');
  await api('/api/users', { token: student }, 403);
  await api('/api/users/400001', { method: 'PATCH', token: root, body: { role: 'technician' } });
  await api('/api/auth/me', { token: student }, 401);
  const technician = await login('400001');
  await api('/api/stats/summary', { token: technician }, 403);
  const admin = await addUser('400002', 'admin');
  await api('/api/users/400001', { method: 'PATCH', token: admin, body: { role: 'admin' } }, 403);
  await api('/api/users/root001', { method: 'DELETE', token: root }, 403);
  await api('/api/users/root001', { method: 'PATCH', token: root, body: { password: 'different-password' } }, 403);
  await api('/api/users/400001', { method: 'PATCH', token: root, body: { password: 'new-test-password' } });
  await api('/api/auth/me', { token: technician }, 401);
  await api('/api/auth/login', { method: 'POST', body: { account: '400001', password } }, 401);
  const updated = await login('400001', 'new-test-password');
  await api('/api/users/400001', { method: 'PATCH', token: root, body: { active: false } });
  await api('/api/auth/me', { token: updated }, 401);
  await api('/api/users/400001', { method: 'DELETE', token: root });
  await api('/api/auth/login', { method: 'POST', body: { account: '400001', password: 'new-test-password' } }, 401);
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
test('basic staff cannot see or mutate another student reservation', async () => {
  const token = await addUser('700001', 'student');
  const own = await book({ studentId: '700001', name: '人员700001' });
  const other = await book();
  const listed = await api('/api/appointments', { token });
  assert.deepEqual(listed.items.map(item => item.id), [own.id]);
  await api(`/api/appointments/${other.id}/status`, { method: 'PATCH', token, body: { status: 'cancelled', studentId: other.studentId } }, 403);
  await api(`/api/appointments/${other.id}/attachments?studentId=${other.studentId}`, { token }, 404);
  await api('/api/appointments', { method: 'POST', token, body: draft() }, 403);
  await api(`/api/appointments/${own.id}/status`, { method: 'PATCH', token, body: { status: 'cancelled' } });
});
test('R2 upload/download preserves bytes, enforces credentials and hides storage keys', async () => {
  const item = await book(), other = await book();
  const bytes = Buffer.from('附件中文测试\nrepair notes');
  const input = { studentId: item.studentId, filename: '../维修记录.txt', mimeType: 'text/plain', data: bytes.toString('base64') };
  const base = `/api/appointments/${item.id}/attachments`;
  const attachment = await api(base, { method: 'POST', body: input }, 201);
  assert.equal(attachment.filename, '维修记录.txt'); assert.ok(!attachment.objectKey);
  assert.equal(Date.parse(attachment.expiresAt) - Date.parse(attachment.createdAt), 180 * 86400000);
  assert.equal((await db.prepare('SELECT used_bytes FROM storage_quota').first()).used_bytes, bytes.length);
  assert.equal((await bucket.list()).objects.length, 1);
  await api(base, {}, 404);
  await api(base, { method: 'POST', body: { ...input, studentId: '999999' } }, 404);
  await api(`${base}/${attachment.id}?studentId=999999`, {}, 404);
  await api(`/api/appointments/${other.id}/attachments/${attachment.id}?studentId=${other.studentId}`, {}, 404);
  const response = await request(`${base}/${attachment.id}?studentId=${item.studentId}`);
  assert.equal(response.status, 200); assert.ok(response.headers.get('content-disposition').includes("filename*=UTF-8''"));
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  const token = await addUser('500001');
  assert.equal((await request(`${base}/${attachment.id}`, { token })).status, 200);
  await api(base, { method: 'POST', body: { ...input, mimeType: 'text/html' } }, 400);
  await api(base, { method: 'POST', body: { ...input, mimeType: 'image/png' } }, 400);
  await api(base, { method: 'POST', body: { ...input, data: '%%%=' } }, 400);
  await api(base, { method: 'POST', body: { ...input, data: Buffer.alloc(5 * 1024 * 1024 + 1, 65).toString('base64') } }, 400);
});
test('R2 write is compensated when D1 metadata fails', async () => {
  const item = await book();
  await db.prepare("CREATE TRIGGER test_attachment_failure BEFORE INSERT ON appointment_attachments BEGIN SELECT RAISE(ABORT,'test failure'); END").run();
  try {
    await api(`/api/appointments/${item.id}/attachments`, { method: 'POST', body: { studentId: item.studentId, filename: 'a.txt', mimeType: 'text/plain', data: 'dGVzdA==' } }, 500);
    assert.equal((await bucket.list()).objects.length, 0);
    assert.equal((await db.prepare('SELECT used_bytes FROM storage_quota').first()).used_bytes, 0);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM attachment_storage').first()).n, 0);
  } finally { await db.prepare('DROP TRIGGER test_attachment_failure').run(); }
});
test('statistics and CSV reflect completed jobs and survive staff deletion', async () => {
  const root = await login(), technician = await addUser('600001');
  const item = await book({ name: '=SUM(1,1)' });
  await api(`/api/appointments/${item.id}/status`, { method: 'PATCH', token: technician, body: { status: 'claimed' } });
  await api(`/api/appointments/${item.id}/status`, { method: 'PATCH', token: technician, body: { status: 'completed', repairNote: '完成' } });
  await api('/api/users/600001', { method: 'DELETE', token: root });
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
  const responses = await Promise.all(Array.from({ length: 10 }, () => request(`/api/appointments/${item.id}/attachments`, { method: 'POST', body: input })));
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
  await assert.rejects(failingPut.upload(item.id, input, null, item.studentId), /put failed/);
  assert.equal((await db.prepare('SELECT used_bytes FROM storage_quota').first()).used_bytes, 0);
  const ambiguousPut = attachmentService(appointments, repository, {
    async put(...args) { await bucket.put(...args); throw new Error('put response lost'); },
    async delete() { throw new Error('delete failed'); }
  }, MAX_R2_BYTES);
  await assert.rejects(ambiguousPut.upload(item.id, input, null, item.studentId), /put response lost/);
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
  const file = await api(base, { method: 'POST', body: { studentId: item.studentId, filename: 'a.txt', mimeType: 'text/plain', data: 'dGVzdA==' } }, 201);
  const expires = new Date().toISOString();
  await db.batch([
    db.prepare('UPDATE appointment_attachments SET expires_at=?').bind(expires),
    db.prepare('UPDATE attachment_storage SET expires_at=?').bind(expires)
  ]);
  for (const options of [{}, { token }]) {
    assert.deepEqual((await api(`${base}?studentId=${item.studentId}`, options)).items, []);
    await api(`${base}/${file.id}?studentId=${item.studentId}`, options, 404);
  }
  assert.deepEqual((await api(`/api/appointments/lookup?appointmentId=${item.id}&studentId=${item.studentId}`)).attachments, []);
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
  await assert.rejects(service.upload(item.id, { filename: 'a.txt', mimeType: 'text/plain', bytes: Buffer.from('test') }, null, item.studentId), error => error.status === 507);
  assert.equal((await bucket.list()).objects.length, 0);
});

test('historical attachments migrate from original timestamps and initialize quota exactly once', async () => {
  const legacy = await mf.getD1Database('MIGRATION_DB');
  await applyMigration(legacy, '0001_initial.sql'); await applyMigration(legacy, '0002_query_indexes.sql');
  const item = await book(), row = await db.prepare('SELECT * FROM appointments WHERE id=?').bind(item.id).first();
  const columns = Object.keys(row);
  await legacy.prepare(`INSERT INTO appointments(${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).bind(...Object.values(row)).run();
  const oldCreated = '2026-01-01T12:34:56.123Z', recentCreated = new Date().toISOString();
  for (const [id, size, created] of [['old', 5, oldCreated], ['recent', 6, recentCreated]]) {
    await legacy.prepare("INSERT INTO appointment_attachments VALUES (?,?,'a.txt','text/plain',?,?,?)").bind(id, item.id, size, `appointments/${item.id}/${id}`, created).run();
  }
  await applyMigration(legacy, '0003_attachment_storage.sql');
  const migrated = (await legacy.prepare('SELECT id,expires_at FROM appointment_attachments ORDER BY id').all()).results;
  assert.deepEqual(migrated, [
    { id: 'old', expires_at: new Date(Date.parse(oldCreated) + 180 * 86400000).toISOString() },
    { id: 'recent', expires_at: new Date(Date.parse(recentCreated) + 180 * 86400000).toISOString() }
  ]);
  assert.equal((await legacy.prepare('SELECT used_bytes FROM storage_quota').first()).used_bytes, 11);
  const repository = attachmentRepository(legacy);
  assert.deepEqual((await repository.list(item.id, new Date().toISOString())).map(file => file.id), ['recent']);
  const cleanup = await cleanupAttachments(repository, async () => {}, { apply: true });
  assert.equal(cleanup.deleted, 1);
  assert.equal((await legacy.prepare('SELECT used_bytes FROM storage_quota').first()).used_bytes, 6);
  assert.deepEqual((await legacy.prepare('PRAGMA foreign_key_check').all()).results, []);
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
    await assert.rejects(service.upload(item.id, { filename: 'a.txt', mimeType: 'text/plain', bytes: Buffer.from('test') }, null, item.studentId));
    assert.equal((await bucket.list()).objects.length, 1);
    assert.equal((await db.prepare('SELECT used_bytes FROM storage_quota').first()).used_bytes, 4);
    assert.equal((await db.prepare('SELECT state FROM attachment_storage').first()).state, 'deleting');
    assert.deepEqual((await service.list(item.id, null, item.studentId)).items, []);
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
    await assert.rejects(service.upload(item.id, { filename: 'a.txt', mimeType: 'text/plain', bytes: Buffer.from('test') }, null, item.studentId), /D1 response lost after commit/);
    const allocation = await db.prepare('SELECT * FROM attachment_storage').first();
    assert.equal(allocation.state, 'deleting');
    assert.equal((await db.prepare('SELECT used_bytes FROM storage_quota').first()).used_bytes, 4);
    assert.equal((await bucket.list()).objects.length, failure === 'delete' ? 1 : 0);
    const base = `/api/appointments/${item.id}/attachments`;
    assert.deepEqual((await api(`${base}?studentId=${item.studentId}`)).items, []);
    await api(`${base}/${allocation.id}?studentId=${item.studentId}`, {}, 404);
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
  const lookup = `/api/appointments/lookup?appointmentId=${item.id}&studentId=${item.studentId}`;
  for (let n = 1; n < 30; n++) {
    const path = n % 2 ? '/api/appointments' : `/api/appointments/${item.id}/status`;
    await api(path, { method: n % 2 ? 'POST' : 'PATCH', body: { status: 'invalid' } }, 400);
  }
  await api('/api/appointments', { method: 'POST', body: draft() }, 429);
  await api(`/api/appointments/${item.id}/status`, { method: 'PATCH', body: {} }, 429);
  for (let n = 0; n < 30; n++) {
    const paths = [lookup, `${base}?studentId=${item.studentId}`, `${base}/missing?studentId=${item.studentId}`];
    await api(paths[n % 3], {}, n % 3 === 2 ? 404 : 200);
  }
  for (const path of [lookup, `${base}?studentId=${item.studentId}`, `${base}/missing?studentId=${item.studentId}`]) await api(path, {}, 429);
  for (let n = 0; n < 15; n++) await api(base, { method: 'POST', body: {} }, 400);
  await api(base, { method: 'POST', body: {} }, 429);
  await login(); // Login still has its own quota.
});

test('valid live polling does not consume quota; credential guessing shares the lookup limit', async () => {
  const item = await book();
  const snapshot = () => db.prepare('SELECT * FROM rate_limits ORDER BY key').all();
  const before = await snapshot();
  const path = `/api/live/summary?appointmentId=${item.id}&studentId=${item.studentId}`;
  for (let n = 0; n < 181; n++) await api(path);
  await api(`/api/live/summary?date=${item.date}&campus=${encodeURIComponent(item.campus)}`);
  await api('/api/live/summary?date=invalid', {}, 400);
  await api(`/api/live/summary?appointmentId=${item.id}`, {}, 400);
  await api(`/api/live/summary?studentId=${item.studentId}`, {}, 400);
  assert.deepEqual((await snapshot()).results, before.results);
  const lookup = `/api/appointments/lookup?appointmentId=${item.id}&studentId=${item.studentId}`;
  await api(lookup); // Interactive lookups and failed queue credentials share 30 attempts.
  for (let n = 0; n < 29; n++) await api(`/api/live/summary?appointmentId=${item.id}&studentId=999999`, {}, 404);
  const exhausted = (await snapshot()).results;
  for (const blocked of [path, path.replace(item.studentId, '999999')]) await api(blocked, {}, 429);
  await api(`/api/live/summary?date=${item.date}`); // Public capacity still works.
  assert.deepEqual((await snapshot()).results, exhausted);
  await api(lookup, {}, 429);
  await db.prepare('UPDATE rate_limits SET expires_at=0').run();
  await api(path); // Expired quota no longer blocks valid polls or triggers writes.
  const expired = (await snapshot()).results;
  assert.ok(expired.every(row => row.expires_at === 0));
  await api(path);
  assert.deepEqual((await snapshot()).results, expired);
});
test('Shanghai dates stay correct at UTC day boundaries', () => {
  assert.equal(dateKey(new Date('2026-10-04T15:59:59Z')), '2026-10-04');
  assert.equal(dateKey(new Date('2026-10-04T16:01:00Z')), '2026-10-05');
  assert.equal(formatDate('2026-10-04T16:01:00Z'), '2026年10月5日');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(serviceDay('2026-10-05'), true);
  assert.equal(serviceDay('2026-10-04'), false);
});

test('two requests for the final slot have one winner and cancellation releases capacity', async () => {
  for (let n = 0; n < 19; n++) await book();
  const attempts = await Promise.all([draft(), draft()].map(body => request('/api/appointments', { method: 'POST', body })));
  assert.deepEqual(attempts.map(response => response.status).sort(), [201,409]);
  const winner = await attempts.find(response => response.status === 201).json();
  await api(`/api/appointments/${winner.id}/status`, { method: 'PATCH', body: { status: 'cancelled', studentId: winner.studentId } });
  await book();
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM appointments WHERE status NOT IN ('cancelled','no_show')").first()).n, 20);
});

test('SQL staff filters preserve literal searches, status groups, totals and student scope', async () => {
  const root = await login();
  const first = await book({ deviceModel: 'A%_Device' }), second = await book({ campus: '浑南' });
  await api(`/api/appointments/${first.id}/status`, { method: 'PATCH', token: root, body: { status: 'awaiting_claim' } });
  await api(`/api/appointments/${second.id}/status`, { method: 'PATCH', token: root, body: { status: 'completed' } });
  const filtered = await api(`/api/appointments?${new URLSearchParams({ q: '%_', campus: '南湖', date, status: 'pending' })}`, { token: root });
  assert.deepEqual(filtered.items.map(item => item.id), [first.id]);
  assert.deepEqual(filtered.counts, { all: 2, pending: 1, in_progress: 0, completed: 1 });
  assert.equal((await api('/api/appointments?q=no-match', { token: root })).items.length, 0);
  for (const query of ['status=invalid','date=2026-02-30','campus=invalid']) await api(`/api/appointments?${query}`, { token: root }, 400);
  const student = await addUser(first.studentId, 'student');
  assert.equal((await api('/api/appointments', { token: student })).counts.all, 1);
});

test('SQL queue counts use campus/slot scopes, deterministic ties and active status rules', async () => {
  const root = await login();
  const first = await book(), second = await book();
  await book({ campus: '浑南' });
  await book({ timeSlot: '20:00–21:00' });
  const ended = await book();
  await api(`/api/appointments/${ended.id}/status`, { method: 'PATCH', token: root, body: { status: 'no_show' } });
  await db.prepare('UPDATE appointments SET created_at=? WHERE id IN (?,?)').bind('2026-10-04T16:00:00.000Z', first.id, second.id).run();
  const summary = await api(`/api/live/summary?appointmentId=${second.id}&studentId=${second.studentId}`);
  assert.equal(summary.dayTotal, 4); assert.equal(summary.campusDayTotal, 3); assert.equal(summary.slotTotal, 2);
  assert.equal(summary.queueTotal, 2); assert.equal(summary.ahead, 1); assert.equal(summary.position, 2);
  assert.deepEqual(summary.slots, { '19:00–20:00': 2, '20:00–21:00': 1 });
  await api(`/api/appointments/${first.id}/status`, { method: 'PATCH', token: root, body: { status: 'completed' } });
  assert.equal((await api(`/api/live/summary?appointmentId=${second.id}&studentId=${second.studentId}`)).ahead, 1);
  await api(`/api/appointments/${first.id}/status`, { method: 'PATCH', token: root, body: { status: 'cancelled' } });
  assert.equal((await api(`/api/live/summary?appointmentId=${second.id}&studentId=${second.studentId}`)).position, 1);
  assert.equal((await api(`/api/live/summary?appointmentId=${first.id}&studentId=${first.studentId}`)).position, null);
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
  const select = columns.map(column => column === 'id' ? '?' : column === 'status' ? "'cancelled'" : column).join(',');
  await db.batch(Array.from({ length: 205 }, (_, n) => db.prepare(`INSERT INTO appointments(${columns.join(',')}) SELECT ${select} FROM appointments WHERE id=?`).bind(`history-${String(n).padStart(4, '0')}`, template.id)));
  const response = await request('/api/export/appointments.csv', { token: root });
  assert.equal(response.status, 200);
  const lines = (await response.text()).trim().split('\r\n');
  assert.equal(lines.length, 207);
  const ids = lines.slice(1).map(line => line.split(',')[0]);
  assert.equal(new Set(ids).size, 206);
  assert.ok(ids.includes('"history-0000"') && ids.includes('"history-0204"'));
});

test('long account fields are rejected instead of silently changing identity', async () => {
  const root = await login();
  await api('/api/users', { method: 'POST', token: root, body: { account: '8'.repeat(21), name: '测试人员', campus: '南湖', password } }, 400);
  await api('/api/users', { method: 'POST', token: root, body: { account: '800001', name: '名'.repeat(81), campus: '南湖', password } }, 400);
});
