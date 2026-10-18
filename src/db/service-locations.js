export function serviceLocationRepository(db, { workflowSchema = false } = {}) {
  return {
    async list(start,end,campuses) {
      if (!campuses.length) return [];
      return (await db.prepare(`SELECT campus,date,location,revision,updated_at AS updatedAt,updated_by AS updatedBy FROM service_locations
        WHERE date>=? AND date<=? AND campus IN (${campuses.map(() => '?').join(',')}) ORDER BY date,campus`).bind(start,end,...campuses).all()).results;
    },
    async update(input,actor,instant) {
      const {campus,date,location,revision} = input;
      const results = await db.batch([
        db.prepare(`INSERT INTO service_location_changes(id,campus,date,actor,before_location,after_location,revision,created_at)
          SELECT ?,?,?,?,COALESCE((SELECT location FROM service_locations WHERE campus=? AND date=?),''),?,?,?
          WHERE EXISTS(SELECT 1 FROM service_locations WHERE campus=? AND date=? AND revision=?)
            OR (?=0 AND NOT EXISTS(SELECT 1 FROM service_locations WHERE campus=? AND date=?))`)
          .bind(crypto.randomUUID(),campus,date,actor,campus,date,location,revision+1,instant,campus,date,revision,revision,campus,date),
        db.prepare(`INSERT INTO service_locations(campus,date,location,revision,updated_at,updated_by) SELECT ?,?,?,1,?,? WHERE ?=0
          OR EXISTS(SELECT 1 FROM service_locations WHERE campus=? AND date=? AND revision=?)
          ON CONFLICT(campus,date) DO UPDATE SET location=excluded.location,revision=service_locations.revision+1,
          updated_at=excluded.updated_at,updated_by=excluded.updated_by WHERE service_locations.revision=?
          RETURNING campus,date,location,revision,updated_at AS updatedAt,updated_by AS updatedBy`)
          .bind(campus,date,location,instant,actor,revision,campus,date,revision,revision)
      ]);
      return results[1].results[0] || null;
    },
    async affected(campus,date) {
      return (await db.prepare(`SELECT id,name,student_id AS studentId,${workflowSchema ? '(SELECT member_id FROM staff_accounts WHERE account=appointments.assigned_to)' : 'NULL'} AS assignedMemberId,contact_type AS contactType,contact_value AS contactValue,
        email,social,phone FROM appointments WHERE campus=? AND date=? AND source='booking' AND status IN ('booked','in_progress') ORDER BY time_slot,id`)
        .bind(campus,date).all()).results;
    },
    async changes(campus,date) {
      return (await db.prepare(`SELECT actor,before_location AS beforeLocation,after_location AS afterLocation,revision,created_at AS createdAt
        FROM service_location_changes WHERE campus=? AND date=? ORDER BY revision DESC`).bind(campus,date).all()).results;
    }
  };
}
