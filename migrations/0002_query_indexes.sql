-- Support active queue/capacity counts, staff filters, exports and SQL workload aggregation.
CREATE INDEX idx_active_queue ON appointments(date,campus,time_slot,created_at,id)
  WHERE status NOT IN ('cancelled','no_show');
CREATE INDEX idx_appointments_created ON appointments(created_at DESC,id DESC);
CREATE INDEX idx_appointments_assigned ON appointments(assigned_to) WHERE assigned_to<>'';
CREATE INDEX idx_appointments_status ON appointments(status,date);
CREATE INDEX idx_users_name ON users(name);
DROP INDEX idx_appointments_queue;
