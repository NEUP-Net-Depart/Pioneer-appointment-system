import { checkProperty, runModel } from './fixtures/workflow-seed.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { warrantyService, normalizeLenovoWarranty } from '../src/services/warranty.js';
import { warrantyRoutes } from '../src/routes/warranty.js';

const details = rows => ({ statusCode: '200', data: { detailinfo: { warranty: rows, onsite: [], other: [] } } });
const row = (overrides = {}) => ({ ServiceProductName: '整机有限保修', ServiceProductSmallClass: '基础服务', PartStartDate: '2025-10-26 00:00:00', PartEndDate: '2026-10-26 00:00:00', ...overrides });

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
      (offset, length) => {
        const start = new Date(Date.UTC(2020, 0, 1) + offset * 86400000),
          end = new Date(start.getTime() + length * 86400000);
        const date = (value) => value.toISOString().slice(0, 10);
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
  for (const payload of [{}, { statusCode: '100', message: '服务繁忙', data: [] }, { statusCode: '200', data: { detailinfo: {} } }]) assert.throws(() => normalizeLenovoWarranty(payload, '2026-10-26'), error => error.code === 'WARRANTY_UPSTREAM_FORMAT');
});
test('server sends only normalized serial to the fixed official host and returns no upstream PII', async () => {
  await lenovoModel();
  const calls = [];
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
  const service = warrantyService({ fetcher: async () => { calls++; } });
  for (const input of [{ brand: 'lenovo', serial: '../private' }, { brand: 'evil', serial: 'TEST1234' }, { brand: 'lenovo', serial: {} }, { brand: 'apple', serial: 'TEST1234' }]) await assert.rejects(service.query(input));
  assert.equal(calls, 0);
});
test('timeouts, network failures, non-JSON and upstream failures return safe errors without serial', async () => {
  const fetchers = [async () => { throw new Error('secret TEST1234'); }, async () => new Response('<html/>'), async () => new Response('', { status: 429 })];
  for (const fetcher of fetchers) await assert.rejects(warrantyService({ fetcher }).query({ brand: 'lenovo', serial: 'TEST1234' }), error => error.status === 502 && !error.message.includes('TEST1234'));
  await assert.rejects(warrantyService({ timeoutMs: 5, fetcher: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))) }).query({ brand: 'lenovo', serial: 'TEST1234' }), error => error.code === 'WARRANTY_TIMEOUT');
});
test('warranty routes require a staff session before reading inputs or contacting upstream', async () => {
  for (const [, , handler] of warrantyRoutes) {
    await assert.rejects(handler({ role: async role => { assert.equal(role, 'technician'); throw new Error('unauthorized'); } }), /unauthorized/);
  }
  const seen = [];
  const context = { request: new Request('https://example.invalid/api/warranty/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brand: 'lenovo', serial: 'TEST1234' }) }), role: async () => seen.push('auth'), limit: async scope => seen.push(scope), services: { warranty: { query: async body => { seen.push(body); return { outcome: 'not_found' }; } } } };
  const response = await warrantyRoutes[2][2](context);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(seen, ['auth', 'warranty', { brand: 'lenovo', serial: 'TEST1234' }]);
});

async function lenovoModel() {
  const query = async (r) => {
    r.result = await r.service.query({ brand: 'lenovo', serial: 'TEST1234' });
  };
  const edges = [
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
  ].map(([from, to, event, run]) => ({ from, to, event, run }));
  await runModel({
    name: 'warranty-lenovo',
    initial: 'idle',
    edges,
    setup: async () => {
      const r = {
        now: new Date('2026-10-26T02:00:00Z'),
        payload: details([row()]),
        calls: 0,
        dispose() {}
      };
      r.service = warrantyService({
        clock: () => r.now,
        fetcher: async () => {
          r.calls++;
          if (r.fail) throw new Error('upstream failed TEST1234');
          return Response.json(r.payload);
        }
      });
      return r;
    },
    observe: (r, state) => {
      if (state === 'idle') assert.equal(r.calls, 0);
      else if (state === 'failed') assert.equal(r.error.status, 502);
      else {
        assert.equal(
          r.result.status,
          { covered: 'in_warranty', expired: 'expired', unknown: 'unknown', not_found: 'unknown' }[
            state
          ]
        );
        assert.equal(r.result.outcome, state === 'not_found' ? 'not_found' : 'found');
      }
    }
  });
}
