function fromRow(row) {
  return row ? { campus: row.campus, weekday: row.weekday, timeSlot: row.time_slot, capacity: row.capacity, revision: row.revision } : null;
}

// Dates without a booking use the current template. Booked dates use their snapshot.
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
  return {
    async list(campuses) {
      if (!campuses.length) return [];
      const result = await db.prepare(`SELECT * FROM weekday_slot_capacities
        WHERE campus IN (${campuses.map(() => '?').join(',')}) ORDER BY campus,weekday,time_slot`).bind(...campuses).all();
      return result.results.map(fromRow);
    },
    async update({ campus, weekday, timeSlot, capacity, revision }) {
      return fromRow(await db.prepare(`UPDATE weekday_slot_capacities SET capacity=?,revision=revision+1
        WHERE campus=? AND weekday=? AND time_slot=? AND revision=? RETURNING *`).bind(capacity, campus, weekday, timeSlot, revision).first());
    },
    async updateMany(items) {
      // One statement checks all revisions and commits all changes together.
      // A stale/missing row makes the capacity CHECK abort the entire statement.
      try {
        const result = await db.prepare(`WITH changes AS MATERIALIZED (
          SELECT json_extract(value,'$.campus') AS campus,json_extract(value,'$.weekday') AS weekday,
            json_extract(value,'$.timeSlot') AS time_slot,json_extract(value,'$.capacity') AS capacity,
            json_extract(value,'$.revision') AS revision FROM json_each(?)
        ), valid AS MATERIALIZED (
          SELECT NOT EXISTS(SELECT 1 FROM changes c LEFT JOIN weekday_slot_capacities s
            ON s.campus=c.campus AND s.weekday=c.weekday AND s.time_slot=c.time_slot
            WHERE s.revision IS NOT c.revision) AS ok
        ) UPDATE weekday_slot_capacities AS s SET
          capacity=CASE WHEN (SELECT ok FROM valid) THEN (SELECT c.capacity FROM changes c
            WHERE c.campus=s.campus AND c.weekday=s.weekday AND c.time_slot=s.time_slot) ELSE -1 END,
          revision=revision+1 WHERE EXISTS(SELECT 1 FROM changes c
            WHERE c.campus=s.campus AND c.weekday=s.weekday AND c.time_slot=s.time_slot) RETURNING *`)
          .bind(JSON.stringify(items)).all();
        return result.results.map(fromRow);
      } catch (error) {
        if (`${error.message} ${error.cause?.message}`.includes('CHECK constraint failed')) return null;
        throw error;
      }
    }
  };
}
