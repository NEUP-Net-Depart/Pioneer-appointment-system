const campusAliases = { '南湖': 'campus-nanhu', '浑南': 'campus-hunnan' };
export const campusId = value => campusAliases[value] || value;
const list = value => Array.isArray(value) ? value : value === undefined ? undefined : [value];

export function validScope(scope) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return false;
  for (const key of ['campusIds', 'departmentIds', 'objectIds', 'campuses', 'departments']) {
    const value = scope[key];
    if (value === undefined || ['campusIds', 'campuses'].includes(key) && ['bound', 'legacy'].includes(value)) continue;
    if (!Array.isArray(value) || value.length > 100 || value.some(item => typeof item !== 'string' || !item.trim() || item.length > 128)) return false;
  }
  return ['self', 'all'].every(key => scope[key] === undefined || typeof scope[key] === 'boolean');
}

// A binding adds restrictions to one complete grant; it never replaces them.
export function intersectScopes(grant = {}, binding = {}) {
  const scope = {};
  for (const [key, alias, normalize] of [['campusIds', 'campuses', campusId], ['departmentIds', 'departments', value => value], ['objectIds', 'objectIds', value => value]]) {
    const a = grant[key] ?? grant[alias]; const b = binding[key] ?? binding[alias];
    const concrete = value => value === 'bound' || value === 'legacy' ? undefined : list(value)?.map(normalize);
    const left = concrete(a), right = concrete(b);
    if (left && right) scope[key] = left.filter(value => right.includes(value));
    else if (left || right) scope[key] = left || right;
    else if (a !== undefined || b !== undefined) scope[key] = 'bound';
  }
  if (grant.self || binding.self) scope.self = true;
  if (grant.all === true && !Object.keys(scope).length) scope.all = true;
  return scope;
}
