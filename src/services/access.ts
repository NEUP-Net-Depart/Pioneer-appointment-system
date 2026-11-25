import type { appointmentRepository } from '../db/appointments.ts';
import { fail } from '../lib/http.ts';
import { hashAccessToken } from '../lib/access-tokens.ts';

export async function guestAppointment(appointments: Pick<ReturnType<typeof appointmentRepository>, 'findByCredential'>, id: string, token: string) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) fail(404,'预约不存在或访问凭证无效');
  const item = await appointments.findByCredential(id,hashAccessToken(token));
  if (!item) fail(404,'预约不存在或访问凭证无效');
  return item;
}
