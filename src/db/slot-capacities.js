function fromRow(row) {
  return row ? { campus: row.campus, weekday: row.weekday, timeSlot: row.time_slot, capacity: row.capacity, revision: row.revision } : null;
}

// Booked dates use materialized capacities, synchronized with template edits for
// today and future dates. Historical dates and retired hourly slots stay intact.
export function scheduleStatement(db, start, end, campuses) {
  const scope = campuses.length ? `campus IN (${campuses.map(() => '?').join(',')})` : '0';
  return db.prepare(`WITH RECURSIVE dates(date) AS (
    SELECT ? UNION ALL SELECT date(date,'+1 day') FROM dates WHERE date<?
  ), schedule AS (
    SELECT campus,date,time_slot,capacity FROM booking_day_slots WHERE date>=? AND date<=?
    UNION ALL
    SELECT t.campus,d.date,t.time_slot,t.capacity FROM dates d JOIN weekday_slot_capacities t
    ON t.weekday=CAST(strftime('%w',d.date) AS INTEGER)
    WHERE NOT EXISTS(SELECT 1 FROM booking_day_slots s WHERE s.campus=t.campus AND s.date=d.date)
  ) SELECT * FROM schedule WHERE ${scope} ORDER BY campus,date,time_slot`)
    .bind(start,end,start,end,...campuses);
}

export function slotCapacityRepository(db) {
  async function save(items, today) {
    const changes = `WITH changes AS MATERIALIZED (
      SELECT json_extract(value,'$.campus') AS campus,json_extract(value,'$.weekday') AS weekday,
        json_extract(value,'$.timeSlot') AS time_slot,json_extract(value,'$.capacity') AS capacity,
        json_extract(value,'$.revision') AS revision FROM json_each(?)
    )`;
    const matching = alias => `c.campus=${alias}.campus AND c.weekday=CAST(strftime('%w',${alias}.date) AS INTEGER) AND c.time_slot=${alias}.time_slot`;
    const payload = JSON.stringify(items);
    try {
      // D1 batch is one transaction: revision failure or day synchronization
      // failure rolls back both statements. Booking guards see only the old
      // pair or the new pair, including during a first-booking race.
      const [result] = await db.batch([
        db.prepare(`${changes}, valid AS MATERIALIZED (
          SELECT NOT EXISTS(SELECT 1 FROM changes c LEFT JOIN weekday_slot_capacities s
            ON s.campus=c.campus AND s.weekday=c.weekday AND s.time_slot=c.time_slot
            WHERE s.revision IS NOT c.revision) AS ok
        ) UPDATE weekday_slot_capacities AS s SET
          capacity=CASE WHEN (SELECT ok FROM valid) THEN (SELECT c.capacity FROM changes c
            WHERE c.campus=s.campus AND c.weekday=s.weekday AND c.time_slot=s.time_slot) ELSE -1 END,
          revision=revision+1 WHERE EXISTS(SELECT 1 FROM changes c
            WHERE c.campus=s.campus AND c.weekday=s.weekday AND c.time_slot=s.time_slot) RETURNING *`)
          .bind(payload),
        db.prepare(`${changes} UPDATE booking_day_slots AS s SET
          capacity=(SELECT c.capacity FROM changes c WHERE ${matching('s')})
          WHERE s.date>=? AND EXISTS(SELECT 1 FROM changes c
            JOIN weekday_slot_capacities t ON t.campus=c.campus AND t.weekday=c.weekday AND t.time_slot=c.time_slot
            WHERE ${matching('s')})`).bind(payload, today)
      ]);
      return result.results.map(fromRow);
    } catch (error) {
      if (`${error.message} ${error.cause?.message}`.includes('CHECK constraint failed')) return null;
      throw error;
    }
  }
  return {
    async actual(date, campus, dutyTypes = []) {
      const [schedule, snapshot, occupied, staffing] = await Promise.all([
        scheduleStatement(db, date, date, [campus]).all(),
        db.prepare('SELECT COUNT(*) AS total FROM booking_day_slots WHERE campus=? AND date=?').bind(campus, date).first(),
        db.prepare("SELECT time_slot,COUNT(*) AS total FROM appointments WHERE campus=? AND date=? AND source='booking' AND status<>'cancelled' GROUP BY time_slot").bind(campus, date).all(),
        dutyTypes.length ? db.prepare(`SELECT da.duty_type,COUNT(DISTINCT da.member_id) AS total FROM duty_assignments da
          JOIN roster_versions rv ON rv.id=da.version_id AND rv.status='published'
          JOIN campuses c ON c.id=da.campus_id
          WHERE c.name=? AND da.business_date=? AND da.duty_type IN (${dutyTypes.map(() => '?').join(',')})
          AND NOT EXISTS(SELECT 1 FROM roster_leave_facts lr WHERE lr.origin_assignment_id=COALESCE(da.origin_assignment_id,da.id) AND lr.member_id=da.member_id AND lr.status='approved')
          GROUP BY da.duty_type`).bind(campus, date, ...dutyTypes).all() : null
      ]);
      return { source: snapshot.total ? 'snapshot' : 'template',
        items: schedule.results.map(row => ({ timeSlot: row.time_slot, capacity: row.capacity,
          occupied: occupied.results.find(item => item.time_slot === row.time_slot)?.total || 0 })),
        staffing: staffing ? Object.fromEntries(dutyTypes.map(type => [type, staffing.results.find(row => row.duty_type === type)?.total || 0])) : null };
    },
    async list(campuses) {
      if (!campuses.length) return [];
      const result = await db.prepare(`SELECT * FROM weekday_slot_capacities
        WHERE campus IN (${campuses.map(() => '?').join(',')}) ORDER BY campus,weekday,time_slot`).bind(...campuses).all();
      return result.results.map(fromRow);
    },
    async update(item, today) {
      const result = await save([item], today);
      return result?.[0] || null;
    },
    async updateMany(items, today) {
      return save(items, today);
    }
  };
}
