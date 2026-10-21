import { parseJson } from '../../platform/contracts.js';
import { nowIso } from '../../platform/time.js';
import { intersectScopes } from '../../modules/authorization/scopes.js';
import { rosterFingerprintSql } from '.././roster-fingerprint.js';
import {
  assignmentLeaveColumn,
  rosterTaskColumns,
  rows,
  json,
  membership,
  profile,
  assignment
} from './shared.js';

export function rostersDomain({ db, collection, auditStatement, commandAuthorization }) {
  async function officeRosterMemberIds(weekStart, campusIds) {
    const campusNames = campusIds.map(
      (value) => ({ 'campus-nanhu': '南湖', 'campus-hunnan': '浑南' })[value] || value
    );
    return rows(
      await db
        .prepare(
          `SELECT DISTINCT m.id FROM members m JOIN member_work_profiles p ON p.member_id=m.id
      WHERE m.status='active' AND p.profile_code='office' AND p.effective_from<=date(?,'+3 day')
      AND (p.effective_to IS NULL OR p.effective_to>?) AND EXISTS(SELECT 1 FROM staff_accounts sa JOIN staff_campus_grants g ON g.account=sa.account
        WHERE sa.member_id=m.id AND sa.status='enabled' AND g.campus IN (${campusNames.map(() => '?').join(',')}))
      ORDER BY m.name,m.id LIMIT 301`
        )
        .bind(weekStart, weekStart, ...campusNames)
        .all()
    ).map((row) => row.id);
  }

  async function rosterMemberFacts(memberIds, weekStart) {
    const facts = new Map();
    for (let offset = 0; offset < memberIds.length; offset += 80) {
      const ids = memberIds.slice(offset, offset + 80),
        placeholders = ids.map(() => '?').join(',');
      const results = await db.batch([
        db
          .prepare(
            `SELECT m.id,m.name,m.student_id,m.status,MAX(CASE WHEN sa.status='enabled' THEN 1 ELSE 0 END) AS enabled,
          (SELECT role FROM staff_accounts WHERE member_id=m.id AND status='enabled' ORDER BY account LIMIT 1) AS role
          FROM members m LEFT JOIN staff_accounts sa ON sa.member_id=m.id WHERE m.id IN (${placeholders}) GROUP BY m.id`
          )
          .bind(...ids),
        db
          .prepare(
            `SELECT DISTINCT sa.member_id,g.campus FROM staff_accounts sa JOIN staff_campus_grants g ON g.account=sa.account
          WHERE sa.member_id IN (${placeholders}) AND sa.status='enabled'`
          )
          .bind(...ids),
        db
          .prepare(
            `SELECT * FROM member_work_profiles WHERE member_id IN (${placeholders}) AND effective_from<=date(?,'+6 day')
          AND (effective_to IS NULL OR effective_to>?)`
          )
          .bind(...ids, weekStart, weekStart),
        db
          .prepare(
            `SELECT da.*,rv.task_id FROM duty_assignments da JOIN roster_versions rv ON rv.id=da.version_id AND rv.status='published'
          WHERE da.member_id IN (${placeholders}) AND da.business_date>=? AND da.business_date<=date(?,'+6 day')`
          )
          .bind(...ids, weekStart, weekStart),
        db
          .prepare(
            `SELECT mm.*,d.name AS department_name FROM member_department_memberships mm JOIN departments d ON d.id=mm.department_id
          WHERE mm.member_id IN (${placeholders}) AND mm.effective_from<=date(?,'+6 day') AND (mm.effective_to IS NULL OR mm.effective_to>?) ORDER BY mm.is_primary DESC,d.name`
          )
          .bind(...ids, weekStart, weekStart),
        db
          .prepare(
            `SELECT mr.member_id,mr.effective_from AS binding_from,mr.effective_to AS binding_to,mr.scope_bindings,r.code AS role_code,rg.*
          FROM member_roles mr JOIN roles r ON r.id=mr.role_id AND r.enabled=1 JOIN role_grants rg ON rg.role_id=r.id
          WHERE mr.member_id IN (${placeholders}) AND mr.effective_from<=date(?,'+6 day') AND (mr.effective_to IS NULL OR mr.effective_to>?)`
          )
          .bind(...ids, weekStart, weekStart)
      ]);
      for (const row of rows(results[0]))
        facts.set(row.id, {
          memberId: row.id,
          name: row.name,
          studentId: row.student_id,
          role: row.role,
          active: row.status === 'active' && !!row.enabled,
          campuses: [],
          profiles: [],
          assignments: [],
          departmentNames: [],
          memberships: [],
          grants: []
        });
      for (const row of rows(results[1])) facts.get(row.member_id)?.campuses.push(row.campus);
      for (const row of rows(results[2])) facts.get(row.member_id)?.profiles.push(profile(row));
      for (const row of rows(results[3]))
        facts.get(row.member_id)?.assignments.push({ ...assignment(row), taskId: row.task_id });
      for (const row of rows(results[4])) {
        const fact = facts.get(row.member_id);
        if (fact) {
          fact.memberships.push(membership(row));
          if (!fact.departmentNames.includes(row.department_name))
            fact.departmentNames.push(row.department_name);
        }
      }
      for (const row of rows(results[5]))
        facts.get(row.member_id)?.grants.push({
          id: row.id,
          roleId: row.role_id,
          roleCode: row.role_code,
          permissionCode: row.permission_code,
          scope: intersectScopes(parseJson(row.scope_spec, {}), parseJson(row.scope_bindings, {})),
          conditions: parseJson(row.condition_spec, []),
          validity: parseJson(row.validity_spec, {}),
          binding: { effectiveFrom: row.binding_from, effectiveTo: row.binding_to }
        });
    }
    return [...facts.values()];
  }

  async function rosterTaskById(id) {
    return rosterTask(
      await db
        .prepare(`SELECT ${rosterTaskColumns} FROM roster_tasks rt WHERE rt.id=?`)
        .bind(id)
        .first()
    );
  }

  async function memberCampuses(memberId) {
    return rows(
      await db
        .prepare(
          `SELECT DISTINCT scg.campus FROM staff_campus_grants scg
      JOIN staff_accounts sa ON sa.account=scg.account WHERE sa.member_id=? AND sa.status='enabled'`
        )
        .bind(memberId)
        .all()
    ).map((row) => row.campus);
  }

  async function createRosterTask(input, actorMemberId) {
    const id = input.id || crypto.randomUUID();
    const at = nowIso();
    await db.batch([
      ...(input.commandRecord
        ? [collection.rosterVersionGuard(input.commandRecord, '1=1', [])]
        : []),
      db
        .prepare(
          `INSERT INTO roster_tasks(id,week_start,campus_scope,slot_start,slot_end,member_ids,deadline,description,created_by_member_id,created_at,duty_type,rule_version,workflow_version,series_id,collection_opens_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .bind(
          id,
          input.weekStart,
          json(input.campusScope, {}),
          input.slotStart,
          input.slotEnd,
          json(input.memberIds, []),
          input.deadline,
          input.description || '',
          actorMemberId,
          at,
          input.dutyType || 'repair',
          input.dutyType === 'office'
            ? input.workflowVersion === 1
              ? 'office-daily-v2'
              : 'office-daily-v1'
            : 'repair-minimum-v2',
          input.workflowVersion || 0,
          input.seriesId || (input.recurrence?.enabled ? id : null),
          input.collectionOpensAt || null
        ),
      ...(input.requirements || []).map((item) =>
        db
          .prepare(
            'INSERT INTO roster_staffing_requirements(task_id,business_date,campus_id,ordinary_minimum) VALUES(?,?,?,?)'
          )
          .bind(id, item.businessDate, item.campusId, item.ordinaryMinimum)
      ),
      ...(input.commandRecord
        ? [
            collection.rosterVersionReceipt(input.commandRecord, 'create-task', id, {
              signature: input.commandSignature
            })
          ]
        : []),
      ...(input.recurrence?.enabled
        ? [
            db
              .prepare(
                'INSERT INTO roster_collection_series(id,owner_member_id,template_task_id,publish_weekday,publish_time,deadline_weekday,deadline_time,next_week,next_publish_at,name) VALUES(?,?,?,?,?,?,?,?,?,?)'
              )
              // Legacy queue columns remain for schema compatibility only; no queue is populated.
              .bind(
                id,
                actorMemberId,
                id,
                input.recurrence.publishWeekday,
                input.recurrence.publishTime,
                input.recurrence.deadlineWeekday,
                input.recurrence.deadlineTime,
                input.weekStart,
                '',
                input.collectionName || ''
              )
          ]
        : []),
      ...(input.commandRecord
        ? [
            collection.rosterAudit(input.commandRecord, 'rosters.task.created', id, {
              weekStart: input.weekStart,
              campusScope: input.campusScope
            }),
            db.prepare('DELETE FROM roster_command_guards')
          ]
        : [])
    ]);
    return rosterTaskById(id);
  }

  function rosterTask(row) {
    return row
      ? {
          id: row.id,
          collectionOpensAt: row.collection_opens_at || null,
          collectionName: row.collection_name || '',
          seriesId: row.series_id || '',
          dutyType: row.duty_type || 'repair',
          workflowVersion: row.workflow_version || 0,
          collectionClosedAt: row.collection_closed_at,
          ruleVersion: row.rule_version || 'legacy',
          requirements: parseJson(row.requirements_json, []),
          weekStart: row.week_start,
          campusScope: parseJson(row.campus_scope, {}),
          slotStart: row.slot_start,
          slotEnd: row.slot_end,
          memberIds: parseJson(row.member_ids, []),
          deadline: row.deadline,
          description: row.description,
          revision: row.revision,
          createdAt: row.created_at
        }
      : null;
  }

  async function listRosterTasks() {
    const result = await db
      .prepare(
        `SELECT ${rosterTaskColumns} FROM roster_tasks rt ORDER BY rt.week_start DESC,rt.id DESC LIMIT 101`
      )
      .all();
    return rows(result).map(rosterTask);
  }

  async function saveRosterRequirements(task, input, auditRecord) {
    const authorization = commandAuthorization(auditRecord);
    const guard = 'EXISTS(SELECT 1 FROM roster_tasks WHERE id=? AND revision=?)';
    // Guard every dependent write with the new revision and the authorized
    // command marker. A stale command must not replace another editor's demand.
    const marker = crypto.randomUUID();
    const gate = `${guard} AND EXISTS(SELECT 1 FROM audit_events WHERE id=? AND action='rosters.requirements.updated')`;
    const statements = [
      db
        .prepare(
          `UPDATE roster_tasks SET revision=revision+1,rule_version=CASE WHEN duty_type='office' THEN 'office-daily-v2' ELSE 'repair-minimum-v2' END WHERE id=? AND revision=? ${authorization.sql}`
        )
        .bind(task.id, input.revision, ...authorization.args),
      auditStatement({ ...auditRecord, id: marker }, true),
      db
        .prepare(`DELETE FROM roster_staffing_requirements WHERE task_id=? AND ${gate}`)
        .bind(task.id, task.id, input.revision + 1, marker)
    ];
    for (const item of input.requirements)
      statements.push(
        db
          .prepare(
            `INSERT INTO roster_staffing_requirements(task_id,business_date,campus_id,ordinary_minimum) SELECT ?,?,?,? WHERE ${gate}`
          )
          .bind(
            task.id,
            item.businessDate,
            item.campusId,
            item.ordinaryMinimum,
            task.id,
            input.revision + 1,
            marker
          )
      );
    const result = await db.batch(statements);
    return result[0]?.meta?.changes ? rosterTaskById(task.id) : null;
  }

  async function saveAvailability(taskId, memberId, input) {
    const id = input.id || crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO availability(id,task_id,member_id,business_date,start_at,end_at,campus_id,revision) VALUES(?,?,?,?,?,?,?,0)
      ON CONFLICT(task_id,member_id,business_date,start_at,end_at,campus_id) DO UPDATE SET revision=availability.revision+1`
      )
      .bind(
        id,
        taskId,
        memberId,
        input.businessDate,
        input.startAt,
        input.endAt,
        input.campusId || null
      )
      .run();
    const result = await db
      .prepare(
        'SELECT * FROM availability WHERE task_id=? AND member_id=? ORDER BY business_date,start_at'
      )
      .bind(taskId, memberId)
      .all();
    return rows(result).map((row) => ({
      id: row.id,
      taskId: row.task_id,
      memberId: row.member_id,
      businessDate: row.business_date,
      startAt: row.start_at,
      endAt: row.end_at,
      campusId: row.campus_id,
      revision: row.revision
    }));
  }

  async function availability(taskId) {
    const result = await db
      .prepare('SELECT * FROM availability WHERE task_id=? ORDER BY business_date,start_at')
      .bind(taskId)
      .all();
    return rows(result).map((row) => ({
      id: row.id,
      taskId: row.task_id,
      memberId: row.member_id,
      businessDate: row.business_date,
      startAt: row.start_at,
      endAt: row.end_at,
      campusId: row.campus_id,
      revision: row.revision
    }));
  }

  async function createRosterVersion(input) {
    const id = input.id || crypto.randomUUID();
    const at = nowIso();
    const statements = [
      db
        .prepare(
          `INSERT INTO roster_versions(id,task_id,status,version,rule_version,algorithm_version,input_snapshot_ref,solver_status,validation_result,created_at) SELECT ?,?,?,COALESCE(MAX(version),0)+1,?,?,?,?,?,? FROM roster_versions WHERE task_id=?`
        )
        .bind(
          id,
          input.taskId,
          input.status || 'draft',
          input.ruleVersion || '1.0.0',
          input.algorithmVersion || 'deterministic-greedy-v1',
          json(input.inputSnapshotRef, {}),
          input.solverStatus || 'feasible',
          json(input.validation, {}),
          at,
          input.taskId
        )
    ];
    statements.push(
      db
        .prepare(
          "UPDATE roster_versions SET status='superseded' WHERE task_id=? AND status='draft' AND id<>?"
        )
        .bind(input.taskId, id)
    );
    for (const item of input.assignments || []) {
      const assignmentId = item.id || crypto.randomUUID();
      statements.push(
        db
          .prepare(
            `INSERT INTO duty_assignments(id,version_id,member_id,business_date,campus_id,duty_type,start_at,end_at,origin_assignment_id)
        VALUES(?,?,?,?,?,?,?,?,(SELECT COALESCE(da.origin_assignment_id,da.id) FROM duty_assignments da JOIN roster_versions rv ON rv.id=da.version_id
          WHERE rv.status='published' AND rv.task_id=? AND da.member_id=? AND da.business_date=? AND da.campus_id=? AND da.duty_type=? AND da.start_at=? AND da.end_at=? LIMIT 1))`
          )
          .bind(
            assignmentId,
            id,
            item.memberId,
            item.businessDate,
            item.campusId,
            item.dutyType || 'repair',
            item.startAt,
            item.endAt,
            input.taskId,
            item.memberId,
            item.businessDate,
            item.campusId,
            item.dutyType || 'repair',
            item.startAt,
            item.endAt
          )
      );
      if (item.roleKind)
        statements.push(
          db
            .prepare(
              'INSERT INTO duty_roles(id,assignment_id,role_kind,effective_range) VALUES(?,?,?,?)'
            )
            .bind(
              `duty-role-${assignmentId}-${item.roleKind}`,
              assignmentId,
              item.roleKind,
              json(item.effectiveRange || {})
            )
        );
    }
    if (input.commandRecord) {
      statements.unshift(
        collection.rosterVersionGuard(
          input.commandRecord,
          `EXISTS(SELECT 1 FROM roster_tasks WHERE id=? AND revision=? ${input.requireClosed ? "AND (collection_closed_at IS NOT NULL OR julianday(deadline)<=julianday('now'))" : ''})`,
          [input.taskId, input.inputSnapshotRef.eligibility.taskRevision]
        )
      );
      statements.push(
        collection.rosterVersionReceipt(input.commandRecord, input.commandRecord.command, id, {
          taskId: input.taskId
        }),
        collection.rosterAudit(
          input.commandRecord,
          input.commandRecord.command === 'revise' ? 'rosters.revised' : 'rosters.generated',
          input.taskId,
          { versionId: id }
        ),
        db.prepare('DELETE FROM roster_command_guards')
      );
    }
    await db.batch(statements);
    return rosterVersion(
      await db.prepare('SELECT * FROM roster_versions WHERE id=?').bind(id).first()
    );
  }

  function rosterVersion(row) {
    return row
      ? {
          id: row.id,
          taskId: row.task_id,
          status: row.status,
          version: row.version,
          ruleVersion: row.rule_version,
          algorithmVersion: row.algorithm_version,
          inputSnapshotRef: parseJson(row.input_snapshot_ref, {}),
          solverStatus: row.solver_status,
          validation: parseJson(row.validation_result, {}),
          publishedAt: row.published_at,
          createdAt: row.created_at
        }
      : null;
  }

  async function rosterVersionById(id) {
    return rosterVersion(
      await db.prepare('SELECT * FROM roster_versions WHERE id=?').bind(id).first()
    );
  }

  async function rosterVersionsForTask(taskId) {
    return rows(
      await db
        .prepare('SELECT * FROM roster_versions WHERE task_id=? ORDER BY version DESC LIMIT 30')
        .bind(taskId)
        .all()
    ).map(rosterVersion);
  }

  async function versionAssignments(id) {
    return rows(
      await db
        .prepare(
          `SELECT da.*,(SELECT name FROM members WHERE id=da.member_id) AS member_name,(SELECT paused FROM service_day_overrides s WHERE s.business_date=da.business_date AND s.campus_id=da.campus_id) AS service_paused,c.name AS campus_name,dr.role_kind,${assignmentLeaveColumn},
      EXISTS(SELECT 1 FROM json_each(rv.input_snapshot_ref,'$.manualOverrides') j WHERE json_extract(j.value,'$.memberId')=da.member_id AND json_extract(j.value,'$.businessDate')=da.business_date AND json_extract(j.value,'$.campusId')=da.campus_id) AS manual_override,
      (EXISTS(SELECT 1 FROM json_each(rv.input_snapshot_ref,'$.lockedAssignments') j WHERE json_extract(j.value,'$.memberId')=da.member_id AND json_extract(j.value,'$.businessDate')=da.business_date AND json_extract(j.value,'$.campusId')=da.campus_id AND json_extract(j.value,'$.startAt')=da.start_at AND json_extract(j.value,'$.endAt')=da.end_at) OR (json_type(rv.input_snapshot_ref,'$.lockedAssignments') IS NULL AND EXISTS(SELECT 1 FROM json_each(rv.input_snapshot_ref,'$.lockedMemberIds') WHERE value=da.member_id))) AS locked
      FROM duty_assignments da JOIN roster_versions rv ON rv.id=da.version_id
      JOIN campuses c ON c.id=da.campus_id LEFT JOIN duty_roles dr ON dr.assignment_id=da.id WHERE da.version_id=?
      ORDER BY da.business_date,da.start_at,da.member_id`
        )
        .bind(id)
        .all()
    ).map((row) => ({
      ...assignment(row),
      locked: !!row.locked,
      manualOverride: !!row.manual_override
    }));
  }

  async function updateRosterDraft(id, input, revision) {
    const validation = input.validation || {
      valid: false,
      errors: [{ code: 'DRAFT_CHANGED_REQUIRES_VALIDATION' }]
    };
    // All dependent writes check the original version. Advance it last, in the same transaction.
    const guard =
      "EXISTS(SELECT 1 FROM roster_versions WHERE id=? AND version=? AND status='draft')";
    const statements = [
      db
        .prepare(
          `DELETE FROM duty_roles WHERE assignment_id IN (SELECT id FROM duty_assignments WHERE version_id=?) AND ${guard}`
        )
        .bind(id, id, revision),
      db
        .prepare(`DELETE FROM duty_assignments WHERE version_id=? AND ${guard}`)
        .bind(id, id, revision)
    ];
    for (const item of input.assignments || []) {
      const assignmentId = item.id || crypto.randomUUID();
      statements.push(
        db
          .prepare(
            `INSERT INTO duty_assignments(id,version_id,member_id,business_date,campus_id,duty_type,start_at,end_at,origin_assignment_id)
        SELECT ?,?,?,?,?,?,?,?,(SELECT COALESCE(da.origin_assignment_id,da.id) FROM duty_assignments da JOIN roster_versions rv ON rv.id=da.version_id
          WHERE rv.status='published' AND rv.task_id=(SELECT task_id FROM roster_versions WHERE id=?) AND da.member_id=? AND da.business_date=? AND da.campus_id=? AND da.duty_type=? AND da.start_at=? AND da.end_at=? LIMIT 1) WHERE ${guard}`
          )
          .bind(
            assignmentId,
            id,
            item.memberId,
            item.businessDate,
            item.campusId,
            item.dutyType || 'repair',
            item.startAt,
            item.endAt,
            id,
            item.memberId,
            item.businessDate,
            item.campusId,
            item.dutyType || 'repair',
            item.startAt,
            item.endAt,
            id,
            revision
          )
      );
      if (item.roleKind)
        statements.push(
          db
            .prepare(
              `INSERT INTO duty_roles(id,assignment_id,role_kind,effective_range)
        SELECT ?,?,?,? WHERE ${guard}`
            )
            .bind(
              `duty-role-${assignmentId}-${item.roleKind}`,
              assignmentId,
              item.roleKind,
              json(item.effectiveRange || {}),
              id,
              revision
            )
        );
    }
    statements.push(
      db
        .prepare(
          `UPDATE roster_versions SET version=version+1,validation_result=?,solver_status=?,rule_version=COALESCE(?,rule_version),input_snapshot_ref=json_set(json_remove(input_snapshot_ref,'$.optimization'),'$.lockedMemberIds',json(?),'$.lockedAssignments',json(?),'$.manualOverrides',json(?),'$.manuallyAdjusted',json('true'),'$.eligibility',json(COALESCE(?,json_extract(input_snapshot_ref,'$.eligibility'),'{}'))) WHERE id=? AND version=? AND status='draft'`
        )
        .bind(
          json(validation, {}),
          validation.valid ? 'feasible' : 'needs_review',
          input.ruleVersion || null,
          json(
            (input.assignments || []).filter((item) => item.locked).map((item) => item.memberId),
            []
          ),
          json(
            (input.assignments || []).filter((item) => item.locked),
            []
          ),
          json(
            (input.assignments || []).filter((item) => item.manualOverride),
            []
          ),
          input.eligibility ? json(input.eligibility, {}) : null,
          id,
          revision
        )
    );
    if (input.commandRecord)
      statements.unshift(
        collection.rosterVersionGuard(
          input.commandRecord,
          `EXISTS(SELECT 1 FROM roster_versions WHERE id=? AND version=? AND status='draft') ${input.fingerprint ? `AND (${rosterFingerprintSql})=?` : ''}`,
          [id, revision, ...(input.fingerprint ? [input.taskId, input.fingerprint] : [])]
        )
      );
    const updateIndex = statements.length - 1;
    if (input.commandRecord)
      statements.push(
        collection.rosterVersionReceipt(input.commandRecord, 'save', id, {
          signature: input.signature
        }),
        collection.rosterAudit(input.commandRecord, 'rosters.updated', input.taskId, {
          versionId: id,
          validation
        }),
        db.prepare('DELETE FROM roster_command_guards')
      );
    const result = await db.batch(statements);
    if (!result[updateIndex]?.meta?.changes) return null;
    return rosterVersionById(id);
  }

  async function rosterFingerprint(taskId) {
    return (await db.prepare(rosterFingerprintSql).bind(taskId).first()).fingerprint;
  }

  async function publishRoster(id, revision, auditRecord, fingerprint, override = null) {
    const at = nowIso();
    const current = await db
      .prepare(`SELECT task_id FROM roster_versions WHERE id=? AND version=? AND status='draft'`)
      .bind(id, revision)
      .first();
    if (!current) return null;
    const authorization = commandAuthorization(auditRecord);
    const result = await db.batch([
      ...(override
        ? [
            db
              .prepare(
                `INSERT INTO roster_publication_overrides(version_id,draft_version,actor_member_id,issues_json,reason,confirmation,request_id,created_at)
        SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM roster_versions WHERE id=? AND version=? AND status='draft')
        ${fingerprint ? `AND (${rosterFingerprintSql})=?` : ''} ${authorization.sql}`
              )
              .bind(
                id,
                revision,
                auditRecord.actorMemberId,
                JSON.stringify(override.issues),
                override.reason,
                override.confirmation,
                auditRecord.requestId || '',
                at,
                id,
                revision,
                ...(fingerprint ? [current.task_id, fingerprint] : []),
                ...authorization.args
              )
          ]
        : []),
      db
        .prepare(
          `UPDATE roster_versions SET status='published',published_at=? WHERE id=? AND version=? AND status='draft' AND (COALESCE(json_extract(validation_result,'$.valid'),0)=1 OR EXISTS(SELECT 1 FROM roster_publication_overrides WHERE version_id=roster_versions.id AND draft_version=roster_versions.version))
        ${fingerprint ? `AND (${rosterFingerprintSql})=?` : ''} ${authorization.sql}`
        )
        .bind(
          at,
          id,
          revision,
          ...(fingerprint ? [current.task_id, fingerprint] : []),
          ...authorization.args
        ),
      ...(auditRecord ? [auditStatement({ ...auditRecord, occurredAt: at }, true)] : []),
      db
        .prepare(
          `UPDATE roster_versions SET status='superseded' WHERE task_id=? AND status IN ('published','draft') AND id<>? AND EXISTS(SELECT 1 FROM roster_versions WHERE id=? AND status='published' AND version=?)`
        )
        .bind(current.task_id, id, id, revision)
    ]);
    return result[override ? 1 : 0]?.meta?.changes
      ? rosterVersion(await db.prepare('SELECT * FROM roster_versions WHERE id=?').bind(id).first())
      : null;
  }

  async function listAssignments(memberId, weekStart) {
    const result = await db
      .prepare(
        `SELECT da.*,(SELECT paused FROM service_day_overrides s WHERE s.business_date=da.business_date AND s.campus_id=da.campus_id) AS service_paused,c.name AS campus_name,dr.role_kind,${assignmentLeaveColumn} FROM duty_assignments da JOIN roster_versions rv ON rv.id=da.version_id AND rv.status='published' JOIN campuses c ON c.id=da.campus_id LEFT JOIN duty_roles dr ON dr.assignment_id=da.id WHERE da.member_id=? AND da.business_date>=? AND da.business_date<=date(?, '+6 day') ORDER BY da.business_date,da.start_at`
      )
      .bind(memberId, weekStart, weekStart)
      .all();
    return rows(result).map(assignment);
  }

  async function assignmentById(id) {
    const row = await db
      .prepare(
        `SELECT da.*,(SELECT paused FROM service_day_overrides s WHERE s.business_date=da.business_date AND s.campus_id=da.campus_id) AS service_paused,c.name AS campus_name,dr.role_kind,rv.status AS version_status,rv.task_id,rv.rule_version,rv.input_snapshot_ref,${assignmentLeaveColumn} FROM duty_assignments da JOIN campuses c ON c.id=da.campus_id
      JOIN roster_versions rv ON rv.id=da.version_id LEFT JOIN duty_roles dr ON dr.assignment_id=da.id WHERE da.id=?`
      )
      .bind(id)
      .first();
    return assignment(row);
  }

  async function effectiveAssignment(id, memberId) {
    const row = await db
      .prepare(
        `SELECT da.*,(SELECT paused FROM service_day_overrides s WHERE s.business_date=da.business_date AND s.campus_id=da.campus_id) AS service_paused,c.name AS campus_name,dr.role_kind,rv.status AS version_status,rv.task_id,rv.rule_version,rv.input_snapshot_ref,${assignmentLeaveColumn}
      FROM duty_assignments da JOIN roster_versions rv ON rv.id=da.version_id AND rv.status='published' JOIN campuses c ON c.id=da.campus_id
      LEFT JOIN duty_roles dr ON dr.assignment_id=da.id WHERE COALESCE(da.origin_assignment_id,da.id)=(SELECT COALESCE(original.origin_assignment_id,original.id) FROM duty_assignments original WHERE original.id=?) AND da.member_id=? LIMIT 1`
      )
      .bind(id, memberId)
      .first();
    return row ? assignment(row) : assignmentById(id);
  }

  async function swapCandidates(source) {
    const result = await db
      .prepare(
        `SELECT da.*,(SELECT paused FROM service_day_overrides s WHERE s.business_date=da.business_date AND s.campus_id=da.campus_id) AS service_paused,c.name AS campus_name,m.name AS member_name,dr.role_kind,rv.status AS version_status,rv.task_id,rv.rule_version,rv.input_snapshot_ref
      FROM duty_assignments da JOIN roster_versions rv ON rv.id=da.version_id AND rv.status='published'
      JOIN campuses c ON c.id=da.campus_id JOIN members m ON m.id=da.member_id AND m.status='active'
      LEFT JOIN duty_roles dr ON dr.assignment_id=da.id
      WHERE da.member_id<>? AND da.duty_type=? AND da.campus_id=?
      AND da.business_date>=? AND da.business_date<=date(?, '+6 day')
      AND NOT EXISTS(SELECT 1 FROM roster_leave_facts lr WHERE lr.origin_assignment_id=COALESCE(da.origin_assignment_id,da.id) AND lr.member_id=da.member_id AND lr.status IN ('pending','approved'))
      ORDER BY da.business_date,da.start_at,m.name,da.id LIMIT 200`
      )
      .bind(source.memberId, source.dutyType, source.campusId, source.weekStart, source.weekStart)
      .all();
    return rows(result).map((row) => ({ ...assignment(row), memberName: row.member_name }));
  }
  return {
    officeRosterMemberIds,
    rosterMemberFacts,
    rosterTaskById,
    memberCampuses,
    createRosterTask,
    listRosterTasks,
    saveRosterRequirements,
    saveAvailability,
    availability,
    createRosterVersion,
    rosterVersionById,
    rosterVersionsForTask,
    versionAssignments,
    updateRosterDraft,
    rosterFingerprint,
    publishRoster,
    listAssignments,
    assignmentById,
    effectiveAssignment,
    swapCandidates
  };
}
