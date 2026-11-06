-- Appointment slots control new online bookings; reception remains valid all day.
-- Preserve terminal appointments and all historical timestamps. No automatic revival.
INSERT INTO audit_events(id,action,source_ref,before_json,after_json,reason,occurred_at)
SELECT 'day-expiry-'||id,'appointments.expiration.migrated',
 json_object('module','repairs','type','appointment','id',id),
 json_object('expiresAt',expires_at,'revision',revision),
 json_object('expiresAt',strftime('%Y-%m-%dT%H:%M:%fZ',date || 'T00:00:00','+1 day','-8 hours')),
 'v1.2 预约当天有效',strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM appointments WHERE status='booked' AND started_at IS NULL
 AND expires_at<>strftime('%Y-%m-%dT%H:%M:%fZ',date || 'T00:00:00','+1 day','-8 hours');
UPDATE appointments SET expires_at=strftime('%Y-%m-%dT%H:%M:%fZ',date || 'T00:00:00','+1 day','-8 hours'),revision=revision+1
WHERE status='booked' AND started_at IS NULL
 AND expires_at<>strftime('%Y-%m-%dT%H:%M:%fZ',date || 'T00:00:00','+1 day','-8 hours');
INSERT INTO staff_release_markers VALUES('appointment-day-0044',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
