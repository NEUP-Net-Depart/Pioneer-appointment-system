import { fail } from '../../lib/http.js';
import { campusId as normalizeCampusId } from '../../modules/authorization/scopes.js';
import { canManageDepartments } from './departments.js';

export function workspaceDomain({ repository, platform, manifests, contextFor }) {
  async function workbench(actor) {
    const context = await contextFor(actor);
    const repairs = await platform.repairs.inProgress(actor.account);
    return {
      actor: context.actor,
      todayDuties: context.todayDuties,
      presence: context.presence,
      repairs: repairs
        .filter((item) => context.actor.authorizedCampuses.includes(item.campus))
        .map((item) =>
          Object.fromEntries(
            [
              'id',
              'campus',
              'date',
              'timeSlot',
              'status',
              'name',
              'studentId',
              'brand',
              'deviceType',
              'deviceModel',
              'faultType',
              'receivedAt',
              'receivedByName',
              'assignedToName'
            ].map((key) => [key, item[key]])
          )
        ),
      resumeTasks: context.resumeTasks || [],
      navigation: context.navigation || [],
      actions: [
        ...(context.permissions['attendance.self'] ? ['attendance.checkin'] : []),
        ...(context.permissions['repair.receive'] ? ['repair.receive'] : []),
        ...(context.permissions['repair.start'] ? ['repair.start'] : [])
      ],
      modules: context.modules || manifests
    };
  }

  async function organization(actor, kind, query = {}) {
    const context = await contextFor(actor);
    if (
      !['members.manage', 'roles.manage', 'settings.manage'].some(
        (code) => context.permissions[code]
      )
    )
      fail(403, '缺少组织字典读取权限');
    const includeDisabled = query.includeDisabled === '1' || query.includeDisabled === true;
    if (kind === 'campuses') return { items: await repository.listCampuses(includeDisabled) };
    if (kind === 'departments')
      return {
        items: await repository.listDepartments(includeDisabled),
        actions: { manage: canManageDepartments(context, platform) }
      };
    if (kind === 'locations') {
      const campuses = (context.actor.authorizedCampuses || []).map(normalizeCampusId);
      if (query.campusId && !campuses.includes(normalizeCampusId(query.campusId)))
        fail(403, '没有该校区的访问权限');
      return {
        items: (await repository.listLocations(query.campusId || '', includeDisabled)).filter(
          (item) => campuses.includes(item.campusId)
        )
      };
    }
    fail(404, '组织字典不存在');
  }

  async function audit(actor, query) {
    const context = await contextFor(actor);
    // Historical records do not yet carry a consistent campus/department scope.
    // Never turn one scoped grant into access to the complete audit journal.
    if (
      !(await repository.listCampuses()).every((item) =>
        (context.actor.authorizedCampuses || []).map(normalizeCampusId).includes(item.id)
      )
    )
      fail(403, '全局审计需要全部校区授权');
    const globalGrants = context.grants.filter(
      (grant) => !Object.keys(grant.scope || {}).some((key) => key !== 'all')
    );
    if (
      !platform.authorizer.evaluate(context.actor, 'audit.read', {}, context, globalGrants).allowed
    )
      fail(403, '当前授权不能查看全局审计记录');
    return { items: await repository.listAudit(query || {}) };
  }
  return { workbench, organization, audit };
}
