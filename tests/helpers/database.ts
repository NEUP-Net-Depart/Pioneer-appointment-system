import type { D1Result } from '@cloudflare/workers-types';
import type { SQLInputValue, SQLOutputValue } from 'node:sqlite';
import type { Database, DatabaseStatement, PioneerEnvironment } from '../../src/platform/environment.ts';
import type { AppointmentStatus } from '../../shared/appointment-types.ts';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

type SqliteRow = Record<string, SQLOutputValue>;

function binding(value: unknown): SQLInputValue {
  if (value === null || typeof value === 'number' || typeof value === 'bigint' ||
      typeof value === 'string') return value;
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError('Invalid SQLite binding');
}

function d1Result<T>(results: T[], changes: number, lastRowId = 0): D1Result<T> {
  return {
    success: true,
    results,
    meta: { changes, last_row_id: lastRowId, changed_db: changes > 0, size_after: 0, rows_read: 0, rows_written: changes, duration: 0 }
  };
}

class TestStatement implements DatabaseStatement {
  declare private readonly sqlite: DatabaseSync;
  declare private readonly sql: string;
  private params: unknown[] = [];

  constructor(sqlite: DatabaseSync, sql: string) {
    this.sqlite = sqlite;
    this.sql = sql;
  }

  bind(...values: unknown[]) {
    this.params = values;
    return this;
  }

  async first<T = SqliteRow>(column?: string): Promise<T | null> {
    const row = this.sqlite.prepare(this.sql).get(...this.params.map(binding));
    if (!row) return null;
    return (column === undefined ? row : row[column]) as T;
  }

  execute<T>(): D1Result<T> {
    const rows = this.sqlite.prepare(this.sql).all(...this.params.map(binding));
    const changes = this.sqlite.prepare('SELECT changes() AS n').get()?.n;
    return d1Result(rows as T[], Number(changes));
  }

  async all<T = SqliteRow>() {
    return this.execute<T>();
  }

  async run<T = SqliteRow>() {
    const result = this.sqlite.prepare(this.sql).run(...this.params.map(binding));
    return d1Result<T>([], Number(result.changes), Number(result.lastInsertRowid));
  }


}

export interface TestDatabase extends Database {
  sqlite: DatabaseSync;
}

export const unusedAttachments: PioneerEnvironment['ATTACHMENTS'] = {
  async get() { throw new Error('Unexpected attachment read'); },
  async put() { throw new Error('Unexpected attachment write'); },
  async delete() { throw new Error('Unexpected attachment deletion'); }
};

export function database(directory = 'migrations', before = '\uffff'): TestDatabase {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of readdirSync(directory).filter(file => file.endsWith('.sql') && file < before).sort())
    sqlite.exec(readFileSync(`${directory}/${file}`, 'utf8'));
  return {
    sqlite,
    prepare: sql => new TestStatement(sqlite, sql),
    async batch<T = unknown>(statements: DatabaseStatement[]) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(statement => {
          if (!(statement instanceof TestStatement)) throw new TypeError('Expected a SQLite test statement');
          return statement.execute<T>();
        });
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    }
  };
}
interface AppointmentSeed {
  id: string;
  date?: string;
  campus?: string;
  status?: AppointmentStatus;
  [column: string]: SQLInputValue | undefined;
}

export function seedAppointment(db: TestDatabase, { id, status = 'booked', date = '2026-11-05', campus = '南湖', ...rest }: AppointmentSeed) {
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
  db.sqlite.prepare(`INSERT INTO appointments(${Object.keys(data).join(',')}) VALUES(${Object.keys(data).map(() => '?').join(',')})`).run(...Object.values(data).map(binding));
}

export function seedStaff(db: TestDatabase, account: string, campus='南湖') {
  db.sqlite.prepare(`INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES(?,?,'technician',?,'test','2026-01-01')`).run(account,account,campus);
  db.sqlite.prepare('INSERT INTO staff_campus_grants(account,campus) VALUES(?,?)').run(account,campus);
}
export function seedPhoto(db: TestDatabase,id: string,appointment: string,side: string,account: string) {
  db.sqlite.prepare(`INSERT INTO appointment_attachments(id,appointment_id,filename,mime_type,size,object_key,created_at,expires_at,purpose,uploaded_by) VALUES(?,?,'original.png','image/png',16,?,'2026-01-01','2099-01-01',?,?)`).run(id,appointment,'test/'+id,'intake_'+side,account);
}

export function testEnvironment(db: Database): PioneerEnvironment {
  return {
    DB: { withSession: () => db },
    ATTACHMENTS: unusedAttachments,
    JWT_SECRET: 'local-test-secret'.repeat(2),
    PII_ENCRYPTION_KEY: '00'.repeat(32)
  };
}
