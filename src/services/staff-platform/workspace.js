import { fail } from '../../lib/http.js';
import { dateKey } from '../../platform/time.js';
import { campusId as normalizeCampusId } from '../../modules/authorization/scopes.js';
import { canManageDepartments } from './departments.js';

export function workspaceDomain({ repository, platform, manifests, contextFor }) {
  async function workbench(actor) {
    const context = await contextFor(actor);
    const current = await platform.repairs?.currentRepair?.(actor.account);
    return {
      actor: context.actor,
      todayDuties: context.todayDuties,
      presence: context.presence,
      currentRepair: current || null,
      resumeTasks: context.resumeTasks || [],
      navigation: context.navigation || [],
      actions: context.todayDuties?.length
        ? ['attendance.checkin', 'repair.start']
        : ['attendance.checkin'],
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
    if (kind === 'locations')
      return { items: await repository.listLocations(query.campusId || '', includeDisabled) };
    fail(404, '组织字典不存在');
  }

  async function deskSummary(actor, query = {}) {
    if (query.businessDate && query.businessDate !== dateKey())
      fail(400, '接待现场仅展示今天，请通过记录页面查询历史');
    // Keep the compatibility URL behind the same role, scope and field projection
    // as the current desk; a summary-read grant alone does not open the staff board.
    const board = await this.field.board(actor, {
      ...query,
      campusId: query.campusId ? normalizeCampusId(query.campusId) : undefined
    });
    const counts = Object.fromEntries(
      ['booked', 'in_progress', 'completed', 'cancelled', 'expired'].map((status) => [
        status,
        board.appointments.filter((item) => item.status === status).length
      ])
    );
    return { ...board, counts };
  }

  async function audit(actor, query) {
    const context = await contextFor(actor);
    // Historical records do not yet carry a consistent campus/department scope.
    // Never turn one scoped grant into access to the complete audit journal.
    const globalGrants = context.grants.filter(
      (grant) => !Object.keys(grant.scope || {}).some((key) => key !== 'all')
    );
    if (
      !platform.authorizer.evaluate(context.actor, 'audit.read', {}, context, globalGrants).allowed
    )
      fail(403, '当前授权不能查看全局审计记录');
    return { items: await repository.listAudit(query || {}) };
  }
  return { workbench, organization, deskSummary, audit };
}
