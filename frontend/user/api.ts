import { apiJson } from '../../shared/api.js';
import type { Appointment, Credential } from './types';
import { credentialHeaders } from './credentials';

type JsonOptions = NonNullable<Parameters<typeof apiJson>[1]> &
  RequestInit & {
    json?: unknown;
    telemetryPoll?: boolean;
  };

export function studentJson<T>(path: string, options: JsonOptions = {}): Promise<T> {
  return apiJson(path, { timeoutMs: 15000, ...options });
}

export type Failure = Error & {
  code?: string;
  status?: number;
  requestId?: string;
  fields?: Record<string, string>;
};

export function failureFrom(value: unknown): Failure {
  return value instanceof Error ? value : new Error(String(value ?? ''));
}

export function appointmentPath(id: string) {
  return '/api/appointments/' + encodeURIComponent(id);
}

export async function readAppointment(
  entry: Credential,
  options: JsonOptions = {}
): Promise<Appointment> {
  const item = await studentJson<Omit<Appointment, 'accessToken'>>(appointmentPath(entry.id), {
    ...options,
    headers: credentialHeaders(entry)
  });
  return { ...item, accessToken: entry.accessToken };
}
