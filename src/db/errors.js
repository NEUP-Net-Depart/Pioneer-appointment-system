// D1 keeps the SQL constraint failure in message/cause. No SQL or bindings leave the server.
export function conflictMessage(error) {
  const message = `${error.message} ${error.cause?.message || ''}`;
  if (message.includes('PRESENCE_BUSY')) return '当前仍有进行中的维修，不能离岗';
  if (message.includes('idx_one_pending_onsite_registration')) return '请先签到或取消当前临时登记';
  if (message.includes('UNIQUE constraint failed: active_repairs.account') || message.includes('UNIQUE constraint failed: active_repairs.member_id') || message.includes('ACTIVE_REPAIR_EXISTS')) return '该维修人员已有进行中的工单，请先完成当前维修';
  if (message.includes('SLOT_PAUSED')) return '该校区该时段暂停预约';
  if (message.includes('SLOT_CHANGED')) return '该日期的时段安排已更新，请重新选择';
  if (message.includes('SLOT_ENDED')) return '该预约时段已经结束';
  if (message.includes('LOCATION_MISSING')) return '该日期尚未配置维修地点，请重新选择日期';
  if (message.includes('LOCATION_REQUIRED')) return '已有预约的维修地点不能为空';
  if (message.includes('STUDENT_DAY_EXISTS')) return '当天已有预约，请先查看原预约';
  if (message.includes('APPOINTMENT_OVERLAP')) return '同一时间已经存在预约';
  if (message.includes('SLOT_FULL')) return '该校区该时段已满';
  if (message.includes('UNIQUE constraint failed: appointments.student_id')) return '同一时段已经存在预约';
  if (message.includes('UNIQUE constraint failed: staff_accounts.account')) return '学号已存在';
  if (message.includes('ACTIVATION_CONFLICT') || message.includes('UNIQUE constraint failed: activation_requests.student_id') || message.includes('UNIQUE constraint failed: staff_whitelist.student_id')) return '资格或申请已更新，请联系管理员或刷新后重试';
  if (message.includes('idx_onsite_request') || message.includes('UNIQUE constraint failed: appointments.registered_by')) return '现场登记请求已处理，请刷新后重试';
  if (message.includes('UNIQUE constraint failed: members.student_id')) return '学号已绑定其他成员';
  if (message.includes('UNIQUE constraint failed: permission_definitions.code') || message.includes('UNIQUE constraint failed: roles.code')) return '编码已存在';
  if (message.includes('role_grants.role_id') || message.includes('UNIQUE constraint failed: roles.code')) return '角色权限已存在';
  if (message.includes('idx_membership_primary_open') || message.includes('member_department_memberships.member_id')) return '成员在该时点已有主归属或重复任职';
  if (message.includes('PRIMARY_MEMBERSHIP_OVERLAP')) return '成员的主归属任职时间重叠，请先结束原主归属';
  if (message.includes('duty_assignments') || message.includes('roster_versions')) return '排班版本或分配已存在，请刷新后重试';
  if (message.includes('REVISION_CONFLICT')) return '对象已被其他操作修改，请刷新后重试';
  return null;
}
export function conflictCode(error) {
  const message = `${error.message} ${error.cause?.message || ''}`;
  return ['STUDENT_DAY_EXISTS','LOCATION_MISSING','LOCATION_REQUIRED','SLOT_ENDED','SLOT_FULL','SLOT_PAUSED','SLOT_CHANGED'].find(code => message.includes(code)) || 'CONFLICT';
}
