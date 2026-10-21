import { fail } from '../../lib/http.js';
import { dateKey } from '../../platform/time.js';
import { requestId, publicResourceRef } from '../../platform/contracts.js';
import { workspacePermissions } from '../../modules/authorization/workspace.js';
import { staffIdentities } from '../../../shared/staff-identities.js';
import { collectionState } from '../../modules/rosters/workflow.js';
import { hashPayload } from './shared.js';

export function contextDomain({ repository, platform, calendarClock }) {
  const collectionStatus = (task) => collectionState(task, calendarClock().getTime());

  async function contextFor(actor, businessDate = dateKey()) {
    const context = await platform.authContext(actor, { businessDate });
    if (context.member?.status && context.member.status !== 'active')
      fail(401, '成员已停用，请联系管理员');
    const effective = {
      ...context,
      businessDate,
      actor: {
        ...context.actor,
        role: actor.role,
        authorizedCampuses: actor.authorizedCampuses || [],
        homeCampus: actor.homeCampus
      },
      grants: context.grants || []
    };
    return {
      ...effective,
      identities: staffIdentities(effective, platform.authorizer),
      permissions: workspacePermissions(effective.actor, effective, platform.authorizer)
    };
  }

  async function scopedActor(actor, permissionCode) {
    const context = await contextFor(actor);
    const authorizedCampuses = (actor.authorizedCampuses || []).filter(
      (campusId) => evaluate(context, permissionCode, { campusId }).allowed
    );
    if (!authorizedCampuses.length) fail(403, '没有执行此操作的权限');
    return { ...actor, authorizedCampuses };
  }

  function evaluate(context, permissionCode, target) {
    return platform.authorizer.evaluate(
      context.actor,
      permissionCode,
      target,
      context,
      context.grants
    );
  }

  async function requirePermission(actor, permissionCode, target = {}, businessDate = dateKey()) {
    const context = await contextFor(actor, businessDate);
    const result = evaluate(context, permissionCode, target);
    if (!result.allowed) fail(403, `缺少权限：${permissionCode}`);
    return { context, result };
  }

  async function withReceipt(actor, action, input, operation) {
    const id = requestId(input?.requestId);
    if (!id) return operation();
    const memberId = (await contextFor(actor)).actor.memberId;
    const hash = hashPayload(input);
    const previous = await repository.receipt(memberId, action, id);
    if (previous) {
      if (previous.payloadHash !== hash) fail(409, '请求编号已用于其他内容', 'REQUEST_CONFLICT');
      if (previous.resultStatus === 'pending')
        fail(409, '请求正在处理中，请稍后重试', 'REQUEST_CONFLICT');
      return { ...previous.result, idempotent: true, receipt: previous };
    }
    if (!(await repository.claimReceipt(memberId, action, id, hash))) {
      const current = await repository.receipt(memberId, action, id);
      if (current?.payloadHash !== hash) fail(409, '请求编号已用于其他内容', 'REQUEST_CONFLICT');
      if (current?.resultStatus === 'pending')
        fail(409, '请求正在处理中，请稍后重试', 'REQUEST_CONFLICT');
      return { ...current.result, idempotent: true, receipt: current };
    }
    try {
      const result = await operation();
      await repository.createReceipt(
        memberId,
        action,
        id,
        hash,
        result,
        result?.id ? publicResourceRef(action.split('.')[0], action, result.id) : {}
      );
      return result;
    } catch (error) {
      await repository.releaseReceipt(memberId, action, id, hash);
      throw error;
    }
  }

  async function rosterWrite(write) {
    try {
      return await write();
    } catch (error) {
      if (
        /CHECK constraint failed|UNIQUE constraint failed: roster_command_receipts/.test(
          String(error.message)
        )
      )
        fail(409, '任务、权限或班表已变化，请重新读取并核对；你的修改可以保留后重试');
      throw error;
    }
  }
  return {
    collectionStatus,
    contextFor,
    scopedActor,
    evaluate,
    requirePermission,
    withReceipt,
    rosterWrite
  };
}
