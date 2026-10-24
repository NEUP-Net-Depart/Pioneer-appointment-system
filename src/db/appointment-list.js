import {
  appointmentOrder,
  readAppointmentCursor,
  appointmentCursor
} from '../../shared/appointment-pagination.js';

const sortColumns = {
  id: 'id',
  createdAt: 'created_at',
  date: 'date',
  timeSlot: 'time_slot',
  campus: 'campus',
  status:
    "CASE status WHEN 'booked' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'completed' THEN 2 WHEN 'cancelled' THEN 3 ELSE 4 END"
};
const counts = `SELECT COUNT(*) AS allCount, COUNT(CASE WHEN status='booked' THEN 1 END) AS booked,
  COUNT(CASE WHEN status='in_progress' THEN 1 END) AS in_progress, COUNT(CASE WHEN status='completed' THEN 1 END) AS completed,
  COUNT(CASE WHEN status='cancelled' THEN 1 END) AS cancelled, COUNT(CASE WHEN status='expired' THEN 1 END) AS expired FROM appointments`;

function accessPredicate(rules, args, carryover = false) {
  if (rules === undefined) return '1';
  if (!rules.length) return '0';
  // One JSON parameter keeps large role sets below D1's binding limit.
  args.push(JSON.stringify(rules));
  return `EXISTS (SELECT 1 FROM json_each(?) AS access_rule
    WHERE json_extract(access_rule.value,'$.campus')=appointments.campus
      AND (json_type(access_rule.value,'$.memberId') IS NULL OR appointments.assigned_to IN
        (SELECT account FROM staff_accounts WHERE member_id=json_extract(access_rule.value,'$.memberId'))
        OR EXISTS(SELECT 1 FROM repair_receptions r WHERE r.appointment_id=appointments.id AND r.state='assigned' AND r.assigned_member_id=json_extract(access_rule.value,'$.memberId')))
      AND (json_type(access_rule.value,'$.date') IS NULL OR appointments.date=json_extract(access_rule.value,'$.date')
        ${carryover ? "OR appointments.status='in_progress' OR (appointments.status='booked' AND EXISTS(SELECT 1 FROM repair_receptions r WHERE r.appointment_id=appointments.id AND r.state IN ('queued','assigned')))" : ''})
      AND (json_type(access_rule.value,'$.objectIds') IS NULL OR appointments.id IN
        (SELECT value FROM json_each(json_extract(access_rule.value,'$.objectIds')))))`;
}

export async function listAppointments(
  db,
  select,
  fromRow,
  query,
  { campuses, summaryRules, identityRules }
) {
  const scopeArgs = [...campuses];
  const scope = `${campuses.length ? `campus IN (${campuses.map(() => '?').join(',')})` : '0'} AND (${accessPredicate(summaryRules, scopeArgs, true)})`;
  const where = [scope],
    args = [...scopeArgs];
  for (const [key, column] of [
    ['campus', 'campus'],
    ['date', 'date'],
    ['timeSlot', 'time_slot']
  ])
    if (query[key]) {
      where.push(`${column}=?`);
      args.push(query[key]);
    }
  if (query.dateFrom && query.dateTo) {
    where.push('date>=? AND date<=?');
    args.push(query.dateFrom, query.dateTo);
  }
  if (query.q) {
    const text = query.q.toLowerCase();
    args.push(text, text, text, text);
    const identity = accessPredicate(identityRules, args);
    args.push(text, text);
    where.push(
      `(instr(lower(id),?)>0 OR instr(lower(repair_number),?)>0 OR instr(lower(device_model),?)>0 OR instr(campus,?)>0 OR ((${identity}) AND (instr(lower(name),?)>0 OR instr(student_id,?)>0)))`
    );
  }
  const filteredWhere = where.join(' AND '),
    filteredArgs = [...args];
  if (query.status === 'pending') where.push("status IN ('booked','in_progress')");
  else if (query.status && query.status !== 'all') {
    where.push('status=?');
    args.push(query.status);
  }
  const order = appointmentOrder(query),
    cursor = readAppointmentCursor(query.cursor, order);
  if (cursor) {
    const alternatives = order.map((item, index) => {
      const parts = order.slice(0, index).map((previous, i) => {
        args.push(cursor[i]);
        return `${sortColumns[previous.field]}=?`;
      });
      args.push(cursor[index]);
      parts.push(`${sortColumns[item.field]}${item.direction === 'asc' ? '>' : '<'}?`);
      return `(${parts.join(' AND ')})`;
    });
    where.push(`(${alternatives.join(' OR ')})`);
  }
  const limit = Number.isInteger(query.limit) ? Math.min(Math.max(query.limit, 1), 200) : 200;
  const pagedSelect = select.replace(
    'SELECT appointments.*',
    `SELECT appointments.*,${order.map((item, index) => `${sortColumns[item.field]} AS __page${index}`).join(',')}`
  );
  const [items, total, filtered] = await db.batch([
    db
      .prepare(
        `${pagedSelect} WHERE ${where.join(' AND ')} ORDER BY ${order.map((item) => `${sortColumns[item.field]} ${item.direction === 'asc' ? 'ASC' : 'DESC'}`).join(',')} LIMIT ?`
      )
      .bind(...args, limit + 1),
    db.prepare(`${counts} WHERE ${scope}`).bind(...scopeArgs),
    db.prepare(`${counts} WHERE ${filteredWhere}`).bind(...filteredArgs)
  ]);
  const page = items.results.slice(0, limit),
    { allCount, ...totals } = total.results[0],
    { allCount: filteredTotal, ...filteredTotals } = filtered.results[0];
  return {
    items: page.map(fromRow),
    counts: { all: allCount, ...totals },
    filteredCounts: { all: filteredTotal, ...filteredTotals },
    nextCursor: items.results.length > limit ? appointmentCursor(page.at(-1), order) : null
  };
}
