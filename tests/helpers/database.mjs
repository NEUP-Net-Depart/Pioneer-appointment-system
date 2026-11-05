import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

export function database(directory = 'migrations', before = '\uffff') {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of readdirSync(directory).filter(file => file.endsWith('.sql') && file < before).sort())
    sqlite.exec(readFileSync(`${directory}/${file}`, 'utf8'));
  const db = {
    sqlite,
    prepare(sql) {
      let params = [];
      return {
        bind(...values) { params = values; return this; },
        async first() { return sqlite.prepare(sql).get(...params) || null; },
        all() { return { results: sqlite.prepare(sql).all(...params) }; },
        async run() { return { meta: sqlite.prepare(sql).run(...params) }; }
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const result = []; for (const statement of statements) result.push(statement.all()); sqlite.exec('COMMIT'); return result; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    }
  };
  return db;
}
export function seedAppointment(db, { id, status = 'booked', date = '2026-11-05', campus = '南湖', ...rest }) {
  const data = {
    id, student_id: id, name: '测试客户', campus, social: 'private-contact', device_type: '笔记本',
    brand: 'Lenovo', device_model: '', warranty: 'unknown', fault_type: '系统', date,
    time_slot: '19:00–19:30', status, outcome: status === 'completed' ? 'unrepaired' : null,
    expires_at: `${date}T12:45:00.000Z`,
    access_token_hash: createHash('sha256').update(id).digest('hex'),
    credential_rotated_at: `${date}T01:00:00.000Z`, created_at: `${date}T01:00:00.000Z`,
    agreement_at: `${date}T01:00:00.000Z`, agreement_version: 'test', ...rest
  };
  db.sqlite.prepare('INSERT OR IGNORE INTO service_locations(campus,date,location,updated_at) VALUES(?,?,?,?)')
    .run(campus,date,'测试地点',data.created_at);
  db.sqlite.prepare(`INSERT INTO appointments(${Object.keys(data).join(',')}) VALUES(${Object.keys(data).map(() => '?').join(',')})`).run(...Object.values(data));
}

export function seedStaff(db, account, campus='南湖') {
  db.sqlite.prepare(`INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES(?,?,'technician',?,'test','2026-01-01')`).run(account,account,campus);
  db.sqlite.prepare('INSERT INTO staff_campus_grants(account,campus) VALUES(?,?)').run(account,campus);
}
export function seedPhoto(db,id,appointment,side,account) {
  db.sqlite.prepare(`INSERT INTO appointment_attachments(id,appointment_id,filename,mime_type,size,object_key,created_at,expires_at,purpose,uploaded_by) VALUES(?,?,'original.png','image/png',16,?,'2026-01-01','2099-01-01',?,?)`).run(id,appointment,'test/'+id,'intake_'+side,account);
}
