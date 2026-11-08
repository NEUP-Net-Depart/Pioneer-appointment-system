-- Deterministic keyed tokens are populated by the Worker after authorization.
-- Historical rows stay untouched and are indexed when an authorized lookup reads them.
CREATE TABLE appointment_contact_index_pending (
  appointment_id TEXT PRIMARY KEY REFERENCES appointments(id) ON UPDATE CASCADE ON DELETE CASCADE,
  generation INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE appointment_contact_index_tokens (
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON UPDATE CASCADE ON DELETE CASCADE,
  token TEXT NOT NULL,
  PRIMARY KEY (appointment_id, token)
);
CREATE INDEX idx_appointment_contact_token ON appointment_contact_index_tokens(token, appointment_id);
INSERT INTO appointment_contact_index_pending(appointment_id,generation)
SELECT id,0 FROM appointments;
CREATE TRIGGER appointment_contact_index_insert AFTER INSERT ON appointments
BEGIN
  INSERT INTO appointment_contact_index_pending(appointment_id,generation) VALUES(NEW.id,0)
    ON CONFLICT(appointment_id) DO UPDATE SET generation=generation+1;
END;
CREATE TRIGGER appointment_contact_index_update AFTER UPDATE OF phone,email,contact_value,social ON appointments
BEGIN
  INSERT INTO appointment_contact_index_pending(appointment_id,generation) VALUES(NEW.id,1)
    ON CONFLICT(appointment_id) DO UPDATE SET generation=generation+1;
END;

-- Exchange workers can read their own assigned customer's identity and contact
-- just like ordinary technicians; no campus-wide contact grant is added.
INSERT OR IGNORE INTO role_grants(id,role_id,permission_code,scope_spec,condition_spec)
VALUES
  ('grant-exchange-own-identity','role-exchange','customer.identity.read','{"self":true}','[{"code":"ownResource","version":1}]'),
  ('grant-exchange-own-contact','role-exchange','customer.contact.read','{"self":true}','[{"code":"ownResource","version":1}]');
