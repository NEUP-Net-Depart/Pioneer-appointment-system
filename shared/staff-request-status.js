export const requestStatusLabels = {
  pending: '待处理', approved: '已批准', rejected: '已退回', withdrawn: '已撤回', accepted: '已生效', declined: '已拒绝', cancelled: '已取消'
};
export const requestStatusLabel = value => requestStatusLabels[value] || '状态待确认';
