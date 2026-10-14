const fromRow = row => row ? { campus:row.campus, location:row.location, revision:row.revision } : null;

export function repairLocationRepository(db) {
  return {
    async list() {
      return (await db.prepare('SELECT campus,location,revision FROM campus_repair_locations ORDER BY campus').all()).results.map(fromRow);
    },
    async update({ campus, location, revision }, instant) {
      return fromRow(await db.prepare(`UPDATE campus_repair_locations SET location=?,revision=revision+1,updated_at=?
        WHERE campus=? AND revision=? RETURNING campus,location,revision`).bind(location,instant,campus,revision).first());
    }
  };
}
