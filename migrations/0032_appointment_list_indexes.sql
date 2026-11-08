CREATE INDEX IF NOT EXISTS idx_appointments_campus_created ON appointments(campus,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_appointments_campus_facets ON appointments(campus,date,time_slot,status);
