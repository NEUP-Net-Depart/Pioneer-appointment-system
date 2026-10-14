import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomBytes, createHmac } from 'node:crypto';
import { Miniflare } from 'miniflare';
import { hashPassword } from '../src/lib/passwords.js';
import { signToken } from '../src/lib/jwt.js';
import { config, wrangler } from '../scripts/cli.mjs';
import { dateKey, addDays, serviceDay, formatDate, slotDeadline, weekRange, expirationDeadline } from '../shared/time.js';
import { attachmentRepository } from '../src/db/attachments.js';
import { appointmentRepository } from '../src/db/appointments.js';
import { appointmentService } from '../src/services/appointments.js';
import { bookingInput } from '../src/lib/validation.js';
import { expireAppointments } from '../scripts/expire-appointments.mjs';
import { attachmentService } from '../src/services/attachments.js';
import { storageLimit } from '../src/lib/env.js';
import { cleanupAttachments } from '../scripts/cleanup-attachments.mjs';
import { cloudflareClient } from '../scripts/cloudflare-d1.mjs';
import { userRepository } from '../src/db/users.js';
import { TIME_SLOTS } from '../shared/constants.js';

let mf, db, bucket;
const MAX_R2_BYTES = 8589934592;
const password = 'integration-test-password-only';
const JWT_SECRET = randomBytes(48).toString('base64url');
const PII_ENCRYPTION_KEY = randomBytes(32).toString('hex');
const bookingDates = [0,1,2,3].map(n => addDays(dateKey(), n)).filter(serviceDay);
const date = bookingDates.find(day => Date.now() < Date.parse(slotDeadline(day,'19:00–19:30'))) || bookingDates[0];
const testNow = new Date(`${dateKey()}T10:00:00+08:00`).toISOString();
let serial = 200000;
const signature = [[[0.1,0.1],[0.2,0.3],[0.3,0.2],[0.4,0.4],[0.5,0.2],[0.6,0.3],[0.7,0.1],[0.8,0.4]]];
const photo = { filename: 'computer.png', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=' };
const draft = (patch = {}) => ({ signature, studentId: String(++serial), name: '测试同学', campus: '南湖', phone: '13800138000', social: 'wechat-private', deviceType: '笔记本电脑', brand: '联想', deviceModel: 'ThinkPad', warranty: '否', date, timeSlot: '19:00–19:30', faultType: '蓝屏', issue: '', agreementAt: new Date().toISOString(), ...patch });
async function request(path, { method = 'GET', body, token, accessToken, headers = {} } = {}) {
  return mf.dispatchFetch(`https://app.test${path}`, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(accessToken ? {'X-Appointment-Token':accessToken} : {}), ...headers }, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
}
async function api(path, options, status = 200) {
  const response = await request(path, options);
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
}
async function intake(item, token) {
  const front = await api(`/api/appointments/${item.id}/attachments`, {method:'POST',token,body:{...photo,purpose:'intake_front'}},201);
  const back = await api(`/api/appointments/${item.id}/attachments`, {method:'POST',token,body:{...photo,purpose:'intake_back'}},201);
  return {frontPhotoId:front.id,backPhotoId:back.id};
}
async function setAppointmentDate(id, day) {
  await db.prepare('UPDATE appointments SET date=?,expires_at=? WHERE id=?').bind(day,expirationDeadline(day),id).run();
}
const book = patch => api('/api/appointments', { method: 'POST', body: draft(patch) }, 201);
async function login(account = 'root001', suppliedPassword = password) {
  return (await api('/api/auth/login', { method: 'POST', body: { account, password: suppliedPassword } })).token;
}
async function configureCapacity(token, capacity, { campus = '南湖', timeSlot = '19:00–19:30', weekday = new Date(date+'T00:00:00Z').getUTCDay() } = {}) {
  const { items } = await api('/api/slot-capacities', { token });
  const item = items.find(row => row.campus === campus && row.weekday === weekday && row.timeSlot === timeSlot);
  return api('/api/slot-capacities', { method: 'PATCH', token, body: { ...item, capacity } });
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
  return api('/api/activation',{method:'POST',body:{studentId,name:`人员${studentId}`,homeCampus:'南湖',password,...patch}},201);
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
    env: { DB: { type: 'd1', id: 'test-db' }, CAPACITY_UPGRADE_DB: { type: 'd1', id: 'capacity-upgrade-db' }, WORKFLOW_UPGRADE_DB: { type: 'd1', id: 'workflow-upgrade-db' }, SLOT_SETTINGS_UPGRADE_DB: { type: 'd1', id: 'slot-settings-upgrade-db' }, ATTACHMENTS: { type: 'r2', name: 'test-attachments' },
      SCHEDULE_UPGRADE_DB: { type: 'd1', id: 'schedule-upgrade-db' },
      SCAN_UPGRADE_DB: { type: 'd1', id: 'scan-upgrade-db' },
      EXPIRATION_UPGRADE_DB: { type: 'd1', id: 'expiration-upgrade-db' },
      FIVE_STATUS_UPGRADE_DB: { type: 'd1', id: 'five-status-upgrade-db' },
      SCAN_WORKBENCH_ENABLED: { type: 'text', value: 'true' },
      TEST_NOW: { type: 'text', value: testNow },
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
  await db.batch(['DELETE FROM appointment_corrections','DELETE FROM credential_recoveries','DELETE FROM activation_requests','DELETE FROM staff_whitelist','DELETE FROM attachment_storage','DELETE FROM appointment_attachments','DELETE FROM appointments','DELETE FROM booking_day_slots',"DELETE FROM staff_accounts WHERE protected=0",'DELETE FROM rate_limits'].map(sql => db.prepare(sql)));
  await db.prepare('UPDATE storage_quota SET used_bytes=0 WHERE id=1').run();
  await db.prepare('UPDATE slot_capacities SET capacity=10,revision=0').run();
  await db.prepare('UPDATE weekday_slot_capacities SET capacity=5,revision=0').run();
  const objects = await bucket.list();
  if (objects.objects.length) await bucket.delete(objects.objects.map(object => object.key));
});

test('scan lookup needs staff authorization, preserves campus scope and never starts a repair', async () => {
  const item = await book(), tech = await addUser('993001');
  const headers = {accessToken:item.accessToken};
  const {code} = await api(`/api/appointments/${item.id}/scan-code`, headers);
  assert.match(code, new RegExp(`^${item.id}\\.[a-f0-9]{12}$`));
  assert.ok(!code.includes(item.accessToken));
  await api(`/api/appointments/${item.id}/scan-code`, {}, 404);
  await api('/api/scan/resolve', {method:'POST',body:{code}}, 401);
  await api(`/api/appointments/${item.id}`, {accessToken:code}, 404);
  const resolve = body => api('/api/scan/resolve', {method:'POST',token:tech,body});
  for (const body of [{code},{code},{id:item.id}]) {
    const found = await resolve(body);
    assert.equal(found.id, item.id); assert.equal(found.status,'booked'); assert.equal(found.revision,0);
    for (const field of ['studentId','name','phone','social','accessToken','accessTokenHash','signature']) assert.equal(found[field],undefined);
  }
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM active_repairs').first()).n,0);
  const foreign = await book({campus:'浑南'});
  const foreignCode = await api(`/api/appointments/${foreign.id}/scan-code`, {accessToken:foreign.accessToken});
  await api('/api/scan/resolve',{method:'POST',token:tech,body:foreignCode},403);
  await api('/api/scan/resolve',{method:'POST',token:tech,body:{code:code.slice(0,-1)+'z'}},400);
  const root = await login();
  await api(`/api/appointments/${item.id}/credential`,{method:'POST',token:root,body:{identityVerified:true,reason:'已核验学生证与登记联系方式'}});
  assert.equal((await resolve({code})).id,item.id, 'student credential rotation must not invalidate a repair QR');
});

test('one staff member cannot start two jobs, retrying intake and completion is idempotent, and corrections obey the claim', async () => {
  const tech = await addUser('993002'), root = await login(), items = [await book(),await book()];
  const photos = await Promise.all(items.map(item => intake(item,tech)));
  const starts = await Promise.all(items.map((item,index) => request(`/api/appointments/${item.id}/status`,{method:'PATCH',token:tech,body:{status:'in_progress',revision:0,...photos[index]}})));
  assert.deepEqual(starts.map(result=>result.status).sort(),[200,409]);
  const winner = starts.findIndex(result=>result.status===200), other = 1-winner;
  const started = await starts[winner].json();
  const retryBody = {status:'in_progress',revision:0,...photos[winner]};
  for (const result of await Promise.all([0,1].map(()=>api(`/api/appointments/${started.id}/status`,{method:'PATCH',token:tech,body:retryBody})))) {
    assert.equal(result.revision,started.revision); assert.equal(result.startedAt,started.startedAt);
  }
  assert.deepEqual((await api('/api/scan/current',{token:await login('993002')})).items.map(item=>item.id),[started.id]);
  const second = await api(`/api/appointments/${items[other].id}/status`,{method:'PATCH',token:root,body:{status:'in_progress',...await intake(items[other],root)}});
  await api(`/api/appointments/${second.id}/status`,{method:'PATCH',token:root,body:{action:'correct',assignedTo:'993002'}},409);
  const end = {status:'completed',outcome:'repaired',repairNote:'已维修并复测',revision:started.revision};
  const finished = await Promise.all([0,1].map(()=>api(`/api/appointments/${started.id}/status`,{method:'PATCH',token:tech,body:end})));
  assert.equal(finished[0].revision,finished[1].revision); assert.equal(finished[0].completedAt,finished[1].completedAt);
  assert.deepEqual((await api('/api/scan/current',{token:tech})).items,[]);
  const transferred = await api(`/api/appointments/${second.id}/status`,{method:'PATCH',token:root,body:{action:'correct',assignedTo:'993002'}});
  assert.equal(transferred.assignedTo,'993002');
  await api(`/api/appointments/${started.id}/status`,{method:'PATCH',token:root,body:{action:'correct',status:'in_progress'}},409);
  assert.deepEqual((await db.prepare('SELECT account,appointment_id FROM active_repairs').all()).results,[{account:'993002',appointment_id:second.id}]);
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
});

test('staff onsite registration is scoped, retry-safe, outside slot capacity and recoverable before intake', async () => {
  const root = await login(), tech = await addUser('993003');
  await configureCapacity(root,0);
  const input = {...draft(),requestId:crypto.randomUUID()};
  await api('/api/scan/onsite',{method:'POST',body:input},401);
  await api('/api/scan/onsite',{method:'POST',token:tech,body:{...input,campus:'浑南'}},403);
  await api('/api/scan/onsite',{method:'POST',token:tech,body:{...input,signature:[]}},400);
  const registrations = await Promise.all([0,1].map(()=>api('/api/scan/onsite',{method:'POST',token:tech,body:input},201)));
  assert.equal(registrations[0].id,registrations[1].id);
  const item = registrations[0];
  assert.equal(item.source,'onsite'); assert.equal(item.status,'booked'); assert.equal(item.accessToken,undefined);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM appointments').first()).n,1);
  const row = await db.prepare('SELECT registered_by,registration_key,signature,social FROM appointments').first();
  assert.equal(row.registered_by,'993003'); assert.equal(row.registration_key,input.requestId); assert.equal(row.signature,JSON.stringify(signature)); assert.match(row.social,/^enc\$/);
  assert.equal((await api('/api/scan/current',{token:tech})).pending.id,item.id);
  assert.deepEqual((await api('/api/scan/current?registrationRequestId='+input.requestId,{token:tech})).registration,{id:item.id,status:'booked'});
  assert.equal((await api('/api/scan/current?registrationRequestId='+input.requestId,{token:root})).registration,null);
  const live = await api(`/api/live/summary?date=${dateKey()}&campus=${encodeURIComponent('南湖')}`);
  assert.equal(live.slotTotal,0);
  const started = await api(`/api/appointments/${item.id}/status`,{method:'PATCH',token:tech,body:{status:'in_progress',...await intake(item,tech)}});
  await api('/api/scan/onsite',{method:'POST',token:tech,body:{...draft(),requestId:crypto.randomUUID()}},409);
  assert.equal((await api('/api/scan/onsite',{method:'POST',token:tech,body:input},201)).id,item.id);
  await api(`/api/appointments/${item.id}/status`,{method:'PATCH',token:tech,body:{status:'completed',outcome:'not_needed',repairNote:'无需处理',revision:started.revision}});
  assert.equal((await api('/api/scan/current',{token:tech})).pending,null);
  assert.deepEqual((await api('/api/scan/current?registrationRequestId='+input.requestId,{token:tech})).registration,{id:item.id,status:'completed'});
  const next = await api('/api/scan/onsite',{method:'POST',token:tech,body:{...draft(),requestId:crypto.randomUUID()}},201);
  assert.notEqual(next.id,item.id);
});

test('expired onsite registrations cannot bypass photo intake through administrator corrections', async () => {
  const root = await login(), tech = await addUser('993005');
  const item = await api('/api/scan/onsite', { method: 'POST', token: tech, body: { ...draft(), requestId: crypto.randomUUID() } }, 201);
  await setAppointmentDate(item.id, addDays(dateKey(new Date(testNow)), -1));
  await api(`/api/appointments/${item.id}/status`, { method: 'PATCH', token: root, body: { action: 'correct', status: 'in_progress', assignedTo: 'root001' } }, 409);
  await api(`/api/appointments/${item.id}/status`, { method: 'PATCH', token: root, body: { action: 'correct', status: 'completed', outcome: 'repaired', repairNote: '未经签到直接修改结果', assignedTo: 'root001' } }, 409);
  const expired = await appointmentRepository(db).find(item.id);
  assert.equal(expired.status, 'expired'); assert.equal(expired.outcome, null);
  assert.equal(expired.frontPhotoId, null); assert.equal(expired.backPhotoId, null);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM active_repairs').first()).n, 0);
});

test('new onsite registrations catch up overdue records while same-day pending intake still blocks duplicates', async () => {
  const tech = await addUser('993006');
  const firstInput = { ...draft(), requestId: crypto.randomUUID() };
  const first = await api('/api/scan/onsite', { method: 'POST', token: tech, body: firstInput }, 201);
  const secondInput = { ...draft(), requestId: crypto.randomUUID() };
  await api('/api/scan/onsite', { method: 'POST', token: tech, body: secondInput }, 409);
  await setAppointmentDate(first.id, addDays(dateKey(new Date(testNow)), -1));
  const second = await api('/api/scan/onsite', { method: 'POST', token: tech, body: secondInput }, 201);
  assert.notEqual(second.id, first.id);
  const expired = await appointmentRepository(db).find(first.id);
  assert.equal(expired.status, 'expired'); assert.equal(expired.outcome, null); assert.equal(expired.completedAt, testNow);
  const retry = await api('/api/scan/onsite', { method: 'POST', token: tech, body: firstInput }, 201);
  assert.equal(retry.id, first.id); assert.equal(retry.status, 'expired');
  assert.equal((await api('/api/scan/current', { token: tech })).pending.id, second.id);
});

test('legacy appointment APIs enforce a single active repair and expire onsite records without consuming booking capacity', async () => {
  const root = await login(), first = await book(), second = await book();
  await api(`/api/appointments/${first.id}/status`, {method:'PATCH',token:root,body:{status:'in_progress',...await intake(first,root)}});
  const conflict = await api(`/api/appointments/${second.id}/status`, {method:'PATCH',token:root,body:{status:'in_progress',...await intake(second,root)}},409);
  assert.match(conflict.error,/已有进行中的工单/);
  await db.prepare("UPDATE appointments SET source='onsite',registered_by='root001',registration_key=? WHERE id=?").bind(crypto.randomUUID(),second.id).run();
  const summary = await api(`/api/live/summary?date=${second.date}&campus=${encodeURIComponent(second.campus)}`);
  assert.equal(summary.slotTotal,1);
  const repository = appointmentRepository(db);
  const overview = await repository.overview(second.date,second.date,[second.campus]);
  assert.equal(overview.totals.reduce((total,slot)=>total+slot.occupied,0),1);
  assert.equal(await repository.countExpirations(expirationDeadline(second.date)),1);
  await repository.expirePending(expirationDeadline(second.date));
  assert.equal((await repository.find(second.id)).status,'expired');
});

test('scan migration preserves duplicate historical work and blocks new claims until those jobs drain', async () => {
  const legacy = await mf.getD1Database('SCAN_UPGRADE_DB');
  for (const file of (await readdir('migrations')).filter(name=>name.endsWith('.sql') && name<'0006').sort()) await applyMigration(legacy,file);
  await legacy.prepare("INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES('993004','历史人员','technician','南湖',?,?)").bind(hashPassword(password),dateKey()).run();
  const items = [await book(),await book(),await book()];
  for (const [index,item] of items.entries()) {
    const row = await db.prepare('SELECT * FROM appointments WHERE id=?').bind(item.id).first();
    row.time_slot = '19:00–20:00';
    for (const key of ['source','registered_by','registration_key','expires_at']) delete row[key];
    row.status = index<2 ? 'in_progress' : 'booked'; row.assigned_to = index<2 ? '993004' : null;
    await legacy.prepare(`INSERT INTO appointments(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).bind(...Object.values(row)).run();
  }
  const before = (await legacy.prepare('SELECT id,status,assigned_to,revision,phone,social,signature FROM appointments ORDER BY id').all()).results;
  await applyMigration(legacy,'0006_scan_workbench.sql');
  assert.deepEqual((await legacy.prepare('SELECT id,status,assigned_to,revision,phone,social,signature FROM appointments ORDER BY id').all()).results,before);
  await applyMigration(legacy,'0007_onsite_expiration.sql');
  await applyMigration(legacy,'0008_five_statuses.sql');
  assert.deepEqual((await legacy.prepare('SELECT id,status,assigned_to,revision,phone,social,signature FROM appointments ORDER BY id').all()).results,before);
  const claim = () => legacy.prepare("UPDATE appointments SET status='in_progress',assigned_to='993004' WHERE id=?").bind(items[2].id).run();
  await assert.rejects(claim,/active_repairs.account/);
  for (const item of items.slice(0,2)) {
    await legacy.prepare("UPDATE appointments SET status='completed',outcome='repaired' WHERE id=?").bind(item.id).run();
    if (item===items[0]) await assert.rejects(claim,/active_repairs.account/);
  }
  await claim();
  assert.equal((await legacy.prepare('SELECT appointment_id FROM active_repairs').first()).appointment_id,items[2].id);
  assert.deepEqual((await legacy.prepare('PRAGMA foreign_key_check').all()).results,[]);
});

test('onsite expiration migration preserves populated records, attachments, recoveries, quota and active repairs', async () => {
  const legacy = await mf.getD1Database('EXPIRATION_UPGRADE_DB');
  for (const file of (await readdir('migrations')).filter(name => name.endsWith('.sql') && name < '0007').sort()) await applyMigration(legacy, file);
  await legacy.prepare("INSERT INTO staff_accounts(account,name,role,home_campus,protected,password_hash,created_at) VALUES('root001','历史人员','superadmin','南湖',1,?,?)").bind(hashPassword(password), dateKey()).run();
  const items = [await book(), await book(), await book(), await book()];
  for (const [index, item] of items.entries()) {
    const row = await db.prepare('SELECT * FROM appointments WHERE id=?').bind(item.id).first();
    row.time_slot = '19:00–20:00';
    delete row.expires_at;
    if (index === 0) {
      row.status = 'in_progress'; row.assigned_to = 'root001'; row.started_at = testNow;
      row.front_photo_id = 'historical-photo'; row.back_photo_id = 'expired-photo-reference';
    } else if (index > 1) {
      row.source = 'onsite'; row.registered_by = 'root001'; row.registration_key = crypto.randomUUID();
    }
    await legacy.prepare(`INSERT INTO appointments(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(() => '?').join(',')})`).bind(...Object.values(row)).run();
  }
  await legacy.prepare("INSERT INTO attachment_storage VALUES('historical-photo','private/photo',4,'complete','2026-10-01','2027-10-01')").run();
  await legacy.prepare("INSERT INTO appointment_attachments VALUES('historical-photo',?,'历史.png','image/png',4,'private/photo','2026-10-01','2027-10-01','intake_front','root001')").bind(items[0].id).run();
  await legacy.prepare("INSERT INTO credential_recoveries VALUES('recovery',?,'root001','历史核验说明','2026-10-01')").bind(items[1].id).run();
  const before = (await legacy.prepare('SELECT * FROM appointments ORDER BY id').all()).results;
  const tables = ['appointment_attachments', 'credential_recoveries', 'attachment_storage', 'storage_quota', 'active_repairs'];
  const related = await Promise.all(tables.map(table => legacy.prepare(`SELECT * FROM ${table}`).all()));
  await applyMigration(legacy, '0007_onsite_expiration.sql');
  const expected = before.map(row => row.id === items[2].id ? { ...row, status: 'completed', outcome: 'expired', completed_at: row.created_at, revision: row.revision + 1 } : row);
  assert.deepEqual((await legacy.prepare('SELECT * FROM appointments ORDER BY id').all()).results, expected);
  for (const [index, table] of tables.entries()) assert.deepEqual((await legacy.prepare(`SELECT * FROM ${table}`).all()).results, related[index].results, table);
  assert.deepEqual((await legacy.prepare('PRAGMA foreign_key_check').all()).results, []);
  await assert.rejects(() => legacy.prepare("UPDATE appointments SET source='onsite',registered_by='root001',registration_key=? WHERE id=?").bind(crypto.randomUUID(), items[1].id).run(), /appointments.registered_by/);
  await assert.rejects(() => legacy.prepare("UPDATE appointments SET status='in_progress',assigned_to='root001' WHERE id=?").bind(items[1].id).run(), /active_repairs.account/);
  await legacy.prepare("DELETE FROM attachment_storage WHERE id='historical-photo'").run();
  assert.equal((await legacy.prepare('SELECT COUNT(*) AS n FROM appointment_attachments').first()).n, 0);
  assert.equal((await legacy.prepare('SELECT used_bytes FROM storage_quota').first()).used_bytes, 0);
});

test('onsite maintenance observes 21:30, retains active repairs and reports a distinct expiration result', async () => {
  const root = await login();
  const input = { ...draft(), requestId: crypto.randomUUID() };
  const item = await api('/api/scan/onsite', { method: 'POST', token: root, body: input }, 201);
  const repository = appointmentRepository(db);
  const before = new Date(`${item.date}T21:29:59+08:00`), deadline = new Date(`${item.date}T21:30:00+08:00`);
  assert.deepEqual(await expireAppointments(repository, { now: before }), { dryRun: true, eligible: 0, ended: 0 });
  assert.deepEqual(await expireAppointments(repository, { now: deadline }), { dryRun: true, eligible: 1, ended: 0 });
  assert.equal((await repository.find(item.id)).status, 'booked');
  assert.deepEqual(await expireAppointments(repository, { apply: true, now: deadline }), { dryRun: false, ended: 1 });
  const expired = await repository.find(item.id);
  assert.equal(expired.status, 'expired'); assert.equal(expired.outcome, null); assert.equal(expired.completedAt, deadline.toISOString());
  assert.deepEqual(await expireAppointments(repository, { apply: true, now: deadline }), { dryRun: false, ended: 0 });
  const next = await api('/api/scan/onsite', { method: 'POST', token: root, body: { ...draft(), requestId: crypto.randomUUID() } }, 201);
  await api(`/api/appointments/${next.id}/status`, { method: 'PATCH', token: root, body: { status: 'in_progress', ...await intake(next, root) } });
  assert.deepEqual(await expireAppointments(repository, { apply: true, now: deadline }), { dryRun: false, ended: 0 });
  assert.equal((await repository.find(next.id)).status, 'in_progress');
  const stats = await api('/api/stats/summary', { token: root });
  assert.equal(stats.expired, 1); assert.equal(stats.cancelled, 0); assert.equal(stats.completed, 0);
  const csv = await (await request('/api/export/appointments.csv', { token: root })).text();
  assert.ok(csv.includes('已逾期'));
});

test('five-state migration preserves populated history, related records and all constraints', async () => {
  const legacy = await mf.getD1Database('FIVE_STATUS_UPGRADE_DB');
  for (const file of (await readdir('migrations')).filter(name => name.endsWith('.sql') && name < '0008').sort()) await applyMigration(legacy, file);
  await legacy.prepare("INSERT INTO staff_accounts(account,name,role,home_campus,protected,password_hash,created_at) VALUES('root001','历史负责人','superadmin','南湖',1,?,?)").bind(hashPassword(password),testNow).run();
  const outcomes = [null,null,'repaired','unrepaired','not_needed','legacy_unknown','cancelled','no_show','expired'];
  const items = [];
  for (const [index,outcome] of outcomes.entries()) {
    const item = await book({timeSlot:TIME_SLOTS[index % TIME_SLOTS.length]}); items.push(item);
    const row = await db.prepare('SELECT * FROM appointments WHERE id=?').bind(item.id).first();
    delete row.expires_at;
    row.time_slot = '19:00–20:00';
    row.status = index === 0 ? 'booked' : index === 1 ? 'in_progress' : 'completed'; row.outcome = outcome;
    row.assigned_to = index > 0 && index < 6 ? 'root001' : null;
    row.started_at = row.assigned_to ? testNow : null; row.completed_at = index > 1 ? testNow : null;
    row.repair_number = `020261012-${70+index}`; row.repair_note = '原维修记录'; row.revision = index;
    row.front_photo_id = 'historical-photo'; row.back_photo_id = 'retained-expired-photo';
    if (index === 8) { row.source='onsite'; row.registered_by='root001'; row.registration_key=crypto.randomUUID(); }
    await legacy.prepare(`INSERT INTO appointments(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(() => '?').join(',')})`).bind(...Object.values(row)).run();
  }
  await legacy.prepare("INSERT INTO attachment_storage VALUES('historical-photo','private/history',4,'complete','2026-10-01','2027-10-01')").run();
  await legacy.prepare("INSERT INTO appointment_attachments VALUES('historical-photo',?,'历史.png','image/png',4,'private/history','2026-10-01','2027-10-01','intake_front','root001')").bind(items[1].id).run();
  await legacy.prepare("INSERT INTO credential_recoveries VALUES('historical-recovery',?,'root001','原始核验原因','2026-10-01')").bind(items[0].id).run();
  const before = (await legacy.prepare('SELECT * FROM appointments ORDER BY id').all()).results;
  const relatedTables = ['appointment_attachments','credential_recoveries','attachment_storage','storage_quota','active_repairs'];
  const related = await Promise.all(relatedTables.map(table => legacy.prepare(`SELECT * FROM ${table}`).all()));
  await applyMigration(legacy,'0008_five_statuses.sql');
  const expected = before.map(row => ({...row,
    status: row.outcome === 'cancelled' ? 'cancelled' : ['no_show','expired'].includes(row.outcome) ? 'expired' : row.status,
    outcome: ['cancelled','no_show','expired'].includes(row.outcome) ? null : row.outcome,
    expires_at: expirationDeadline(row.date)
  }));
  assert.deepEqual((await legacy.prepare('SELECT * FROM appointments ORDER BY id').all()).results,expected);
  for (const [index,table] of relatedTables.entries()) assert.deepEqual((await legacy.prepare(`SELECT * FROM ${table}`).all()).results,related[index].results,table);
  assert.deepEqual((await legacy.prepare('PRAGMA foreign_key_check').all()).results,[]);
  await assert.rejects(legacy.prepare("UPDATE appointments SET status='no_show' WHERE id=?").bind(items[0].id).run(),/CHECK/);
  await assert.rejects(legacy.prepare("UPDATE appointments SET outcome='cancelled' WHERE id=?").bind(items[6].id).run(),/CHECK/);
  await assert.rejects(legacy.prepare("UPDATE appointments SET status='in_progress',assigned_to='root001' WHERE id=?").bind(items[0].id).run(),/active_repairs.account/);
  await applyMigration(legacy,'0009_weekday_booking_schedules.sql');
  const repository = appointmentRepository(legacy);
  const counts = (await repository.list({status:'all'},{campuses:['南湖'],technician:''})).counts;
  assert.deepEqual(counts,{all:9,booked:1,in_progress:1,completed:4,cancelled:1,expired:2});
  assert.equal((await repository.overview(date,date,['南湖'])).totals[0].occupied,7);
  await legacy.prepare("DELETE FROM attachment_storage WHERE id='historical-photo'").run();
  assert.equal((await legacy.prepare('SELECT COUNT(*) AS n FROM appointment_attachments').first()).n,0);
  assert.equal((await legacy.prepare('SELECT used_bytes FROM storage_quota').first()).used_bytes,0);
});

test('old terminal outcome requests are rejected and cancellation returns a primary state', async () => {
  const item = await book(), root = await login();
  for (const outcome of ['cancelled','expired','no_show','legacy_unknown']) {
    await api(`/api/appointments/${item.id}/status`,{method:'PATCH',token:root,body:{action:'correct',status:'completed',outcome}},400);
  }
  for (const body of [{status:'no_show'},{status:'booked',expiresAt:item.expiresAt},{status:'cancelled',outcome:'repaired'}]) {
    await api(`/api/appointments/${item.id}/status`,{method:'PATCH',token:root,body},400);
  }
  assert.equal((await appointmentRepository(db).find(item.id)).revision,0);
  const cancelled = await api(`/api/appointments/${item.id}/status`,{method:'PATCH',accessToken:item.accessToken,body:{status:'cancelled',revision:item.revision}});
  assert.equal(cancelled.status,'cancelled'); assert.equal(cancelled.outcome,null);
  const stats = await api('/api/stats/summary',{token:root});
  assert.equal(stats.cancelled,1); assert.equal(stats.completed,0); assert.equal(stats.expired,0);
  assert.equal(stats.noShow,undefined); assert.equal(stats.noShowRate,undefined);
});

test('admin recovery extends both sources, records snapshots and requires fresh photo intake', async () => {
  const root = await login(), actor = await userRepository(db).find('root001');
  const repository = appointmentRepository(db);
  for (const source of ['booking','onsite']) {
    const item = source==='booking' ? await book() : await api('/api/scan/onsite',{method:'POST',token:root,body:{...draft(),requestId:crypto.randomUUID()}},201);
    let now = new Date(`${item.date}T21:31:00+08:00`);
    const service = appointmentService(repository,userRepository(db),PII_ENCRYPTION_KEY,() => now);
    const read = async () => (await service.list({status:'all'},actor)).items.find(row => row.id===item.id);
    const expired = await read();
    assert.equal(expired.status,'expired');
    const expiresAt = new Date(`${item.date}T22:00:00+08:00`).toISOString();
    const input = {action:'correct',revision:expired.revision,correctionReason:'已核实工作人员漏记，需要重新签到',patch:{status:'booked',expiresAt}};
    await assert.rejects(service.update(item.id,{...input,patch:{status:'booked'}},actor),error => error.status===409);
    await assert.rejects(service.update(item.id,{...input,correctionReason:''},actor),error => error.status===400);
    await assert.rejects(service.update(item.id,{...input,patch:{status:'booked',expiresAt:now.toISOString()}},actor),error => error.status===409);
    await assert.rejects(service.update(item.id,{...input,revision:0},actor),error => error.status===409);
    await assert.rejects(service.update(item.id,{action:'correct',patch:{status:'in_progress',assignedTo:actor.account}},actor),error => error.status===409);
    const restored = await service.update(item.id,input,actor);
    assert.equal(restored.status,'booked'); assert.equal(restored.expiresAt,expiresAt);
    for (const key of ['outcome','startedAt','completedAt','frontPhotoId','backPhotoId']) assert.equal(restored[key],null);
    assert.equal(restored.assignedTo,''); assert.equal(restored.repairNote,'');
    const audit = await db.prepare('SELECT * FROM appointment_corrections WHERE appointment_id=?').bind(item.id).first();
    assert.equal(audit.actor,actor.account); assert.equal(audit.reason,input.correctionReason);
    assert.equal(audit.created_at,now.toISOString());
    assert.equal(JSON.parse(audit.before_state).status,'expired'); assert.equal(JSON.parse(audit.after_state).expiresAt,expiresAt);
    assert.equal(JSON.parse(audit.after_state).revision,restored.revision);
    now = new Date(`${item.date}T21:45:00+08:00`);
    assert.equal((await read()).status,'booked');
    await assert.rejects(service.update(item.id,{patch:{status:'in_progress'}},actor),error => error.status===400);
    now = new Date(expiresAt);
    assert.equal((await expireAppointments(repository,{now})).eligible,1);
    assert.equal((await read()).status,'expired');
    assert.equal((await expireAppointments(repository,{apply:true,now})).ended,0);
  }
});

test('failed and stale corrections never leave audit rows or bypass capacity and uniqueness', async () => {
  await login();
  const actor = await userRepository(db).find('root001'), item = await book();
  const repository = appointmentRepository(db), service = appointmentService(repository,userRepository(db),PII_ENCRYPTION_KEY,() => new Date(testNow));
  const cancelled = await service.update(item.id,{patch:{status:'cancelled'}},null,item.accessToken);
  const input = {action:'correct',correctionReason:'管理员核实误取消记录后恢复预约',patch:{status:'booked'},revision:cancelled.revision};
  await db.prepare('UPDATE booking_day_slots SET capacity=? WHERE campus=? AND date=? AND time_slot=?').bind(0,item.campus,item.date,item.timeSlot).run();
  await assert.rejects(service.update(item.id,input,actor),/SLOT_PAUSED/);
  assert.deepEqual(await service.lookup(item.id,item.accessToken),cancelled);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM appointment_corrections').first()).n,0);
  await db.prepare('UPDATE booking_day_slots SET capacity=? WHERE campus=? AND date=? AND time_slot=?').bind(1,item.campus,item.date,item.timeSlot).run();
  const replacement = await book();
  await assert.rejects(service.update(item.id,input,actor),/SLOT_FULL/);
  await db.prepare('UPDATE booking_day_slots SET capacity=? WHERE campus=? AND date=? AND time_slot=?').bind(10,item.campus,item.date,item.timeSlot).run();
  await db.prepare('UPDATE appointments SET student_id=? WHERE id=?').bind(item.studentId,replacement.id).run();
  await assert.rejects(service.update(item.id,input,actor),/APPOINTMENT_OVERLAP/);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM appointment_corrections').first()).n,0);
  await service.update(replacement.id,{patch:{status:'cancelled'}},null,replacement.accessToken);
  const restored = await service.update(item.id,input,actor);
  await assert.rejects(service.update(item.id,input,actor),error => error.status===409);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM appointment_corrections').first()).n,1);
  assert.deepEqual(await service.lookup(item.id,item.accessToken),restored);
});

test('restored repairs reject earlier photos and remain in progress beyond the extended deadline', async () => {
  const root = await login(), actor = await userRepository(db).find('root001'), item = await book();
  const oldPhotos = await intake(item,root), repository = appointmentRepository(db);
  await db.prepare('UPDATE appointment_attachments SET created_at=? WHERE appointment_id=?').bind(item.createdAt,item.id).run();
  let now = new Date(`${item.date}T21:31:00+08:00`);
  const service = appointmentService(repository,userRepository(db),PII_ENCRYPTION_KEY,() => now);
  await service.lookup(item.id,item.accessToken);
  const expiresAt = new Date(`${item.date}T22:00:00+08:00`).toISOString();
  await service.update(item.id,{action:'correct',correctionReason:'核验旧工单后延长期限重新拍照接单',patch:{status:'booked',expiresAt}},actor);
  await assert.rejects(service.update(item.id,{patch:{status:'in_progress',...oldPhotos}},actor),error => error.status===400);
  const freshPhotos = await intake(item,root);
  await db.prepare('UPDATE appointment_attachments SET created_at=? WHERE id IN (?,?)').bind(now.toISOString(),freshPhotos.frontPhotoId,freshPhotos.backPhotoId).run();
  const started = await service.update(item.id,{patch:{status:'in_progress',...freshPhotos}},actor);
  assert.equal(started.frontPhotoId,freshPhotos.frontPhotoId); assert.equal(started.startedAt,now.toISOString());
  now = new Date(`${item.date}T23:00:00+08:00`);
  assert.equal((await service.lookup(item.id,item.accessToken)).status,'in_progress');
  const completed = await service.update(item.id,{patch:{status:'completed',outcome:'repaired',repairNote:'维修完成并复测'}},actor);
  assert.equal(completed.status,'completed'); assert.equal(completed.completedAt,now.toISOString());
});

test('onsite recovery preserves campus and administrator permissions and one pending registration', async () => {
  const root = await login(), tech = await addUser('993006'), actor = await userRepository(db).find('root001');
  const owner = await userRepository(db).find('993006');
  const item = await api('/api/scan/onsite',{method:'POST',token:tech,body:{...draft(),requestId:crypto.randomUUID()}},201);
  await api(`/api/appointments/${item.id}/status`,{method:'PATCH',token:tech,body:{status:'cancelled'}});
  const next = await api('/api/scan/onsite',{method:'POST',token:tech,body:{...draft(),requestId:crypto.randomUUID()}},201);
  const repository = appointmentRepository(db), service = appointmentService(repository,userRepository(db),PII_ENCRYPTION_KEY,() => new Date(testNow));
  const input = {action:'correct',correctionReason:'核实重复登记后尝试恢复原现场工单',patch:{status:'booked'}};
  await assert.rejects(service.update(item.id,input,owner),error => error.status===403);
  await assert.rejects(service.update(item.id,input,{...actor,authorizedCampuses:['浑南']}),error => error.status===403);
  await assert.rejects(service.update(item.id,input,actor),/appointments.registered_by/);
  assert.equal((await repository.find(item.id)).status,'cancelled');
  assert.equal((await repository.pendingRegistration(owner.account)).id,next.id);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM appointment_corrections').first()).n,0);
  assert.equal((await api('/api/scan/current',{token:root})).items.length,0);
});

test('expiration racing with photo intake has one consistent winner and respects recorded starts', async () => {
  const root = await login(), actor = await userRepository(db).find('root001'), item = await book();
  const photos = await intake(item,root), repository = appointmentRepository(db);
  const before = new Date(`${item.date}T21:29:59.999+08:00`), at = expirationDeadline(item.date);
  const service = appointmentService(repository,userRepository(db),PII_ENCRYPTION_KEY,() => before);
  const [start] = await Promise.allSettled([
    service.update(item.id,{revision:item.revision,patch:{status:'in_progress',...photos}},actor),
    repository.expirePending(at,{id:item.id})
  ]);
  const stored = await repository.find(item.id);
  if (start.status==='fulfilled') {
    assert.equal(stored.status,'in_progress'); assert.equal(stored.startedAt,before.toISOString());
    assert.equal((await repository.expirePending(new Date(`${item.date}T23:59:00+08:00`).toISOString(),{id:item.id})).meta.changes,0);
  } else { assert.equal(start.reason.status,409); assert.equal(stored.status,'expired'); assert.equal(stored.startedAt,null); }
  const recorded = await book();
  await db.prepare('UPDATE appointments SET started_at=? WHERE id=?').bind(before.toISOString(),recorded.id).run();
  assert.equal((await repository.expirePending(at,{id:recorded.id})).meta.changes,0);
  assert.equal((await repository.find(recorded.id)).status,'booked');
});

test('onsite creation stops at the inclusive Shanghai deadline', async () => {
  const actor = await userRepository(db).find('root001');
  let now = new Date(`${date}T21:29:59.999+08:00`);
  const repository = appointmentRepository(db), service = appointmentService(repository,userRepository(db),PII_ENCRYPTION_KEY,() => now);
  const data = bookingInput(draft());
  const item = await service.createOnsite(data,actor.account,crypto.randomUUID());
  assert.equal(item.expiresAt,expirationDeadline(date));
  now = new Date(item.expiresAt);
  await assert.rejects(service.createOnsite(data,actor.account,crypto.randomUUID()),error => error.status===400);
  assert.equal((await service.lookup(item.id,item.accessToken)).status,'expired');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM appointments').first()).n,1);
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
  assert.equal(item.id, `reserve0${item.date.replaceAll('-','')}-01`);
  const row = await db.prepare('SELECT phone,social FROM appointments WHERE id=?').bind(item.id).first();
  assert.match(row.phone, /^enc\$/); assert.match(row.social, /^enc\$/); assert.ok(!row.social.includes('wechat-private'));
  const found = await api(`/api/appointments/${item.id}`,{accessToken:item.accessToken});
  assert.equal(found.social, 'wechat-private'); assert.equal(found.phone, '13800138000');
  await api(`/api/appointments/${item.id}`,{accessToken:'x'.repeat(43)},404);
  await api('/api/appointments', {}, 401);
  const live = await api(`/api/live/summary?appointmentId=${item.id}`,{accessToken:item.accessToken});
  assert.equal(live.position, 1); assert.equal(live.capacity, 5); assert.equal(live.slotTotal, 1);
  const cancelled = await api(`/api/appointments/${item.id}/status`, { method: 'PATCH', accessToken:item.accessToken, body: { status: 'cancelled', studentId: item.studentId, assignedTo: 'root001', repairNote: 'injection' } });
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.outcome, null); assert.equal(cancelled.assignedTo, ''); assert.equal(cancelled.repairNote, '');
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
  await api('/api/appointments', { method: 'POST', body: draft({ timeSlot: '19:00-20:00', social: 'enc$literal-user-input' }) }, 400);
});
test('simultaneous reservations cannot exceed capacity and retain sequential unique IDs', async () => {
  const results = await Promise.all(Array.from({ length: 15 }, () => request('/api/appointments', { method: 'POST', body: draft() })));
  assert.equal(results.filter(r => r.status === 201).length, 5);
  assert.equal(results.filter(r => r.status === 409).length, 10);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM appointments').first()).n, 5);
  const ids = (await db.prepare('SELECT id FROM appointments ORDER BY id').all()).results.map(row => row.id);
  assert.equal(new Set(ids).size, 5); assert.ok(ids.at(-1).endsWith('-05'));
  const live = await api(`/api/live/summary?date=${date}&campus=${encodeURIComponent('南湖')}`);
  assert.equal(live.slots['19:00–19:30'], 5);
});

test('capacity migration preserves existing bookings and enforces ten on new or restored reservations', async () => {
  const legacy = await mf.getD1Database('CAPACITY_UPGRADE_DB');
  await applyMigration(legacy, '0001_initial.sql');
  const insert = (n, campus = '南湖', slot = '19:00–20:00') => legacy.prepare(`INSERT INTO appointments
    (id,student_id,name,campus,social,device_type,brand,device_model,warranty,fault_type,date,time_slot,status,
      access_token_hash,credential_rotated_at,created_at,agreement_at,agreement_version)
    VALUES (?,?, '测试同学',?, 'wechat','笔记本电脑','联想','ThinkPad','否','蓝屏',?,?,'pending',?,?,?,?,'v1')`)
    .bind(`legacy-${n}`, String(900000 + n), campus, date, slot, n.toString(16).padStart(64, '0'), date, date, date);
  await legacy.batch(Array.from({ length: 11 }, (_, n) => insert(n)));
  await applyMigration(legacy, '0002_slot_capacity.sql');
  assert.equal((await legacy.prepare('SELECT COUNT(*) AS n FROM appointments').first()).n, 11);
  await legacy.prepare("UPDATE appointments SET status='completed',repair_note='已修复' WHERE id='legacy-0'").run();
  assert.equal((await legacy.prepare("SELECT repair_note FROM appointments WHERE id='legacy-0'").first()).repair_note, '已修复');
  await assert.rejects(insert(11).run(), /SLOT_FULL/);
  await legacy.prepare("UPDATE appointments SET status='cancelled' WHERE id='legacy-0'").run();
  await assert.rejects(legacy.prepare("UPDATE appointments SET status='pending' WHERE id='legacy-0'").run(), /SLOT_FULL/);
  await legacy.prepare("UPDATE appointments SET status='no_show' WHERE id='legacy-1'").run();
  await legacy.prepare("UPDATE appointments SET status='pending' WHERE id='legacy-0'").run();
  await insert(12, '浑南').run();
  await insert(13, '南湖', '20:00–21:00').run();
  await assert.rejects(legacy.prepare("UPDATE appointments SET campus='南湖' WHERE id='legacy-12'").run(), /SLOT_FULL/);
  await assert.rejects(legacy.prepare("UPDATE appointments SET time_slot='19:00–20:00' WHERE id='legacy-13'").run(), /SLOT_FULL/);
});
test('duplicate check spans campuses and is atomic', async () => {
  const input = draft();
  const responses = await Promise.all(['南湖','浑南'].map(campus => request('/api/appointments', { method: 'POST', body: { ...input, campus } })));
  assert.deepEqual(responses.map(r => r.status).sort(), [201,409]);
});
test('reactivating cancelled appointments still enforces D1 capacity and duplicate constraints', async () => {
  const root = await login(), old = await book();
  await api(`/api/appointments/${old.id}/status`, { method: 'PATCH', token: root, body: { status: 'cancelled' } });
  const replacement = await book({ studentId: old.studentId });
  await api(`/api/appointments/${old.id}/status`, { method: 'PATCH', token: root, body: { action: 'correct', status: 'booked' } }, 409);
  await api(`/api/appointments/${replacement.id}/status`, { method: 'PATCH', token: root, body: { status: 'cancelled' } });
  for (let n = 0; n < 5; n++) await book();
  await api(`/api/appointments/${old.id}/status`, { method: 'PATCH', token: root, body: { action: 'correct', status: 'booked' } }, 409);
});
test('simultaneous sign-ins have one winner; technician ownership and transitions hold', async () => {
  const item = await book();
  const tokens = await Promise.all([addUser('300001'), addUser('300002')]);
  const photos = await Promise.all(tokens.map(token => intake(item, token)));
  const results = await Promise.all(tokens.map((token, index) => request(`/api/appointments/${item.id}/status`, { method: 'PATCH', token, body: { status: 'in_progress', ...photos[index] } })));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.ok(results.some(r => [403,409].includes(r.status)));
  const winner = results.findIndex(r => r.status === 200), token = tokens[winner];
  await api(`/api/appointments/${item.id}/status`, { method: 'PATCH', token: tokens[1-winner], body: { status: 'completed' } }, 403);
  await api(`/api/appointments/${item.id}/status`, { method: 'PATCH', accessToken:item.accessToken, body: { status: 'cancelled', studentId: item.studentId } }, 409);
  await api(`/api/appointments/${item.id}/status`, { method: 'PATCH', token, body: { assignedTo: '' } }, 403);
  await api(`/api/appointments/${item.id}/status`, { method: 'PATCH', token, body: { action: 'correct', status: 'booked' } }, 403);
  await api(`/api/appointments/${item.id}/status`, { method: 'PATCH', token, body: { status: 'in_progress' } }, 409);
  const done = await api(`/api/appointments/${item.id}/status`, { method: 'PATCH', token, body: { status: 'completed', outcome: 'repaired', repairNote: '已完成测试' } });
  assert.equal(done.repairNote, '已完成测试');
  await api(`/api/appointments/${item.id}/status`, { method: 'PATCH', token, body: { status: 'in_progress' } }, 409);
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
  await api(`/api/appointments/${item.id}/status`,{method:'PATCH',token,body:{status:'in_progress',...await intake(item, token)}});
  assert.equal((await request(`${base}/${attachment.id}`, { token })).status, 200);
  await api(base, { accessToken:item.accessToken, method: 'POST', body: { ...input, mimeType: 'text/html' } }, 400);
  await api(base, { accessToken:item.accessToken, method: 'POST', body: { ...input, mimeType: 'image/png' } }, 400);
  await api(base, { accessToken:item.accessToken, method: 'POST', body: { ...input, data: '%%%=' } }, 400);
  await api(base, { accessToken:item.accessToken, method: 'POST', body: { ...input, data: Buffer.alloc(5 * 1024 * 1024 + 1, 65).toString('base64') } }, 400);
});
test('intake photos enforce 2 MB per file while general attachments retain 5 MB', async () => {
  const item = await book(), token = await login();
  const base = `/api/appointments/${item.id}/attachments`;
  const image = size => {
    const bytes = Buffer.alloc(size, 65);
    Buffer.from(photo.data, 'base64').copy(bytes);
    return { ...photo, data: bytes.toString('base64') };
  };
  for (const purpose of ['intake_front', 'intake_back']) {
    const accepted = await api(base, { method: 'POST', token, body: { ...image(2 * 1024 * 1024), purpose } }, 201);
    assert.equal(accepted.size, 2 * 1024 * 1024);
    const rejected = await api(base, { method: 'POST', token, body: { ...image(2 * 1024 * 1024 + 1), purpose } }, 400);
    assert.equal(rejected.error, '签到照片大小不能超过 2 MB');
  }
  const general = await api(base, { method: 'POST', accessToken: item.accessToken, body: image(5 * 1024 * 1024) }, 201);
  assert.equal(general.size, 5 * 1024 * 1024);
  const rejected = await api(base, { method: 'POST', accessToken: item.accessToken, body: image(5 * 1024 * 1024 + 1) }, 400);
  assert.equal(rejected.error, '附件大小不能超过 5 MB');
  assert.equal((await bucket.list()).objects.length, 3);
  assert.equal((await db.prepare('SELECT used_bytes FROM storage_quota').first()).used_bytes, 9 * 1024 * 1024);
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
  await api(`/api/appointments/${item.id}/status`, { method: 'PATCH', token: technician, body: { status:'in_progress',...await intake(item, technician) } });
  await api(`/api/appointments/${item.id}/status`, { method: 'PATCH', token: technician, body: { status: 'completed', outcome: 'repaired', repairNote: '完成' } });
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
  await api(`/api/appointments/${item.id}/status`,{method:'PATCH',body:{studentId:item.studentId,status: 'cancelled'}},404);
  await api(`/api/live/summary?studentId=${item.studentId}`,{},400);
  const technician=await addUser('690001');
  await api(`/api/appointments/${item.id}/credential`,{method:'POST',token:technician,body:{}},403);
  await api(`/api/appointments/${item.id}/credential`,{method:'POST',token:root,body:{identityVerified:false,reason:'已当面核验学生证和联系方式'}},400);
  const recovered=await api(`/api/appointments/${item.id}/credential`,{method:'POST',token:root,body:{identityVerified:true,reason:'已当面核验学生证和联系方式'}});
  assert.notEqual(item.accessToken,recovered.accessToken);
  for(const path of paths)await api(path,{accessToken:item.accessToken},404);
  await api(`/api/appointments/${item.id}`,{accessToken:recovered.accessToken});
  assert.equal((await request(`/api/appointments/${item.id}/attachments/${file.id}`,{accessToken:recovered.accessToken})).status,200);
  await api(`/api/appointments/${item.id}/status`,{method:'PATCH',accessToken:item.accessToken,body:{status: 'cancelled'}},404);
  await api(`/api/appointments/${item.id}/status`,{method:'PATCH',accessToken:recovered.accessToken,body:{status: 'cancelled'}});
  const audit=await db.prepare('SELECT * FROM credential_recoveries').first();
  assert.equal(audit.actor,'root001');assert.ok(!JSON.stringify(audit).includes(recovered.accessToken));
});

test('two requests for the final slot have one winner and cancellation releases capacity', async () => {
  for (let n = 0; n < 4; n++) await book();
  const attempts = await Promise.all([draft(), draft()].map(body => request('/api/appointments', { method: 'POST', body })));
  assert.deepEqual(attempts.map(response => response.status).sort(), [201,409]);
  const winner = await attempts.find(response => response.status === 201).json();
  await api(`/api/appointments/${winner.id}/status`, { method: 'PATCH', accessToken:winner.accessToken, body: { status: 'cancelled', studentId: winner.studentId } });
  await book();
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM appointments WHERE status<>'cancelled'").first()).n, 5);
});

test('SQL staff filters preserve literal searches, status groups and totals', async () => {
  const root = await login();
  const first = await book({ deviceModel: 'A%_Device' }), second = await book({ campus: '浑南' });
  await api(`/api/appointments/${second.id}/status`, { method: 'PATCH', token: root, body: { status: 'cancelled' } });
  const filtered = await api(`/api/appointments?${new URLSearchParams({ q: '%_', campus: '南湖', date, status: 'booked' })}`, { token: root });
  assert.deepEqual(filtered.items.map(item => item.id), [first.id]);
  assert.deepEqual(filtered.counts, { all: 2, booked: 1, in_progress: 0, completed: 0, cancelled: 1, expired: 0 });
  assert.equal((await api('/api/appointments?q=no-match', { token: root })).items.length, 0);
  for (const query of ['status=invalid','date=2026-02-30','campus=invalid']) await api(`/api/appointments?${query}`, { token: root }, 400);
});

test('staff sorting and slot filters compose while contextual counts ignore only the status tab', async () => {
  const token = await login();
  const first = await book(), later = await book({ timeSlot: '20:00–20:30' }), other = await book({ campus: '浑南' });
  await db.prepare("UPDATE appointments SET status='cancelled',outcome=NULL WHERE id=?").bind(later.id).run();
  const sorted = await api('/api/appointments?sort=date&direction=asc', { token });
  assert.deepEqual(sorted.items.map(item => item.timeSlot), ['19:00–19:30','19:00–19:30','20:00–20:30']);
  const reverse = await api('/api/appointments?sort=date&direction=desc', { token });
  assert.equal(reverse.items[0].id, later.id);
  const filtered = await api(`/api/appointments?${new URLSearchParams({ campus:'南湖',date,timeSlot:'20:00–20:30',status:'booked',sort:'status',direction:'asc' })}`, { token });
  assert.equal(filtered.items.length, 0);
  assert.deepEqual(filtered.filteredCounts, { all:1,booked:0,in_progress:0,completed:0,cancelled:1,expired:0 });
  assert.equal(filtered.counts.all, 3);
  await db.prepare("UPDATE appointments SET status='in_progress',assigned_to='root001' WHERE id=?").bind(first.id).run();
  const pending = await api('/api/appointments?status=pending&campus=南湖', { token });
  assert.deepEqual(pending.items.map(item=>item.id), [first.id]);
  assert.equal(pending.filteredCounts.cancelled, 1);
  const pendingAll = await api('/api/appointments?status=pending', { token });
  assert.deepEqual(new Set(pendingAll.items.map(item=>item.id)), new Set([first.id,other.id]));
  assert.equal((await api('/api/appointments?sort=status&direction=desc', { token })).items[0].id, later.id);
  assert.equal((await api('/api/appointments?sort=campus&direction=asc', { token })).items.at(-1).id, other.id);
  assert.ok(first.id);
  const composed = await api('/api/appointments?sorts=campus:asc,date:desc', { token });
  assert.deepEqual(composed.items.map(item => item.id), [later.id, first.id, other.id]);
  const dateFirst = await api('/api/appointments?sorts=date:desc,campus:asc', { token });
  assert.equal(dateFirst.items[0].id, later.id);
  await db.prepare('UPDATE appointments SET created_at=? WHERE id=?').bind('2099-01-01T00:00:00.000Z', other.id).run();
  assert.equal((await api('/api/appointments?sorts=', { token })).items[0].id, other.id);
  for (const sorts of ['campus:asc,campus:desc','date:invalid','id:asc','date:asc:desc','date:asc,','created_at DESC:asc']) {
    await api(`/api/appointments?${new URLSearchParams({sorts})}`, { token }, 400);
  }
  for (const query of ['sort=invalid','sort=created_at%20DESC','direction=invalid','timeSlot=invalid']) await api(`/api/appointments?${query}`, { token }, 400);
});

test('staff overview uses real capacity and cancellation rules without exposing student data or other campuses', async () => {
  const root = await login(), tech = await addUser('650018');
  const active = await book(), finished = await book(), cancelled = await book();
  await book({ campus:'浑南' });
  await db.prepare("UPDATE appointments SET status='in_progress',assigned_to='650018' WHERE id=?").bind(active.id).run();
  await db.prepare("UPDATE appointments SET status='completed',outcome='repaired' WHERE id=?").bind(finished.id).run();
  await db.prepare("UPDATE appointments SET status='cancelled',outcome=NULL WHERE id=?").bind(cancelled.id).run();
  await configureCapacity(root, 1);
  const result = await api('/api/appointments/overview', { token:tech });
  assert.deepEqual(result.campuses, ['南湖']);
  assert.equal(result.start, dateKey()); assert.equal(result.end, addDays(dateKey(),6));
  assert.ok(result.dates.every(serviceDay));
  const slot = result.items.find(item => item.date===date && item.timeSlot==='19:00–19:30');
  assert.equal(slot.occupied,2); assert.equal(slot.remaining,3); assert.equal(slot.capacity,5);
  assert.equal(slot.booked,0); assert.equal(slot.inProgress,1);
  assert.ok(result.items.every(item => item.campus==='南湖' && !('name' in item) && !('studentId' in item) && !('social' in item)));
  await configureCapacity(root,0);
  const paused = await api('/api/appointments/overview', { token:root });
  assert.equal(paused.items.find(item => item.campus==='南湖' && item.date===date && item.timeSlot==='19:00–19:30').capacity,5);
  assert.ok(paused.items.some(item => item.campus==='浑南' && item.occupied===1));
  await api('/api/appointments/overview', {},401);
});

test('weekly overview includes earlier records and range filters preserve permissions and counts', async () => {
  const root=await login(),tech=await addUser('650019');
  const first=await book(),last=await book(),outside=await book(),otherCampus=await book({campus:'浑南'});
  const week=weekRange();
  for(const [item,day] of [[first,week.start],[last,addDays(week.start,3)],[outside,addDays(week.start,-4)],[otherCampus,week.start]]) {
    await db.prepare("UPDATE appointments SET date=?,status='completed',outcome='repaired',assigned_to='650019' WHERE id=?").bind(day,item.id).run();
  }
  const overview=await api('/api/appointments/overview',{token:tech});
  assert.equal(overview.week.start,week.start);assert.equal(overview.week.end,week.end);
  assert.equal(overview.week.items.find(item=>item.date===week.start && item.timeSlot==='19:00–19:30').occupied,1);
  assert.ok(overview.week.items.every(item=>item.campus==='南湖' && serviceDay(item.date)));
  const query=new URLSearchParams({dateFrom:week.start,dateTo:week.end,status:'completed',timeSlot:'19:00–19:30',sorts:'date:asc,campus:asc'});
  const result=await api(`/api/appointments?${query}`,{token:tech});
  assert.deepEqual(result.items.map(item=>item.id),[first.id,last.id]);
  assert.equal(result.filteredCounts.completed,2);
  const all=await api(`/api/appointments?${query}`,{token:root});assert.equal(all.items.length,3);
  for(const invalid of [{dateFrom:week.start},{dateTo:week.end},{dateFrom:week.end,dateTo:week.start},{dateFrom:'2026-02-30',dateTo:week.end},{date:week.start,dateFrom:week.start,dateTo:week.end}]) {
    await api(`/api/appointments?${new URLSearchParams(invalid)}`,{token:root},400);
  }
});

test('SQL queue counts use campus/slot scopes, deterministic ties and active status rules', async () => {
  const root = await login();
  const first = await book(), second = await book();
  await book({ campus: '浑南' });
  await book({ timeSlot: '20:00–20:30' });
  const ended = await book();
  await db.prepare("UPDATE appointments SET status='expired',outcome=NULL WHERE id=?").bind(ended.id).run();
  await db.prepare('UPDATE appointments SET created_at=? WHERE id IN (?,?)').bind('2026-10-04T16:00:00.000Z', first.id, second.id).run();
  const summary = await api(`/api/live/summary?appointmentId=${second.id}`,{accessToken:second.accessToken});
  assert.equal(summary.dayTotal, 5); assert.equal(summary.campusDayTotal, 4); assert.equal(summary.slotTotal, 3);
  assert.equal(summary.queueTotal, 2); assert.equal(summary.ahead, 1); assert.equal(summary.position, 2);
  assert.deepEqual(summary.slots, { '19:00–19:30': 3, '19:30–20:00': 0, '20:00–20:30': 1, '20:30–21:00': 0 });
  await api(`/api/appointments/${first.id}/status`, { method: 'PATCH', token: root, body: { status:'in_progress',...await intake(first, root) } });
  await api(`/api/appointments/${first.id}/status`, { method: 'PATCH', token: root, body: { status: 'completed', outcome: 'repaired', repairNote: '已修复' } });
  assert.equal((await api(`/api/live/summary?appointmentId=${second.id}`,{accessToken:second.accessToken})).ahead, 0);
  await api(`/api/appointments/${first.id}/status`, { method: 'PATCH', token: root, body: { action: 'correct', status: 'cancelled' } });
  assert.equal((await api(`/api/live/summary?appointmentId=${second.id}`,{accessToken:second.accessToken})).position, 1);
  assert.equal((await api(`/api/live/summary?appointmentId=${first.id}`,{accessToken:first.accessToken})).position, null);
});

test('SQL statistics aggregate date windows and workload without reading contact ciphertext', async () => {
  const root = await login();
  await addUser('650001');
  const recent = await book({ faultType: '蓝屏' }), older = await book({ faultType: '硬盘' }), skipped = await book();
  const today = dateKey(), past = addDays(today, -30);
  await db.prepare("UPDATE appointments SET date=?,status='completed',outcome='repaired',assigned_to='650001',social='unreadable' WHERE id=?").bind(today, recent.id).run();
  await db.prepare("UPDATE appointments SET date=?,status='completed',outcome='legacy_unknown',assigned_to='650001' WHERE id=?").bind(past, older.id).run();
  await db.prepare("UPDATE appointments SET date=?,status='expired',outcome=NULL WHERE id=?").bind(today, skipped.id).run();
  const current = await api('/api/stats/summary?range=7', { token: root });
  assert.equal(current.total, 2); assert.equal(current.completed, 1); assert.equal(current.expired, 1);
  assert.deepEqual(current.daily, { [today]: { total: 2, completed: 1 } });
  assert.deepEqual(current.faults, { '蓝屏': 1 });
  assert.deepEqual(current.technicians, { '650001': { started: 1, completed: 1 } });
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
  const select = columns.map(column => column === 'id' ? '?' : column === 'status' ? "'cancelled'" : column === 'outcome' ? 'NULL' : column === 'access_token_hash' ? 'lower(hex(randomblob(32)))' : column).join(',');
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
    await api('/api/activation',{method:'POST',body:{studentId:'800001',name:'测试人员',homeCampus:'南湖',password,...patch}},400);
  }
});

test('technicians see campus summaries before claiming and only their own private records after',async()=>{
  const own=await book(),other=await book(),foreign=await book({campus:'浑南'});
  const token=await addUser('710001'),colleague=await addUser('710002');
  const listed=await api('/api/appointments',{token});
  assert.equal((await api(`/api/appointments?q=${own.studentId}`,{token})).items.length,0);
  assert.equal(listed.counts.all,2);assert.ok(!listed.items.some(item=>item.id===foreign.id));
  for(const item of listed.items){for(const field of ['studentId','name','phone','social','issue','serial','note','agreementAt','repairNote'])assert.ok(!Object.hasOwn(item,field),field);}
  await api(`/api/appointments/${foreign.id}/status`,{method:'PATCH',token,body:{status:'in_progress'}},403);
  await api(`/api/appointments/${own.id}/attachments`,{token,accessToken:own.accessToken},403);
  await api(`/api/appointments/${other.id}/status`,{method:'PATCH',token:colleague,body:{status:'in_progress',...await intake(other, colleague)}});
  await api(`/api/appointments/${own.id}/status`,{method:'PATCH',token,body:{status:'in_progress',...await intake(own, token)}});
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
  await api(`/api/appointments/${foreign.id}/status`,{method:'PATCH',token:admin,body:{status:'in_progress'}},403);
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
  const application=await applyStaff('810001',{name:'真实部员',contact:'不再收集的联系方式',role:'superadmin',authorizedCampuses:['南湖','浑南'],protected:true});
  await api('/api/auth/login',{method:'POST',body:{account:'810001',password}},401);
  assert.equal(await db.prepare('SELECT * FROM staff_accounts WHERE account=?').bind('810001').first(),null);
  const stored=await db.prepare('SELECT * FROM activation_requests WHERE id=?').bind(application.id).first();
  assert.ok(stored.password_hash.startsWith('scrypt$'));assert.equal(stored.contact,'');
  assert.ok(!(await api('/api/activation-requests',{token})).items.some(item=>Object.hasOwn(item,'contact')));
  assert.ok(!stored.receipt_hash.includes(application.receipt));
  await api(`/api/activation/${application.id}`,{},404);
  assert.equal((await api(`/api/activation/${application.id}`,{headers:{'X-Activation-Receipt':application.receipt}})).status,'pending');
  await api('/api/activation-requests/review',{method:'POST',token,body:{ids:[application.id],status:'approved',reviewNote:'已当面核验部员身份和学生证'}},400);
  await api('/api/activation-requests/review',{method:'POST',token,body:{ids:[application.id],status:'approved',identityVerified:true,reviewNote:'x'.repeat(301)}},400);
  await api('/api/activation-requests/review',{method:'POST',token,body:{ids:[application.id],status:'approved',identityVerified:true}});
  assert.equal((await api(`/api/activation/${application.id}`,{headers:{'X-Activation-Receipt':application.receipt}})).reviewNote,'');
  const user=await api('/api/auth/me',{token:await login('810001')});
  assert.equal(user.role,'technician');assert.deepEqual(user.authorizedCampuses,['浑南']);assert.equal(user.homeCampus,'南湖');
  assert.equal((await db.prepare('SELECT status FROM staff_whitelist WHERE student_id=?').bind('810001').first()).status,'activated');
  assert.equal((await db.prepare('SELECT password_hash FROM activation_requests WHERE id=?').bind(application.id).first()).password_hash,'');
  await api('/api/activation',{method:'POST',body:{studentId:'810001',name:'真实部员',homeCampus:'南湖',password}},400);
});

test('concurrent activation submissions and approvals have exactly one winner',async()=>{
  const token=await whitelistStaff('820001');
  const body={studentId:'820001',name:'真实部员',homeCampus:'南湖',password};
  const submitted=await Promise.all([request('/api/activation',{method:'POST',body}),request('/api/activation',{method:'POST',body})]);
  assert.deepEqual(submitted.map(response=>response.status).sort(),[201,409]);
  const application=await submitted.find(response=>response.status===201).json();
  const review={ids:[application.id],status:'approved',identityVerified:true,reviewNote:'已核验'};
  const results=await Promise.all([request('/api/activation-requests/review',{method:'POST',token,body:review}),request('/api/activation-requests/review',{method:'POST',token,body:review})]);
  assert.deepEqual(results.map(response=>response.status).sort(),[200,409]);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM staff_accounts WHERE account=?').bind('820001').first()).n,1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM staff_campus_grants WHERE account=?').bind('820001').first()).n,1);
});

test('identity mismatch, duplicate pending attempts, rejection and reapplication do not reserve a staff account',async()=>{
  const token=await whitelistStaff('830001',{name:'真实部员'});
  await api('/api/activation',{method:'POST',body:{studentId:'830001',name:'冒名部员',homeCampus:'南湖',password}},400);
  const first=await applyStaff('830001',{name:'真实部员'});
  await api('/api/activation',{method:'POST',body:{studentId:'830001',name:'真实部员',homeCampus:'南湖',password}},409);
  await api('/api/activation-requests/review',{method:'POST',token,body:{ids:[first.id],status:'rejected',reviewNote:'  '}});
  const second=await applyStaff('830001',{name:'真实部员'});assert.notEqual(first.id,second.id);
  assert.equal((await api(`/api/activation/${first.id}`,{headers:{'X-Activation-Receipt':first.receipt}})).status,'rejected');
  assert.equal((await api(`/api/activation/${first.id}`,{headers:{'X-Activation-Receipt':first.receipt}})).reviewNote,'');
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

test('an outdated staff detail cannot overwrite a newer repair record',async()=>{
  const item=await book(),token=await login();
  const started=await api(`/api/appointments/${item.id}/status`,{method:'PATCH',token,body:{status:'in_progress',...await intake(item, token),revision:item.revision}});
  const first=await api(`/api/appointments/${item.id}/status`,{method:'PATCH',token,body:{repairNote:'管理员已核实故障',revision:started.revision}});
  await api(`/api/appointments/${item.id}/status`,{method:'PATCH',token,body:{repairNote:'过期窗口的记录',revision:started.revision}},409);
  assert.equal((await api(`/api/appointments/${item.id}`,{accessToken:item.accessToken})).repairNote,first.repairNote);
});

test('five-state workflow records the actor and server time, requires a result and excludes exceptions from repair success',async()=>{
  const token=await addUser('870001'),root=await login();
  for(const outcome of ['repaired','unrepaired','not_needed']){
    // Isolate result-validation scenarios from the separately tested IP write quota.
    await db.prepare('DELETE FROM rate_limits').run();
    const item=await book();
    assert.equal(item.status,'booked');assert.equal(item.outcome,null);assert.equal(item.startedAt,null);assert.equal(item.completedAt,null);
    await api(`/api/appointments/${item.id}/status`,{method:'PATCH',token,body:{status:'in_progress',startedAt:'2000-01-01T00:00:00Z'}},400);
    await api(`/api/appointments/${item.id}/status`,{method:'PATCH',token,body:{status:'in_progress',assignedTo:'root001'}},403);
    const started=await api(`/api/appointments/${item.id}/status`,{method:'PATCH',token,body:{status:'in_progress',...await intake(item, token),revision:item.revision}});
    assert.equal(started.assignedTo,'870001');assert.ok(Number.isFinite(Date.parse(started.startedAt)));
    for(const body of [{status:'completed'},{status:'completed',outcome},{status:'completed',outcome,repairNote:'  '},{status:'completed',outcome:'legacy_unknown',repairNote:'不能填写历史结果'}]){
      await api(`/api/appointments/${item.id}/status`,{method:'PATCH',token,body},400);
    }
    const done=await api(`/api/appointments/${item.id}/status`,{method:'PATCH',token,body:{status:'completed',outcome,repairNote:'检测与维修结果',revision:started.revision}});
    assert.equal(done.startedAt,started.startedAt);assert.ok(Date.parse(done.completedAt)>=Date.parse(done.startedAt));
    await api(`/api/appointments/${item.id}/status`,{method:'PATCH',token,body:{repairNote:'维修人员不能修改已结束记录'}},409);
  }
  const cancelled=await book();
  await api(`/api/appointments/${cancelled.id}/status`,{method:'PATCH',accessToken:cancelled.accessToken,body:{status: 'cancelled'}});
  const legacy=await book();
  await db.prepare("UPDATE appointments SET status='completed',outcome='legacy_unknown' WHERE id=?").bind(legacy.id).run();
  const stats=await api('/api/stats/summary',{token:root});
  assert.equal(stats.completed,4);assert.equal(stats.classified,3);assert.equal(stats.repaired,1);assert.equal(stats.repairSuccessRate,33);
  assert.deepEqual(stats.technicians['870001'],{started:3,completed:3});
  const csv=await (await request('/api/export/appointments.csv',{token:root})).text();
  assert.ok(csv.includes('维修结果') && csv.includes('开始时间(UTC)') && csv.includes('修复成功') && csv.includes('历史未分类'));
});

test('automatic expirations honor 21:30 Shanghai, dry-run, missed days, active repairs and idempotency',async()=>{
  const waiting=await book(),past=await book(),active=await book(),future=await book();
  const token=await login();
  await api(`/api/appointments/${active.id}/status`,{method:'PATCH',token,body:{status:'in_progress',...await intake(active, token)}});
  await setAppointmentDate(past.id, addDays(date,-1));
  await setAppointmentDate(future.id, addDays(date,1));
  const repository=appointmentRepository(db);
  const before=new Date(`${date}T21:29:59.999+08:00`),at=new Date(`${date}T21:30:00+08:00`);
  assert.equal((await expireAppointments(repository,{now:before})).eligible,1);
  assert.equal((await repository.find(past.id)).status,'booked');
  assert.equal((await expireAppointments(repository,{apply:true,now:before})).ended,1);
  assert.equal((await repository.find(waiting.id)).status,'booked');
  assert.equal((await expireAppointments(repository,{apply:true,now:at})).ended,1);
  const ended=await repository.find(waiting.id);
  assert.equal(ended.status,'expired');assert.equal(ended.outcome,null);assert.equal(ended.completedAt,at.toISOString());assert.equal(ended.assignedTo,'');assert.equal(ended.startedAt,null);
  assert.equal((await repository.find(active.id)).status,'in_progress');assert.equal((await repository.find(future.id)).status,'booked');
  assert.equal((await expireAppointments(repository,{apply:true,now:at})).ended,0);
  assert.equal((await repository.find(waiting.id)).revision,ended.revision);
  const live=await api(`/api/live/summary?appointmentId=${waiting.id}`,{accessToken:waiting.accessToken});
  assert.equal(live.position,null);assert.equal(live.slotTotal,2);assert.equal(live.queueTotal,1);
});

test('queries and writes catch up missed automatic endings; unauthorized credentials cannot alter records',async()=>{
  const item=await book(),repository=appointmentRepository(db),users=userRepository(db);
  const after=new Date(`${date}T21:30:00+08:00`);
  const service=appointmentService(repository,users,PII_ENCRYPTION_KEY,()=>after);
  await assert.rejects(service.lookup(item.id,'x'.repeat(43)),error=>error.status===404);
  assert.equal((await repository.find(item.id)).status,'booked');
  const ended=await service.lookup(item.id,item.accessToken);
  assert.equal(ended.status,'expired');assert.equal(ended.outcome,null);
  await assert.rejects(service.update(item.id,{patch:{status:'in_progress'}},await users.find('root001')),error=>error.status===409);
  const another=await book();
  const listed=await service.list({status:'all'},await users.find('root001'));
  assert.equal(listed.items.find(row=>row.id===another.id).status,'expired');
  const expired=appointmentService(repository,users,PII_ENCRYPTION_KEY,()=>new Date(`${date}T20:00:00+08:00`));
  await assert.rejects(expired.create(draft()),error=>error.status===400 && error.message.includes('时段已经结束'));
});

test('admin corrections preserve start on reopening, validate reassignment and clear fields on undoing sign-in',async()=>{
  const item=await book(),root=await login(),tech=await addUser('870002');
  await addUser('870003');
  const started=await api(`/api/appointments/${item.id}/status`,{method:'PATCH',token:tech,body:{status:'in_progress',...await intake(item, tech)}});
  const done=await api(`/api/appointments/${item.id}/status`,{method:'PATCH',token:tech,body:{status:'completed',outcome:'unrepaired',repairNote:'未能修复'}});
  await api(`/api/appointments/${item.id}/status`,{method:'PATCH',token:tech,body:{action:'correct',outcome:'repaired',repairNote:'越权纠错'}},403);
  const fixed=await api(`/api/appointments/${item.id}/status`,{method:'PATCH',token:root,body:{action:'correct',outcome:'repaired',repairNote:'复测已修复',revision:done.revision}});
  assert.equal(fixed.completedAt,done.completedAt);assert.equal(fixed.startedAt,started.startedAt);
  await api(`/api/appointments/${item.id}/status`,{method:'PATCH',token:root,body:{action:'correct',assignedTo:'missing'}},400);
  const resumed=await api(`/api/appointments/${item.id}/status`,{method:'PATCH',token:root,body:{action:'correct',status:'in_progress',assignedTo:'870003'}});
  assert.equal(resumed.startedAt,started.startedAt);assert.equal(resumed.completedAt,null);assert.equal(resumed.outcome,null);assert.equal(resumed.assignedTo,'870003');
  const reset=await api(`/api/appointments/${item.id}/status`,{method:'PATCH',token:root,body:{action:'correct',status:'booked'}});
  for(const key of ['startedAt','completedAt','outcome'])assert.equal(reset[key],null);
  assert.equal(reset.assignedTo,'');assert.equal(reset.repairNote,'');
  const service=appointmentService(appointmentRepository(db),userRepository(db),PII_ENCRYPTION_KEY,()=>new Date(`${date}T21:30:00+08:00`));
  await assert.rejects(service.update(item.id,{action:'correct',patch:{status:'booked'}},await userRepository(db).find('root001')),error=>error.status===409);
});

test('workflow migration preserves populated legacy records, credentials, attachments, quota and foreign keys',async()=>{
  const legacy=await mf.getD1Database('WORKFLOW_UPGRADE_DB');
  await applyMigration(legacy,'0001_initial.sql');await applyMigration(legacy,'0002_slot_capacity.sql');
  await legacy.prepare("INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES ('900001','历史人员','technician','南湖','hash','2026-10-01')").run();
  const statuses=['pending','awaiting_claim','claimed','in_progress','completed','cancelled','no_show','no_repair'];
  for(const [n,status] of statuses.entries()){
    await legacy.prepare(`INSERT INTO appointments(id,student_id,name,campus,phone,social,device_type,brand,device_model,warranty,fault_type,date,time_slot,status,assigned_to,repair_note,access_token_hash,credential_rotated_at,revision,created_at,agreement_at,agreement_version)
      VALUES (?,?,'历史同学','南湖','enc$phone','enc$social','电脑','品牌','型号','否','蓝屏',?,'19:00–20:00',?,'900001','原始维修记录',?,'2026-10-01',7,'2026-10-01','2026-10-01','v1')`)
      .bind(`workflow-${n}`,String(n===6 ? 910000 : 910000+n),date,status,n.toString(16).padStart(64,'0')).run();
  }
  await legacy.prepare("INSERT INTO attachment_storage VALUES ('file','private/key',4,'complete','2026-10-01','2027-10-01')").run();
  await legacy.prepare("INSERT INTO appointment_attachments VALUES ('file','workflow-0','历史.txt','text/plain',4,'private/key','2026-10-01','2027-10-01')").run();
  await legacy.prepare("INSERT INTO credential_recoveries VALUES ('recovery','workflow-0','900001','原始核验说明','2026-10-01')").run();
  const original=(await legacy.prepare('SELECT * FROM appointments ORDER BY id').all()).results;
  await applyMigration(legacy,'0003_three_step_workflow.sql');
  const mapped=(await legacy.prepare('SELECT * FROM appointments ORDER BY id').all()).results;
  assert.equal(mapped.length,8);
  for(const [n,row] of mapped.entries()){
    const {status,...rest}=original[n];
    for(const [key,value] of Object.entries(rest))assert.equal(row[key],value,`${row.id}.${key}`);
    assert.equal(row.status,n<2 ? 'booked' : n<4 ? 'in_progress' : 'completed');
    assert.equal(row.outcome,({completed:'legacy_unknown',cancelled:'cancelled',no_show:'no_show',no_repair:'unrepaired'})[status] || null);
    assert.equal(row.started_at,null);assert.equal(row.completed_at,null);
  }
  assert.equal((await legacy.prepare('SELECT COUNT(*) AS n FROM appointment_attachments').first()).n,1);
  assert.equal((await legacy.prepare('SELECT reason FROM credential_recoveries').first()).reason,'原始核验说明');
  assert.equal((await legacy.prepare('SELECT used_bytes FROM storage_quota').first()).used_bytes,4);
  assert.deepEqual((await legacy.prepare('PRAGMA foreign_key_check').all()).results,[]);
  await assert.rejects(legacy.prepare("UPDATE appointments SET status='pending' WHERE id='workflow-0'").run());
  await assert.rejects(legacy.prepare("UPDATE appointments SET outcome='repaired' WHERE id='workflow-0'").run());
  await assert.rejects(legacy.prepare("UPDATE appointments SET status='booked',outcome=NULL WHERE id='workflow-6'").run(),/UNIQUE/);
  await legacy.prepare("DELETE FROM attachment_storage WHERE id='file'").run();
  assert.equal((await legacy.prepare('SELECT COUNT(*) AS n FROM appointment_attachments').first()).n,0);
  assert.equal((await legacy.prepare('SELECT used_bytes FROM storage_quota').first()).used_bytes,0);
});

test('finished repairs and expirations retain capacity while restoring a cancellation checks capacity',async()=>{
  const items=[];for(let n=0;n<5;n++)items.push(await book());
  const token=await login();
  await api(`/api/appointments/${items[0].id}/status`,{method:'PATCH',token,body:{status:'in_progress',...await intake(items[0], token)}});
  await api(`/api/appointments/${items[0].id}/status`,{method:'PATCH',token,body:{status:'completed',outcome:'not_needed',repairNote:'无需维修'}});
  await api('/api/appointments',{method:'POST',body:draft()},409);
  await appointmentRepository(db).expirePending(expirationDeadline(date),{id:items[1].id});
  await api('/api/appointments',{method:'POST',body:draft()},409);
  await api(`/api/appointments/${items[2].id}/status`,{method:'PATCH',accessToken:items[2].accessToken,body:{status: 'cancelled'}});
  await book();
  await api(`/api/appointments/${items[2].id}/status`,{method:'PATCH',token,body:{action:'correct',status:'in_progress',assignedTo:'root001'}},409);
  assert.equal((await api(`/api/appointments/${items[2].id}`,{accessToken:items[2].accessToken})).status,'cancelled');
});

test('correcting legacy results preserves missing times and disabled historical assignees',async()=>{
  const item=await book(),root=await login();await addUser('870004');
  await db.prepare("UPDATE appointments SET status='completed',outcome='legacy_unknown',assigned_to='870004',repair_note='旧维修说明' WHERE id=?").bind(item.id).run();
  await api('/api/users/870004',{method:'PATCH',token:root,body:{status:'disabled'}});
  const corrected=await api(`/api/appointments/${item.id}/status`,{method:'PATCH',token:root,body:{action:'correct',outcome:'repaired',repairNote:'管理员核对旧记录确认已修复'}});
  assert.equal(corrected.assignedTo,'870004');assert.equal(corrected.startedAt,null);assert.equal(corrected.completedAt,null);
  await api(`/api/appointments/${item.id}/status`,{method:'PATCH',token:root,body:{action:'correct',status:'in_progress'}},400);
  await api('/api/users/870004',{method:'PATCH',token:root,body:{status:'enabled'}});
  const resumed=await api(`/api/appointments/${item.id}/status`,{method:'PATCH',token:root,body:{action:'correct',status:'in_progress'}});
  assert.equal(resumed.startedAt,null);assert.equal(resumed.completedAt,null);assert.equal(resumed.outcome,null);
});


test('booking requires nonblank bounded handwriting and persists agreement signature', async () => {
  for (const invalid of [undefined, [], [[[0.1,0.1],[0.1,0.1]]], [[[2,0],[0,0]]]]) {
    await api('/api/appointments', {method:'POST',body:draft({signature:invalid})}, 400);
  }
  const item = await book();
  assert.deepEqual(JSON.parse(item.signature), signature);
  const stored = await db.prepare('SELECT signature,agreement_at FROM appointments WHERE id=?').bind(item.id).first();
  assert.deepEqual(JSON.parse(stored.signature), signature);
  assert.equal(stored.agreement_at, item.createdAt);
});

test('sign-in requires two purpose-matched photos uploaded by the signing technician', async () => {
  const item = await book(), other = await book(), token = await addUser('880001'), colleague = await addUser('880002'), root = await login();
  const change = (body, expected=400) => api(`/api/appointments/${item.id}/status`, {method:'PATCH',token,body:{status:'in_progress',...body}}, expected);
  await change({});
  await api(`/api/appointments/${item.id}/attachments`, {method:'POST',accessToken:item.accessToken,body:{...photo,purpose:'intake_front'}}, 401);
  await api(`/api/appointments/${item.id}/attachments`, {method:'POST',token,body:{filename:'fake.txt',mimeType:'text/plain',data:'dGVzdA==',purpose:'intake_front'}}, 400);
  const wrongActor = await intake(item, colleague);
  await change(wrongActor);
  const wrongOrder = await intake(other, token);
  await change(wrongOrder);
  const photos = await intake(item, token);
  await change({frontPhotoId:photos.frontPhotoId});
  await change({frontPhotoId:photos.backPhotoId,backPhotoId:photos.frontPhotoId});
  await change({frontPhotoId:photos.frontPhotoId,backPhotoId:photos.frontPhotoId});
  await api(`/api/appointments/${item.id}/status`, {method:'PATCH',token:root,body:{action:'correct',status:'in_progress',assignedTo:'880001'}}, 409);
  assert.equal((await appointmentRepository(db).find(item.id)).status, 'booked');
  const started = await change(photos, 200);
  assert.equal(started.assignedTo, '880001'); assert.equal(started.frontPhotoId, photos.frontPhotoId); assert.equal(started.backPhotoId, photos.backPhotoId);
  assert.equal(started.repairNumber, null);
});

test('booking numbers use the selected date across Shanghai midnight, campuses and slots', async () => {
  let instant = new Date('2026-10-13T23:59:00+08:00');
  const service = appointmentService(appointmentRepository(db), userRepository(db), PII_ENCRYPTION_KEY, () => instant);
  const create = patch => service.create(bookingInput(draft({date:'2026-10-15',...patch})));
  const first = await create();
  assert.equal(first.id, 'reserve020261015-01');
  instant = new Date('2026-10-14T00:01:00+08:00');
  const second = await create(), laterSlot = await create({timeSlot:'20:00–20:30'});
  assert.equal(second.id, 'reserve020261015-02');
  assert.equal(laterSlot.id, 'reserve020261015-03');
  assert.equal((await create({campus:'浑南'})).id, 'reserve120261015-01');
  assert.equal((await create({date:'2026-10-14'})).id, 'reserve020261014-01');
  const cancelled = await service.update(second.id, {patch:{status: 'cancelled'}}, null, second.accessToken);
  assert.equal(cancelled.id, second.id); assert.equal(cancelled.repairNumber, null);
  assert.equal((await create()).id, 'reserve020261015-04');
});

test('new bookings continue legacy booking suffixes without rewriting primary keys or using repair sequences', async () => {
  const service = appointmentService(appointmentRepository(db), userRepository(db), PII_ENCRYPTION_KEY, () => new Date('2026-10-13T10:00:00+08:00'));
  const create = () => service.create(bookingInput(draft({date:'2026-10-15'})));
  const legacyIds = ['reserve020261015-11','reverse020261015-97','020261015-99'];
  for (const id of legacyIds) {
    const item = await create();
    // Pre-upgrade fixtures include all historical booking prefixes.
    await db.prepare('UPDATE appointments SET id=? WHERE id=?').bind(id,item.id).run();
  }
  await db.prepare('UPDATE appointments SET repair_number=? WHERE id=?').bind('020261015-900',legacyIds[0]).run();
  const before = (await db.prepare('SELECT * FROM appointments ORDER BY id').all()).results;
  const current = await Promise.all([create(),create()]);
  assert.deepEqual(current.map(item=>item.id).sort(), ['reserve020261015-100','reserve020261015-101']);
  assert.ok(current.every(item=>item.repairNumber===null));
  const after = (await db.prepare('SELECT * FROM appointments WHERE id IN (?,?,?) ORDER BY id').bind(...legacyIds).all()).results;
  assert.deepEqual(after, before);
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
});

test('completion and correction reuse the booking number even on a later day', async () => {
  const first = await book(), second = await book(), third = await book(), foreign = await book({campus:'浑南'}), root = await login();
  const repository = appointmentRepository(db), users = userRepository(db), actor = await users.find('root001');
  for (const [index,item] of [first,second,third,foreign].entries()) {
    const token = index === 3 ? root : await addUser(`99100${index}`);
    await api(`/api/appointments/${item.id}/status`, {method:'PATCH',token,body:{status:'in_progress',...await intake(item,token)}});
  }
  // UTC 16:01 is the next business day in Shanghai.
  const nextDay = addDays(dateKey(), 1), instant = new Date(`${nextDay}T00:01:00+08:00`);
  const service = appointmentService(repository, users, PII_ENCRYPTION_KEY, () => instant);
  const finish = item => service.update(item.id, {patch:{status:'completed',outcome:'repaired',repairNote:'检测完成'}}, actor);
  const doneSecond = await finish(second), doneFirst = await finish(first), doneForeign = await finish(foreign);
  for (const [done, original] of [[doneSecond,second],[doneFirst,first],[doneForeign,foreign]]) {
    assert.equal(done.repairNumber, null); assert.equal(done.id, original.id);
    assert.equal(done.completedAt, instant.toISOString());
  }
  const later = appointmentService(repository, users, PII_ENCRYPTION_KEY, () => new Date(`${addDays(nextDay,1)}T00:01:00+08:00`));
  const doneThird = await later.update(third.id, {patch:{status:'completed',outcome:'not_needed',repairNote:'无需处理'}}, actor);
  assert.equal(doneThird.id, third.id); assert.equal(doneThird.repairNumber, null);
  await assert.rejects(finish(second), error => error.status === 409);
  const corrected = await service.update(second.id, {action:'correct',patch:{status:'completed',outcome:'unrepaired',repairNote:'复核'}}, actor);
  assert.equal(corrected.id, second.id); assert.equal(corrected.repairNumber, null);
  const search = await api(`/api/appointments?q=${doneSecond.id}`, {token:root});
  assert.deepEqual(search.items.map(item=>item.id), [second.id]);
  const csv = await (await request('/api/export/appointments.csv',{token:root})).text();
  assert.ok(csv.includes(doneSecond.id)); assert.ok(csv.includes('历史维修编号'));
  assert.ok((await db.prepare('SELECT repair_number FROM appointments').all()).results.every(row=>row.repair_number===null));
  for (const field of ['id','repairNumber']) {
    await api(`/api/appointments/${second.id}/status`, {method:'PATCH',token:root,body:{action:'correct',repairNote:'不能改号',[field]:'020261015-99'}}, 400);
  }
});

test('concurrent completion retries retain original numbers and reject conflicting stale revisions', async () => {
  const root = await login(), items = await Promise.all([book(),book(),book()]);
  for (const [index,item] of items.entries()) {
    const token = index === 0 ? root : await addUser(`99200${index}`);
    Object.assign(item, await api(`/api/appointments/${item.id}/status`, {method:'PATCH',token,body:{status:'in_progress',...await intake(item,token)}}));
  }
  const finish = item => request(`/api/appointments/${item.id}/status`, {method:'PATCH',token:root,body:{status:'completed',outcome:'repaired',repairNote:'已修复',revision:item.revision}});
  const responses = await Promise.all([finish(items[0]),finish(items[0]),finish(items[1])]);
  assert.deepEqual(responses.map(r=>r.status).sort(), [200,200,200]);
  const completed = [];
  for (const response of responses) if (response.status === 200) completed.push(await response.json());
  assert.deepEqual([...new Set(completed.map(item=>item.id))].sort(), items.slice(0,2).map(item=>item.id).sort());
  await api(`/api/appointments/${items[0].id}/status`, {method:'PATCH',token:root,body:{status:'completed',outcome:'unrepaired',repairNote:'不同结果',revision:items[0].revision}},409);
  assert.ok(completed.every(item=>item.repairNumber===null));
  const last = await finish(items[2]); assert.equal(last.status, 200);
  const done = await last.json(); assert.equal(done.id, items[2].id); assert.equal(done.repairNumber, null);
  assert.equal((await book()).id.split('-')[1], '04');
});

test('historical booking and repair numbers retain credentials, attachments, recovery, search and export', async () => {
  const root = await login(), repository = appointmentRepository(db), actor = await userRepository(db).find('root001');
  for (const [index,prefix] of ['','reverse','reserve'].entries()) {
    const headers = {'CF-Connecting-IP':`198.51.100.${70+index}`};
    const clientApi = (path,options,status) => api(path,{...options,headers},status);
    const clientRequest = (path,options) => request(path,{...options,headers});
    const current = await book(), id = `${prefix}020261012-${51+index}`, repairNumber = `020261015-${51+index}`;
    await db.prepare("UPDATE appointments SET id=?,repair_number=?,status='completed',outcome='repaired',assigned_to='root001',repair_note='旧维修说明',started_at=?,completed_at=? WHERE id=?")
      .bind(id,repairNumber,current.createdAt,current.createdAt,current.id).run();
    const item = {...current,id}, accessToken = item.accessToken;
    const stored = await db.prepare('SELECT * FROM appointments WHERE id=?').bind(id).first();
    const file = await clientApi(`/api/appointments/${repairNumber}/attachments`, {method:'POST',accessToken,body:{filename:'历史.txt',mimeType:'text/plain',data:'bGVnYWN5'}}, 201);
    assert.equal(file.appointmentId, id);
    for (const query of [id,repairNumber]) {
      const found = await clientApi(`/api/appointments/${query}`, {accessToken});
      assert.equal(found.id, id); assert.equal(found.repairNumber, repairNumber); assert.equal(found.attachments[0].id, file.id);
      await clientApi(`/api/appointments/${query}`, {}, 404);
      await clientApi(`/api/appointments/${query}`, {accessToken:'x'.repeat(43)}, 404);
      const list = await clientApi(`/api/appointments?q=${query}`, {token:root});
      assert.deepEqual(list.items.map(item=>item.id), [id]);
      const live = await clientApi(`/api/live/summary?appointmentId=${query}`, {accessToken});
      assert.equal(live.position, null);
      assert.equal((await clientApi(`/api/appointments/${query}/attachments`, {accessToken})).items[0].id, file.id);
      assert.equal(await (await clientRequest(`/api/appointments/${query}/attachments/${file.id}`, {accessToken})).text(), 'legacy');
    }
    assert.deepEqual(await db.prepare('SELECT * FROM appointments WHERE id=?').bind(id).first(), stored);
    const corrected = await clientApi(`/api/appointments/${id}/status`, {method:'PATCH',token:root,body:{action:'correct',outcome:'unrepaired',repairNote:'复核旧记录'}});
    assert.equal(corrected.id, id); assert.equal(corrected.repairNumber, repairNumber);
    const service = appointmentService(repository, userRepository(db), PII_ENCRYPTION_KEY, () => new Date(`${item.date}T18:00:00+08:00`));
    const reopened = await service.update(id, {action:'correct',patch:{status:'in_progress'}}, actor);
    const ended = await service.update(id, {patch:{status:'completed',outcome:'repaired',repairNote:'重新检测'}}, actor);
    assert.equal(reopened.repairNumber, repairNumber); assert.equal(ended.repairNumber, repairNumber);
    const recovered = await clientApi(`/api/appointments/${id}/credential`, {method:'POST',token:root,body:{identityVerified:true,reason:'已当面核验历史预约学生身份'}});
    assert.equal(recovered.id, id);
    await clientApi(`/api/appointments/${repairNumber}`, {accessToken}, 404);
    assert.equal((await clientApi(`/api/appointments/${repairNumber}`, {accessToken:recovered.accessToken})).id, id);
    const recovery = await db.prepare('SELECT appointment_id FROM credential_recoveries WHERE appointment_id=?').bind(id).first();
    assert.equal(recovery.appointment_id, id);
    const csv = await (await request('/api/export/appointments.csv',{token:root})).text();
    assert.ok(csv.includes(id) && csv.includes(repairNumber));
  }
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
});

test('repair aliases resolve by credential before expiration, cancellation and attachment ownership checks', async () => {
  const original = await book(), other = await book(), alias = '020261012-88';
  await db.prepare('UPDATE appointments SET repair_number=? WHERE id=?').bind(alias,original.id).run();
  // An old unprefixed primary key can have the same text as another repair number.
  await db.prepare('UPDATE appointments SET id=? WHERE id=?').bind(alias,other.id).run();
  assert.equal((await api(`/api/appointments/${alias}`, {accessToken:original.accessToken})).id, original.id);
  assert.equal((await api(`/api/appointments/${alias}`, {accessToken:other.accessToken})).id, alias);
  const file = await api(`/api/appointments/${alias}/attachments`, {method:'POST',accessToken:original.accessToken,body:{filename:'alias.txt',mimeType:'text/plain',data:'b3duZXI='}}, 201);
  await api(`/api/appointments/${alias}/attachments/${file.id}`, {accessToken:other.accessToken}, 404);
  const cancelled = await api(`/api/appointments/${alias}/status`, {method:'PATCH',accessToken:original.accessToken,body:{status: 'cancelled'}});
  assert.equal(cancelled.id, original.id); assert.equal((await appointmentRepository(db).find(alias)).status, 'booked');
  const repository = appointmentRepository(db);
  await setAppointmentDate(alias, addDays(dateKey(),-1));
  await db.prepare("UPDATE appointments SET date=?,repair_number=? WHERE id=?").bind(addDays(dateKey(),-1),'020261012-89',alias).run();
  const expired = await api('/api/appointments/020261012-89', {accessToken:other.accessToken});
  assert.equal(expired.id, alias); assert.equal(expired.status, 'expired'); assert.equal(expired.outcome, null);
  assert.equal((await repository.find(original.id)).status, 'cancelled');
});

test('weekday half-hour settings default to five and follow administrator campus grants', async () => {
  const root = await login();
  const defaults = (await api('/api/slot-capacities', { token: root })).items;
  assert.equal(defaults.length, 32);
  assert.ok(defaults.every(item => item.capacity === 5 && item.revision === 0));
  assert.equal(new Set(defaults.map(item => `${item.campus}/${item.weekday}/${item.timeSlot}`)).size, 32);
  const input = { campus: '南湖', weekday: 1, timeSlot: '19:00–19:30', capacity: 4, revision: 0 };
  await api('/api/slot-capacities', {}, 401);
  await api('/api/slot-capacities', { method: 'PATCH', body: input }, 401);
  const technician = await addUser('910001');
  await api('/api/slot-capacities', { token: technician }, 403);
  await api('/api/slot-capacities', { method: 'PATCH', token: technician, body: input }, 403);
  const admin = await addUser('910002', 'admin');
  await db.prepare("UPDATE staff_accounts SET home_campus='浑南' WHERE account='910002'").run();
  const scoped = (await api('/api/slot-capacities', { token: admin })).items;
  assert.equal(scoped.length, 16);
  assert.ok(scoped.every(item => item.campus === '南湖'));
  const updated = await api('/api/slot-capacities', { method: 'PATCH', token: admin, body: input });
  assert.deepEqual(updated, { ...input, revision: 1 });
  await api('/api/slot-capacities', { method: 'PATCH', token: admin, body: { ...input, campus: '浑南' } }, 403);
  assert.ok((await api('/api/slot-capacities', { token: root })).items.filter(item => item.campus === '浑南').every(item => item.capacity === 5));
  await api('/api/users/910002', { method: 'PATCH', token: root, body: { status: 'disabled' } });
  await api('/api/slot-capacities', { token: admin }, 401);
  await api('/api/slot-capacities', { method: 'PATCH', token: admin, body: updated }, 401);
});

test('capacity APIs and D1 reject invalid numbers, versions, campuses and slots', async () => {
  const token = await login(), input = { campus: '南湖', weekday: 1, timeSlot: '19:00–19:30', capacity: 5, revision: 0 };
  const invalid = [
    ...[-1, 0.5, '5', '', null, true, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity].map(capacity => ({ capacity })),
    ...[undefined, -1, 0.5, '0', null, Number.MAX_SAFE_INTEGER + 1].map(revision => ({ revision })),
    ...[undefined,0,5,1.5,'1',null].map(weekday=>({weekday})), { timeSlot:'19:00–20:00' }, { campus: '其他' }, { campus: null }, { timeSlot: '10:00–11:00' }, { timeSlot: null }
  ];
  for (const patch of invalid) await api('/api/slot-capacities', { method: 'PATCH', token, body: { ...input, ...patch } }, 400);
  for (const capacity of [-1, 0.5, 'invalid', null, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(db.prepare("UPDATE weekday_slot_capacities SET capacity=? WHERE campus='南湖' AND time_slot='19:00–19:30'").bind(capacity).run(), /constraint/i);
  }
  await assert.rejects(db.prepare("UPDATE weekday_slot_capacities SET campus='其他' WHERE campus='南湖'").run(), /constraint/i);
  await assert.rejects(db.prepare("UPDATE weekday_slot_capacities SET time_slot='10:00–11:00' WHERE campus='南湖'").run(), /constraint/i);
  assert.ok((await api('/api/slot-capacities', { token })).items.every(item => item.capacity === 5 && item.revision === 0));
  const normalized = await api('/api/slot-capacities', { method: 'PATCH', token, body: { ...input, timeSlot: '19:00-19:30', capacity: Number.MAX_SAFE_INTEGER } });
  assert.equal(normalized.timeSlot, input.timeSlot);
  assert.equal(normalized.capacity, Number.MAX_SAFE_INTEGER);
});

test('weekday templates freeze on first booking and preserve cancellations, restoration and queues', async () => {
  await db.prepare('DELETE FROM booking_day_slots').run();
  const token = await login(), timeSlot = '19:00–19:30';
  await configureCapacity(token, 3);
  const responses = await Promise.all(Array.from({length:8}, () => request('/api/appointments', {method:'POST',body:draft({timeSlot})})));
  assert.equal(responses.filter(r=>r.status===201).length,3);
  assert.equal(responses.filter(r=>r.status===409).length,5);
  const item = await responses.find(r=>r.status===201).json();
  await configureCapacity(token,0);
  const summary = await api(`/api/live/summary?date=${date}&campus=${encodeURIComponent('南湖')}`);
  assert.deepEqual(summary.timeSlots,['19:00–19:30','19:30–20:00','20:00–20:30','20:30–21:00']);
  assert.equal(summary.slotCapacities[timeSlot],3);
  assert.equal(summary.slots[timeSlot],3);
  assert.equal((await api(`/api/live/summary?date=${addDays(date,7)}&campus=${encodeURIComponent('南湖')}`)).slotCapacities[timeSlot],0);
  assert.equal((await api(`/api/live/summary?date=${date}&campus=${encodeURIComponent('浑南')}`)).slotCapacities[timeSlot],5);
  await api(`/api/appointments/${item.id}/status`,{method:'PATCH',accessToken:item.accessToken,body:{status:'cancelled'}});
  await api(`/api/appointments/${item.id}/status`,{method:'PATCH',token,body:{action:'correct',status:'booked'}});
  await api('/api/appointments',{method:'POST',body:draft({timeSlot:'19:00–19:30'})},409);
  const overview=await api('/api/appointments/overview',{token});
  assert.equal(overview.items.find(r=>r.campus==='南湖' && r.date===date && r.timeSlot===timeSlot).capacity,3);
  for (const row of (await db.prepare('SELECT id FROM appointments').all()).results)
    await db.prepare("UPDATE appointments SET status='cancelled',outcome=NULL WHERE id=?").bind(row.id).run();
  assert.equal((await api(`/api/live/summary?date=${date}&campus=${encodeURIComponent('南湖')}`)).slotCapacities[timeSlot],3);
  await book({timeSlot});
  assert.equal((await api(`/api/live/summary?appointmentId=${item.id}`,{accessToken:item.accessToken})).capacity,3);
});

test('all four half-hour slots propagate through booking, summary, queue, overview, filters and export', async () => {
  await db.prepare('DELETE FROM booking_day_slots').run();
  const token = await login(), targetDate = bookingDates.find(day => day > dateKey());
  assert.ok(targetDate, 'fixture requires a future service day in the booking window');
  const bookings = [];
  for (const timeSlot of TIME_SLOTS) {
    const item = await book({ date: targetDate, timeSlot });
    bookings.push(item);
    const lookup = await api(`/api/appointments/${item.id}`, { accessToken: item.accessToken });
    assert.equal(lookup.timeSlot, timeSlot);
    const summary = await api(`/api/live/summary?appointmentId=${item.id}`, { accessToken: item.accessToken });
    assert.deepEqual(summary.timeSlots, TIME_SLOTS);
    assert.equal(summary.capacity, 5);
    assert.equal(summary.slotTotal, 1);
    assert.equal(summary.position, 1);
    const query = new URLSearchParams({ campus: '南湖', date: targetDate, timeSlot });
    const filtered = await api(`/api/appointments?${query}`, { token });
    assert.deepEqual(filtered.items.map(row => row.id), [item.id]);
  }
  const summary = await api(`/api/live/summary?${new URLSearchParams({ campus: '南湖', date: targetDate })}`);
  assert.deepEqual(summary.slots, Object.fromEntries(TIME_SLOTS.map(slot => [slot, 1])));
  assert.deepEqual(summary.slotCapacities, Object.fromEntries(TIME_SLOTS.map(slot => [slot, 5])));
  assert.equal(summary.capacity, 20);
  const overview = await api('/api/appointments/overview', { token });
  const rows = overview.items.filter(item => item.campus === '南湖' && item.date === targetDate);
  assert.deepEqual(rows.map(row => row.timeSlot), TIME_SLOTS);
  assert.ok(rows.every(row => row.occupied === 1 && row.remaining === 4 && row.capacity === 5));
  const csv = await (await request('/api/export/appointments.csv', { token })).text();
  for (const item of bookings) assert.ok(csv.includes(item.id) && csv.includes(item.timeSlot));
  const cancelled = bookings[3];
  await api(`/api/appointments/${cancelled.id}/status`, { method: 'PATCH', accessToken: cancelled.accessToken, body: { status: 'cancelled' } });
  const refreshed = await api(`/api/live/summary?${new URLSearchParams({ campus: '南湖', date: targetDate })}`);
  assert.equal(refreshed.slots[TIME_SLOTS[3]], 0);
  assert.equal(refreshed.slots[TIME_SLOTS[0]], 1);
});

test('new booking and query APIs reject retired hourly slots', async () => {
  const retired = '19:00–20:00';
  await api('/api/appointments', { method: 'POST', body: draft({ timeSlot: retired }) }, 400);
  await api(`/api/live/summary?${new URLSearchParams({ date, campus: '南湖', timeSlot: retired })}`, {}, 400);
  await api(`/api/appointments?${new URLSearchParams({ date, campus: '南湖', timeSlot: retired })}`, { token: await login() }, 400);
});

test('concurrent configuration updates cannot overwrite a stale revision or affect another slot', async () => {
  const token = await login(), input = { campus: '南湖', weekday: 1, timeSlot: '19:00–19:30', capacity: 5, revision: 0 };
  const responses = await Promise.all([5, 7].map(capacity => request('/api/slot-capacities', { method: 'PATCH', token, body: { ...input, capacity } })));
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const winner = await responses.find(response => response.status === 200).json();
  assert.equal(winner.revision, 1);
  await api('/api/slot-capacities', { method: 'PATCH', token, body: input }, 409);
  const other = await api('/api/slot-capacities', { method: 'PATCH', token, body: { ...input, timeSlot: '20:00–20:30' } });
  assert.equal(other.revision, 1);
  const current = (await api('/api/slot-capacities', { token })).items.find(item => item.campus === winner.campus && item.weekday === winner.weekday && item.timeSlot === winner.timeSlot);
  assert.deepEqual(current, winner);
  assert.equal((await api('/api/slot-capacities', { method: 'PATCH', token, body: { ...winner, capacity: 0 } })).revision, 2);
});

test('first booking and template pause race atomically without partial snapshots', async () => {
  await db.prepare('DELETE FROM booking_day_slots').run();
  const token = await login(), item = await configureCapacity(token,1);
  const [paused,reservation]=await Promise.all([
    request('/api/slot-capacities',{method:'PATCH',token,body:{...item,capacity:0}}),
    request('/api/appointments',{method:'POST',body:draft({timeSlot:item.timeSlot})})
  ]);
  assert.equal(paused.status,200);
  assert.ok([201,409].includes(reservation.status));
  const summary=await api(`/api/live/summary?date=${date}&campus=${encodeURIComponent('南湖')}`);
  assert.equal(summary.slotCapacities[item.timeSlot],reservation.status===201 ? 1:0);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM booking_day_slots WHERE campus='南湖' AND date=?").bind(date).first()).n,reservation.status===201 ? 4:0);
  await api('/api/appointments',{method:'POST',body:draft({timeSlot:item.timeSlot})},409);
});

test('slot settings migration preserves existing records and replaces fixed capacity triggers', async () => {
  const legacy = await mf.getD1Database('SLOT_SETTINGS_UPGRADE_DB');
  for (const file of ['0001_initial.sql', '0002_slot_capacity.sql', '0003_three_step_workflow.sql', '0004_signatures_intake_numbers.sql']) await applyMigration(legacy, file);
  const insert = n => legacy.prepare(`INSERT INTO appointments
    (id,student_id,name,campus,social,device_type,brand,device_model,warranty,fault_type,date,time_slot,status,
      access_token_hash,credential_rotated_at,created_at,agreement_at,agreement_version)
    VALUES (?,?,'历史同学','南湖','private','电脑','品牌','型号','否','蓝屏',?,'19:00–20:00','booked',?,?,?,?,'v1')`)
    .bind(`settings-${n}`, String(950000 + n), date, String(n).padStart(64, '0'), date, date, date);
  for (let n = 1; n <= 4; n++) await insert(n).run();
  await legacy.prepare("UPDATE appointments SET status='completed',outcome='cancelled' WHERE id='settings-4'").run();
  const original = (await legacy.prepare('SELECT * FROM appointments ORDER BY id').all()).results;
  await applyMigration(legacy, '0005_slot_capacity_settings.sql');
  assert.deepEqual((await legacy.prepare('SELECT * FROM appointments ORDER BY id').all()).results, original);
  assert.deepEqual((await legacy.prepare('PRAGMA foreign_key_check').all()).results, []);
  const defaults = (await legacy.prepare('SELECT * FROM slot_capacities').all()).results;
  assert.equal(defaults.length, 4);
  assert.ok(defaults.every(item => item.capacity === 10 && item.revision === 0));
  await legacy.prepare("UPDATE slot_capacities SET capacity=0 WHERE campus='南湖' AND time_slot='19:00–20:00'").run();
  await assert.rejects(insert(5).run(), /SLOT_PAUSED/);
  await assert.rejects(legacy.prepare("UPDATE appointments SET status='booked',outcome=NULL WHERE id='settings-4'").run(), /SLOT_PAUSED/);
  await legacy.prepare("UPDATE appointments SET status='in_progress',repair_note='已有预约继续处理' WHERE id='settings-1'").run();
  await legacy.prepare("UPDATE appointments SET status='completed',outcome='no_show' WHERE id='settings-2'").run();
  await legacy.prepare("UPDATE slot_capacities SET capacity=2 WHERE campus='南湖' AND time_slot='19:00–20:00'").run();
  await assert.rejects(insert(5).run(), /SLOT_FULL/);
  await legacy.prepare("UPDATE slot_capacities SET capacity=4 WHERE campus='南湖' AND time_slot='19:00–20:00'").run();
  await insert(5).run();
  assert.equal((await legacy.prepare('SELECT COUNT(*) AS n FROM appointments').first()).n, 5);
});


test('schedule migration preserves legacy bookings, cancelled days, onsite work, attachments and active repair claims', async () => {
  const legacy = await mf.getD1Database('SCHEDULE_UPGRADE_DB');
  for (const file of (await readdir('migrations')).filter(name=>name.endsWith('.sql') && name<'0007').sort()) await applyMigration(legacy,file);
  await legacy.prepare("INSERT INTO staff_accounts(account,name,role,home_campus,protected,password_hash,created_at) VALUES('root001','历史管理员','superadmin','南湖',1,?,?)").bind(hashPassword(password),dateKey()).run();
  const booked=await book(),cancelled=await book(),onsite=await book();
  for (const item of [booked,cancelled,onsite]) {
    const row=await db.prepare('SELECT * FROM appointments WHERE id=?').bind(item.id).first();
    row.time_slot='19:00–20:00';
    delete row.expires_at;
    await legacy.prepare(`INSERT INTO appointments(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).bind(...Object.values(row)).run();
  }
  await legacy.prepare("UPDATE appointments SET status='in_progress',assigned_to='root001',front_photo_id='photo1',back_photo_id='photo2',repair_number='legacy-repair' WHERE id=?").bind(booked.id).run();
  await legacy.prepare("UPDATE appointments SET status='completed',outcome='cancelled',date=? WHERE id=?").bind(addDays(date,7),cancelled.id).run();
  await legacy.prepare("UPDATE appointments SET source='onsite',registered_by='root001',registration_key='onsite-key',date=? WHERE id=?").bind(addDays(date,14),onsite.id).run();
  await legacy.prepare("INSERT INTO appointment_attachments VALUES('photo1',?,'front.png','image/png',100,'r2/front','2026-10-12','2027-10-12','intake_front','root001')").bind(booked.id).run();
  await legacy.prepare("INSERT INTO attachment_storage VALUES('photo1','r2/front',100,'complete','2026-10-12','2027-10-12')").run();
  await legacy.prepare("INSERT INTO credential_recoveries VALUES('recovery',?,'root001','人工核验历史记录','2026-10-12')").bind(booked.id).run();
  await legacy.prepare("UPDATE slot_capacities SET capacity=7 WHERE campus='南湖' AND time_slot='19:00–20:00'").run();
  await applyMigration(legacy,'0007_onsite_expiration.sql');
  await applyMigration(legacy,'0008_five_statuses.sql');
  await legacy.prepare("INSERT INTO appointment_corrections VALUES('historical-correction',?,'root001','历史纠错说明','{}','{}','2026-10-12')").bind(booked.id).run();
  const tables=['appointments','appointment_attachments','credential_recoveries','active_repairs','attachment_storage','storage_quota','appointment_corrections'];
  const before=await Promise.all(tables.map(async table=>(await legacy.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).results));
  await applyMigration(legacy,'0009_weekday_booking_schedules.sql');
  for (const [index,table] of tables.entries()) assert.deepEqual((await legacy.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).results,before[index],table);
  assert.deepEqual((await legacy.prepare('PRAGMA foreign_key_check').all()).results,[]);
  const snapshot=(await legacy.prepare("SELECT * FROM booking_day_slots WHERE campus='南湖' ORDER BY date,time_slot").all()).results;
  assert.equal(snapshot.length,4);
  assert.deepEqual([...new Set(snapshot.map(r=>r.date))],[date,addDays(date,7)]);
  assert.deepEqual(snapshot.slice(0,2).map(r=>[r.time_slot,r.capacity]),[['19:00–20:00',7],['20:00–21:00',10]]);
  assert.deepEqual((await legacy.prepare("SELECT capacity FROM weekday_slot_capacities WHERE campus='南湖' AND weekday=1 ORDER BY time_slot").all()).results.map(r=>r.capacity),[4,3,5,5]);
  await legacy.prepare("UPDATE appointments SET status='completed',outcome='repaired' WHERE id=?").bind(booked.id).run();
  assert.equal((await legacy.prepare('SELECT COUNT(*) AS n FROM active_repairs').first()).n,0);
  await legacy.prepare("DELETE FROM attachment_storage WHERE id='photo1'").run();
  assert.equal((await legacy.prepare('SELECT COUNT(*) AS n FROM appointment_attachments').first()).n,0);
  assert.equal((await legacy.prepare('SELECT used_bytes FROM storage_quota').first()).used_bytes,0);
});


test('half-hour bookings reject overlapping slots across campuses', async () => {
  await db.prepare("DELETE FROM booking_day_slots WHERE campus='浑南'").run();
  const legacy=await book();
  await api('/api/appointments',{method:'POST',body:draft({studentId:legacy.studentId,campus:'浑南',timeSlot:'19:00–19:30'})},409);
  const later=await book({studentId:legacy.studentId,campus:'浑南',timeSlot:'20:00–20:30'});
  assert.equal(later.timeSlot,'20:00–20:30');
  await api(`/api/appointments/${legacy.id}/status`,{method:'PATCH',accessToken:legacy.accessToken,body:{status:'cancelled'}});
  await book({studentId:legacy.studentId,campus:'浑南',timeSlot:'19:00–19:30'});
  await api(`/api/appointments/${legacy.id}/status`,{method:'PATCH',token:await login(),body:{action:'correct',status:'booked'}},409);
});


test('bulk capacity saves are atomic, revision checked and restricted to authorized campuses', async () => {
  const root=await login();
  const original=(await api('/api/slot-capacities',{token:root})).items;
  const [first,second]=original;
  await api('/api/slot-capacities',{method:'PATCH',token:root,body:{...second,capacity:9}});
  await api('/api/slot-capacities',{method:'PATCH',token:root,body:{items:[{...first,capacity:7},{...second,capacity:8}]}},409);
  let current=(await api('/api/slot-capacities',{token:root})).items;
  const find=item=>current.find(row=>row.campus===item.campus && row.weekday===item.weekday && row.timeSlot===item.timeSlot);
  assert.deepEqual(find(first),first);
  assert.equal(find(second).capacity,9);
  const saved=await api('/api/slot-capacities',{method:'PATCH',token:root,body:{items:current.map(item=>({...item,capacity:11}))}});
  assert.equal(saved.items.length,32);
  assert.ok(saved.items.every(item=>item.capacity===11));
  current=saved.items;
  const admin=await addUser('950006','admin');
  await api('/api/slot-capacities',{method:'PATCH',token:admin,body:{items:current.map(item=>({...item,capacity:12}))}},403);
  assert.deepEqual((await api('/api/slot-capacities',{token:root})).items.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),current.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
  for(const items of [[],Array(33).fill(first),[first,first],[null],[{...first,weekday:0}]])
    await api('/api/slot-capacities',{method:'PATCH',token:root,body:{items}},400);
  const a=current.find(item=>item.campus==='南湖' && item.weekday===1 && item.timeSlot==='19:00–19:30');
  const b=current.find(item=>item.campus==='南湖' && item.weekday===1 && item.timeSlot==='19:30–20:00');
  await db.prepare('DELETE FROM weekday_slot_capacities WHERE campus=? AND weekday=? AND time_slot=?').bind(b.campus,b.weekday,b.timeSlot).run();
  await api('/api/slot-capacities',{method:'PATCH',token:root,body:{items:[{...a,capacity:13},{...b,capacity:13}]}},409);
  assert.equal((await db.prepare('SELECT capacity FROM weekday_slot_capacities WHERE campus=? AND weekday=? AND time_slot=?').bind(a.campus,a.weekday,a.timeSlot).first()).capacity,11);
  await db.prepare('INSERT INTO weekday_slot_capacities(campus,weekday,time_slot,capacity,revision) VALUES(?,?,?,?,?)').bind(b.campus,b.weekday,b.timeSlot,b.capacity,b.revision).run();
});
