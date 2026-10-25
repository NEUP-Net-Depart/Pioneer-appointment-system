import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
for(const directory of ['migrations','database/staff-migrations'])test(directory+': multi-device upgrade preserves original appointments and receipts',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('PRAGMA foreign_keys=ON');
  for(const file of (await readdir(directory)).filter(file=>file.endsWith('.sql') && file<'0041').sort())db.exec(await readFile(directory+'/'+file,'utf8'));
  db.exec("INSERT INTO service_locations(campus,date,location,updated_at) VALUES('南湖','2026-10-15','历史地点','2026-10-15T00:00:00.000Z')");
  const insert=(id,student='20260001')=>db.prepare(`INSERT INTO appointments(id,student_id,name,campus,social,device_type,brand,device_model,warranty,fault_type,date,time_slot,status,access_token_hash,credential_rotated_at,created_at,agreement_at,agreement_version,source,expires_at) VALUES(?,?,'历史客户','南湖','enc$unchanged','笔记本','原厂商','原型号','未知','系统问题','2026-10-15','19:00–19:30','booked',?,'2026-10-15T00:00:00.000Z','2026-10-15T00:00:00.000Z','2026-10-15T00:00:00.000Z','v1','booking','2026-10-15T12:45:00.000Z')`).run(id,student,id.padEnd(64,'a'));
  insert('reserve020261015-01');
  db.prepare('INSERT INTO booking_requests(request_key,digest,appointment_id,encrypted_token,created_at) VALUES(?,?,?,?,?)').run('a'.repeat(43),'b'.repeat(64),'reserve020261015-01','enc$old-token','2026-10-15T00:00:00.000Z');
  const before=db.prepare('SELECT * FROM appointments').all(),receipt=db.prepare('SELECT * FROM booking_requests').get();
  assert.throws(()=>insert('reserve020261015-02'),/STUDENT_DAY_EXISTS/);
  db.exec(await readFile(directory+'/0041_multi_device_booking.sql','utf8'));
  assert.deepEqual(db.prepare('SELECT * FROM appointments').all(),before);
  const after=db.prepare('SELECT * FROM booking_requests').get();assert.equal(after.device_count,1);delete after.device_count;assert.deepEqual(after,receipt);
  insert('reserve020261015-02');assert.throws(()=>insert('reserve020261015-03'),/STUDENT_DAY_LIMIT/);
  db.exec("UPDATE appointments SET status='cancelled' WHERE id='reserve020261015-02'");insert('reserve020261015-03');
  assert.throws(()=>db.exec("UPDATE appointments SET status='booked' WHERE id='reserve020261015-02'"),/STUDENT_DAY_LIMIT/);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();}
});
