import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {verifyStaffSchema,STAFF_RELEASE} from '../src/db/staff-readiness.js';

function adapter(sqlite) {
  return {prepare(sql) {
    const query=sqlite.prepare(sql);
    const statement=values=>({bind:(...args)=>statement(args),first:async()=>query.get(...values)||null,all:async()=>({results:query.all(...values)})});
    return statement([]);
  },batch:async statements=>Promise.all(statements.map(statement=>statement.all()))};
}
async function baseline(directory) {
  const db=new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON;');
  for(const name of (await readdir(directory)).filter(name=>name<'0033').sort())db.exec(await readFile(directory+'/'+name,'utf8'));
  db.prepare("INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES('20268801','原管理员','admin','南湖','unchanged-hash','2026-01-01')").run();
  db.prepare("INSERT INTO staff_campus_grants VALUES('20268801','南湖')").run();
  db.prepare("INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES('20268803','原维修人员','technician','南湖','technician-hash','2026-01-01')").run();
  db.prepare("INSERT INTO staff_campus_grants VALUES('20268803','南湖')").run();
  return db;
}
function snapshot(db) {
  return db.prepare("SELECT name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY name").all().map(row=>({
    ...row,rows:row.sql.startsWith('CREATE TABLE') ? db.prepare(`SELECT * FROM "${row.name}"`).all() : []
  }));
}
for(const directory of ['migrations','database/staff-migrations']) {
  test(`${directory}: duplicate logins abort the entire upgrade without merging credentials or campus rights`,async()=>{
    const db=await baseline(directory);
    try {
      db.prepare("INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at,member_id) VALUES('20268802','另一个账号','technician','浑南','separate-hash','2026-01-01','member-20268801')").run();
      db.prepare("INSERT INTO staff_campus_grants VALUES('20268802','浑南')").run();
      const before=snapshot(db),sql=await readFile(directory+'/0033_staff_business_roles.sql','utf8');
      db.exec('BEGIN');
      assert.throws(()=>db.exec(sql),/CHECK constraint/);
      db.exec('ROLLBACK');
      assert.deepEqual(snapshot(db),before);
    }finally{db.close();}
  });
  test(`${directory}: failed batches roll back and readiness rejects incomplete or weakened authorization schemas`,async()=>{
    const db=await baseline(directory);
    try {
      const before=snapshot(db),sql=await readFile(directory+'/0033_staff_business_roles.sql','utf8');
      await assert.rejects(verifyStaffSchema(adapter(db)));
      db.exec('BEGIN');
      assert.throws(()=>db.exec(sql+'INSERT INTO missing_upgrade_table VALUES(1);'),/missing_upgrade_table/);
      db.exec('ROLLBACK');
      assert.deepEqual(snapshot(db),before);
      db.exec('BEGIN;'+sql+'COMMIT;');
      assert.equal(await verifyStaffSchema(adapter(db)),STAFF_RELEASE);
      for(const [table,column] of [['member_roles','scope_bindings'],['role_grants','scope_spec']])
        assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE json_extract(${column},'$.campuses')='legacy' OR json_extract(${column},'$.campusIds')='legacy'`).get().n,0);
      assert.equal(JSON.parse(db.prepare("SELECT scope_bindings FROM member_roles WHERE member_id='member-20268803'").get().scope_bindings).campuses,'bound');
      const row=db.prepare("SELECT password_hash FROM staff_accounts WHERE account='20268801'").get();
      assert.equal(row.password_hash,'unchanged-hash');
      db.exec('DROP INDEX idx_staff_accounts_member_id; CREATE INDEX idx_staff_accounts_member_id ON staff_accounts(member_id)');
      await assert.rejects(verifyStaffSchema(adapter(db)),/uniqueness/);
      db.exec('DROP INDEX idx_staff_accounts_member_id; CREATE UNIQUE INDEX idx_staff_accounts_member_id ON staff_accounts(account)');
      await assert.rejects(verifyStaffSchema(adapter(db)),/wrong column/);
    }finally{db.close();}
  });
}
