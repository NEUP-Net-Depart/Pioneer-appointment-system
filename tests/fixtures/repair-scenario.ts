import type { AccountRecord } from '../../src/db/records.ts';
import { present } from '../helpers/present.ts';
import assert from 'node:assert/strict';
import { appointmentPatch } from '../../src/lib/validation.ts';
import { modelEdges, runModel, rejectWithoutWrite } from './workflow-seed.ts';
import { addDays, dateKey, expirationDeadline } from '../../shared/time.ts';
import { appointmentRepository } from '../../src/db/appointments.ts';
import { userRepository } from '../../src/db/users.ts';
import { appointmentService } from '../../src/services/appointments.ts';
import { scanService } from '../../src/services/scan.ts';
import { database, seedAppointment, seedStaff, seedPhoto } from '../helpers/database.ts';
import { staffServices } from './staff-services.ts';

export function repairScenario(test: import('node:test').TestContext, { time = '22:30', studentId, managed = false }: { time?: string; studentId?: string; managed?: boolean } = {}) {
  // Thursday is bookable; the following Friday exercises cross-day repair
  // without opening online capacity on a closed day. Neither follows the host clock.
  const serviceDay = '2026-11-05';
  const instant = (day: string, time: string) => new Date(`${day}T${time}:00+08:00`);
  test.mock.timers.enable({ apis: ['Date'], now: instant(serviceDay, time) });
  const clock = () => new Date();
  const calendar = {
    serviceDay,
    previousServiceDay: addDays(serviceDay, -7),
    nextDay: addDays(serviceDay, 1),
    moveTo(day: string, time: string) {
      test.mock.timers.setTime(instant(day, time).getTime());
    }
  };

  const db = database(),
    key = '00'.repeat(32);
  if (!managed) test.after(() => db.sqlite.close());
  seedStaff(db, '20260001');
  seedStaff(db, '20260002');
  seedStaff(db, '20260003', '浑南');
  for (const account of ['20260001', '20260002', '20260003'])
    db.sqlite
      .prepare(
        "INSERT INTO member_department_memberships(id,member_id,department_id,position_code,assignment_type,is_primary,effective_from,created_at) VALUES(?,?,'dept-hardware','member','primary',1,'2026-01-01','2026-01-01')"
      )
      .run('post-' + account, 'member-' + account);
  const users = userRepository(db),
    repo = appointmentRepository(db);
  const staff = staffServices(db, key);
  const service = appointmentService(repo, key, clock, staff);
  const scan = scanService(repo, service, 'test-qr-secret', clock, staff.field);
  function order(id: string, values: Partial<Parameters<typeof seedAppointment>[1]> = {}) {
    const date = values.date ?? dateKey(clock());
    seedAppointment(db, {
      id,
      student_id: studentId ?? id,
      date,
      expires_at: expirationDeadline(date),
      ...values
    });
  }
  return { db, users, repo, staff, service, scan, calendar, clock, order };
}

type RepairScenario = ReturnType<typeof repairScenario>;
type RepairModel = RepairScenario & {
  one: AccountRecord;
  two: AccountRecord;
  other: AccountRecord;
  receipt?: Parameters<RepairScenario['service']['receive']>[1];
  dispose(): void;
};

export async function repairModel(t: import('node:test').TestContext) {
  const revision = async (r: RepairModel) => present(await r.repo.find('model')).revision;
  const input = async <T extends Record<string, unknown>>(r: RepairModel, values: T) => ({
    revision: await revision(r),
    requestId: crypto.randomUUID(),
    ...values
  });
  const update = async (r: RepairModel, values: Record<string, unknown>, actor = r.one) =>
    r.service.update('model', appointmentPatch(await input(r, values)), actor);
  const receive = async (r: RepairModel) => {
    r.receipt = await input(r, { photosCaptured: true, uploadTimedOut: true });
    await r.service.receive('model', r.receipt, r.one);
  };
  const finish = (r: RepairModel) =>
    update(r, { status: 'completed', outcome: 'repaired', repairNote: '已完成检修' }, r.two);
  const edges = modelEdges<RepairModel>([
    ['booked', 'received', 'RECEIVE', receive],
    [
      'booked',
      'started',
      'START',
      (r) => update(r, { status: 'in_progress', photosCaptured: true, uploadTimedOut: true })
    ],
    ['booked', 'cancelled', 'CANCEL', (r) => update(r, { status: 'cancelled' })],
    [
      'booked',
      'expired',
      'EXPIRE',
      async (r) => {
        r.calendar.moveTo(r.calendar.nextDay, '10:00');
        await r.staff.field.board(r.one);
      }
    ],
    [
      'booked',
      'booked',
      'REJECT_FOREIGN',
      (r) =>
        rejectWithoutWrite(
          r.db,
          async () =>
            r.service.receive(
              'model',
              await input(r, { photosCaptured: true, uploadTimedOut: true }),
              r.other
            ),
          { status: 403 }
        )
    ],
    [
      'received',
      'received',
      'REPLAY_RECEIVE',
      async (r) => {
        const before = await r.repo.find('model');
        await r.service.receive('model', present(r.receipt), r.one);
        assert.deepEqual(await r.repo.find('model'), before);
      }
    ],
    [
      'received',
      'received',
      'REJECT_CANCEL',
      (r) => rejectWithoutWrite(r.db, () => update(r, { status: 'cancelled' }), { status: 409 })
    ],
    [
      'received',
      'received',
      'REJECT_STALE',
      (r) =>
        rejectWithoutWrite(
          r.db,
          () => r.service.receive('model', { ...present(r.receipt), requestId: crypto.randomUUID() }, r.one),
          { status: 409 }
        )
    ],
    ['received', 'started', 'START_RECEIVED', (r) => update(r, { status: 'in_progress' })],
    [
      'received',
      'crossday',
      'NEXT_DAY',
      (r) => {
        r.calendar.moveTo(r.calendar.nextDay, '10:00');
      }
    ],
    ['crossday', 'started', 'START_CROSSDAY', (r) => update(r, { status: 'in_progress' })],
    [
      'started',
      'transferred',
      'TRANSFER',
      async (r) => r.service.transfer('model', await input(r, { receivedDevice: true }), r.two)
    ],
    [
      'started',
      'started',
      'REJECT_UNCONFIRMED_TRANSFER',
      (r) =>
        rejectWithoutWrite(
          r.db,
          async () => r.service.transfer('model', await input(r, { receivedDevice: false }), r.two),
          { status: 400 }
        )
    ],
    [
      'transferred',
      'transferred',
      'REJECT_FORMER_OWNER',
      (r) =>
        rejectWithoutWrite(
          r.db,
          () => update(r, { status: 'completed', outcome: 'repaired', repairNote: '原主修越权' }),
          { status: 403 }
        )
    ],
    ['transferred', 'completed', 'FINISH', finish],
    [
      'completed',
      'corrected',
      'CORRECT',
      (r) =>
        update(r, { action: 'correct', outcome: 'unrepaired', repairNote: '复核仍有故障' }, r.two)
    ],
    [
      'completed',
      'completed',
      'REJECT_RESTART',
      (r) =>
        rejectWithoutWrite(r.db, () => update(r, { status: 'in_progress' }, r.two), { status: 409 })
    ],
    [
      'corrected',
      'partial',
      'SUPPLEMENT_FRONT',
      async (r) => {
        seedPhoto(r.db, 'mf', 'model', 'front', r.one.account);
        await r.service.supplement('model', await input(r, { frontPhotoId: 'mf' }), r.one);
      }
    ],
    [
      'partial',
      'photos',
      'SUPPLEMENT_BACK',
      async (r) => {
        seedPhoto(r.db, 'mb', 'model', 'back', r.one.account);
        await r.service.supplement('model', await input(r, { backPhotoId: 'mb' }), r.one);
      }
    ],
    [
      'partial',
      'partial',
      'REJECT_NEW_OWNER_PHOTOS',
      (r) =>
        rejectWithoutWrite(
          r.db,
          async () => r.service.supplement('model', await input(r, { frontPhotoId: 'mf' }), r.two),
          { status: 403 }
        )
    ],
    ...['cancelled', 'expired'].map<[string, string, string, (r: RepairModel) => unknown]>((state) => [
      state,
      state,
      'REJECT_TERMINAL_START',
      (r) => rejectWithoutWrite(r.db, () => update(r, { status: 'in_progress' }), { status: 409 })
    ])
  ]);
  await runModel({
    name: 'repair-lifecycle',
    initial: 'booked',
    edges,
    setup: async () => {
      t.mock.timers.reset();
      const r = repairScenario(t, { managed: true });
      r.order('model');
      return {
        ...r,
        one: present(await r.users.find('20260001')),
        two: present(await r.users.find('20260002')),
        other: present(await r.users.find('20260003')),
        dispose() {
          r.db.sqlite.close();
          t.mock.timers.reset();
        }
      };
    },
    observe: async (r, state: string) => {
      const item = present(await r.repo.find('model'));
      const expected = ['booked', 'received', 'crossday'].includes(state)
        ? 'booked'
        : ['started', 'transferred'].includes(state)
          ? 'in_progress'
          : ['completed', 'corrected', 'partial', 'photos'].includes(state)
            ? 'completed'
            : state;
      assert.equal(item.status, expected);
      if (
        [
          'received',
          'crossday',
          'started',
          'transferred',
          'completed',
          'corrected',
          'partial',
          'photos'
        ].includes(state)
      )
        assert.ok(item.receivedAt);
      if (['started', 'transferred', 'completed', 'corrected', 'partial', 'photos'].includes(state))
        assert.equal(item.assignedTo, state === 'started' ? r.one.account : r.two.account);
      if (['completed', 'corrected', 'partial', 'photos'].includes(state))
        assert.equal(item.outcome, state === 'completed' ? 'repaired' : 'unrepaired');
      if (state === 'partial') {
        assert.equal(item.frontPhotoId, 'mf');
        assert.equal(item.backPhotoId, null);
        assert.equal(item.photoDeferredBy, r.one.account);
      }
      if (state === 'photos') {
        assert.equal(item.frontPhotoId, 'mf');
        assert.equal(item.backPhotoId, 'mb');
        assert.ok(!item.photoDeferredBy);
      }
      assert.equal(present(r.db.sqlite.prepare('SELECT COUNT(*) n FROM attendance_records').get()).n, 0);
      assert.deepEqual(r.db.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
    }
  });
}
