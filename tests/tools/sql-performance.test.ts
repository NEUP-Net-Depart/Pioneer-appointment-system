import { unusedAttachments } from '../helpers/database.ts';
import { present } from '../helpers/present.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { handleRequest } from '../../src/app.ts';
import { userRepository } from '../../src/db/users.ts';
import { signToken } from '../../src/lib/jwt.ts';
import { sqlProfiler, budgetFailures } from '../helpers/sql-profile.ts';
import { seedSqlProfile } from '../fixtures/sql-profile.ts';

const secret = 'isolated-sql-profile-secret-32-characters';
const budgets: Record<string, { rowsRead: number; rowsWritten: number; statements: number }> = {
  'account.find': { rowsRead: 64, rowsWritten: 0, statements: 1 },
  'auth.member': { rowsRead: 128, rowsWritten: 0, statements: 12 },
  'auth.leader': { rowsRead: 128, rowsWritten: 0, statements: 12 },
  availability: { rowsRead: 160, rowsWritten: 0, statements: 8 },
  logout: { rowsRead: 64, rowsWritten: 8, statements: 3 }
};

// Optional diagnostic: real local workerd/D1, current migrations and application
// requests. No remote credentials, production bindings, mocks of SQL, or timing gate.
test('SQL read/write budgets stay bounded as unrelated data grows (issue #144)', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-05T10:00:00+08:00') });
  type Snapshot = ReturnType<ReturnType<typeof sqlProfiler>['snapshot']>;
  const report: {
    passed: boolean; engine: string; sizes: number[]; budgets: typeof budgets;
    samples: (Snapshot & { name: string; accounts: number; appointments: number; runs: Snapshot[]; medianSqlWallMs: number })[];
    controls: (Snapshot & { name: string; accounts: number; detected: string[] })[];
    error?: string; failures?: string[];
  } = {
    passed: false,
    engine: 'local workerd/D1',
    sizes: [100, 1000],
    budgets,
    samples: [],
    controls: []
  };
  const failures = [];
  try {
    for (const accounts of report.sizes) {
      const mf = new Miniflare({
        telemetry: { enabled: false },
        workers: [
          {
            config: {
              name: 'sql-profile',
              compatibilityDate: '2026-09-01',
              manifest: {
                mainModule: 'index.js',
                modules: {
                  'index.js': {
                    type: 'esm',
                    contents: 'export default {fetch(){return new Response("fixture")}}'
                  }
                }
              },
              env: { DB: { type: 'd1', id: 'sql-profile' } }
            }
          }
        ]
      });
      try {
        const native = await mf.getD1Database('DB');
        await seedSqlProfile(native, accounts);
        const profiler = sqlProfiler(native),
          users = userRepository(profiler.db);
        const env = {
          DB: profiler.db,
          ATTACHMENTS: unusedAttachments,
          JWT_SECRET: secret,
          PII_ENCRYPTION_KEY: '00'.repeat(32),
          TELEMETRY_ENABLED: 'false'
        };
        async function request(path: string, account?: string, method = 'GET') {
          // Token preparation is outside the measured request, which still performs
          // the real authentication and context reads (including duplicate queries).
          const user = account ? present(await userRepository(native).find(account)) : null;
          const req = new Request(`https://sql.test${path}`, {
            method,
            headers: user ? { authorization: `Bearer ${signToken(user, secret)}` } : {}
          });
          profiler.reset();
          const response = await handleRequest(req, env);
          const body = await response.json();
          assert.equal(response.status, 200, JSON.stringify(body));
          return body;
        }
        const cases = {
          'account.find': async () => {
            profiler.reset();
            assert.equal((present(await users.find('20260001'))).account, '20260001');
          },
          'auth.member': async () => {
            assert.equal((await request('/api/auth/me', '20260001')).account, '20260001');
          },
          'auth.leader': async () => {
            assert.deepEqual(
              (await request('/api/auth/me', '20260002')).authorizedCampuses.sort(),
              ['南湖', '浑南']
            );
          },
          availability: async () => {
            const body = await request(
              '/api/booking-availability?date=2026-11-05&campus=' + encodeURIComponent('南湖')
            );
            assert.equal(body.slots['19:00–19:30'], 1);
          },
          logout: async () => {
            assert.equal((await request('/api/auth/logout', '20260001', 'POST')).ok, true);
          }
        };
        for (const [name, run] of Object.entries(cases)) {
          const runs = [];
          for (let repetition = 0; repetition < 3; repetition++) {
            await run();
            runs.push(profiler.snapshot());
          }
          const sample = {
            name,
            accounts,
            appointments: accounts * 20 + 1,
            ...runs.reduce((worst, row) => (row.rowsRead > worst.rowsRead ? row : worst)),
            runs,
            medianSqlWallMs: runs.map((row) => row.elapsedMs).sort((a, b) => a - b)[1]
          };
          const baseline = report.samples.find((row) => row.name === name);
          for (const run of runs)
            failures.push(
              ...budgetFailures(run, budgets[name], baseline).map(
                (error) => `${name} (${accounts} accounts): ${error}`
              )
            );
          report.samples.push(sample);
        }
        // Negative controls prove the same budgets catch global UNION scans and
        // unbounded writes. These deliberately bad SQL statements stay in this tool.
        profiler.reset();
        await profiler.db
          .prepare(
            `SELECT staff_accounts.account,
          (SELECT json_group_array(campus) FROM staff_access_campuses WHERE account=staff_accounts.account) AS campuses
          FROM staff_accounts WHERE account=?`
          )
          .bind('20260001')
          .first();
        const scan = profiler.snapshot();
        const scanErrors = budgetFailures(scan, budgets['account.find']);
        assert.ok(
          scanErrors.some((error) => error.startsWith('rowsRead:')),
          'Issue #144 negative control must exceed the read budget'
        );
        report.controls.push({
          name: 'issue-144-global-union',
          accounts,
          ...scan,
          detected: scanErrors
        });
        profiler.reset();
        await profiler.db.prepare('UPDATE staff_accounts SET revision=revision+1').run();
        const write = profiler.snapshot();
        const writeErrors = budgetFailures(write, budgets.logout);
        assert.ok(
          writeErrors.some((error) => error.startsWith('rowsWritten:')),
          'Unbounded update must exceed the write budget'
        );
        report.controls.push({
          name: 'unbounded-write',
          accounts,
          ...write,
          detected: writeErrors
        });
      } finally {
        await mf.dispose();
      }
    }
    report.passed = failures.length === 0;
  } catch (error) {
    report.error = error instanceof Error ? error.stack : String(error);
    throw error;
  } finally {
    report.failures = failures;
    await mkdir('output/sql-profile', { recursive: true });
    await writeFile('output/sql-profile/report.json', JSON.stringify(report, null, 2) + '\n');
    console.table(
      report.samples.map(
        ({ name, accounts, rowsRead, rowsWritten, statements, durationMs, medianSqlWallMs }) => ({
          name,
          accounts,
          rowsRead,
          rowsWritten,
          statements,
          durationMs,
          medianSqlWallMs: Math.round(medianSqlWallMs * 100) / 100
        })
      )
    );
    console.log('SQL details and negative controls: output/sql-profile/report.json');
  }
  assert.deepEqual(failures, [], 'SQL budget exceeded; inspect output/sql-profile/report.json');
});
