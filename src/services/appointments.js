import { fail } from '../lib/http.js';
import { encryptText, decryptText } from '../lib/privacy.js';
import { roleLevel } from '../../shared/constants.js';
import { addDays, dateKey, nowIso, serviceDay } from '../../shared/time.js';

export function presentAppointment(item, encryptionKey) {
  return { ...item, phone: decryptText(item.phone, encryptionKey), social: decryptText(item.social, encryptionKey) };
}
const transitions = {
  pending: ['claimed','awaiting_claim'], awaiting_claim: ['claimed'],
  claimed: ['in_progress','completed','no_show','no_repair'], in_progress: ['completed','no_show','no_repair']
};
export function appointmentService(appointments, users, encryptionKey) {
  const present = item => presentAppointment(item, encryptionKey);
  return {
    async list(query, user) {
      const result = await appointments.list(query, user.role === 'student' ? user.account : '');
      return { ...result, items: result.items.map(present) };
    },
    async create(data, user) {
      const today = dateKey();
      if (data.date < today || data.date > addDays(today, 3)) fail(400, '预约日期必须为今天起 3 天内');
      if (!serviceDay(data.date)) fail(400, '预约日期必须为周一至周四');
      if (user?.role === 'student' && (data.studentId !== user.account || data.name !== user.name)) fail(403, '只能为当前登录学生提交预约');
      const instant = nowIso();
      const item = { ...data, status: 'pending', assignedTo: '', repairNote: '', createdAt: instant,
        agreementAt: instant, agreementVersion: data.agreementVersion || 'v1.0',
        phone: encryptText(data.phone, encryptionKey), social: encryptText(data.social, encryptionKey) };
      return present(await appointments.create(item));
    },
    async lookup({ id, studentId }) {
      const item = await appointments.find(id);
      if (!item || item.studentId !== studentId) fail(404, '预约编号或学号不匹配');
      return present(item);
    },
    async update(id, { patch: input, studentId }, user) {
      const item = await appointments.find(id);
      if (!item) fail(404, '预约不存在');
      const guestCancel = !user && input.status === 'cancelled' && item.studentId === studentId;
      const studentCancel = user?.role === 'student' && item.studentId === user.account && input.status === 'cancelled';
      if (!user && !guestCancel) fail(401, '请使用预约编号和学号查询后再操作');
      let patch = { ...input };
      if (guestCancel || studentCancel) {
        if (!['pending','awaiting_claim'].includes(item.status)) fail(409, '当前状态不能取消');
        patch = { status: 'cancelled' };
      } else {
        if ((roleLevel[user?.role] ?? -1) < 1) fail(403, '没有执行此操作的权限');
        if (patch.assignedTo) {
          let assignee = await users.find(patch.assignedTo.toLowerCase());
          if (!assignee) {
            const matches = await users.findByName(patch.assignedTo);
            if (matches.length > 1) fail(400, '有多个同名工作人员，请输入学号');
            assignee = matches[0];
          }
          if (!assignee?.active || (roleLevel[assignee.role] ?? -1) < 1) fail(400, '维修人员账号不存在或未启用');
          patch.assignedTo = assignee.account;
        }
        if (user.role === 'technician') {
          const owns = item.assignedTo === user.account;
          const claiming = patch.status === 'claimed' && !item.assignedTo && ['pending','awaiting_claim'].includes(item.status);
          if (!owns && !claiming) fail(403, '只能处理自己接单的预约');
          if (claiming && !patch.assignedTo) patch.assignedTo = user.account;
          if (patch.assignedTo !== undefined && patch.assignedTo !== user.account) fail(403, '维修人员不能转派或解除接单');
          if (patch.status && patch.status !== item.status && !(transitions[item.status] || []).includes(patch.status)) fail(409, '当前状态不能直接跳转到目标状态');
        }
      }
      if (!Object.keys(patch).length) fail(400, '没有可更新的字段');
      const updated = await appointments.update(item, patch);
      if (!updated) fail(409, '预约已被其他工作人员修改，请刷新后重试');
      return present(updated);
    }
  };
}
