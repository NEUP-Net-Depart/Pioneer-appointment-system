import { present } from '../helpers/present.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database,seedStaff,seedAppointment,seedPhoto } from '../helpers/database.ts';

for(const directory of ['migrations','database/staff-migrations'])test(`${directory}: queued, assigned, in-progress and photo facts survive destructive cutover`,()=>{
  const db=database(directory,'0045_');
  try {
    seedStaff(db,'20260001');seedStaff(db,'20260002');
    seedAppointment(db,{id:'active',status:'in_progress',assigned_to:'20260001',started_at:'2026-11-05T10:00:00.000Z'});
    seedAppointment(db,{id:'waiting'});seedPhoto(db,'wf','waiting','front','20260001');seedPhoto(db,'wb','waiting','back','20260001');
    db.sqlite.exec("UPDATE appointments SET front_photo_id='wf',back_photo_id='wb' WHERE id='waiting'");
    db.sqlite.exec(`INSERT INTO repair_receptions(appointment_id,state,received_at,received_by,assigned_to,assigned_member_id,updated_at) VALUES('waiting','assigned','2026-11-05T10:00:00.000Z','20260001','20260002','member-20260002','2026-11-05T10:00:00.000Z')`);
    const photos=db.sqlite.prepare('SELECT * FROM appointment_attachments').all();
    const before=db.sqlite.prepare("SELECT * FROM appointments WHERE id='active'").get();
    db.sqlite.exec(readFileSync(`${directory}/0045_direct_repairs.sql`,'utf8'));
    assert.deepEqual(db.sqlite.prepare('SELECT * FROM appointment_attachments').all(),photos);
    const after=db.sqlite.prepare("SELECT * FROM appointments WHERE id='active'").get();
    for(const key of Object.keys(present(before)))assert.equal(present(after)[key],present(before)[key],key);
    const waiting=db.sqlite.prepare("SELECT * FROM appointments WHERE id='waiting'").get();
    assert.equal(present(waiting).status,'booked');assert.equal(present(waiting).assigned_to,null);assert.equal(present(waiting).received_by,'20260001');
    assert.equal(present(waiting).front_photo_id,'wf');
    assert.ok(db.sqlite.prepare("SELECT before_json FROM audit_events WHERE action='repairs.workflow.archived' AND before_json LIKE '%assigned%'").get());
    for(const name of ['active_repairs','repair_receptions','repair_queue_tickets','idx_one_pending_onsite_registration'])assert.equal(db.sqlite.prepare('SELECT name FROM sqlite_master WHERE name=?').get(name),undefined);
    assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{db.sqlite.close();}
});
