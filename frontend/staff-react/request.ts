import type { ApiRequestOptions } from '../../shared/api.ts';
import { apiJson } from '../../shared/api.ts';

export async function request<T = unknown>(
  path: string,
  { body, ...options }: Omit<ApiRequestOptions, 'body'> & { body?: unknown } = {}
) {
  return apiJson<T>(path, { ...options, ...(body === undefined ? {} : { json: body }) });
}
