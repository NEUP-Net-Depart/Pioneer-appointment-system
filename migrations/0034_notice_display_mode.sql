-- Existing announcements keep their current inline presentation and acceptance.
ALTER TABLE booking_notices ADD COLUMN display_mode TEXT NOT NULL DEFAULT 'inline'
  CHECK(display_mode IN ('inline','modal'));
