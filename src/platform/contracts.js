export const CONTRACT_VERSION = 'staff-platform.v1';
export const SCHEMA_VERSION = '0007';

export const errorCodes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  PERMISSION_REQUIRED: 'PERMISSION_REQUIRED',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  REQUEST_CONFLICT: 'REQUEST_CONFLICT',
  PRESENCE_CHANGED: 'PRESENCE_CHANGED',
  ACTIVE_REPAIR_EXISTS: 'ACTIVE_REPAIR_EXISTS'
};

export function requestId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value)) return '';
  return value;
}

export function publicResourceRef(module, type, id) {
  return { module, type, id: String(id) };
}

export function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

export function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}
