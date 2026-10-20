import { fail } from '../lib/http.js';
import { account, stringField, passwordInput } from '../lib/validation.js';
import { CAMPUSES } from '../../shared/constants.js';
import { nowIso } from '../../shared/time.js';
import { parseWhitelistCsv } from '../lib/whitelist-csv.js';
import { hashPassword } from '../lib/passwords.js';
import { issueAccessToken, hashAccessToken } from '../lib/access-tokens.js';
import { requireGrantScope } from './permissions.js';

export function activationService(repository, users, staff) {
  async function authorized(actor) {
    return staff.scopedActor(actor, 'accounts.manage');
  }
  function manageable(actor, item) {
    requireGrantScope(actor, item.authorizedCampuses);
    // A scoped accounts.manage grant is the source of truth for ordinary
    // activation work. Keep only the protected top-level identity boundary.
    if (
      item.expectedRole === 'superadmin' ||
      (item.expectedRole === 'admin' && actor.role !== 'superadmin')
    )
      fail(403, '不能管理最高管理员或管理员激活资格');
  }
  function inScope(actor, item) {
    return (
      item.expectedRole !== 'superadmin' &&
      (item.expectedRole !== 'admin' || actor.role === 'superadmin') &&
      item.authorizedCampuses.length > 0 &&
      item.authorizedCampuses.every((campus) => actor.authorizedCampuses.includes(campus))
    );
  }
  return {
    async import(input, actor) {
      actor = await authorized(actor);
      const items = parseWhitelistCsv(input),
        fresh = [],
        skipped = [];
      const [staff, whitelist] = await Promise.all([users.list(), repository.listWhitelist()]);
      const existing = new Set([
        ...staff.map((item) => item.account),
        ...whitelist.map((item) => item.studentId)
      ]);
      for (const item of items) {
        manageable(actor, item);
        if (item.expectedRole === 'admin')
          fail(
            400,
            '管理员请通过成员管理导入，并明确配置角色和授权校区；普通加入名单仅支持维修人员'
          );
        if (existing.has(item.studentId)) skipped.push(item.studentId);
        else fresh.push(item);
      }
      if (fresh.length) await repository.importWhitelist(fresh, actor.account, nowIso());
      return { imported: fresh.map((item) => item.studentId), skipped };
    },
    async whitelist(actor) {
      actor = await authorized(actor);
      return { items: (await repository.listWhitelist()).filter((item) => inScope(actor, item)) };
    },
    async changeWhitelist(id, input, actor) {
      actor = await authorized(actor);
      const item = await repository.findWhitelist(id);
      if (!item) fail(404, '白名单不存在');
      manageable(actor, item);
      if (!['open', 'revoked'].includes(input.status)) fail(400, '资格状态不正确');
      if (item.status === 'activated') fail(409, '已激活账号请在账号列表中管理');
      if (!(await repository.changeWhitelist(item, input.status, actor.account, nowIso())))
        fail(409, '白名单已更新，请刷新');
      return { ok: true };
    },
    async submit(input) {
      const studentId = account(input.studentId),
        name = stringField(input.name, '姓名', 80, true);
      if (!/^\d{6,20}$/.test(studentId) || name.length < 2 || !CAMPUSES.includes(input.homeCampus))
        fail(400, '学号、姓名或所属校区不正确');
      const password = passwordInput(input.password);
      const whitelist = await repository.findWhitelist(studentId);
      if (
        !whitelist ||
        whitelist.status !== 'open' ||
        (whitelist.expectedName && whitelist.expectedName !== name) ||
        (await users.find(studentId))
      )
        fail(400, '当前资料无法提交激活申请，请联系管理员核实');
      if (whitelist.expectedRole === 'admin' && !whitelist.activationMemberId)
        fail(409, '管理员资格尚未配置角色和校区，请联系最高管理员通过成员管理导入并显式授权');
      const receipt = issueAccessToken(),
        id = crypto.randomUUID();
      if (
        !(await repository.submit(
          {
            id,
            studentId,
            name,
            homeCampus: input.homeCampus,
            passwordHash: hashPassword(password),
            receiptHash: receipt.hash,
            createdAt: nowIso()
          },
          whitelist.revision
        ))
      )
        fail(409, '资格已更新，请联系管理员');
      return { id, receipt: receipt.token, status: 'pending' };
    },
    async status(id, receipt) {
      if (typeof receipt !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(receipt))
        fail(404, '申请不存在或回执无效');
      const item = await repository.publicStatus(id, hashAccessToken(receipt));
      if (!item) fail(404, '申请不存在或回执无效');
      return item;
    },
    async requests(actor) {
      actor = await authorized(actor);
      const items = (await repository.listRequests()).filter((item) => inScope(actor, item));
      return { items };
    },
    async review(input, actor) {
      actor = await authorized(actor);
      const ids = input.ids,
        status = input.status,
        note = stringField(input.reviewNote, '审核说明', 300);
      if (
        !Array.isArray(ids) ||
        !ids.length ||
        ids.length > 100 ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => typeof id !== 'string' || id.length > 40) ||
        !['approved', 'rejected'].includes(status)
      )
        fail(400, '审核申请或状态不正确');
      if (status === 'approved' && input.identityVerified !== true)
        fail(400, '审批前必须逐人核验身份');
      const items = [];
      for (const id of ids) {
        const item = await repository.findRequest(id);
        if (!item) fail(404, '申请不存在');
        manageable(actor, item);
        if (item.status !== 'pending' || (status === 'approved' && item.whitelistStatus !== 'open'))
          fail(409, '申请或资格已更新，请刷新');
        items.push(item);
      }
      let result;
      try {
        result = await repository.review(items, status, note, actor.account, nowIso());
      } catch (error) {
        if (String(error.message).includes('ACTIVATION_ADMIN_AUTHORIZATION_REQUIRED'))
          fail(409, '管理员资格尚未配置角色和校区，请先通过成员管理导入并显式授权，再审核激活');
        if (String(error.message).includes('ACTIVATION_QUALIFICATION_CHANGED'))
          fail(409, '成员资格或授权已变化，请先在成员管理中核实，再审核激活');
        throw error;
      }
      if (!result.applied.length) fail(409, '申请已被其他管理员处理，请刷新');
      return result;
    }
  };
}
