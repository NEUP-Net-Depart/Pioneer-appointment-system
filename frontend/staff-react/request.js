import { apiJson } from '../../shared/api.js';
import { invalidateWorkspaceQueries } from './workspace-state.js';

export async function request(path, { body, ...options } = {}) {
  const result = await apiJson(path, { ...options, ...(body === undefined ? {} : { json: body }) });
  if (!['GET', 'HEAD'].includes((options.method || 'GET').toUpperCase()))
    invalidateWorkspaceQueries();
  return result;
}
