import { present } from '../helpers/present.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';

import {readFileSync} from 'node:fs';
import {database,seedAppointment,seedStaff} from '../helpers/database.ts';

for (const directory of ['migrations', 'database/staff-migrations']) test(`${directory}: link expansion preserves populated rows and database guards`, () => {
  const db = database(directory, '0055_');
  try {
    seedStaff(db, '20260001');
    seedAppointment(db, {id:'original',date:'2026-11-02',student_id:'20260009',status:'completed'});
    seedAppointment(db, {id:'existing',date:'2026-11-03',student_id:'20260009',parent_appointment_id:'original',link_kind:'continuation',linked_by:'20260001'});
    const before = db.sqlite.prepare('SELECT * FROM appointments ORDER BY id').all();
    db.sqlite.exec(readFileSync(`${directory}/0055_repair_induced_link.sql`, 'utf8'));
    assert.deepEqual(db.sqlite.prepare('SELECT * FROM appointments ORDER BY id').all(), before);
    seedAppointment(db, {id:'new-fault',student_id:'20260009',parent_appointment_id:'original',link_kind:'repair_induced',linked_by:'20260001'});
    assert.throws(() => seedAppointment(db, {id:'wrong-owner',student_id:'20269999',parent_appointment_id:'original',link_kind:'repair_induced',linked_by:'20260001'}), /REPAIR_LINK_INVALID/);
    assert.throws(() => db.sqlite.prepare("UPDATE appointments SET link_kind='recurrence' WHERE id='new-fault'").run(), /REPAIR_LINK_INVALID/);
    assert.equal(db.sqlite.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { db.sqlite.close(); }
});
for(const directory of ['migrations','database/staff-migrations'])test(`${directory}: every retired request is archived and scheduled appointments are linked without inventing service`,()=>{
 const db=database(directory,'0046_');
 try{
  seedStaff(db,'20260001');seedAppointment(db,{id:'original',student_id:'20260009',status:'completed'});seedAppointment(db,{id:'child',student_id:'20260009',source:'onsite',registration_flow:'repair_followup',registered_by:'20260001'});
  for(const [id,status] of [['pending','pending'],['scheduled','scheduled'],['rejected','rejected']]){
   db.sqlite.prepare(`INSERT INTO repair_followups(id,parent_appointment_id,status,reason,request_id,request_hash,requested_at,scheduled_appointment_id,scheduled_by,scheduled_at,resolved_by,resolved_at,resolution_note)
    VALUES(?,'original',?,'old reason',?,?,'2026-11-01',?,?,?,?,?,'old decision')`).run(id,status,id,'a'.repeat(64),status==='scheduled'?'child':null,status==='scheduled'?'20260001':null,status==='scheduled'?'2026-11-02':null,status==='pending'?null:'20260001',status==='pending'?null:'2026-11-02');
  }
  const requests=db.sqlite.prepare('SELECT * FROM repair_followups ORDER BY id').all(),original=db.sqlite.prepare("SELECT * FROM appointments WHERE id='original'").get();
  db.sqlite.exec(readFileSync(`${directory}/0046_repair_links.sql`,'utf8'));
  const archived=db.sqlite.prepare("SELECT before_json,after_json FROM audit_events WHERE action='repairs.followup.migrated' ORDER BY id").all();
  assert.equal(archived.length,requests.length);
  for(const row of requests){const record=archived.find(x=>JSON.parse(String(x.before_json)).id===row.id);const saved=JSON.parse(String(present(record).before_json));
   for(const [field,value] of Object.entries(row))assert.deepEqual(saved[field.replace(/_([a-z])/g,(_,letter)=>letter.toUpperCase())],value,field);
  }
  const after=db.sqlite.prepare("SELECT * FROM appointments WHERE id='original'").get();
  for(const [field,value] of Object.entries(present(original)))assert.equal(present(after)[field],value,field);
  const child=db.sqlite.prepare("SELECT * FROM appointments WHERE id='child'").get();
  assert.equal(present(child).parent_appointment_id,'original');assert.equal(present(child).link_kind,'historical');assert.equal(present(child).status,'booked');
  assert.equal(present(db.sqlite.prepare('SELECT COUNT(*) n FROM appointments').get()).n,2);
  assert.equal(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='repair_followups'").get(),undefined);
  assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.sqlite.close();}
});
