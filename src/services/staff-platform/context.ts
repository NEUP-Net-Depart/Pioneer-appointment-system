import type { StaffAccountDto } from '../../../shared/staff-types.ts';
import type { StaffRepository } from '../../db/staff-platform.ts';
import type { StaffPlatform } from '../../app/compose.ts';
import type { PolicyResource } from '../../modules/authorization/types.ts';

export type StaffContext = Awaited<ReturnType<ReturnType<typeof contextDomain>['contextFor']>>;
export type StaffDomainDependencies = ReturnType<typeof contextDomain> & {
  repository: StaffRepository;
  platform: StaffPlatform;
};

import { fail } from '../../lib/http.ts';
import { dateKey } from '../../platform/time.ts';
import { requestId, publicResourceRef } from '../../platform/contracts.ts';
import { workspacePermissions } from '../../modules/authorization/workspace.ts';
import { staffIdentities } from '../../../shared/staff-identities.ts';
import { hashPayload } from './shared.ts';

export function contextDomain({
  repository,
  platform
}: {
  repository: StaffRepository;
  platform: StaffPlatform;
}) {
  async function contextFor(
    actor: Pick<StaffAccountDto, 'account' | 'role' | 'authorizedCampuses'> &
      Partial<Pick<StaffAccountDto, 'name' | 'homeCampus'>>,
    businessDate = dateKey()
  ) {
    const context = await platform.authContext(actor, { businessDate });
    if (
      (context.member?.status && context.member.status !== 'active') ||
      context.actor?.status === 'disabled'
    )
      fail(401, '成员已停用，请联系管理员');
    if (!context.actor.memberId) fail(401, '成员已停用，请联系管理员');
    const effective = {
      ...context,
      businessDate,
      actor: {
        ...context.actor,
        memberId: context.actor.memberId,
        role: context.actor.role ?? actor.role,
        authorizedCampuses: context.actor.authorizedCampuses ?? actor.authorizedCampuses ?? [],
        homeCampus: context.actor.homeCampus ?? actor.homeCampus
      },
      grants: context.grants || []
    };
    return {
      ...effective,
      identities: staffIdentities(effective),
      permissions: workspacePermissions(effective.actor, effective, platform.authorizer)
    };
  }

  async function scopedActor<T extends StaffAccountDto>(
    actor: T,
    permissionCode: string
  ): Promise<T> {
    const context = await contextFor(actor);
    const authorizedCampuses = (context.actor.authorizedCampuses || []).filter(
      (campusId: string) => evaluate(context, permissionCode, { campusId }).allowed
    );
    if (!authorizedCampuses.length) fail(403, '没有执行此操作的权限');
    return { ...actor, authorizedCampuses };
  }

  function evaluate(context: StaffContext, permissionCode: string, target: PolicyResource) {
    return platform.authorizer.evaluate(
      context.actor,
      permissionCode,
      target,
      context,
      context.grants
    );
  }

  async function requirePermission(
    actor: StaffAccountDto,
    permissionCode: string,
    target: PolicyResource = {},
    businessDate = dateKey()
  ) {
    const context = await contextFor(actor, businessDate);
    const result = evaluate(context, permissionCode, target);
    if (!result.allowed) fail(403, `缺少权限：${permissionCode}`);
    return { context, result };
  }

  async function withReceipt<T extends object, Input extends { requestId?: unknown }>(
    actor: StaffAccountDto,
    action: string,
    input: Input,
    operation: () => Promise<T>
  ) {
    const id = requestId(input?.requestId);
    if (!id) return operation();
    const memberId = (await contextFor(actor)).actor.memberId;
    const hash = hashPayload(input);
    const previous = await repository.receipt<T>(memberId, action, id);
    if (previous) {
      if (previous.payloadHash !== hash) fail(409, '请求编号已用于其他内容', 'REQUEST_CONFLICT');
      if (previous.resultStatus === 'pending')
        fail(409, '请求正在处理中，请稍后重试', 'REQUEST_CONFLICT');
      return { ...previous.result, idempotent: true, receipt: previous };
    }
    if (!(await repository.claimReceipt(memberId, action, id, hash))) {
      const current = await repository.receipt<T>(memberId, action, id);
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
        'id' in result && typeof result.id === 'string'
          ? publicResourceRef(action.split('.')[0], action, result.id)
          : {}
      );
      return result;
    } catch (error) {
      await repository.releaseReceipt(memberId, action, id, hash);
      throw error;
    }
  }

  return {
    contextFor,
    scopedActor,
    evaluate,
    requirePermission,
    withReceipt
  };
}
