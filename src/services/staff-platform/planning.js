import { fail } from '../../lib/http.js';
import { dateKey, weekRange, validDate, addDays } from '../../platform/time.js';
import { stableJson, publicResourceRef } from '../../platform/contracts.js';
import { generateRoster, validateRoster } from '../../modules/rosters/solver.js';
import { campusId as normalizeCampusId } from '../../modules/authorization/scopes.js';
import {
  rosterTaskManaged,
  rosterDepartments,
  rosterMemberInScope
} from '../../modules/rosters/scope.js';
import { staffIdentities } from '../../../shared/staff-identities.js';
import { repairRosterPool, rosterFactContext } from '../../modules/rosters/qualification.js';
import { rosterStage, sameAssignment } from '../../modules/rosters/workflow.js';
import { generateOfficeRoster } from '../../modules/rosters/office.ts';
import { tokenDigest, rosterEligibilitySnapshot, rosterAssignmentSnapshot } from './shared.js';
import { csvRows } from './shared.js';

export function planningDomain({
  repository,
  platform,
  calendarClock,
  collectionStatus,
  contextFor,
  commandRecord,
  applyAvailabilityContinuation,
  rosterWrite
}) {
  async function rosterInput(actor, taskId) {
    const task = await repository.rosterTaskById(taskId);
    if (!task) fail(404, '排班任务不存在');
    const campusIds = task.campusScope?.campusIds;
    if (
      !validDate(task.weekStart) ||
      weekRange(task.weekStart).start !== task.weekStart ||
      !campusIds?.length
    )
      fail(409, '该任务缺少有效的周起始日期或校区，请重新创建收集任务');
    const office = task.dutyType === 'office';
    const context = await contextFor(actor);
    if (!rosterTaskManaged(context, platform.authorizer, task))
      fail(403, '没有管理该任务全部校区与部门的权限');
    const pausedDays = await repository.serviceDays(task.weekStart, addDays(task.weekStart, 3));
    const slots = Array.from({ length: 4 }, (_, offset) =>
      campusIds.map((campusId) => ({
        businessDate: addDays(task.weekStart, offset),
        campusId,
        startAt: task.slotStart,
        endAt: task.slotEnd,
        dutyType: office ? 'office' : 'repair',
        requireLead: !office,
        ...((!office && task.ruleVersion === 'repair-minimum-v2') ||
        (office && task.workflowVersion === 1)
          ? {
              ordinaryMinimum:
                task.requirements?.find(
                  (item) =>
                    item.businessDate === addDays(task.weekStart, offset) &&
                    item.campusId === campusId
                )?.ordinaryMinimum ?? 1
            }
          : {})
      }))
    )
      .flat()
      .filter(
        (slot) =>
          !pausedDays.some(
            (day) =>
              day.paused && day.businessDate === slot.businessDate && day.campusId === slot.campusId
          )
      );
    const windows = await repository.availability(taskId);
    const memberIds = [
      ...new Set(
        task.memberIds?.length
          ? task.memberIds
          : office
            ? await repository.officeRosterMemberIds(task.weekStart, campusIds)
            : windows.map((item) => item.memberId)
      )
    ];
    if (memberIds.length > 300) fail(400, '单个排班任务最多支持 300 名成员');
    const members = [];
    const facts = await repository.rosterMemberFacts(memberIds, task.weekStart);
    for (const fact of facts) {
      if (!fact.active) continue;
      if (!slots.some((slot) => rosterMemberInScope(fact, task, slot.businessDate, slot.campusId)))
        continue;
      const memberId = fact.memberId;
      const campusAccess = fact.campuses.map(normalizeCampusId);
      const other = fact.assignments.filter((item) => item.taskId !== taskId);
      const available = [],
        manualSlots = [],
        leadSlots = [];
      let ordinaryEligible = false;
      for (const slot of slots) {
        if (
          !campusAccess.includes(slot.campusId) ||
          !rosterMemberInScope(fact, task, slot.businessDate, slot.campusId)
        )
          continue;
        const profiles = fact.profiles.filter(
          (profile) =>
            profile.effectiveFrom <= slot.businessDate &&
            (!profile.effectiveTo || slot.businessDate < profile.effectiveTo)
        );
        const departments = rosterDepartments(fact, slot.businessDate, task);
        const pools = office
          ? []
          : (departments.length ? departments : [{ departmentId: undefined }]).map((item) =>
              repairRosterPool(fact, platform.authorizer, slot.businessDate, {
                id: taskId,
                campusId: slot.campusId,
                departmentId: item.departmentId
              })
            );
        const pool = pools.includes('lead') ? 'lead' : pools.includes('ordinary') ? 'ordinary' : '';
        if (office ? !profiles.some((item) => item.profileCode === 'office') : !pool) continue;
        if (pool === 'lead') leadSlots.push(slot);
        if (pool === 'ordinary') ordinaryEligible = true;
        if (
          other.some(
            (item) =>
              item.businessDate === slot.businessDate &&
              item.startAt < slot.endAt &&
              slot.startAt < item.endAt
          )
        )
          continue;
        manualSlots.push(slot);
        if (
          other.some(
            (item) =>
              (!office && item.dutyType === 'repair') ||
              (office && item.dutyType === 'office' && item.businessDate === slot.businessDate)
          )
        )
          continue;
        if (
          (!office || task.workflowVersion === 1) &&
          !windows.some(
            (item) =>
              item.memberId === memberId &&
              item.businessDate === slot.businessDate &&
              (!item.campusId || item.campusId === slot.campusId) &&
              item.startAt <= slot.startAt &&
              item.endAt >= slot.endAt
          )
        )
          continue;
        available.push(slot);
      }
      if (office && !manualSlots.length) continue;
      if (!office && !leadSlots.length && !ordinaryEligible) continue;
      const departmentNames = [
        ...new Set(
          slots
            .flatMap((slot) =>
              rosterDepartments(fact, slot.businessDate, task).map((item) => item.departmentName)
            )
            .filter(Boolean)
        )
      ];
      const pool = !office && leadSlots.length ? 'lead' : 'ordinary';
      members.push({
        memberId,
        name: fact.name,
        studentId: fact.studentId || '',
        available:
          !office && pool === 'lead'
            ? available.filter((slot) => leadSlots.includes(slot))
            : available,
        manualSlots,
        reportedWindows: windows.filter((item) => item.memberId === memberId),
        existingAssignments: other,
        leadSlots,
        pool,
        identities: staffIdentities(rosterFactContext(fact, task.weekStart), platform.authorizer),
        departmentNames
      });
    }
    return {
      taskId,
      task,
      dutyType: task.dutyType || 'repair',
      taskRevision: task.revision,
      allSuspended: !slots.length,
      ruleVersion: task.ruleVersion || 'legacy',
      weekStart: task.weekStart,
      members,
      slots,
      requireLead: !office,
      preservedAssignments: repository.protectedRosterAssignments
        ? await repository.protectedRosterAssignments(taskId)
        : []
    };
  }

  async function rosterTaskState(actor, taskId) {
    const initial = await rosterInput(actor, taskId);
    await applyAvailabilityContinuation(initial.task);
    const source = await rosterInput(actor, taskId);
    const versions = await repository.rosterVersionsForTask(taskId);
    const latest = versions.find((item) => ['draft', 'published'].includes(item.status));
    const published = versions.find((item) => item.status === 'published');
    const assignments = latest ? await repository.versionAssignments(latest.id) : [];
    const savedEligibility = latest?.inputSnapshotRef?.eligibility;
    const savedAssignments =
      latest?.inputSnapshotRef?.optimization && latest.inputSnapshotRef.generatedAssignments;
    const sourceChanged =
      (!!savedEligibility &&
        stableJson(savedEligibility) !== stableJson(rosterEligibilitySnapshot(source))) ||
      (!!savedAssignments &&
        stableJson(savedAssignments) !== stableJson(rosterAssignmentSnapshot(assignments)));
    const submissions = repository.rosterSubmissions
      ? await repository.rosterSubmissions(taskId)
      : [];
    const audience = source.task.memberIds || [];
    const facts = audience.length
      ? await repository.rosterMemberFacts(audience, source.weekStart)
      : [];
    const progress = {
      total: audience.length,
      submitted: submissions.filter((item) => audience.includes(item.memberId)).length,
      people: facts.map((item) => ({
        memberId: item.memberId,
        name: item.name,
        active: item.active,
        submission: submissions.find((row) => row.memberId === item.memberId) || null
      })),
      coverage: source.slots.map((slot) => ({
        ...slot,
        ordinary: source.members.filter(
          (member) =>
            member.pool === 'ordinary' &&
            member.available.some((item) =>
              sameAssignment({ ...item, memberId: '' }, { ...slot, memberId: '' })
            )
        ).length,
        leads: source.members.filter(
          (member) =>
            member.pool === 'lead' &&
            member.available.some(
              (item) => item.businessDate === slot.businessDate && item.campusId === slot.campusId
            )
        ).length
      }))
    };
    const validation = validateRoster({ assignments }, source);
    const confirmation = latest
      ? await tokenDigest(
          stableJson({
            version: latest.version,
            validation,
            fingerprint: await repository.rosterFingerprint(taskId)
          })
        )
      : '';
    return {
      taskId,
      task: source.task,
      allSuspended: source.allSuspended,
      series:
        source.task.seriesId && repository.rosterSeries
          ? await repository.rosterSeries(source.task.seriesId)
          : null,
      collectionState: collectionStatus(source.task),
      stage: rosterStage(source.task, versions, calendarClock().getTime()),
      progress,
      protectedAssignments: repository.protectedRosterAssignments
        ? await repository.protectedRosterAssignments(taskId)
        : [],
      publishedVersion: published || null,
      dutyType: source.dutyType,
      ruleVersion: source.ruleVersion,
      requiresRuleConfirmation:
        source.dutyType !== 'office' && source.ruleVersion !== 'repair-minimum-v2',
      members: source.members,
      slots: source.slots,
      draft: latest ? { ...latest, assignments, sourceChanged, validation, confirmation } : null,
      publishedAssignments: published ? await repository.versionAssignments(published.id) : []
    };
  }

  async function generate(actor, input) {
    const task = await repository.rosterTaskById(input.taskId);
    if (task) {
      const context = await contextFor(actor);
      if (rosterTaskManaged(context, platform.authorizer, task))
        await applyAvailabilityContinuation(task);
    }
    const source = await rosterInput(actor, input.taskId);
    if (source.task.workflowVersion === 1 && collectionStatus(source.task) !== 'closed')
      fail(409, '请先结束收集，再生成自动排班');
    const context = await contextFor(actor),
      record = commandRecord(actor, context, input);
    record.command = 'generate';
    if (repository.rosterCommandReceipt) {
      const replay = await repository.rosterCommandReceipt(
        record.actorMemberId,
        record.command,
        record.requestId
      );
      if (replay) {
        if (JSON.parse(replay.payload).taskId !== input.taskId) fail(409, '请求编号已用于其他任务');
        return { version: await repository.rosterVersionById(replay.resourceId), idempotent: true };
      }
    }
    if (source.dutyType !== 'office' && source.ruleVersion !== 'repair-minimum-v2')
      fail(409, '旧任务需先确认每日最低人员需求，再生成新规则草稿');
    const previous = (await repository.rosterVersionsForTask(source.taskId)).find((item) =>
      ['draft', 'published'].includes(item.status)
    );
    source.locked = previous
      ? (await repository.versionAssignments(previous.id)).filter(
          (item) =>
            item.locked || source.preservedAssignments.some((row) => sameAssignment(row, item))
        )
      : [];
    const published = (await repository.rosterVersionsForTask(source.taskId)).find(
      (item) => item.status === 'published'
    );
    if (published)
      for (const item of await repository.versionAssignments(published.id))
        if (
          source.preservedAssignments.some((row) => sameAssignment(row, item)) &&
          !source.locked.some((row) => sameAssignment(row, item))
        )
          source.locked.push({ ...item, locked: true });
    const suspendedLocks = source.locked.filter(
      (item) =>
        !source.slots.some((slot) => sameAssignment({ ...slot, memberId: item.memberId }, item))
    );
    const solverSource = {
      ...source,
      locked: source.locked.filter((item) => !suspendedLocks.includes(item)),
      members: source.members.map((member) => ({
        ...member,
        available: member.available.filter(
          (slot) =>
            !suspendedLocks.some(
              (item) =>
                item.memberId === member.memberId &&
                (source.dutyType !== 'office' || item.businessDate === slot.businessDate)
            )
        )
      }))
    };
    const result =
      source.dutyType === 'office'
        ? source.task.workflowVersion === 1
          ? generateOfficeRoster(solverSource)
          : {
              assignments: previous ? await repository.versionAssignments(previous.id) : [],
              ruleVersion: 'office-daily-v1',
              algorithmVersion: 'manual-office-v1',
              solverStatus: 'needs_review',
              inputSnapshotRef: { dutyType: 'office' }
            }
        : generateRoster(solverSource);
    for (const item of suspendedLocks)
      if (!result.assignments.some((row) => sameAssignment(row, item)))
        result.assignments.push({ ...item, locked: true });
    const beforeLeaves = result.assignments.map((item) => item.leaveStatus || '');
    result.assignments = await inheritAssignmentLeaves(source.taskId, result.assignments);
    if (
      result.inputSnapshotRef.optimization &&
      result.assignments.some((item, index) => (item.leaveStatus || '') !== beforeLeaves[index])
    ) {
      result.inputSnapshotRef.optimization = {
        ...result.inputSnapshotRef.optimization,
        complete: false,
        reason: 'attendance_changed',
        objective: null
      };
      result.solverStatus = 'feasible';
    }
    const validation = validateRoster(result, source);
    result.solverStatus = validation.valid
      ? result.solverStatus === 'optimal'
        ? 'optimal'
        : 'feasible'
      : 'needs_review';
    const version = await rosterWrite(async () =>
      repository.createRosterVersion({
        taskId: source.taskId,
        assignments: result.assignments.map((item) => ({ ...item, id: undefined })),
        commandRecord: record,
        requireClosed: source.task.workflowVersion === 1,
        inputSnapshotRef: {
          ...result.inputSnapshotRef,
          publicationBase:
            (await repository.rosterVersionsForTask(source.taskId)).find(
              (item) => item.status === 'published'
            )?.id || '',
          manualOverrides: result.assignments.filter((item) => item.manualOverride),
          eligibility: rosterEligibilitySnapshot(source),
          generatedAssignments: rosterAssignmentSnapshot(result.assignments),
          lockedAssignments: source.locked,
          taskRevision: source.taskRevision,
          lockedMemberIds: source.locked.map((item) => item.memberId)
        },
        ruleVersion: result.ruleVersion,
        algorithmVersion: result.algorithmVersion,
        solverStatus: result.solverStatus,
        validation
      })
    );
    if (!repository.rosterAudit)
      await repository.audit({
        actorMemberId: context.actor.memberId,
        actorAccount: actor.account,
        action: 'rosters.generated',
        sourceRef: publicResourceRef('rosters', 'version', version.id),
        after: { version, validation },
        requestId: input.requestId
      });
    const names = new Map(source.members.map((item) => [item.memberId, item.name]));
    return {
      ...result,
      assignments: result.assignments.map((item) => ({
        ...item,
        memberName: names.get(item.memberId)
      })),
      validation,
      version
    };
  }

  async function reviseRoster(actor, taskId, input) {
    const source = await rosterInput(actor, taskId),
      versions = await repository.rosterVersionsForTask(taskId);
    const published = versions.find((item) => item.status === 'published');
    if (!published || published.id !== input.publishedVersionId)
      fail(409, '当前发布班表已变化，请重新打开');
    const context = await contextFor(actor),
      record = { ...commandRecord(actor, context, input), command: 'revise' };
    const replay = await repository.rosterCommandReceipt(
      record.actorMemberId,
      record.command,
      record.requestId
    );
    if (replay) {
      if (JSON.parse(replay.payload).taskId !== taskId) fail(409, '请求编号已用于其他任务');
      return repository.rosterVersionById(replay.resourceId);
    }
    if (versions.some((item) => item.status === 'draft'))
      fail(409, '已有未发布修订，请继续编辑现有草稿');
    const assignments = await repository.versionAssignments(published.id);
    return rosterWrite(() =>
      repository.createRosterVersion({
        taskId,
        assignments: assignments.map((item) => ({ ...item, id: undefined })),
        commandRecord: record,
        ruleVersion: source.ruleVersion,
        algorithmVersion: 'published-copy-v1',
        validation: validateRoster({ assignments }, source),
        inputSnapshotRef: {
          basePublishedVersionId: published.id,
          publicationBase: published.id,
          eligibility: rosterEligibilitySnapshot(source),
          manualOverrides: assignments.filter((item) => item.manualOverride),
          lockedAssignments: assignments.filter((item) => item.locked),
          lockedMemberIds: assignments.filter((item) => item.locked).map((item) => item.memberId)
        }
      })
    );
  }

  async function checkProtected(taskId, assignments) {
    if (!repository.protectedRosterAssignments) return;
    const protectedRows = await repository.protectedRosterAssignments(taskId);
    if (protectedRows.some((row) => !assignments.some((item) => sameAssignment(row, item))))
      fail(
        409,
        '已签到、过去日期或暂停日的原班次不能变更，请保留原安排，通过现场协调或考勤修正处理'
      );
    if (
      assignments.some(
        (row) =>
          row.businessDate < dateKey() && !protectedRows.some((item) => sameAssignment(row, item))
      )
    )
      fail(409, '过去日期不能新增或更改排班，请通过考勤修正处理');
  }

  async function updateRoster(actor, id, input) {
    if (
      !Number.isInteger(input.version) ||
      !Array.isArray(input.assignments) ||
      input.assignments.length > 300 ||
      input.assignments.some(
        (item) =>
          !item ||
          typeof item.memberId !== 'string' ||
          !validDate(item.businessDate) ||
          typeof item.campusId !== 'string' ||
          typeof item.startAt !== 'string' ||
          typeof item.endAt !== 'string'
      )
    )
      fail(400, '排班草稿字段不完整');
    const version = await repository.rosterVersionById(id);
    if (!version) fail(404, '排班草稿不存在');
    const context = await contextFor(actor),
      record = { ...commandRecord(actor, context, input), command: 'save' };
    if (repository.rosterCommandReceipt) {
      const replay = await repository.rosterCommandReceipt(
        record.actorMemberId,
        'save',
        record.requestId
      );
      if (replay) {
        if (replay.resourceId !== id || JSON.parse(replay.payload).signature !== stableJson(input))
          fail(409, '请求编号已用于其他调整');
        await rosterInput(actor, version.taskId);
        return { ...(await repository.rosterVersionById(id)), idempotent: true };
      }
    }
    const fingerprint = repository.rosterFingerprint
      ? await repository.rosterFingerprint(version.taskId)
      : undefined;
    const source = await rosterInput(actor, version.taskId);
    const assignments = await inheritAssignmentLeaves(source.taskId, input.assignments);
    await checkProtected(source.taskId, assignments);
    for (const item of assignments) {
      const member = source.members.find((person) => person.memberId === item.memberId);
      item.manualOverride =
        !!member &&
        !member.available.some(
          (slot) =>
            slot.businessDate === item.businessDate &&
            slot.campusId === item.campusId &&
            slot.startAt <= item.startAt &&
            slot.endAt >= item.endAt
        );
    }
    const validation = validateRoster({ assignments }, source);
    if (source.dutyType !== 'office' && source.ruleVersion !== 'repair-minimum-v2')
      fail(409, '请先确认每日最低人员需求');
    const result = await rosterWrite(() =>
      repository.updateRosterDraft(
        id,
        {
          assignments,
          validation,
          ruleVersion: source.ruleVersion,
          eligibility: rosterEligibilitySnapshot(source),
          commandRecord: record,
          signature: stableJson(input),
          fingerprint,
          taskId: source.taskId
        },
        input.version
      )
    );
    if (!result) fail(409, '排班版本已变化，请刷新');
    if (!repository.rosterAudit)
      await repository.audit({
        actorMemberId: (await contextFor(actor)).actor.memberId,
        actorAccount: actor.account,
        action: 'rosters.updated',
        sourceRef: publicResourceRef('rosters', 'version', id),
        after: result,
        requestId: input.requestId
      });
    return { ...result, assignments, revision: result.version };
  }

  async function inheritAssignmentLeaves(taskId, assignments) {
    const published = (await repository.rosterVersionsForTask(taskId)).find(
      (item) => item.status === 'published'
    );
    const previous = published ? await repository.versionAssignments(published.id) : [];
    const key = (item) =>
      `${item.memberId}:${item.businessDate}:${item.campusId}:${item.startAt}:${item.endAt}:${item.dutyType || 'repair'}`;
    const statuses = new Map(previous.map((item) => [key(item), item.leaveStatus || '']));
    return assignments.map((item) => ({ ...item, leaveStatus: statuses.get(key(item)) || '' }));
  }

  async function publish(actor, id, input) {
    if (!Number.isInteger(input.version) || input.version < 1) fail(400, '请选择有效的班表版本');
    const version = await repository.rosterVersionById(id);
    if (!version) fail(404, '排班草稿不存在');
    const fingerprint = repository.rosterFingerprint
      ? await repository.rosterFingerprint(version.taskId)
      : undefined;
    const source = await rosterInput(actor, version.taskId);
    if (version.status === 'published' && version.version === input.version) return version;
    if (
      source.dutyType !== 'office' &&
      (source.ruleVersion !== 'repair-minimum-v2' || version.ruleVersion !== source.ruleVersion)
    )
      fail(409, '请先确认需求，并重新生成或保存校验草稿');
    if (
      version.inputSnapshotRef?.eligibility?.taskRevision !== undefined &&
      version.inputSnapshotRef.eligibility.taskRevision !== source.taskRevision
    )
      fail(409, '最低人员需求已变更，请重新生成或保存校验草稿');
    const assignments = await repository.versionAssignments(id);
    await checkProtected(source.taskId, assignments);
    const validation = validateRoster({ assignments }, source);
    let override = null;
    if (!validation.valid) {
      if (validation.blocking)
        fail(409, '存在资格、授权、实际时间冲突或受保护班次问题，必须处理后再发布');
      const confirmation = await tokenDigest(
        stableJson({ version: version.version, validation, fingerprint })
      );
      if (
        input.confirmation !== confirmation ||
        typeof input.overrideReason !== 'string' ||
        input.overrideReason.trim().length < 2 ||
        input.overrideReason.length > 500 ||
        !Array.isArray(input.overrideIssues) ||
        stableJson([...input.overrideIssues].sort()) !==
          stableJson(validation.errors.map((issue) => issue.id).sort())
      )
        fail(409, '请重新读取当前检查结果，逐项确认问题并填写发布原因');
      override = { issues: validation.errors, reason: input.overrideReason.trim(), confirmation };
    }
    const context = await contextFor(actor);
    let result;
    try {
      result = await repository.publishRoster(
        id,
        input.version,
        {
          actorMemberId: context.actor.memberId,
          actorAccount: actor.account,
          authVersion: context.authVersion,
          action: 'rosters.published',
          sourceRef: publicResourceRef('rosters', 'version', id),
          before: version,
          after: { ...version, status: 'published', override },
          requestId: input.requestId
        },
        fingerprint,
        override
      );
    } catch (error) {
      if (String(error.message).includes('ROSTER_ATTENDED_ASSIGNMENT_CHANGED'))
        fail(409, '人员已签到，原班次不能更改，请重新核对');
      if (String(error.message).includes('ROSTER_PUBLICATION_BASE_CHANGED'))
        fail(409, '已有新的班表发布，请基于最新班表核对修订');
      if (String(error.message).includes('ROSTER_SCHEDULE_CONFLICT'))
        fail(409, '人员已在其他班表被安排，请刷新并重新核对');
      if (String(error.message).includes('ROSTER_CAMPUS_LEADER_CONFLICT'))
        fail(409, '该校区当天已有其他班表发布的负责人，请先协调现有班表');
      if (String(error.message).includes('ROSTER_REPAIR_MINIMUM_MISSING'))
        fail(409, '负责人或普通人员覆盖已变化，请重新校验');
      throw error;
    }
    if (!result) fail(409, '班表、人员资格、可用时间或需求已变化，请刷新并重新校验');
    return result;
  }
  async function importRoster(actor, taskId, input) {
    if (typeof input.csv !== 'string' || input.csv.length > 120000) fail(400, '值班表文件过大');
    if (!Number.isInteger(input.version) || input.version < 1) fail(400, '请先选择有效的班表草稿');
    const source = await rosterInput(actor, taskId);
    const version = (await repository.rosterVersionsForTask(taskId)).find(
      (item) => item.status === 'draft'
    );
    if (!version) fail(409, '请先结束收集并生成草稿；已发布班表请先建立修订稿');
    if (input.version !== version.version) fail(409, '班表草稿已变化，请重新预览导入');
    const csv = csvRows(input.csv.replace(/^\uFEFF/, ''));
    if (csv.length < 2 || csv.length > 301) fail(400, '每次请导入 1 至 300 条安排');
    if (
      csv
        .shift()
        .map((value) => value.trim())
        .join(',') !== '姓名,学号,日期,校区,岗位'
    )
      fail(400, '请使用 姓名,学号,日期,校区,岗位 五列表头');
    const byStudent = new Map(
      source.members
        .filter((member) => member.studentId)
        .map((member) => [member.studentId, member])
    );
    const assignments = [],
      seen = new Set(),
      preview = [];
    for (const [index, cells] of csv.entries()) {
      if (cells.length !== 5) fail(400, `第 ${index + 2} 行列数不正确`);
      const [name, studentId, businessDate, campus, role] = cells.map((value) => value.trim());
      const member = byStudent.get(studentId);
      if (!member) fail(400, `第 ${index + 2} 行学号不在本任务可安排人员中`);
      if (name && name !== member.name) fail(400, `第 ${index + 2} 行姓名与学号不匹配`);
      const campusId = { 南湖: 'campus-nanhu', 浑南: 'campus-hunnan' }[campus] || campus;
      const slot = source.slots.find(
        (item) => item.businessDate === businessDate && item.campusId === campusId
      );
      if (!slot) fail(400, `第 ${index + 2} 行日期或校区不在本任务班次中`);
      const roleKind =
        source.dutyType === 'office'
          ? { 办公人员: '', 协调人: 'coordinator' }[role]
          : { 维修工作人员: '', 维修负责人: 'repair_lead' }[role];
      if (roleKind === undefined) fail(400, `第 ${index + 2} 行岗位与任务类型不符`);
      if (source.dutyType !== 'office' && (member.pool === 'lead') !== (roleKind === 'repair_lead'))
        fail(400, `第 ${index + 2} 行负责人和普通人员身份不匹配`);
      const key = `${member.memberId}:${businessDate}:${campusId}`;
      if (seen.has(key)) fail(400, `第 ${index + 2} 行重复安排同一成员`);
      seen.add(key);
      const manualOverride = !member.available.some(
        (item) =>
          item.businessDate === slot.businessDate &&
          item.campusId === slot.campusId &&
          item.startAt <= slot.startAt &&
          item.endAt >= slot.endAt
      );
      assignments.push({ ...slot, memberId: member.memberId, roleKind, manualOverride });
      preview.push({
        name: member.name,
        studentId,
        businessDate,
        campusId,
        role: role || (source.dutyType === 'office' ? '办公人员' : '维修工作人员'),
        manualOverride
      });
    }
    const current = await repository.versionAssignments(version.id);
    const locked = current.filter((item) => item.locked);
    if (locked.some((item) => !assignments.some((candidate) => sameAssignment(item, candidate))))
      fail(409, '导入文件缺少已锁定安排，请先在草稿中解除锁定或保留该安排');
    for (const assignment of assignments)
      if (locked.some((item) => sameAssignment(item, assignment))) assignment.locked = true;
    await checkProtected(taskId, assignments);
    const validation = validateRoster({ assignments }, source);
    const previewToken = await tokenDigest(
      stableJson({ taskId, version: version.version, assignments, validation })
    );
    if (input.confirm) {
      if (input.previewToken !== previewToken) fail(409, '导入内容或班表条件已变化，请重新预览');
      if (validation.blocking) fail(409, '导入包含资格、时间或人员冲突，请先修改文件');
      await updateRoster(actor, version.id, {
        version: version.version,
        assignments,
        requestId: input.requestId
      });
    }
    return {
      taskId,
      version: version.version,
      count: assignments.length,
      assignments: preview,
      validation,
      previewToken,
      saved: !!input.confirm
    };
  }
  return { rosterTaskState, generate, reviseRoster, updateRoster, publish, importRoster };
}
