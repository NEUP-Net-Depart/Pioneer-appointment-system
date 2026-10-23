// Reception is an operational stage, not an appointment status.
export const receptionWorkflow = Object.freeze(
  [
    {
      value: 'booked',
      label: '未到场',
      hint: '接待核验与拍照',
      description: '尚未完成到场接待。由接待人员核验设备、拍摄照片，再安排维修人员。'
    },
    {
      value: 'queued',
      label: '排队中',
      hint: '接待安排维修人',
      description: '已完成设备核验和拍照，等待接待人员选择空闲维修人员并分派。'
    },
    {
      value: 'assigned',
      label: '排队中 · 等待确认',
      hint: '维修人员确认开修',
      description: '已分派给指定维修人员，并占用其接单名额；对方确认接手后才开始维修。'
    },
    {
      value: 'in_progress',
      label: '维修中',
      hint: '维修人员处理设备',
      description: '维修人员已确认接手，正在处理设备；完成后提交维修结果。'
    }
  ].map((stage) => Object.freeze(stage))
);
const stageLabels = Object.fromEntries(
  receptionWorkflow.map((stage) => [stage.value, stage.label])
);
export const receptionLabels = Object.freeze({
  queued: stageLabels.queued,
  assigned: stageLabels.assigned,
  started: stageLabels.in_progress,
  closed: '已结束',
  left: '已离队'
});
export function receptionStatus(item) {
  if (item.status==='booked' && item.reception?.leftAt) return 'left';
  return item.status === 'booked' && ['queued', 'assigned'].includes(item.reception?.state)
    ? item.reception.state
    : item.status;
}

// Overview groups assigned reservations into the live queue without losing their actual stage.
export function receptionGroup(item) {
  const status=receptionStatus(item);
  return ['queued','assigned'].includes(status) ? 'queued' : status;
}
export function queueTicketLabel(ticket) {
  return ticket ? String(ticket.number).padStart(3,'0')+'号' : '';
}
