import { addDays, dateKey, expirationDeadline } from '../../shared/time.js';
import { appointmentRepository } from '../../src/db/appointments.js';
import { userRepository } from '../../src/db/users.js';
import { appointmentService } from '../../src/services/appointments.js';
import { scanService } from '../../src/services/scan.js';
import { database, seedAppointment, seedStaff } from '../helpers/database.mjs';
import { staffServices } from './staff-services.mjs';

export function repairScenario(test, { time = '22:30', studentId } = {}) {
  // Thursday is bookable; the following Friday exercises cross-day repair
  // without opening online capacity on a closed day. Neither follows the host clock.
  const serviceDay = '2026-11-05';
  const instant = (day, time) => new Date(`${day}T${time}:00+08:00`);
  test.mock.timers.enable({ apis: ['Date'], now: instant(serviceDay, time) });
  const clock = () => new Date();
  const calendar = {
    serviceDay,
    previousServiceDay: addDays(serviceDay, -7),
    nextDay: addDays(serviceDay, 1),
    moveTo(day, time) { test.mock.timers.setTime(instant(day, time).getTime()); }
  };

  const db = database(), key = '00'.repeat(32);
  test.after(() => db.sqlite.close());
  seedStaff(db, '20260001');
  seedStaff(db, '20260002');
  seedStaff(db, '20260003', '浑南');
  const users = userRepository(db), repo = appointmentRepository(db);
  const staff = staffServices(db, key);
  const service = appointmentService(repo, users, key, clock, staff);
  const scan = scanService(repo, service, 'test-qr-secret', clock, staff.field);
  function order(id, values = {}) {
    const date = values.date ?? dateKey(clock());
    seedAppointment(db, {
      id, student_id: studentId ?? id, date, expires_at: expirationDeadline(date), ...values
    });
  }
  return { db, users, repo, staff, service, scan, calendar, clock, order };
}
