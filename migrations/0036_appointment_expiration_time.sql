-- Move pending appointments using the old 21:30 Shanghai default to 20:45.
-- Preserve recorded starts, terminal history and explicitly adjusted deadlines.
UPDATE appointments
SET expires_at=date || 'T12:45:00.000Z',revision=revision+1
WHERE status='booked' AND started_at IS NULL
  AND expires_at=date || 'T13:30:00.000Z';

-- The final booking slot ends after the shared expiration deadline.
CREATE TRIGGER appointment_new_expiration_deadline BEFORE INSERT ON appointments
WHEN NEW.source='booking' AND NEW.status='booked'
BEGIN
  SELECT RAISE(ABORT,'SLOT_ENDED') WHERE julianday(NEW.created_at)>=julianday(NEW.expires_at);
END;
