import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { database, seedStaff, seedAppointment, seedPhoto } from './helpers/database.mjs';
import { stageFixture } from './fixtures/staff-cutover.mjs';
import { rehearseSnapshot } from '../scripts/rehearse-preview.mjs';

async function snapshot(current) {
  const before = current ? '\uffff' : '0042';
  const db = database('migrations', before),
    sqlite = db.sqlite;
  try {
    sqlite.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT UNIQUE NOT NULL)');
    for (const name of (await readdir('migrations')).filter(
      (name) => name.endsWith('.sql') && name < before
    ))
      sqlite.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(name);
    seedStaff(db, '20260001');
    for (const status of ['booked', 'in_progress', 'completed', 'expired'])
      seedAppointment(db, {
        id: status,
        status,
        date: '2026-10-12',
        student_id: '2026' + status,
        assigned_to: ['in_progress', 'completed'].includes(status) ? '20260001' : null,
        repair_note: status === 'completed' ? '历史内部说明' : '',
        expires_at: current ? '2026-10-12T16:00:00.000Z' : '2026-10-12T13:30:00.000Z'
      });
    seedPhoto(db, 'original-front', 'completed', 'front', '20260001');
    sqlite.exec("UPDATE appointments SET front_photo_id='original-front' WHERE id='completed'");
    if (!current)
      await stageFixture(sqlite, {
        'member-20260001': {
          decision: 'migrate',
          post: {
            departmentCode: 'hardware',
            positionCode: 'member',
            effectiveFrom: '2026-01-01',
            effectiveTo: null
          }
        }
      });
    const objects = sqlite
      .prepare(
        "SELECT name,type,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type='trigger',type='index'"
      )
      .all();
    const quote = (value) =>
      value === null
        ? 'NULL'
        : typeof value === 'number'
          ? String(value)
          : "'" + String(value).replaceAll("'", "''") + "'";
    return [
      ...objects
        .filter((row) => row.type === 'table')
        .flatMap((row) => [
          row.sql + ';',
          ...sqlite
            .prepare(`SELECT * FROM "${row.name}"`)
            .all()
            .map(
              (value) =>
                `INSERT INTO "${row.name}" VALUES(${Object.values(value).map(quote).join(',')});`
            )
        ]),
      ...objects.filter((row) => row.type !== 'table').map((row) => row.sql + ';')
    ].join('\n');
  } finally {
    sqlite.close();
  }
}

test('a populated snapshot upgrades through the full ledger while preserving orders, photos, accounts and credentials', async () => {
  const result = await rehearseSnapshot(await snapshot(false));
  assert.ok(result.applied > 0);
  assert.equal(result.preservedTables, 7);
  assert.equal(result.accounts['technician → dept-hardware:member'], 1);
});

test('a current D1 export restores interleaved tables and cyclic references without reapplying migrations', async () => {
  const result = await rehearseSnapshot(await snapshot(true));
  assert.equal(result.applied, 0);
  assert.equal(result.preservedTables, 7);
});
