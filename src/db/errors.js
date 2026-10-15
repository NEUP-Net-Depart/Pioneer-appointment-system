// D1 keeps the SQL constraint failure in message/cause. No SQL or bindings leave the server.
export function conflictMessage(error) {
  const message = `${error.message} ${error.cause?.message || ''}`;
  if (message.includes('STUDENT_DAY_EXISTS')) return '该学号当天已有预约。请检查学号，或联系工作人员核实。';
  if (message.includes('LOCATION_MISSING')) return '该日期尚未配置维修地点，请重新选择日期';
  if (message.includes('LOCATION_REQUIRED')) return '已有预约的服务日必须先设置替代地点';
  if (message.includes('SLOT_ENDED')) return '该预约时段已经结束';
  if (message.includes('UNIQUE constraint failed: active_repairs.account') || message.includes('ACTIVE_REPAIR_EXISTS')) return '该维修人员已有进行中的工单，请先完成当前维修';
  if (message.includes('idx_one_pending_onsite_registration') || message.includes('UNIQUE constraint failed: appointments.registered_by')) return '请先签到或取消当前临时登记';
  if (message.includes('SLOT_PAUSED')) return '该校区该时段暂停预约';
  if (message.includes('SLOT_CHANGED')) return '该日期的时段安排已更新，请重新选择';
  if (message.includes('APPOINTMENT_OVERLAP')) return '同一时间已经存在预约';
  if (message.includes('SLOT_FULL')) return '该校区该时段已满';
  if (message.includes('UNIQUE constraint failed: appointments.student_id')) return '同一时段已经存在预约';
  if (message.includes('UNIQUE constraint failed: staff_accounts.account')) return '学号已存在';
  if (message.includes('ACTIVATION_CONFLICT') || message.includes('UNIQUE constraint failed: activation_requests.student_id') || message.includes('UNIQUE constraint failed: staff_whitelist.student_id')) return '资格或申请已更新，请联系管理员或刷新后重试';
  return null;
}
export function conflictCode(error) {
  const message = `${error.message} ${error.cause?.message || ''}`;
  return ['STUDENT_DAY_EXISTS','LOCATION_MISSING','LOCATION_REQUIRED','SLOT_ENDED','SLOT_FULL','SLOT_PAUSED','SLOT_CHANGED'].find(code => message.includes(code)) || 'CONFLICT';
}
