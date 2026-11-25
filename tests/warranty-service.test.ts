import { database, seedStaff, testEnvironment } from './helpers/database.ts';
import { handleRequest } from '../src/app.ts';
import { userRepository } from '../src/db/users.ts';
import { signToken } from '../src/lib/jwt.ts';
import { HttpError } from '../src/lib/http.ts';
import { present } from './helpers/present.ts';
import { checkProperty, modelEdges, runModel } from './fixtures/workflow-seed.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { warrantyService, normalizeLenovoWarranty } from '../src/services/warranty.ts';

const details = (rows: ReturnType<typeof row>[]) => ({ statusCode: '200', data: { detailinfo: { warranty: rows, onsite: [], other: [] } } });
const row = (overrides: Partial<{ ServiceProductName: string; ServiceProductSmallClass: string; PartStartDate: string; PartEndDate: string }> = {}) => ({ ServiceProductName: '整机有限保修', ServiceProductSmallClass: '基础服务', PartStartDate: '2025-10-26 00:00:00', PartEndDate: '2026-10-26 00:00:00', ...overrides });

test('Lenovo preserves original service dates and treats expiry date as inclusive in China', async () => {
  const payload = details([
    row(),
    row({
      ServiceProductName: '意外保',
      ServiceProductSmallClass: '意外保',
      PartEndDate: '2030-10-26'
    })
  ]);
  assert.equal(normalizeLenovoWarranty(payload, '2026-10-26').status, 'in_warranty');
  const expired = normalizeLenovoWarranty(payload, '2026-10-27');
  assert.equal(expired.status, 'expired');
  assert.equal(expired.services[1].status, 'in_warranty');
  assert.equal(expired.services[0].end, '2026-10-26');
  await checkProperty((fc) =>
    fc.property(
      fc.integer({ min: 0, max: 3650 }),
      fc.integer({ min: 0, max: 1000 }),
      (offset: number, length: number) => {
        const start = new Date(Date.UTC(2020, 0, 1) + offset * 86400000),
          end = new Date(start.getTime() + length * 86400000);
        const date = (value: Date) => value.toISOString().slice(0, 10);
        const value = details([row({ PartStartDate: date(start), PartEndDate: date(end) })]);
        assert.equal(normalizeLenovoWarranty(value, date(start)).status, 'in_warranty');
        assert.equal(normalizeLenovoWarranty(value, date(end)).status, 'in_warranty');
        assert.equal(
          normalizeLenovoWarranty(value, date(new Date(end.getTime() + 86400000))).status,
          'expired'
        );
      }
    )
  );
});
test('missing, future, invalid and mixed coverage never imply expired hardware', () => {
  for (const rows of [[], [row({ PartEndDate: '' })], [row({ PartEndDate: '2026-02-30' })], [row({ PartEndDate: '2026-99-99' })], [row({ PartStartDate: '2027-01-01', PartEndDate: '2028-01-01' })], [row({ ServiceProductSmallClass: '电池延保及上门类服务' })]]) {
    assert.equal(normalizeLenovoWarranty(details(rows), '2026-10-27').status, 'unknown');
  }
  assert.equal(normalizeLenovoWarranty(details([row(), row({ PartEndDate: '' })]), '2026-10-27').status, 'unknown');
  assert.equal(normalizeLenovoWarranty({ statusCode: '100', message: '保修信息不存在', data: [] }, '2026-10-26').outcome, 'not_found');
  for (const payload of [{}, { statusCode: '100', message: '服务繁忙', data: [] }, { statusCode: '200', data: { detailinfo: {} } }]) assert.throws(() => normalizeLenovoWarranty(payload, '2026-10-26'), error => error instanceof HttpError && error.code === 'WARRANTY_UPSTREAM_FORMAT');
});
test('server sends only normalized serial to the fixed official host and returns no upstream PII', async () => {
  await lenovoModel();
  const calls: [url: string, options: RequestInit][] = [];
  const service = warrantyService({ clock: () => new Date('2026-10-26T16:05:00Z'), fetcher: async (...args) => { calls.push(args); return Response.json({ ...details([row()]), owner: 'PRIVATE', phone: 'PRIVATE' }); } });
  const result = await service.query({ brand: 'lenovo', serial: ' sn: test1234 ', url: 'https://attacker.invalid/' });
  assert.equal(calls[0][0], 'https://consumerservice.lenovo.com.cn/api/drive/TEST1234/drivewarrantyinfo');
  assert.equal(calls[0][1].redirect, 'manual');
  assert.equal(result.status, 'expired'); // Already October 27 in China.
  assert.equal(result.serial, 'TEST1234');
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.equal(result.source.name, '联想中国官方服务');
  assert.equal(service.providers().providers.filter(provider => provider.available).length, 1);
});
test('unsupported brands, injection and invalid serials do not call any manufacturer', async () => {
  let calls = 0;
  const service = warrantyService({ fetcher: async () => { calls++; throw new Error('Unexpected upstream request'); } });
  for (const input of [{ brand: 'lenovo', serial: '../private' }, { brand: 'evil', serial: 'TEST1234' }, { brand: 'lenovo', serial: {} }, { brand: 'apple', serial: 'TEST1234' }]) await assert.rejects(service.query(input));
  assert.equal(calls, 0);
});
test('timeouts, network failures, non-JSON and upstream failures return safe errors without serial', async () => {
  const fetchers = [async () => { throw new Error('secret TEST1234'); }, async () => new Response('<html/>'), async () => new Response('', { status: 429 })];
  for (const fetcher of fetchers) await assert.rejects(warrantyService({ fetcher }).query({ brand: 'lenovo', serial: 'TEST1234' }), error => error instanceof HttpError && error.status === 502 && !error.message.includes('TEST1234'));
  await assert.rejects(warrantyService({ timeoutMs: 5, fetcher: async (_url, { signal }) => new Promise((_resolve, reject) => present(signal).addEventListener('abort', () => reject(new Error('aborted')))) }).query({ brand: 'lenovo', serial: 'TEST1234' }), error => error instanceof HttpError && error.code === 'WARRANTY_TIMEOUT');
});
test('warranty routes require a staff session before reading inputs or contacting upstream', async (t) => {
  const db = database();
  t.after(() => db.sqlite.close());
  const env = testEnvironment(db);
  const base = 'https://app.test/api/warranty/';
  const upstream = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ statusCode: '100', message: '保修信息不存在', data: [] }));
  for (const [method, path] of [['GET', 'providers'], ['POST', 'challenge'], ['POST', 'query']]) {
    assert.equal((await handleRequest(new Request(base + path, { method }), env)).status, 401);
  }
  assert.equal(upstream.mock.callCount(), 0);
  seedStaff(db, '20261001');
  const staff = present(await userRepository(db).find('20261001'));
  const response = await handleRequest(new Request(base + 'query', {
    method: 'POST',
    headers: { Authorization: `Bearer ${signToken(staff, env.JWT_SECRET)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ brand: 'lenovo', serial: 'TEST1234' })
  }), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal((await response.json()).outcome, 'not_found');
  assert.equal(upstream.mock.callCount(), 1);
});

type LenovoPayload = ReturnType<typeof details> | { statusCode: string; message: string; data: [] };
type LenovoModel = {
  now: Date;
  payload: LenovoPayload;
  calls: number;
  fail?: boolean;
  result?: Awaited<ReturnType<ReturnType<typeof warrantyService>['query']>>;
  error?: HttpError;
  service: ReturnType<typeof warrantyService>;
  dispose(): void;
};

async function lenovoModel() {
  const query = async (r: LenovoModel) => {
    r.result = await r.service.query({ brand: 'lenovo', serial: 'TEST1234' });
  };
  const edges = modelEdges<LenovoModel>([
    ['idle', 'covered', 'QUERY', query],
    [
      'covered',
      'expired',
      'AFTER_END_DATE',
      async (r) => {
        r.now = new Date('2026-10-26T16:00:00Z');
        await query(r);
      }
    ],
    [
      'covered',
      'unknown',
      'MALFORMED_DATE',
      async (r) => {
        r.payload = details([row({ PartEndDate: '' })]);
        await query(r);
      }
    ],
    [
      'covered',
      'not_found',
      'NOT_FOUND',
      async (r) => {
        r.payload = { statusCode: '100', message: '保修信息不存在', data: [] };
        await query(r);
      }
    ],
    [
      'covered',
      'failed',
      'UPSTREAM_FAILURE',
      async (r) => {
        r.fail = true;
        try {
          await query(r);
          assert.fail('expected upstream failure');
        } catch (error) {
          assert.ok(error instanceof HttpError);
          assert.equal(error.status, 502);
          assert.ok(!error.message.includes('TEST1234'));
          r.error = error;
        }
      }
    ],
    [
      'failed',
      'covered',
      'RETRY',
      async (r) => {
        r.fail = false;
        await query(r);
      }
    ]
  ]);
  await runModel<LenovoModel>({
    name: 'warranty-lenovo',
    initial: 'idle',
    edges,
    setup: async () => {
      const state: Omit<LenovoModel, 'service'> = {
        now: new Date('2026-10-26T02:00:00Z'),
        payload: details([row()]),
        calls: 0,
        dispose() {}
      };
      const r: LenovoModel = {
        ...state,
        service: warrantyService({
          clock: () => r.now,
          fetcher: async () => {
            r.calls++;
            if (r.fail) throw new Error('upstream failed TEST1234');
            return Response.json(r.payload);
          }
        })
      };
      return r;
    },
    observe: (r, state: string) => {
      if (state === 'idle') assert.equal(r.calls, 0);
      else if (state === 'failed') assert.equal(present(r.error).status, 502);
      else {
        const expected: Readonly<Record<string, string>> = { covered: 'in_warranty', expired: 'expired', unknown: 'unknown', not_found: 'unknown' };
        const result = present(r.result);
        assert.equal(result.status, expected[state]);
        assert.equal(result.outcome, state === 'not_found' ? 'not_found' : 'found');
      }
    }
  });
}
