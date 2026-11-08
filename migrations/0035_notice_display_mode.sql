-- Existing announcements keep their current inline presentation and acceptance.
ALTER TABLE booking_notices ADD COLUMN display_mode TEXT NOT NULL DEFAULT 'inline'
  CHECK(display_mode IN ('inline','modal'));
INSERT INTO staff_release_markers(id,applied_at) VALUES('booking-settings-0035',datetime('now'));
