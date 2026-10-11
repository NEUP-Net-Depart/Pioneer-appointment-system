function fromRow(row) {
  return row ? { campus: row.campus, timeSlot: row.time_slot, capacity: row.capacity, revision: row.revision } : null;
}

export function slotCapacityRepository(db) {
  return {
    async list(campuses) {
      if (!campuses.length) return [];
      const result = await db.prepare(`SELECT * FROM slot_capacities
        WHERE campus IN (${campuses.map(() => '?').join(',')}) ORDER BY campus,time_slot`).bind(...campuses).all();
      return result.results.map(fromRow);
    },
    async update({ campus, timeSlot, capacity, revision }) {
      return fromRow(await db.prepare(`UPDATE slot_capacities SET capacity=?,revision=revision+1
        WHERE campus=? AND time_slot=? AND revision=? RETURNING *`).bind(capacity, campus, timeSlot, revision).first());
    }
  };
}
