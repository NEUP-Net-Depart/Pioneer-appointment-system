import { apiJson } from '../../shared/api.ts';
import type { ApiRequestOptions } from '../../shared/api.ts';
export { failureFrom } from '../../shared/api-types.ts';
export type { ApiFailure as Failure } from '../../shared/api-types.ts';
import type { Appointment, Credential } from './types';
import { credentialHeaders } from './credentials';

export function studentJson<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  return apiJson<T>(path, { timeoutMs: 15000, ...options });
}

export function appointmentPath(id: string) {
  return '/api/appointments/' + encodeURIComponent(id);
}

export async function readAppointment(
  entry: Credential,
  options: ApiRequestOptions = {}
): Promise<Appointment> {
  const item = await studentJson<Omit<Appointment, 'accessToken'>>(appointmentPath(entry.id), {
    ...options,
    headers: credentialHeaders(entry)
  });
  return { ...item, accessToken: entry.accessToken };
}
