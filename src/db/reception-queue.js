// All staff, guest and command projections use the same arrival ordering.
// The ticket breaks equal timestamps, including leaving and rejoining within one millisecond.
export const queueOrder = "r.received_at,COALESCE((SELECT number FROM repair_queue_tickets t WHERE t.id=r.ticket_id),0),r.appointment_id";
export const queueHead = `SELECT r.appointment_id FROM repair_receptions r JOIN appointments a ON a.id=r.appointment_id WHERE r.state='queued' AND a.status='booked' AND a.campus=? ORDER BY ${queueOrder} LIMIT 1`;
export function positionStatement(db,item) {
  return db.prepare(`SELECT COUNT(*) AS total,
    1+COALESCE(SUM((r.received_at,COALESCE(t.number,0),r.appointment_id)<(?,?,?)),0) AS position,
    1+COALESCE(SUM(r.state='queued' AND (r.received_at,COALESCE(t.number,0),r.appointment_id)<(?,?,?)),0) AS dispatchPosition
    FROM repair_receptions r JOIN appointments a ON a.id=r.appointment_id LEFT JOIN repair_queue_tickets t ON t.id=r.ticket_id
    WHERE a.campus=? AND a.status='booked' AND r.state IN ('queued','assigned')`)
    .bind(item.reception.receivedAt,item.reception.ticket?.number || 0,item.id,item.reception.receivedAt,item.reception.ticket?.number || 0,item.id,item.campus);
}
