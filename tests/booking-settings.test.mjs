import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { bookingWindow, validReleaseTime } from '../shared/booking-settings.js';
import { bookingDates } from '../shared/booking-slots.js';

test('release time advances only the booking horizon, with midnight and Shanghai boundaries', () => {
  assert.deepEqual(bookingDates(new Date('2026-10-12T09:59:59+08:00')), ['2026-10-12','2026-10-13','2026-10-14']);
  assert.deepEqual(bookingDates(new Date('2026-10-12T10:00:00+08:00')), ['2026-10-12','2026-10-13','2026-10-14','2026-10-15']);
  assert.deepEqual(bookingDates(new Date('2026-10-12T10:00:00+08:00'),'11:30'), ['2026-10-12','2026-10-13','2026-10-14']);
  assert.deepEqual(bookingDates(new Date('2026-10-12T00:00:00+08:00'),'00:00'), ['2026-10-12','2026-10-13','2026-10-14','2026-10-15']);
  assert.deepEqual(bookingDates(new Date('2026-10-16T09:59:59+08:00')), []);
  assert.deepEqual(bookingDates(new Date('2026-10-16T10:00:00+08:00')), ['2026-10-19']);
  assert.deepEqual(bookingDates(new Date('2026-10-18T16:00:00Z')), ['2026-10-19','2026-10-20','2026-10-21']);
  assert.equal(bookingWindow(new Date('2026-12-31T09:59:59+08:00')).end,'2027-01-02');
  assert.equal(bookingWindow(new Date('2026-12-31T10:00:00+08:00')).nextReleaseAt,'2027-01-01T02:00:00.000Z');
  for(const value of ['24:00','10:60','1:00',null,'10:00:00']) assert.equal(validReleaseTime(value),false);
});

test('booking settings migrate populated dev in place and preserve the historical appointment and capacity snapshot', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON');
    for(const file of (await readdir('migrations')).filter(file=>file.endsWith('.sql') && file<'0033_booking_settings.sql').sort()) db.exec(await readFile('migrations/'+file,'utf8'));
    db.exec(`INSERT INTO service_locations(campus,date,location,updated_at) VALUES('南湖','2026-10-12','历史维修地点','2026-10-10T00:00:00.000Z');
      INSERT INTO appointments(id,student_id,name,college,campus,phone,social,device_type,brand,device_model,serial,warranty,fault_type,issue,liquid_drop,date,time_slot,note,status,expires_at,repair_note,access_token_hash,credential_rotated_at,created_at,agreement_at,agreement_version,signature)
      VALUES('reserve020261012-01','20260001','历史客户','','南湖','','密文联系方式','笔记本','联想','T14','','否','蓝屏','','','2026-10-12','19:00–19:30','','booked','2026-10-12T13:30:00.000Z','',printf('%064d',1),'2026-10-12T02:00:00.000Z','2026-10-12T02:00:00.000Z','2026-10-12T02:00:00.000Z','v1.1','[]');`);
    const row = {...db.prepare('SELECT * FROM appointments').get()};
    const snapshots = db.prepare('SELECT * FROM booking_day_slots ORDER BY campus,date,time_slot').all();
    const capacities = db.prepare('SELECT * FROM weekday_slot_capacities ORDER BY campus,weekday,time_slot').all();
    db.exec(await readFile('migrations/0033_booking_settings.sql','utf8'));
    const migrated = {...db.prepare('SELECT * FROM appointments').get()};
    assert.equal(migrated.booking_notices,'[]'); delete migrated.booking_notices;
    assert.deepEqual(migrated,row);
    assert.deepEqual(db.prepare('SELECT * FROM booking_day_slots ORDER BY campus,date,time_slot').all(),snapshots);
    assert.deepEqual(db.prepare('SELECT * FROM weekday_slot_capacities ORDER BY campus,weekday,time_slot').all(),capacities);
    assert.deepEqual(db.prepare('SELECT release_time FROM booking_settings').all().map(row=>row.release_time),['10:00','10:00']);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM booking_notices').get().n,0);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally {db.close();}
});

test('notice presentation migration preserves published notices and their acceptance versions',async()=>{
  const db=new DatabaseSync(':memory:');
  try {
    for(const file of (await readdir('migrations')).filter(file=>file.endsWith('.sql') && file<'0034_notice_display_mode.sql').sort())db.exec(await readFile('migrations/'+file,'utf8'));
    db.exec(`INSERT INTO booking_notices(id,campus,title,content,important,enabled,starts_at,ends_at,revision,updated_at)
      VALUES('existing-notice','南湖','既有公告','保留阅读确认',1,1,'2026-10-21','2026-10-22',7,'2026-10-21');`);
    const before={...db.prepare('SELECT * FROM booking_notices').get()};
    db.exec(await readFile('migrations/0034_notice_display_mode.sql','utf8'));
    const after={...db.prepare('SELECT * FROM booking_notices').get()};
    assert.equal(after.display_mode,'inline');delete after.display_mode;assert.deepEqual(after,before);
    assert.throws(()=>db.exec("UPDATE booking_notices SET display_mode='invalid'"),/CHECK/);
  } finally {db.close();}
});
