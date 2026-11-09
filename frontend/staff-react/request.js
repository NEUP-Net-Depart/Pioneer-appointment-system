import { apiJson } from '../../shared/api.js';

export async function request(path, { body, ...options } = {}) {
  return apiJson(path, { ...options, ...(body === undefined ? {} : { json: body }) });
}
