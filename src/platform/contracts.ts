export const CONTRACT_VERSION = 'staff-platform.v1';
export const SCHEMA_VERSION = '0022';

export const errorCodes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  PERMISSION_REQUIRED: 'PERMISSION_REQUIRED',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  REQUEST_CONFLICT: 'REQUEST_CONFLICT',
  PRESENCE_CHANGED: 'PRESENCE_CHANGED',
  ACTIVE_REPAIR_EXISTS: 'ACTIVE_REPAIR_EXISTS'
};

export function requestId(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value)) return '';
  return value;
}

export function publicResourceRef(module: string, type: string, id: string | number) {
  return { module, type, id: String(id) };
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  try { return value ? (JSON.parse(value) as T) : fallback; } catch { return fallback; }
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`;
}
