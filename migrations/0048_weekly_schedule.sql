-- Keep every original roster row in the audit journal; retain all assignment IDs in the new model.
INSERT INTO audit_events(id,action,source_ref,before_json,reason,occurred_at)
 SELECT 'v12-schedule-swap_requests-'||rowid,'rosters.model.migrated',json_object('module','rosters','type','swap_requests','id',CAST(rowid AS TEXT)),
 json_object('id',id,'from_assignment_id',from_assignment_id,'to_assignment_id',to_assignment_id,'from_member_id',from_member_id,'to_member_id',to_member_id,'from_revision',from_revision,'to_revision',to_revision,'status',status,'note',note,'revision',revision,'created_at',created_at,'decided_at',decided_at,'applied_from_assignment_id',applied_from_assignment_id,'applied_to_assignment_id',applied_to_assignment_id),'旧排班事实完整保存，切换通常可用时间与按周例外',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM swap_requests;
INSERT INTO audit_events(id,action,source_ref,before_json,reason,occurred_at)
 SELECT 'v12-schedule-leave_requests-'||rowid,'rosters.model.migrated',json_object('module','rosters','type','leave_requests','id',CAST(rowid AS TEXT)),
 json_object('id',id,'assignment_id',assignment_id,'member_id',member_id,'reason',reason,'status',status,'reviewer_member_id',reviewer_member_id,'review_note',review_note,'revision',revision,'created_at',created_at,'reviewed_at',reviewed_at),'旧排班事实完整保存，切换通常可用时间与按周例外',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM leave_requests;
INSERT INTO audit_events(id,action,source_ref,before_json,reason,occurred_at)
 SELECT 'v12-schedule-duty_roles-'||rowid,'rosters.model.migrated',json_object('module','rosters','type','duty_roles','id',CAST(rowid AS TEXT)),
 json_object('id',id,'assignment_id',assignment_id,'role_kind',role_kind,'effective_range',effective_range),'旧排班事实完整保存，切换通常可用时间与按周例外',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM duty_roles;
INSERT INTO audit_events(id,action,source_ref,before_json,reason,occurred_at)
 SELECT 'v12-schedule-duty_assignments-'||rowid,'rosters.model.migrated',json_object('module','rosters','type','duty_assignments','id',CAST(rowid AS TEXT)),
 json_object('id',id,'version_id',version_id,'member_id',member_id,'business_date',business_date,'campus_id',campus_id,'duty_type',duty_type,'start_at',start_at,'end_at',end_at,'revision',revision,'origin_assignment_id',origin_assignment_id,'previous_assignment_id',previous_assignment_id),'旧排班事实完整保存，切换通常可用时间与按周例外',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM duty_assignments;
INSERT INTO audit_events(id,action,source_ref,before_json,reason,occurred_at)
 SELECT 'v12-schedule-roster_publication_overrides-'||rowid,'rosters.model.migrated',json_object('module','rosters','type','roster_publication_overrides','id',CAST(rowid AS TEXT)),
 json_object('version_id',version_id,'draft_version',draft_version,'actor_member_id',actor_member_id,'issues_json',issues_json,'reason',reason,'confirmation',confirmation,'request_id',request_id,'created_at',created_at),'旧排班事实完整保存，切换通常可用时间与按周例外',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM roster_publication_overrides;
INSERT INTO audit_events(id,action,source_ref,before_json,reason,occurred_at)
 SELECT 'v12-schedule-roster_versions-'||rowid,'rosters.model.migrated',json_object('module','rosters','type','roster_versions','id',CAST(rowid AS TEXT)),
 json_object('id',id,'task_id',task_id,'status',status,'version',version,'rule_version',rule_version,'algorithm_version',algorithm_version,'input_snapshot_ref',input_snapshot_ref,'solver_status',solver_status,'validation_result',validation_result,'published_at',published_at,'created_at',created_at),'旧排班事实完整保存，切换通常可用时间与按周例外',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM roster_versions;
INSERT INTO audit_events(id,action,source_ref,before_json,reason,occurred_at)
 SELECT 'v12-schedule-availability-'||rowid,'rosters.model.migrated',json_object('module','rosters','type','availability','id',CAST(rowid AS TEXT)),
 json_object('id',id,'task_id',task_id,'member_id',member_id,'business_date',business_date,'start_at',start_at,'end_at',end_at,'campus_id',campus_id,'revision',revision),'旧排班事实完整保存，切换通常可用时间与按周例外',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM availability;
INSERT INTO audit_events(id,action,source_ref,before_json,reason,occurred_at)
 SELECT 'v12-schedule-roster_submissions-'||rowid,'rosters.model.migrated',json_object('module','rosters','type','roster_submissions','id',CAST(rowid AS TEXT)),
 json_object('task_id',task_id,'member_id',member_id,'revision',revision,'submitted_at',submitted_at,'unavailable',unavailable,'source',source),'旧排班事实完整保存，切换通常可用时间与按周例外',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM roster_submissions;
INSERT INTO audit_events(id,action,source_ref,before_json,reason,occurred_at)
 SELECT 'v12-schedule-roster_preference_history-'||rowid,'rosters.model.migrated',json_object('module','rosters','type','roster_preference_history','id',CAST(rowid AS TEXT)),
 json_object('member_id',member_id,'duty_type',duty_type,'revision',revision,'enabled',enabled,'windows',windows,'unavailable',unavailable,'source_task_id',source_task_id,'updated_at',updated_at),'旧排班事实完整保存，切换通常可用时间与按周例外',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM roster_preference_history;
INSERT INTO audit_events(id,action,source_ref,before_json,reason,occurred_at)
 SELECT 'v12-schedule-roster_availability_preferences-'||rowid,'rosters.model.migrated',json_object('module','rosters','type','roster_availability_preferences','id',CAST(rowid AS TEXT)),
 json_object('member_id',member_id,'duty_type',duty_type,'enabled',enabled,'windows',windows,'unavailable',unavailable,'source_task_id',source_task_id,'revision',revision,'updated_at',updated_at),'旧排班事实完整保存，切换通常可用时间与按周例外',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM roster_availability_preferences;
INSERT INTO audit_events(id,action,source_ref,before_json,reason,occurred_at)
 SELECT 'v12-schedule-roster_collection_series-'||rowid,'rosters.model.migrated',json_object('module','rosters','type','roster_collection_series','id',CAST(rowid AS TEXT)),
 json_object('id',id,'owner_member_id',owner_member_id,'template_task_id',template_task_id,'enabled',enabled,'publish_weekday',publish_weekday,'publish_time',publish_time,'deadline_weekday',deadline_weekday,'deadline_time',deadline_time,'next_week',next_week,'next_publish_at',next_publish_at,'revision',revision,'last_error',last_error,'name',name,'current_week',current_week),'旧排班事实完整保存，切换通常可用时间与按周例外',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM roster_collection_series;
INSERT INTO audit_events(id,action,source_ref,before_json,reason,occurred_at)
 SELECT 'v12-schedule-roster_staffing_requirements-'||rowid,'rosters.model.migrated',json_object('module','rosters','type','roster_staffing_requirements','id',CAST(rowid AS TEXT)),
 json_object('task_id',task_id,'business_date',business_date,'campus_id',campus_id,'ordinary_minimum',ordinary_minimum),'旧排班事实完整保存，切换通常可用时间与按周例外',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM roster_staffing_requirements;
INSERT INTO audit_events(id,action,source_ref,before_json,reason,occurred_at)
 SELECT 'v12-schedule-roster_command_receipts-'||rowid,'rosters.model.migrated',json_object('module','rosters','type','roster_command_receipts','id',CAST(rowid AS TEXT)),
 json_object('request_id',request_id,'actor_member_id',actor_member_id,'command',command,'resource_id',resource_id,'payload',payload,'created_at',created_at),'旧排班事实完整保存，切换通常可用时间与按周例外',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM roster_command_receipts;
INSERT INTO audit_events(id,action,source_ref,before_json,reason,occurred_at)
 SELECT 'v12-schedule-roster_tasks-'||rowid,'rosters.model.migrated',json_object('module','rosters','type','roster_tasks','id',CAST(rowid AS TEXT)),
 json_object('id',id,'week_start',week_start,'campus_scope',campus_scope,'slot_start',slot_start,'slot_end',slot_end,'member_ids',member_ids,'deadline',deadline,'description',description,'revision',revision,'created_by_member_id',created_by_member_id,'created_at',created_at,'duty_type',duty_type,'rule_version',rule_version,'collection_closed_at',collection_closed_at,'workflow_version',workflow_version,'series_id',series_id,'collection_opens_at',collection_opens_at),'旧排班事实完整保存，切换通常可用时间与按周例外',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM roster_tasks;

CREATE TABLE roster_weeks (
 id TEXT PRIMARY KEY,week_start TEXT NOT NULL,campus_id TEXT NOT NULL REFERENCES campuses(id),
 duty_type TEXT NOT NULL CHECK(duty_type IN ('repair','office')),revision INTEGER NOT NULL DEFAULT 0,
 published_at TEXT,updated_at TEXT NOT NULL,updated_by TEXT REFERENCES staff_accounts(account),
 UNIQUE(week_start,campus_id,duty_type)
);
INSERT INTO roster_weeks(id,week_start,campus_id,duty_type,published_at,updated_at)
 SELECT 'week-'||t.week_start||'-'||a.campus_id||'-'||a.duty_type,t.week_start,a.campus_id,a.duty_type,
 MAX(CASE WHEN v.status='published' THEN v.published_at END),MAX(v.created_at)
 FROM duty_assignments a JOIN roster_versions v ON v.id=a.version_id JOIN roster_tasks t ON t.id=v.task_id
 GROUP BY t.week_start,a.campus_id,a.duty_type;
CREATE TABLE _schedule_assignments AS
 SELECT a.id,'week-'||t.week_start||'-'||a.campus_id||'-'||a.duty_type AS week_id,a.member_id,a.business_date,a.campus_id,a.duty_type,a.start_at,a.end_at,a.revision,
 CASE v.status WHEN 'published' THEN 1 ELSE 0 END AS active,v.created_at AS created_at,COALESCE(v.published_at,v.created_at) AS updated_at,
 COALESCE(a.origin_assignment_id,a.id) AS origin_id
 FROM duty_assignments a JOIN roster_versions v ON v.id=a.version_id JOIN roster_tasks t ON t.id=v.task_id;
CREATE TABLE _schedule_leaves AS
 SELECT l.id||'-'||a.id AS id,a.id AS assignment_id,l.member_id,l.reason,l.created_at AS recorded_at,l.revision
 FROM roster_leave_facts l JOIN _schedule_assignments a ON a.origin_id=l.origin_assignment_id AND a.member_id=l.member_id AND a.active=1
 WHERE l.status IN ('pending','approved');
CREATE TABLE _schedule_covers AS
 SELECT s.* FROM swap_requests s JOIN _schedule_assignments a ON a.id=s.from_assignment_id AND a.active=1 AND a.member_id=s.from_member_id
 JOIN _schedule_assignments b ON b.id=s.to_assignment_id AND b.active=1 AND b.member_id=s.to_member_id
 WHERE s.status='pending' AND a.revision=s.from_revision AND b.revision=s.to_revision;
CREATE TABLE member_availability (
 member_id TEXT NOT NULL REFERENCES members(id),duty_type TEXT NOT NULL CHECK(duty_type IN ('repair','office')),
 week_start TEXT NOT NULL DEFAULT '',windows TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(windows)),
 revision INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL,PRIMARY KEY(member_id,duty_type,week_start)
);
INSERT INTO member_availability(member_id,duty_type,windows,revision,updated_at)
 SELECT member_id,duty_type,CASE unavailable WHEN 1 THEN '[]' ELSE windows END,revision,updated_at FROM roster_availability_preferences WHERE enabled=1;
INSERT INTO member_availability(member_id,duty_type,week_start,windows,updated_at)
 SELECT s.member_id,t.duty_type,t.week_start,
 COALESCE((SELECT json_group_array(json_object('weekday',((CAST(strftime('%w',a.business_date) AS INTEGER)+6)%7+1),'campusId',a.campus_id,'startAt',a.start_at,'endAt',a.end_at))
 FROM availability a JOIN roster_tasks x ON x.id=a.task_id JOIN roster_submissions z ON z.task_id=x.id AND z.member_id=a.member_id
 WHERE a.member_id=s.member_id AND x.week_start=t.week_start AND x.duty_type=t.duty_type AND z.source='manual' AND z.unavailable=0),'[]'),MAX(s.submitted_at)
 FROM roster_submissions s JOIN roster_tasks t ON t.id=s.task_id WHERE s.source='manual' GROUP BY s.member_id,t.duty_type,t.week_start;
DROP VIEW roster_leave_facts;

DROP TRIGGER assignment_lineage_revision;
DROP TRIGGER swap_accept_guard;
DROP TRIGGER roster_task_workflow_overlap;
DROP TRIGGER roster_preserve_attended;
DROP TRIGGER roster_preference_created;
DROP TRIGGER roster_preference_changed;
DROP TRIGGER roster_publication_schedule_guard;
DROP TRIGGER roster_repair_minimum_publish;
DROP TRIGGER service_day_roster_publish;
PRAGMA defer_foreign_keys=ON;
DROP TABLE swap_requests;
DROP TABLE leave_requests;
DROP TABLE duty_roles;
DROP TABLE duty_assignments;
DROP TABLE roster_publication_overrides;
DROP TABLE roster_versions;
DROP TABLE availability;
DROP TABLE roster_submissions;
DROP TABLE roster_preference_history;
DROP TABLE roster_availability_preferences;
DROP TABLE roster_collection_series;
DROP TABLE roster_staffing_requirements;
DROP TABLE roster_command_receipts;
DROP TABLE roster_command_guards;
DROP TABLE roster_tasks;

CREATE TABLE duty_assignments (
 id TEXT PRIMARY KEY,week_id TEXT NOT NULL REFERENCES roster_weeks(id),member_id TEXT NOT NULL REFERENCES members(id),
 business_date TEXT NOT NULL,campus_id TEXT NOT NULL REFERENCES campuses(id),duty_type TEXT NOT NULL CHECK(duty_type IN ('repair','office')),
 start_at TEXT NOT NULL,end_at TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,CHECK(start_at<end_at)
);
INSERT INTO duty_assignments SELECT id,week_id,member_id,business_date,campus_id,duty_type,start_at,end_at,revision,active,created_at,updated_at FROM _schedule_assignments;
CREATE INDEX idx_duty_week ON duty_assignments(week_id,active);
CREATE INDEX idx_duty_member_day ON duty_assignments(member_id,business_date,active);
CREATE TABLE roster_leaves (
 id TEXT PRIMARY KEY,assignment_id TEXT NOT NULL REFERENCES duty_assignments(id),member_id TEXT NOT NULL REFERENCES members(id),
 reason TEXT NOT NULL,recorded_at TEXT NOT NULL,withdrawn_at TEXT,revision INTEGER NOT NULL DEFAULT 0
);
INSERT INTO roster_leaves(id,assignment_id,member_id,reason,recorded_at,revision) SELECT id,assignment_id,member_id,reason,recorded_at,revision FROM _schedule_leaves;
CREATE INDEX idx_roster_leave_assignment ON roster_leaves(assignment_id,member_id,withdrawn_at);
CREATE TABLE roster_covers (
 id TEXT PRIMARY KEY,assignment_id TEXT NOT NULL REFERENCES duty_assignments(id),exchange_assignment_id TEXT REFERENCES duty_assignments(id),
 from_member_id TEXT NOT NULL REFERENCES members(id),to_member_id TEXT NOT NULL REFERENCES members(id),
 assignment_revision INTEGER NOT NULL,exchange_revision INTEGER,status TEXT NOT NULL CHECK(status IN ('pending','accepted','declined','cancelled')),
 note TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,decided_at TEXT
);
INSERT INTO roster_covers(id,assignment_id,exchange_assignment_id,from_member_id,to_member_id,assignment_revision,exchange_revision,status,note,revision,created_at)
 SELECT id,from_assignment_id,to_assignment_id,from_member_id,to_member_id,from_revision,to_revision,status,note,revision,created_at FROM _schedule_covers;
UPDATE audit_events SET after_json=json_object('disposition',CASE WHEN json_extract(before_json,'$.id') IN (SELECT id FROM roster_covers) THEN 'pending_recipient_confirmation' ELSE 'archived_no_active_exchange' END)
 WHERE action='rosters.model.migrated' AND json_extract(source_ref,'$.type')='swap_requests';
UPDATE audit_events SET after_json=json_object('disposition',CASE WHEN EXISTS(SELECT 1 FROM roster_leaves l WHERE l.id LIKE json_extract(audit_events.before_json,'$.id')||'-%') THEN 'recorded_leave' ELSE 'archived_history' END)
 WHERE action='rosters.model.migrated' AND json_extract(source_ref,'$.type')='leave_requests';
CREATE INDEX idx_roster_cover_recipient ON roster_covers(to_member_id,status);
DROP TABLE _schedule_covers;
DROP TABLE _schedule_leaves;
DROP TABLE _schedule_assignments;
-- Removed publication rules and questionnaire permissions are history, not active configuration.
INSERT INTO audit_events(id,action,source_ref,before_json,reason,occurred_at)
 SELECT 'v12-roster-rule-'||rowid,'rosters.rule.archived',json_object('module','rosters','type','rule','id',rule_code),
 json_object('code',rule_code,'version',version,'parameters',parameters,'schemaVersion',schema_version,'effectiveAt',effective_at,'retiredAt',retired_at),
 '改为负责人直接发布和调整周班表',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM business_rule_versions WHERE rule_code LIKE 'roster.%';
DELETE FROM business_rule_versions WHERE rule_code LIKE 'roster.%';
INSERT INTO audit_events(id,action,source_ref,before_json,reason,occurred_at)
 SELECT 'v12-roster-permission-'||code,'rosters.permission.archived',json_object('module','rosters','type','permission','id',code),
 json_object('code',code,'name',name,'description',description,'scopeKinds',scope_kinds,'conditionKinds',condition_kinds),'排班按任职和校区统一管理',strftime('%Y-%m-%dT%H:%M:%fZ','now')
 FROM permission_definitions WHERE code IN ('roster.repair.manage','roster.office.manage','roster.repair.configure','leave.review');
DELETE FROM role_grants WHERE permission_code IN ('roster.repair.manage','roster.office.manage','roster.repair.configure','leave.review');
DELETE FROM permission_definitions WHERE code IN ('roster.repair.manage','roster.office.manage','roster.repair.configure','leave.review');
INSERT INTO permission_definitions(code,module_code,name,description,scope_kinds,condition_kinds,sensitive)
 VALUES('roster.manage','rosters','排班管理','发布和调整授权校区排班','["campus"]','[]',0);
INSERT INTO staff_release_markers VALUES('weekly-schedule-0048',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
