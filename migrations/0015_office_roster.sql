-- Existing collection tasks retain their repair workflow.
ALTER TABLE roster_tasks ADD COLUMN duty_type TEXT NOT NULL DEFAULT 'repair' CHECK(duty_type IN ('repair','office'));

-- Publication is the atomic boundary: competing tasks cannot double-book a member.
CREATE TRIGGER roster_publication_schedule_guard BEFORE UPDATE OF status ON roster_versions
WHEN NEW.status='published' AND OLD.status<>'published'
BEGIN
  SELECT RAISE(ABORT,'ROSTER_SCHEDULE_CONFLICT') WHERE EXISTS (
    SELECT 1 FROM duty_assignments a JOIN duty_assignments b ON a.member_id=b.member_id AND a.id<>b.id
    JOIN roster_versions other ON other.id=b.version_id
    WHERE a.version_id=NEW.id AND (b.version_id=NEW.id OR (other.status='published' AND other.task_id<>NEW.task_id))
    AND ((a.duty_type='repair' AND b.duty_type='repair' AND date(a.business_date,'weekday 0','-6 day')=date(b.business_date,'weekday 0','-6 day'))
      OR (a.business_date=b.business_date AND ((a.duty_type='office' AND b.duty_type='office') OR (a.start_at<b.end_at AND b.start_at<a.end_at))))
  );
END;
