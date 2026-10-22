import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { expirationDeadline } from '../shared/time.js';
import { TIME_SLOTS } from '../shared/constants.js';

const migration = '0036_appointment_expiration_time.sql';
for (const directory of ['migrations', 'database/staff-migrations']) {
  test(`${directory} advances pending default expirations and preserves repairs, history and custom deadlines`, async () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('PRAGMA foreign_keys=ON');
      for (const file of (await readdir(directory)).filter(file => file.endsWith('.sql') && file < migration).sort())
        db.exec(await readFile(`${directory}/${file}`, 'utf8'));
      db.exec(`INSERT INTO staff_accounts(account,name,role,home_campus,protected,password_hash,created_at)
        VALUES('root001','负责人','superadmin','南湖',1,'test-only','2026-10-01');`);
      const cases = [
        { id:'online', status:'booked' },
        { id:'onsite', status:'booked', source:'onsite', campus:'浑南' },
        { id:'missed', status:'booked', date:'2026-10-08' },
        { id:'future', status:'booked', date:'2026-10-26' },
        { id:'extended', status:'booked', expiresAt:'2026-10-12T14:00:00.000Z' },
        { id:'recorded-start', status:'booked', startedAt:'2026-10-12T10:00:00.000Z' },
        { id:'active', status:'in_progress', startedAt:'2026-10-12T10:00:00.000Z' },
        { id:'completed', status:'completed', startedAt:'2026-10-12T10:00:00.000Z' },
        { id:'cancelled', status:'cancelled' },
        { id:'expired', status:'expired' }
      ];
      const insert = (item, index) => {
        const date = item.date || '2026-10-12', campus = item.campus || '南湖';
        const createdAt = item.createdAt || `${date}T02:00:00.000Z`;
        db.prepare('INSERT OR IGNORE INTO service_locations(campus,date,location,updated_at) VALUES(?,?,?,?)')
          .run(campus,date,'原维修地点',createdAt);
        db.prepare(`INSERT INTO appointments(id,student_id,name,campus,social,device_type,brand,device_model,warranty,
          fault_type,date,time_slot,status,outcome,assigned_to,started_at,completed_at,source,registered_by,registration_key,
          expires_at,access_token_hash,credential_rotated_at,created_at,agreement_at,agreement_version,revision)
          VALUES(?,?,'测试同学',?,'private','笔记本电脑','联想','ThinkPad','否','系统问题',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'v1',3)`)
          .run(item.id,`student-${item.id}`,campus,date,item.timeSlot || TIME_SLOTS[index % TIME_SLOTS.length],item.status,
            item.status === 'completed' ? 'repaired' : null,
            ['in_progress','completed'].includes(item.status) ? 'root001' : null,
            item.startedAt || null,['completed','cancelled','expired'].includes(item.status) ? createdAt : null,
            item.source || 'booking',item.source === 'onsite' ? 'root001' : null,item.source === 'onsite' ? item.id : null,
            item.expiresAt || `${date}T13:30:00.000Z`,createHash('sha256').update(item.id).digest('hex'),createdAt,createdAt,createdAt);
      };
      cases.forEach(insert);
      const snapshot = () => db.prepare('SELECT * FROM appointments ORDER BY id').all().map(row => ({...row}));
      const before = snapshot();
      const sql = await readFile(`${directory}/${migration}`, 'utf8');
      db.exec(sql);
      const changed = new Set(['online','onsite','missed','future']);
      const expected = before.map(row => changed.has(row.id)
        ? {...row, expires_at:expirationDeadline(row.date), revision:row.revision+1}
        : row);
      assert.deepEqual(snapshot(),expected);
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
      const update = sql.slice(0,sql.indexOf('CREATE TRIGGER'));
      db.exec(update);
      assert.deepEqual(snapshot(),expected,'catch-up does not repeatedly revise appointments');
      insert({id:'before-deadline',status:'booked',timeSlot:'20:30–21:00',createdAt:'2026-10-12T12:44:59.999Z',expiresAt:expirationDeadline('2026-10-12')},0);
      assert.throws(() => insert({id:'at-deadline',status:'booked',timeSlot:'20:30–21:00',createdAt:'2026-10-12T12:45:00.000Z',expiresAt:expirationDeadline('2026-10-12')},0),/SLOT_ENDED/);
      assert.throws(() => insert({id:'after-deadline',status:'booked',timeSlot:'20:30–21:00',createdAt:'2026-10-12T12:50:00.000Z',expiresAt:expirationDeadline('2026-10-12')},0),/SLOT_ENDED/);
    } finally {
      db.close();
    }
  });
}
