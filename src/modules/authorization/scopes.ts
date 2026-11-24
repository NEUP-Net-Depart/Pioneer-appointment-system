import type { GrantScope } from '../../../shared/staff-types.ts';
import { isObject } from '../../../shared/api-types.ts';

const identity = (value: string) => value;
const campusAliases: Partial<Record<string, string>> = { '南湖': 'campus-nanhu', '浑南': 'campus-hunnan' };
export function campusId(value: string): string;
export function campusId(value?: string | null): string | null | undefined;
export function campusId(value?: string | null) { return typeof value === 'string' ? campusAliases[value] || value : value; }
const list = (value?: string | string[]) => Array.isArray(value) ? value : value === undefined ? undefined : [value];

export function validScope(scope: unknown): scope is GrantScope {
  if (!isObject(scope)) return false;
  for (const key of ['campusIds', 'departmentIds', 'objectIds', 'campuses', 'departments']) {
    const value = scope[key];
    if (value === undefined || ['campusIds', 'campuses'].includes(key) && value === 'bound') continue;
    if (!Array.isArray(value) || value.length > 100 || value.some(item => typeof item !== 'string' || !item.trim() || item.length > 128)) return false;
  }
  return ['self', 'all'].every(key => scope[key] === undefined || typeof scope[key] === 'boolean');
}

// A binding adds restrictions to one complete grant; it never replaces them.
export function intersectScopes(grant: GrantScope = {}, binding: GrantScope = {}): GrantScope {
  const scope: GrantScope = {};
  for (const [key, alias, normalize] of [['campusIds', 'campuses', campusId], ['departmentIds', 'departments', identity], ['objectIds', 'objectIds', identity]] as const) {
    const a = grant[key] ?? grant[alias]; const b = binding[key] ?? binding[alias];
    const concrete = (value?: 'bound' | string[]) => value === 'bound' ? undefined : list(value)?.map(item => normalize(item));
    const left = concrete(a), right = concrete(b);
    if (left && right) scope[key] = left.filter(value => right.includes(value));
    else if (left || right) scope[key] = left || right;
    else if (a !== undefined || b !== undefined) Object.assign(scope, { [key]: 'bound' });
  }
  if (grant.self || binding.self) scope.self = true;
  if (grant.all === true && !Object.keys(scope).length) scope.all = true;
  return scope;
}
