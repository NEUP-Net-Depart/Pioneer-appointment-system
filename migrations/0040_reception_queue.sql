-- Persist arrival tickets independently from live queue position. Existing arrivals keep their order.
CREATE TABLE repair_queue_tickets (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  campus TEXT NOT NULL,
  queue_date TEXT NOT NULL,
  number INTEGER NOT NULL CHECK(number>0),
  created_at TEXT NOT NULL,
  UNIQUE(campus,queue_date,number)
);
CREATE INDEX idx_repair_queue_appointment ON repair_queue_tickets(appointment_id,created_at);
ALTER TABLE repair_receptions ADD COLUMN ticket_id TEXT REFERENCES repair_queue_tickets(id) ON DELETE SET NULL;
ALTER TABLE repair_receptions ADD COLUMN left_at TEXT;
INSERT INTO repair_queue_tickets(id,appointment_id,campus,queue_date,number,created_at)
SELECT 'legacy-queue-'||r.appointment_id,r.appointment_id,a.campus,date(r.received_at,'+8 hours'),
  ROW_NUMBER() OVER (PARTITION BY a.campus,date(r.received_at,'+8 hours') ORDER BY r.received_at,r.appointment_id),r.received_at
FROM repair_receptions r JOIN appointments a ON a.id=r.appointment_id;
UPDATE repair_receptions SET ticket_id='legacy-queue-'||appointment_id;
CREATE TABLE repair_queue_counters (
  campus TEXT NOT NULL,
  queue_date TEXT NOT NULL,
  last_number INTEGER NOT NULL CHECK(last_number>0),
  PRIMARY KEY(campus,queue_date)
);
INSERT INTO repair_queue_counters(campus,queue_date,last_number)
SELECT campus,queue_date,MAX(number) FROM repair_queue_tickets GROUP BY campus,queue_date;
INSERT INTO staff_release_markers(id,applied_at) VALUES('reception-queue-0040',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
