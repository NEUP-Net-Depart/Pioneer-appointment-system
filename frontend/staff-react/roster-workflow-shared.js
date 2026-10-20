const campuses = { 'campus-nanhu': '南湖校区', 'campus-hunnan': '浑南校区' };
const days = ['周一', '周二', '周三', '周四'];
const key = (slot) => `${slot.businessDate}:${slot.campusId}:${slot.startAt}:${slot.endAt}`;
const label = (slot) =>
  `${slot.businessDate.slice(5).replace('-', '/')} · ${campuses[slot.campusId]} · ${slot.startAt}–${slot.endAt}`;
const issueLabels = {
  OFFICE_COVERAGE_MISSING: '办公人员未达到目标',
  COVERAGE_MISSING: '尚未安排人员',
  LEAD_COVERAGE_MISSING: '缺少负责人',
  ORDINARY_COVERAGE_MISSING: '普通人员低于最低需求',
  LEAD_SURPLUS: '只能安排一名负责人',
  MEMBER_WEEK_MISSING: '本周尚未安排',
  MEMBER_WEEK_DUPLICATE: '本周重复安排',
  MEMBER_DAY_DUPLICATE: '同日重复安排',
  MEMBER_UNAVAILABLE: '资格、授权或班次冲突',
  LEAD_INELIGIBLE: '负责人资格不符',
  POOL_MISMATCH: '人员身份与名额不符',
  LOCKED_ASSIGNMENT_CHANGED: '锁定安排已改变',
  DUTY_TYPE_MISMATCH: '岗位不匹配',
  TIME_CONFLICT: '与其他班次实际时间重叠'
};
const repairStages = ['发布收集', '收集进度', '调整班表', '检查发布'];
export { campuses, days, key, label, issueLabels, repairStages };
