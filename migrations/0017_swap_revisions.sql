-- A swap publishes successor assignments; original roster facts stay immutable.
ALTER TABLE duty_assignments ADD COLUMN previous_assignment_id TEXT REFERENCES duty_assignments(id);
CREATE INDEX idx_assignment_previous ON duty_assignments(previous_assignment_id);
ALTER TABLE swap_requests ADD COLUMN applied_from_assignment_id TEXT REFERENCES duty_assignments(id);
ALTER TABLE swap_requests ADD COLUMN applied_to_assignment_id TEXT REFERENCES duty_assignments(id);

-- Unchanged republications retain the owner's revision, including after a swap.
CREATE TRIGGER assignment_lineage_revision AFTER INSERT ON duty_assignments
WHEN NEW.origin_assignment_id IS NOT NULL
BEGIN
  UPDATE duty_assignments SET revision=(SELECT revision FROM duty_assignments WHERE id=NEW.origin_assignment_id) WHERE id=NEW.id;
END;

DROP TRIGGER swap_accept_guard;
CREATE TRIGGER swap_accept_guard BEFORE UPDATE OF status ON swap_requests
WHEN OLD.status='pending' AND NEW.status='accepted'
BEGIN
  SELECT RAISE(ABORT,'SWAP_REVISION_CONFLICT') WHERE
    NOT EXISTS(SELECT 1 FROM duty_assignments next
      JOIN duty_assignments previous ON previous.id=next.previous_assignment_id
      JOIN duty_assignments original ON original.id=OLD.from_assignment_id
      JOIN roster_versions rv ON rv.id=next.version_id AND rv.status='published'
      WHERE next.id=NEW.applied_from_assignment_id AND next.member_id=OLD.to_member_id
        AND previous.member_id=OLD.from_member_id AND previous.revision=OLD.from_revision
        AND next.revision=OLD.from_revision+1
        AND COALESCE(previous.origin_assignment_id,previous.id)=COALESCE(original.origin_assignment_id,original.id))
    OR NOT EXISTS(SELECT 1 FROM duty_assignments next
      JOIN duty_assignments previous ON previous.id=next.previous_assignment_id
      JOIN duty_assignments original ON original.id=OLD.to_assignment_id
      JOIN roster_versions rv ON rv.id=next.version_id AND rv.status='published'
      WHERE next.id=NEW.applied_to_assignment_id AND next.member_id=OLD.from_member_id
        AND previous.member_id=OLD.to_member_id AND previous.revision=OLD.to_revision
        AND next.revision=OLD.to_revision+1
        AND COALESCE(previous.origin_assignment_id,previous.id)=COALESCE(original.origin_assignment_id,original.id));
END;
