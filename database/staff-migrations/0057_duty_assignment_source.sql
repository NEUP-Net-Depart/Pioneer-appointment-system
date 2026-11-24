ALTER TABLE duty_assignments ADD COLUMN assignment_source TEXT CHECK (assignment_source IN ('auto', 'manual'));
