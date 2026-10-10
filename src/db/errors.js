// D1 keeps the SQL constraint failure in message/cause. No SQL or bindings leave the server.
export function conflictMessage(error) {
  const message = `${error.message} ${error.cause?.message || ''}`;
  if (message.includes('SLOT_FULL')) return '该校区该时段已满';
  if (message.includes('UNIQUE constraint failed: appointments.student_id')) return '同一时段已经存在预约';
  if (message.includes('UNIQUE constraint failed: staff_accounts.account')) return '学号已存在';
  if (message.includes('ACTIVATION_CONFLICT') || message.includes('UNIQUE constraint failed: activation_requests.student_id') || message.includes('UNIQUE constraint failed: staff_whitelist.student_id')) return '资格或申请已更新，请联系管理员或刷新后重试';
  return null;
}
