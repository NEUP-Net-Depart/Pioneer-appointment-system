export type FieldErrors = Record<string, string>;

export interface ApiErrorResponse {
  error?: string;
  code?: string;
  fields?: FieldErrors;
  requestId?: string;
}

export type ApiFailure = Error & {
  code?: string;
  status?: number;
  fields?: FieldErrors;
  requestId?: string | null;
};

export function failureFrom(value: unknown): ApiFailure {
  return value instanceof Error ? value : new Error(String(value ?? ''));
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface ItemsResponse<T> {
  items: T[];
}

export interface PageResponse<T> extends ItemsResponse<T> {
  nextCursor: string | null;
}
