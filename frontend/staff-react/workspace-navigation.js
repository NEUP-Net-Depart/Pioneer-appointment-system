// Presentation only. Entries are supplied after the existing permission checks.
export const workspaceGroups = ['现场工作', '排班考勤', '人员权限', '业务设置', '我的'];

const destinations = {
  'scene:desk': ['现场工作', 'desk', '接待 扫码 登记 分派 队列 签到码'],
  'scene:repair': ['现场工作', 'repair', '接单 维修 保修 扫码'],
  staff: ['现场工作', 'records', '预约 查询 返修 工单'],
  stats: ['现场工作', 'chart', '统计 工作量'],
  'roster-manage': ['排班考勤', 'calendar', '维修 收集 填报 排班 发布'],
  'office-roster': ['排班考勤', 'calendar', '办公 收集 填报 排班 发布'],
  'leave-review': ['排班考勤', 'check', '请假 审核 审批'],
  'attendance-manage': ['排班考勤', 'check', '考勤 补录 修正 签到'],
  reports: ['排班考勤', 'download', '报表 导出 志愿 登记表 考勤'],
  members: ['人员权限', 'people', '人员 成员 部门 导入 激活 账号 审核'],
  permissions: ['人员权限', 'shield', '角色 权限 授权'],
  capacity: ['业务设置', 'settings', '预约 配置 名额 暂停 公告 地点 放号'],
  'scene:mine': ['我的', 'person', '个人 资料'],
  roster: ['我的', 'calendar', '我的 班次 排班 填报 请假 换班'],
  attendance: ['我的', 'check', '本人 签到 考勤'],
  settings: ['我的', 'shield', '账号 安全 密码 退出']
};

export function workspaceEntry(entry) {
  const [group, icon, keywords] = destinations[entry.id] || ['我的', 'records', ''];
  return { ...entry, group, icon, keywords };
}

export function groupWorkspaceEntries(entries) {
  return workspaceGroups
    .map((label) => ({
      label,
      items: entries
        .filter((entry) => entry.group === label)
        .sort(
          (a, b) =>
            Object.keys(destinations).indexOf(a.id) - Object.keys(destinations).indexOf(b.id)
        )
    }))
    .filter((group) => group.items.length);
}

export function mobileWorkspaceEntries(entries) {
  const ids = ['scene:desk', 'scene:repair', 'roster'];
  const work = ids
    .map((id) => entries.find((entry) => entry.id === id))
    .filter(Boolean)
    .slice(0, 2);
  const mine = entries.find((entry) => entry.id === 'scene:mine');
  return [...work, ...(mine ? [mine] : [])];
}

export function matchesWorkspaceEntry(entry, group, query) {
  const search = query.trim().toLocaleLowerCase();
  if (group.toLocaleLowerCase() === search) return true;
  const text = `${entry.label} ${entry.keywords || ''}`.toLocaleLowerCase();
  return search.split(/\s+/).every((word) => text.includes(word));
}
