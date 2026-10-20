import { fail } from '../../lib/http.js';
import { dateKey, weekRange } from '../../platform/time.js';
import { requestId, stableJson, publicResourceRef } from '../../platform/contracts.js';
import { campusId as normalizeCampusId } from '../../modules/authorization/scopes.js';
import { assignmentProtected, validateSwap } from '../../modules/rosters/swap-validation.js';
import { staffIdentities } from '../../../shared/staff-identities.js';
import { repairRosterPool, rosterFactContext } from '../../modules/rosters/qualification.js';
import { hashPayload, tokenDigest, inputString, publicLeave, publicSwap } from './shared.js';

export function requestsDomain({ repository, platform, contextFor, evaluate, requirePermission }) {
  async function rosterMine(actor, query = {}) {
    const context = await contextFor(actor);
    await requirePermission(actor, 'roster.read', { memberId: context.actor.memberId });
    return {
      items: await repository.listAssignments(
        context.actor.memberId,
        query.weekStart || weekRange(dateKey()).start
      ),
      weekStart: query.weekStart || weekRange(dateKey()).start
    };
  }

  async function leave(actor, input) {
    const context = await contextFor(actor);
    await requirePermission(actor, 'roster.read', { memberId: context.actor.memberId });
    if (
      typeof input.assignmentId !== 'string' ||
      !input.assignmentId ||
      typeof input.reason !== 'string' ||
      input.reason.trim().length < 2 ||
      input.reason.length > 500
    )
      fail(400, '请假班次或原因不正确');
    const id = requestId(input.requestId),
      hash = hashPayload(input);
    const receipt = id
      ? { memberId: context.actor.memberId, action: 'leave.create', id, hash }
      : null;
    const replay = async () => {
      const previous =
        receipt && (await repository.receipt(receipt.memberId, receipt.action, receipt.id));
      if (!previous) return null;
      if (previous.payloadHash !== hash) fail(409, '请求编号已用于其他内容', 'REQUEST_CONFLICT');
      if (previous.resultStatus !== 'success')
        fail(409, '请求正在处理中，请稍后重试', 'REQUEST_CONFLICT');
      return { ...previous.result, idempotent: true };
    };
    const previous = await replay();
    if (previous) return previous;
    const assignment = await repository.assignmentById(input.assignmentId);
    if (!assignment || assignment.memberId !== context.actor.memberId)
      fail(403, '只能为本人班次申请请假');
    if (assignment.versionStatus && assignment.versionStatus !== 'published')
      fail(409, '该班次已被新版班表替换，请选择当前班次');
    const result = publicLeave(
      await repository.createLeave(
        {
          assignmentId: assignment.originAssignmentId || assignment.id,
          activeAssignmentId: assignment.id,
          reason: input.reason.trim()
        },
        context.actor.memberId,
        {
          actorMemberId: context.actor.memberId,
          actorAccount: actor.account,
          authVersion: context.authVersion,
          action: 'rosters.leave.created',
          requestId: id
        },
        receipt
      )
    );
    if (result) return result;
    const concurrent = await replay();
    if (concurrent) return concurrent;
    fail(409, '该班次已变化，或已有待审批、已批准的请假申请，请刷新后查看');
  }

  async function leaveAccess(context, request, assignment, memberships) {
    const departments =
      memberships ||
      (assignment && repository.memberships
        ? await repository.memberships(request.member_id, assignment.businessDate)
        : []);
    const targets = departments.length ? departments.map((item) => item.departmentId) : [undefined];
    return {
      departments,
      allowed:
        !!assignment &&
        targets.some(
          (departmentId) =>
            evaluate(context, 'leave.review', {
              campusId: assignment.campusId,
              memberId: request.member_id,
              departmentId,
              id: request.id
            }).allowed
        )
    };
  }

  async function currentLeaveAssignment(row) {
    return repository.effectiveLeaveAssignment
      ? repository.effectiveLeaveAssignment(row.assignment_id, row.member_id)
      : row.assignment || repository.assignmentById(row.assignment_id);
  }

  function leaveActions(request, assignment, context, canReview) {
    const current =
      !!assignment &&
      (!assignment.versionStatus || assignment.versionStatus === 'published') &&
      assignment.memberId === request.member_id;
    return {
      review: canReview && request.status === 'pending',
      approve: canReview && request.status === 'pending' && current,
      reason: current ? '' : '原班次已被调整，可退回申请并请成员重新选择班次',
      withdraw: request.member_id === context.actor.memberId && request.status === 'pending'
    };
  }

  async function leaveDetail(actor, id) {
    const context = await contextFor(actor),
      row = await repository.leaveById(id);
    if (!row) fail(404, '请假申请不存在');
    const assignment = await currentLeaveAssignment(row);
    const access = await leaveAccess(context, row, assignment);
    if (!access.allowed && row.member_id !== context.actor.memberId)
      fail(403, '没有查看该请假申请的权限');
    if (!access.allowed)
      await requirePermission(actor, 'roster.read', { memberId: context.actor.memberId });
    const member = await repository.memberRow(row.member_id);
    const identityContext = repository.fieldContexts
      ? (await repository.fieldContexts([row.member_id], context.businessDate)).get(row.member_id)
      : null;
    return {
      ...publicLeave(row),
      memberName: member?.name || '成员',
      assignment,
      identities: identityContext ? staffIdentities(identityContext, platform.authorizer) : [],
      departments: access.departments.map((item) => item.departmentName),
      actions: leaveActions(row, assignment, context, access.allowed),
      impact: access.allowed && assignment ? await repository.leaveImpact(assignment) : null
    };
  }

  async function leaves(actor, query = {}) {
    const context = await contextFor(actor);
    const all = query.all === true || query.all === '1' || query.all === 'true';
    if (!all) await requirePermission(actor, 'roster.read', { memberId: context.actor.memberId });
    if (query.status && !['pending', 'approved', 'rejected', 'withdrawn'].includes(query.status))
      fail(400, '请假状态不正确');
    const rows = await repository.listLeaves({
      status: query.status,
      memberId: all ? undefined : context.actor.memberId
    });
    const identities = repository.fieldContexts
      ? await repository.fieldContexts(
          [...new Set(rows.map((row) => row.member_id))],
          context.businessDate
        )
      : new Map();
    const assignments = new Map(
      await Promise.all(
        rows.map(async (row) => [
          row.id,
          row.assignment?.versionStatus === 'published'
            ? row.assignment
            : await currentLeaveAssignment(row)
        ])
      )
    );
    const memberships = new Map();
    if (repository.membershipsForMembers)
      for (const day of new Set(
        [...assignments.values()].filter(Boolean).map((item) => item.businessDate)
      )) {
        const ids = [
          ...new Set(
            rows
              .filter((row) => assignments.get(row.id)?.businessDate === day)
              .map((row) => row.member_id)
          )
        ];
        memberships.set(day, await repository.membershipsForMembers(ids, day));
      }
    const items = [];
    for (const row of rows) {
      const assignment = assignments.get(row.id);
      const access = await leaveAccess(
        context,
        row,
        assignment,
        memberships.get(assignment?.businessDate)?.filter((item) => item.memberId === row.member_id)
      );
      const canReview = access.allowed;
      if (all && !canReview) continue;
      if (query.campusId && assignment?.campusId !== query.campusId) continue;
      items.push({
        ...publicLeave(row),
        assignment,
        memberName: row.member_name || '',
        departments: access.departments.map((item) => item.departmentName),
        identities: identities.has(row.member_id)
          ? staffIdentities(identities.get(row.member_id), platform.authorizer)
          : [],
        actions: leaveActions(row, assignment, context, canReview)
      });
    }
    return { items };
  }

  async function leaveDecision(actor, id, input) {
    if (!['approve', 'reject'].includes(input.decision)) fail(400, '审批动作不正确');
    if (!Number.isInteger(input.revision) || input.revision < 0) fail(400, '请假申请版本不正确');
    const note = inputString(input, 'note', 500);
    const request = await repository.leaveById(id);
    if (!request) fail(404, '请假申请不存在');
    const assignment = await currentLeaveAssignment(request);
    const context = await contextFor(actor);
    const access = await leaveAccess(context, request, assignment);
    if (!access.allowed) fail(403, '没有审批该校区与部门申请的权限');
    const status = input.decision === 'approve' ? 'approved' : 'rejected';
    if (request.status === status && request.revision === input.revision + 1)
      return publicLeave(request);
    if (status === 'approved' && !leaveActions(request, assignment, context, true).approve)
      fail(409, '班次或申请已变化，请刷新后处理');
    const result = await repository.updateLeave(
      id,
      status,
      context.actor.memberId,
      input.revision,
      note,
      {
        actorMemberId: context.actor.memberId,
        actorAccount: actor.account,
        authVersion: context.authVersion,
        action: 'rosters.leave.reviewed',
        sourceRef: publicResourceRef('rosters', 'leave', id),
        before: publicLeave(request),
        after: {
          ...publicLeave(request),
          status,
          reviewNote: note,
          reviewerMemberId: context.actor.memberId
        },
        requestId: input.requestId
      }
    );
    if (!result) fail(409, '请假申请或班次已变化，请刷新');
    return publicLeave(result);
  }

  async function leaveWithdraw(actor, id, input) {
    if (!Number.isInteger(input.revision) || input.revision < 0) fail(400, '请假申请版本不正确');
    const context = await contextFor(actor);
    await requirePermission(actor, 'roster.read', { memberId: context.actor.memberId });
    const request = await repository.leaveById(id);
    if (!request || request.member_id !== context.actor.memberId)
      fail(403, '只能撤回本人的请假申请');
    if (request.status === 'withdrawn' && request.revision === input.revision + 1)
      return publicLeave(request);
    const result = await repository.updateLeave(
      id,
      'withdrawn',
      context.actor.memberId,
      input.revision,
      '本人撤回',
      {
        actorMemberId: context.actor.memberId,
        actorAccount: actor.account,
        authVersion: context.authVersion,
        action: 'rosters.leave.withdrawn',
        sourceRef: publicResourceRef('rosters', 'leave', id),
        before: publicLeave(request),
        after: { ...publicLeave(request), status: 'withdrawn' },
        requestId: input.requestId
      }
    );
    if (!result) fail(409, '请假申请已变化，请刷新');
    return publicLeave(result);
  }

  async function swapSnapshot(fromId, toId, owners) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const fingerprint = await repository.swapFingerprint(fromId, toId);
      const original = await Promise.all([
        repository.assignmentById(fromId),
        repository.assignmentById(toId)
      ]);
      if (original.some((row) => !row)) fail(404, '换班班次不存在');
      const current = owners
        ? await Promise.all(
            original.map((row, index) => repository.effectiveAssignment(row.id, owners[index]))
          )
        : original;
      const [from, to] = current;
      const weekStart = weekRange(from.businessDate).start;
      const [facts, coverage, protectedAssignments] = await Promise.all([
        repository.rosterMemberFacts([from.memberId, to.memberId], weekStart),
        repository.swapCoverage(weekStart),
        repository.protectedRosterAssignments(undefined, weekStart)
      ]);
      if (fingerprint !== (await repository.swapFingerprint(fromId, toId))) continue;
      const validation = validateSwap({
        from,
        to,
        facts,
        coverage,
        protectedAssignments,
        today: dateKey(),
        authorizer: platform.authorizer
      });
      if (owners && current.some((row, index) => row.memberId !== owners[index]))
        validation.errors.push('班次人员已变化，请重新发起换班');
      validation.allowed = !validation.errors.length;
      const named = (row) => ({
        ...row,
        memberName: facts.find((item) => item.memberId === row.memberId)?.name || '成员'
      });
      return { ...validation, from: named(from), to: named(to), fingerprint };
    }
    fail(409, '班表正在更新，请稍后重新查看换班结果');
  }

  function swapProjection(snapshot) {
    return {
      allowed: snapshot.allowed,
      errors: snapshot.errors,
      fromAssignment: snapshot.from,
      toAssignment: snapshot.to,
      after: snapshot.after,
      coverage: snapshot.coverage || []
    };
  }

  async function swapCandidates(actor, query = {}) {
    const context = await contextFor(actor);
    await requirePermission(actor, 'roster.read', { memberId: context.actor.memberId });
    const source = await repository.assignmentById(query.assignmentId);
    if (!source || source.memberId !== context.actor.memberId) fail(403, '请先选择本人的班次');
    if (source.versionStatus !== 'published' || source.leaveStatus)
      fail(409, '该班次已调整或已请假，请刷新班表');
    const protectedAssignments = await repository.protectedRosterAssignments(
      undefined,
      weekRange(source.businessDate).start
    );
    if (assignmentProtected(source, protectedAssignments, dateKey()))
      fail(409, '已签到或已结束的班次不能换班，请联系负责人处理');
    const candidates = await repository.swapCandidates({
      ...source,
      weekStart: weekRange(source.businessDate).start
    });
    const facts = new Map(
      (
        await repository.rosterMemberFacts(
          [...new Set([source.memberId, ...candidates.map((item) => item.memberId)])],
          weekRange(source.businessDate).start
        )
      ).map((item) => [item.memberId, item])
    );
    const eligible = (fact, slot) =>
      slot.dutyType === 'office'
        ? fact?.active &&
          fact.profiles.some(
            (item) =>
              item.profileCode === 'office' &&
              item.effectiveFrom <= slot.businessDate &&
              (!item.effectiveTo || slot.businessDate < item.effectiveTo)
          )
        : fact &&
          !!repairRosterPool(fact, platform.authorizer, slot.businessDate, {
            id: slot.taskId,
            campusId: slot.campusId
          });
    if (!eligible(facts.get(source.memberId), source))
      fail(403, '当前工作资格不支持该班次换班，请联系负责人处理');
    return {
      items: candidates
        .filter(
          (item) =>
            !assignmentProtected(item, protectedAssignments, dateKey()) &&
            eligible(facts.get(item.memberId), source) &&
            eligible(facts.get(source.memberId), item)
        )
        .map((item) => ({
          ...item,
          identities: staffIdentities(
            rosterFactContext(facts.get(item.memberId), item.businessDate),
            platform.authorizer
          )
        }))
    };
  }

  async function swapPreview(actor, input) {
    const context = await contextFor(actor);
    await requirePermission(actor, 'roster.read', { memberId: context.actor.memberId });
    const source = await repository.assignmentById(input.fromAssignmentId);
    if (!source || source.memberId !== context.actor.memberId) fail(403, '只能从本人班次发起换班');
    const target = await repository.assignmentById(input.toAssignmentId);
    if (!target) fail(404, '目标班次不存在');
    if (
      !(context.actor.authorizedCampuses || []).some(
        (value) => normalizeCampusId(value) === target.campusId
      )
    )
      fail(403, '没有目标校区的班次访问权限');
    const snapshot = await swapSnapshot(input.fromAssignmentId, input.toAssignmentId);
    return swapProjection(snapshot);
  }

  async function swapReceipt(context, action, input) {
    if (input.requestId !== undefined && !requestId(input.requestId)) fail(400, '请求编号不正确');
    const receipt = {
      memberId: context.actor.memberId,
      action,
      id: requestId(input.requestId) || crypto.randomUUID(),
      hash: await tokenDigest(stableJson(input))
    };
    const replay = async () => {
      const previous = await repository.receipt(receipt.memberId, receipt.action, receipt.id);
      if (!previous) return null;
      if (previous.payloadHash !== receipt.hash)
        fail(409, '请求编号已用于其他内容', 'REQUEST_CONFLICT');
      if (previous.resultStatus !== 'success')
        fail(409, '请求正在处理中，请稍后重试', 'REQUEST_CONFLICT');
      return { ...publicSwap(previous.result), idempotent: true };
    };
    return { receipt, replay, previous: await replay() };
  }

  async function swap(actor, input) {
    const context = await contextFor(actor);
    await requirePermission(actor, 'roster.read', { memberId: context.actor.memberId });
    if (
      !input.fromAssignmentId ||
      !input.toAssignmentId ||
      !input.toMemberId ||
      !Number.isInteger(input.fromRevision) ||
      !Number.isInteger(input.toRevision)
    )
      fail(400, '换班班次或版本不正确');
    const note = inputString(input, 'note', 500);
    const command = await swapReceipt(context, 'swap.create', input);
    if (command.previous) return command.previous;
    const snapshot = await swapSnapshot(input.fromAssignmentId, input.toAssignmentId);
    const { from, to } = snapshot;
    if (
      from.memberId !== context.actor.memberId ||
      to.memberId === context.actor.memberId ||
      input.toMemberId !== to.memberId
    )
      fail(400, '换班班次或目标成员不正确');
    if (from.revision !== input.fromRevision || to.revision !== input.toRevision)
      fail(409, '班次已变化，请重新选择');
    if (
      weekRange(from.businessDate).start !== weekRange(to.businessDate).start ||
      from.dutyType !== to.dutyType
    )
      fail(400, '只能交换同一周、相同岗位类型的班次');
    if (!snapshot.allowed) fail(409, snapshot.errors.join('；'));
    const result = await repository.createSwap(
      { ...input, note },
      {
        actorMemberId: context.actor.memberId,
        actorAccount: actor.account,
        authVersion: context.authVersion,
        action: 'rosters.swap.created',
        requestId: command.receipt.id
      },
      command.receipt,
      snapshot
    );
    if (result) return publicSwap(result);
    const concurrent = await command.replay();
    if (concurrent) return concurrent;
    fail(409, '班次或人员资格已变化，或已有双方待确认的换班邀请，请刷新后查看');
  }

  async function canManageSwap(context, from, to) {
    if (!from || !to) return false;
    const allowed = await Promise.all(
      [from, to].map(async (assignment) => {
        const departments = await repository.memberships(
          assignment.memberId,
          assignment.businessDate
        );
        return (
          departments.length ? departments.map((item) => item.departmentId) : [undefined]
        ).some(
          (departmentId) =>
            evaluate(
              context,
              assignment.dutyType === 'office' ? 'roster.office.manage' : 'roster.repair.manage',
              {
                campusId: assignment.campusId,
                departmentId,
                memberId: assignment.memberId,
                id: assignment.id
              }
            ).allowed
        );
      })
    );
    return allowed.every(Boolean);
  }

  async function swaps(actor, query = {}) {
    const context = await contextFor(actor);
    const all = query.all === true || query.all === '1' || query.all === 'true';
    if (!all) await requirePermission(actor, 'roster.read', { memberId: context.actor.memberId });
    if (query.status && !['pending', 'accepted', 'declined', 'cancelled'].includes(query.status))
      fail(400, '换班状态不正确');
    const rows = await repository.listSwaps({
      status: query.status,
      memberId: all ? undefined : context.actor.memberId
    });
    const items = [],
      names = new Map();
    async function named(row, memberId = row?.memberId) {
      if (!row) return null;
      if (!names.has(memberId))
        names.set(memberId, (await repository.memberRow(memberId))?.name || '成员');
      return { ...row, memberId, memberName: names.get(memberId) };
    }
    for (const row of rows) {
      const from = await repository.assignmentById(row.from_assignment_id),
        to = await repository.assignmentById(row.to_assignment_id);
      if (all && !(await canManageSwap(context, from, to))) continue;
      if (query.campusId && from?.campusId !== query.campusId && to?.campusId !== query.campusId)
        continue;
      items.push({
        ...publicSwap(row),
        fromAssignment: await named(from, row.from_member_id),
        toAssignment: await named(to, row.to_member_id),
        actions: {
          respond: row.to_member_id === context.actor.memberId && row.status === 'pending'
        }
      });
    }
    return { items };
  }

  async function swapDetail(actor, id) {
    const context = await contextFor(actor),
      row = await repository.swapById(id);
    if (!row) fail(404, '换班申请不存在');
    const participant = [row.from_member_id, row.to_member_id].includes(context.actor.memberId);
    if (participant)
      await requirePermission(actor, 'roster.read', { memberId: context.actor.memberId });
    else if (
      !(await canManageSwap(
        context,
        await repository.assignmentById(row.from_assignment_id),
        await repository.assignmentById(row.to_assignment_id)
      ))
    )
      fail(403, '没有查看此换班申请的权限');
    if (row.status !== 'pending') {
      const [from, to] = await Promise.all([
        repository.assignmentById(row.from_assignment_id),
        repository.assignmentById(row.to_assignment_id)
      ]);
      const [sender, invitee] = await Promise.all([
        repository.memberRow(row.from_member_id),
        repository.memberRow(row.to_member_id)
      ]);
      return {
        ...publicSwap(row),
        allowed: false,
        errors: [],
        after: [],
        coverage: [],
        actions: { respond: false },
        fromAssignment: {
          ...from,
          memberId: row.from_member_id,
          memberName: sender?.name || '成员'
        },
        toAssignment: { ...to, memberId: row.to_member_id, memberName: invitee?.name || '成员' },
        applied: row.applied_from_assignment_id
          ? await Promise.all([
              repository.assignmentById(row.applied_from_assignment_id),
              repository.assignmentById(row.applied_to_assignment_id)
            ])
          : []
      };
    }
    const snapshot = await swapSnapshot(row.from_assignment_id, row.to_assignment_id, [
      row.from_member_id,
      row.to_member_id
    ]);
    if (snapshot.from.revision !== row.from_revision || snapshot.to.revision !== row.to_revision) {
      snapshot.allowed = false;
      snapshot.errors.push('原班次已更新，请从最新班次重新发起');
    }
    return {
      ...publicSwap(row),
      ...swapProjection(snapshot),
      actions: { respond: row.to_member_id === context.actor.memberId && row.status === 'pending' },
      applied: row.applied_from_assignment_id
        ? await Promise.all([
            repository.assignmentById(row.applied_from_assignment_id),
            repository.assignmentById(row.applied_to_assignment_id)
          ])
        : []
    };
  }

  async function swapDecision(actor, id, input) {
    if (
      !['accept', 'decline'].includes(input.decision) ||
      !Number.isInteger(input.revision) ||
      input.revision < 0
    )
      fail(400, '换班确认动作或版本不正确');
    const context = await contextFor(actor),
      row = await repository.swapById(id);
    if (!row) fail(404, '换班申请不存在');
    if (row.to_member_id !== context.actor.memberId)
      fail(403, '只有被邀请的成员可以确认或拒绝换班');
    await requirePermission(actor, 'roster.read', { memberId: context.actor.memberId });
    const command = await swapReceipt(context, 'swap.decide', { ...input, swapId: id });
    if (command.previous) return command.previous;
    if (row.status !== 'pending' || row.revision !== input.revision)
      fail(409, '换班申请已变化，请刷新');
    let snapshot;
    if (input.decision === 'accept') {
      snapshot = await swapSnapshot(row.from_assignment_id, row.to_assignment_id, [
        row.from_member_id,
        row.to_member_id
      ]);
      if (snapshot.from.revision !== row.from_revision || snapshot.to.revision !== row.to_revision)
        fail(409, '班次已变化，请从最新班次重新发起');
      if (!snapshot.allowed) fail(409, snapshot.errors.join('；'));
    }
    let result;
    try {
      result = await repository.updateSwap(
        row,
        input.decision === 'accept' ? 'accepted' : 'declined',
        input.revision,
        {
          actorMemberId: context.actor.memberId,
          actorAccount: actor.account,
          authVersion: context.authVersion,
          action: 'rosters.swap.decided',
          before: publicSwap(row),
          requestId: command.receipt.id
        },
        command.receipt,
        snapshot
      );
    } catch (error) {
      if (/ROSTER_ATTENDED_ASSIGNMENT_CHANGED/.test(String(error.message)))
        fail(409, '人员已签到或班次已结束，不能换班，请重新核对');
      if (
        /SWAP_REVISION_CONFLICT|ROSTER_SCHEDULE_CONFLICT|ROSTER_PUBLICATION_BASE_CHANGED/.test(
          String(error.message)
        )
      )
        fail(409, '班次已变化或出现时间冲突，请刷新后重新发起');
      throw error;
    }
    if (result) return publicSwap(result);
    const concurrent = await command.replay();
    if (concurrent) return concurrent;
    fail(409, '换班申请、班次或人员资格已变化，请刷新');
  }
  return {
    rosterMine,
    leave,
    leaveDetail,
    leaves,
    leaveDecision,
    leaveWithdraw,
    swapCandidates,
    swapPreview,
    swap,
    swaps,
    swapDetail,
    swapDecision
  };
}
