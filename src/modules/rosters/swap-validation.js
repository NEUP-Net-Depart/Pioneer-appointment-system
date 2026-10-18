import { campusId } from '../authorization/scopes.js';
import { weekRange } from '../../platform/time.js';
import { createAuthorizer } from '../authorization/public.js';
import { repairRosterPool } from './qualification.js';

const activeOn = (profile, day) => profile.effectiveFrom <= day && (!profile.effectiveTo || day < profile.effectiveTo);
const sameSlot = (a, b) => a.businessDate === b.businessDate && a.campusId === b.campusId && a.dutyType === b.dutyType && a.startAt <= b.startAt && a.endAt >= b.endAt;

// This pure projection is shared by preview and confirmation. Database commands
// reassert current versions, qualification and coverage inside their transaction.
export function assignmentProtected(row, protectedAssignments = [], today = '') {
  return !!row && (today && row.businessDate < today || protectedAssignments.some(item => item.memberId === row.memberId && item.businessDate === row.businessDate && item.campusId === row.campusId));
}

export function validateSwap({ from, to, facts, coverage, protectedAssignments = [], today = '', authorizer=createAuthorizer() }) {
  const errors = [];
  if (!from || !to) return { allowed: false, errors: ['班次不存在，请重新选择'], after: [] };
  if ([from, to].some(row => assignmentProtected(row, protectedAssignments, today))) errors.push('已签到或已结束的班次不能换班，请联系负责人处理');
  if (from.memberId === to.memberId || from.id === to.id) errors.push('请选择另一位成员的班次');
  if (weekRange(from.businessDate).start !== weekRange(to.businessDate).start) errors.push('只能交换同一周的班次');
  if (from.dutyType !== to.dutyType) errors.push('只能交换相同岗位类型的班次');
  if ([from, to].some(row => row.versionStatus !== 'published')) errors.push('班次已被调整，请刷新班表');
  if ([from, to].some(row => ['pending', 'approved'].includes(row.leaveStatus))) errors.push('班次存在待审批或已批准的请假，请先处理请假');
  const after = [from, to].map((slot, index) => {
    const memberId = index === 0 ? to.memberId : from.memberId;
    const fact = facts.find(item => item.memberId === memberId);
    const profiles = (fact?.profiles || []).filter(item => activeOn(item, slot.businessDate));
    if (!fact?.active) errors.push('接手成员已停用或没有可登录账号');
    if (!(fact?.campuses || []).some(value => campusId(value) === slot.campusId)) errors.push('接手成员没有目标校区的适用授权');
    const pooled=slot.dutyType==='repair' && slot.ruleVersion==='repair-minimum-v2';
    const pool=pooled && repairRosterPool(fact || {},authorizer,slot.businessDate,{id:slot.taskId,campusId:slot.campusId});
    if (pooled ? !pool : !profiles.some(item => (slot.dutyType === 'office' ? ['office'] : ['repair']).includes(item.profileCode)) || slot.dutyType==='repair' && profiles.some(item=>item.profileCode==='exchange')) errors.push('接手成员没有对应排班工作资格，交流人员不参与维修换班');
    if ((fact?.assignments || []).filter(row => ![from.id, to.id].includes(row.id)).some(row =>
      slot.dutyType === 'repair' && row.dutyType === 'repair' && weekRange(row.businessDate).start === weekRange(slot.businessDate).start ||
      row.businessDate === slot.businessDate && (slot.dutyType === 'office' && row.dutyType === 'office' || row.startAt < slot.endAt && slot.startAt < row.endAt))) errors.push('交换后与接手成员的其他已发布班次冲突');
    if (slot.dutyType === 'office' && slot.roleKind === 'office_lead' && !profiles.some(item => item.profileCode === 'office_lead')) errors.push('接手成员没有办公值班负责人资格');
    const roleKind = slot.dutyType === 'office' ? slot.roleKind || '' : (pooled ? pool==='lead' : profiles.some(item => item.profileCode === 'repair_lead')) ? 'repair_lead' : '';
    return { ...slot, memberId, memberName: fact?.name || '成员', roleKind, leaveStatus: '' };
  });
  const effective = [...coverage.filter(row => ![from.id, to.id].includes(row.id) && row.leaveStatus !== 'approved'), ...after];
  const slots = [...new Map([from,to].map(slot => [`${slot.campusId}:${slot.businessDate}:${slot.startAt}:${slot.endAt}`,slot])).values()];
  const impacts = slots.map(slot => {
    const assigned = effective.filter(row => sameSlot(row, slot));
    const leaders = assigned.filter(row => row.roleKind === 'repair_lead');
    if (!assigned.length || slot.dutyType === 'repair' && !leaders.length) errors.push('交换后缺少完整时段的维修负责人覆盖');
    if(slot.ruleVersion==='repair-minimum-v2' && (leaders.length!==1 || assigned.length-leaders.length<(slot.ordinaryMinimum ?? 1))) errors.push('交换后需要恰好 1 名负责人，并达到普通维修人员最低需求');
    return { campusId: slot.campusId, businessDate: slot.businessDate, startAt: slot.startAt, endAt: slot.endAt,
      expected: new Set(assigned.map(row => row.memberId)).size, leaders: new Set(leaders.map(row => row.memberId)).size };
  });
  return { allowed: !errors.length, errors: [...new Set(errors)], after, coverage: impacts };
}
