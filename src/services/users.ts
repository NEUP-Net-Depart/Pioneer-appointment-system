import type { StaffAccountDto } from '../../shared/staff-types.ts';
import type { userRepository } from '../db/users.ts';
import type { userPatch } from '../lib/validation.ts';
import type { StaffService } from './staff-platform.ts';

type Users = Pick<ReturnType<typeof userRepository>, 'find' | 'list' | 'assignees' | 'update'>;
import { fail } from '../lib/http.ts';
import { hashPassword } from '../lib/passwords.ts';
import { roleLevel } from '../../shared/constants.ts';
import { publicUserView } from '../db/users.ts';
import { canManageAccount, requireGrantScope, requireRole, requireCampus } from './permissions.ts';

export function userService(users: Users, staff: Pick<StaffService, 'scopedActor' | 'contextFor'>) {
  async function manageable(id: string, actor: StaffAccountDto, options?: Parameters<Users['find']>[1]) {
    const target = await users.find(id, options);
    if (!target) fail(404, '账号不存在');
    if (!canManageAccount(actor, target)) fail(403, '只能管理授权校区内其他成员的普通账号');
    return target;
  }
  return {
    async detail(id: string, actor: StaffAccountDto) {
      actor = await staff.scopedActor(actor, 'accounts.manage');
      const target = await manageable(id, actor, { withRoles: true });
      return { ...publicUserView(target), actions: { edit: true, changeStatus: true, resetPassword: true } };
    },
    async assignees(query: Parameters<Users['assignees']>[0], actor: StaffAccountDto) {
      requireRole(actor, 'technician');
      actor = await staff.scopedActor(actor, 'repair.correct');
      requireCampus(actor, query.campus);
      return { items: await users.assignees(query) };
    },
    async list(actor: StaffAccountDto) {
      requireRole(actor, 'technician');
      actor = await staff.scopedActor(actor, 'accounts.manage');
      return {
        items: (await users.list(actor.authorizedCampuses))
          .filter(
            (user) =>
              (actor.role === 'superadmin' &&
                user.authorizedCampuses.length > 0 &&
                user.authorizedCampuses.every((campus) =>
                  actor.authorizedCampuses.includes(campus)
                )) ||
              canManageAccount(actor, user) ||
              user.account === actor.account
          )
          .map((user) => {
            const editable = canManageAccount(actor, user);
            return {
              ...user,
              actions: { edit: editable, changeStatus: editable, resetPassword: editable }
            };
          })
      };
    },
    async update(id: string, input: ReturnType<typeof userPatch>, actor: StaffAccountDto) {
      actor = await staff.scopedActor(actor, 'accounts.manage');
      const target = await manageable(id, actor),
        patch: ReturnType<typeof userPatch> & { passwordHash?: string } = { ...input };
      if (patch.authorizedCampuses) requireGrantScope(actor, patch.authorizedCampuses);
      if (patch.role !== undefined) {
        if (
          !Object.hasOwn(roleLevel, patch.role) ||
          patch.role === 'superadmin'
        )
          fail(403, '不能授予系统管理员身份');
      }
      if (patch.password !== undefined) {
        patch.passwordHash = hashPassword(patch.password);
        delete patch.password;
      }
      if (!Object.keys(patch).length) fail(400, '没有可更新的字段');
      const context = await staff.contextFor(actor);
      const updated = await users.update(target, patch, {
        auditRecord: {
          actorAccount: actor.account,
          actorMemberId: context.actor.memberId,
          authVersion: context.authVersion,
          action: 'accounts.updated'
        }
      });
      if (!updated) fail(409, '账号已被其他操作修改，请刷新');
      return updated;
    }
  };
}
