import { fail } from '../lib/http.js';
import { hashAccessToken } from '../lib/access-tokens.js';

export async function guestAppointment(appointments, id, token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) fail(404,'预约不存在或访问凭证无效');
  const item = await appointments.findByCredential(id,hashAccessToken(token));
  if (!item) fail(404,'预约不存在或访问凭证无效');
  return item;
}
