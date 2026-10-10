import { fail } from '../lib/http.js';
import { encryptText, decryptText } from '../lib/privacy.js';
import { addDays, dateKey, nowIso, serviceDay } from '../../shared/time.js';
import { issueAccessToken } from '../lib/access-tokens.js';
import { guestAppointment } from './access.js';
import { appointmentScope,requireRole,requireAppointmentAccess,requireCampus } from './permissions.js';

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
    async list(query,user) {
      const result = await appointments.list(query,appointmentScope(user));
      const items=result.items.map(item=>{
        if(user.role==='technician' && item.assignedTo!==user.account) {
          return Object.fromEntries(['id','campus','date','timeSlot','deviceType','brand','deviceModel','faultType','status','assignedTo','createdAt'].map(key=>[key,item[key]]));
        }
        return present(item);
      });
      return { ...result,items };
    },
    async create(data) {
      const today = dateKey();
      if (data.date < today || data.date > addDays(today, 3)) fail(400, '预约日期必须为今天起 3 天内');
      if (!serviceDay(data.date)) fail(400, '预约日期必须为周一至周四');
      const instant = nowIso();
      const credential = issueAccessToken();
      const item = { ...data, status: 'pending', assignedTo: '', repairNote: '', createdAt: instant,
        agreementAt: instant, agreementVersion: data.agreementVersion || 'v1.0',
        accessTokenHash: credential.hash, credentialRotatedAt: instant,
        phone: encryptText(data.phone, encryptionKey), social: encryptText(data.social, encryptionKey) };
      return { ...present(await appointments.create(item)), accessToken: credential.token };
    },
    async lookup(id, accessToken) {
      return present(await guestAppointment(appointments,id,accessToken));
    },
    async recover(id, input, actor) {
      const item = await appointments.find(id);
      if (!item) fail(404,'预约不存在');
      requireRole(actor,'admin');requireAppointmentAccess(actor,item);
      if (input.identityVerified!==true || typeof input.reason!=='string' || input.reason.trim().length<8 || input.reason.length>300) fail(400,'请确认已人工核验身份，并记录至少 8 字的核验说明');
      const credential=issueAccessToken();
      if (!await appointments.rotateCredential(item,credential.hash,actor.account,input.reason.trim(),nowIso())) fail(409,'预约已更新，请刷新后重试');
      return { id:item.id,accessToken:credential.token };
    },
    async update(id, { patch: input }, user, accessToken) {
      const item = user ? await appointments.find(id) : await guestAppointment(appointments,id,accessToken);
      if (!item) fail(404, '预约不存在');
      const guestCancel = !user && input.status === 'cancelled';
      if (!user && !guestCancel) fail(403, '学生仅可取消待接单预约');
      let patch = { ...input };
      if (guestCancel) {
        if (!['pending','awaiting_claim'].includes(item.status)) fail(409, '当前状态不能取消');
        patch = { status: 'cancelled' };
      } else {
        requireAppointmentAccess(user,item,{claim:input.status==='claimed'});
        if (patch.assignedTo) {
          let assignee = await users.find(patch.assignedTo.toLowerCase());
          if (!assignee) {
            const matches = await users.findByName(patch.assignedTo);
            if (matches.length > 1) fail(400, '有多个同名工作人员，请输入学号');
            assignee = matches[0];
          }
          if (assignee?.status !== 'enabled') fail(400,'维修人员账号不存在或未启用');
          requireCampus(assignee,item.campus);
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
