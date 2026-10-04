// D1 keeps the SQL constraint failure in message/cause. No SQL or bindings leave the server.
export function conflictMessage(error) {
  const message = `${error.message} ${error.cause?.message || ''}`;
  if (message.includes('SLOT_FULL')) return '该校区该时段已满';
  if (message.includes('UNIQUE constraint failed: appointments.student_id')) return '同一时段已经存在预约';
  if (message.includes('UNIQUE constraint failed: users.account')) return '学号已存在';
  return null;
}
