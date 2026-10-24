import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
for(const directory of ['migrations','database/staff-migrations'])test(directory+': existing arrivals retain data and receive independent daily campus tickets',async()=>{
 const db=new DatabaseSync(':memory:');
 try {
  db.exec('PRAGMA foreign_keys=ON');
  for(const file of (await readdir(directory)).filter(file=>file.endsWith('.sql') && file<'0040').sort())db.exec(await readFile(directory+'/'+file,'utf8'));
  db.exec("INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES('20269999','历史接待','technician','南湖','preserved','2026-01-01')");
  for(const [i,campus,at] of [[1,'南湖','2026-10-14T02:00:00.000Z'],[2,'南湖','2026-10-14T02:00:00.000Z'],[3,'南湖','2026-10-15T02:00:00.000Z'],[4,'浑南','2026-10-15T02:00:00.000Z']]){
   const date=at.slice(0,10),id='reserve0'+date.replaceAll('-','')+'-0'+i;
   db.prepare(`INSERT INTO appointments(id,student_id,name,campus,social,device_type,brand,device_model,warranty,fault_type,date,time_slot,status,access_token_hash,credential_rotated_at,created_at,agreement_at,agreement_version,source,expires_at) VALUES(?,?,'历史客户',?,'enc$unchanged','笔记本电脑','原厂商','原型号','未知','系统问题',?,'19:00–19:30','booked',?,?,?,?, 'v1','onsite',?)`).run(id,'2030999'+i,campus,date,String(i).repeat(64),at,at,at,date+'T12:45:00.000Z');
   db.prepare("INSERT INTO repair_receptions(appointment_id,state,received_at,received_by,updated_at) VALUES(?,'queued',?,'20269999',?)").run(id,at,at);
  }
  const before=db.prepare('SELECT * FROM appointments ORDER BY id').all();
  db.exec(await readFile(directory+'/0040_reception_queue.sql','utf8'));
  assert.deepEqual(db.prepare('SELECT * FROM appointments ORDER BY id').all(),before);
  const tickets=db.prepare('SELECT campus,queue_date,number FROM repair_queue_tickets ORDER BY queue_date,campus,number').all();
  assert.deepEqual(tickets.map(t=>[t.campus,t.queue_date,t.number]),[['南湖','2026-10-14',1],['南湖','2026-10-14',2],['南湖','2026-10-15',1],['浑南','2026-10-15',1]]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM repair_receptions WHERE ticket_id IS NOT NULL AND left_at IS NULL').get().n,4);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM repair_queue_counters').get().n,3);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();}
});
