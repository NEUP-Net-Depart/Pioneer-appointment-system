ALTER TABLE appointments ADD COLUMN signature TEXT NOT NULL DEFAULT '';
ALTER TABLE appointments ADD COLUMN repair_number TEXT;
ALTER TABLE appointments ADD COLUMN front_photo_id TEXT;
ALTER TABLE appointments ADD COLUMN back_photo_id TEXT;
CREATE UNIQUE INDEX idx_repair_number ON appointments(repair_number);
ALTER TABLE appointment_attachments ADD COLUMN purpose TEXT NOT NULL DEFAULT 'general';
ALTER TABLE appointment_attachments ADD COLUMN uploaded_by TEXT;
