import { present } from '../helpers/present.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {database,seedStaff,seedAppointment} from '../helpers/database.ts';

for(const directory of ['migrations','database/staff-migrations'])test(`${directory}: membership cutover preserves personnel and archives all retired grants`,()=>{
 const db=database(directory,'0047_');
 try{
  seedStaff(db,'20261001');post(db,'20261001','dept-network','head');
  db.sqlite.exec("INSERT INTO member_roles(id,member_id,role_id,effective_from,reason) VALUES('old-qualification','member-20261001','role-technician','2026-01-01','historical authorization')");
  const before=db.sqlite.prepare('SELECT * FROM member_department_memberships').all();
  db.sqlite.exec(readFileSync(`${directory}/0047_membership_identity.sql`,'utf8'));
  assert.deepEqual(db.sqlite.prepare('SELECT * FROM member_department_memberships').all(),before);
  const archived=db.sqlite.prepare("SELECT before_json FROM audit_events WHERE id='v12-identity-member_roles-old-qualification'").get();
  assert.equal(JSON.parse(String(present(archived).before_json)).reason,'historical authorization');
  assert.equal(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='effective_member_roles'").get(),undefined);
  assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.sqlite.close();}
});

for(const directory of ['migrations','database/staff-migrations'])test(`${directory}: final cleanup retains original registration evidence and retires conditional grants without broadening them`,()=>{
 const db=database(directory,'0049_');
 try{
  seedStaff(db,'20261001');
  seedAppointment(db,{id:'old-onsite',source:'onsite',registered_by:'20261001',registration_flow:'frontdesk'});
  db.sqlite.exec(`UPDATE role_grants SET condition_spec='[{"code":"signedDutyPresence"}]' WHERE role_id='role-superadmin' AND permission_code='settings.manage'`);
  const before=db.sqlite.prepare("SELECT * FROM appointments WHERE id='old-onsite'").get();
  const grant=db.sqlite.prepare("SELECT * FROM role_grants WHERE role_id='role-superadmin' AND permission_code='settings.manage'").get();
  db.sqlite.exec(readFileSync(`${directory}/0049_finalize_business_model.sql`,'utf8'));
  const after=db.sqlite.prepare("SELECT * FROM appointments WHERE id='old-onsite'").get();
  const archived=JSON.parse(String(present(db.sqlite.prepare("SELECT before_json FROM audit_events WHERE id='v12-registration-flow-old-onsite'").get()).before_json));
  assert.equal(archived.registration_flow,present(before).registration_flow);delete present(before).registration_flow;assert.deepEqual(after,before);
  assert.equal(db.sqlite.prepare('SELECT id FROM role_grants WHERE id=?').get(present(grant).id),undefined);
  const saved=JSON.parse(String(present(db.sqlite.prepare('SELECT before_json FROM audit_events WHERE id=?').get('v12-retired-condition-grant-'+present(grant).id)).before_json));
  assert.deepEqual(saved,{...grant});
  assert.equal(db.sqlite.prepare("SELECT code FROM permission_definitions WHERE code='onsite.frontdesk.create'").get(),undefined);
  assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.sqlite.close();}
});

function post(db: import('../helpers/database.ts').TestDatabase,account: string,department: string,position='member'){
 db.sqlite.prepare("INSERT INTO member_department_memberships(id,member_id,department_id,position_code,assignment_type,is_primary,effective_from,created_at) VALUES(?,?,?,?,'primary',1,'2026-01-01','2026-01-01')").run('post-'+account,'member-'+account,department,position);
}
