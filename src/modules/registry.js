import { identityManifest } from './identity/manifest.js';
import { organizationManifest } from './organization/manifest.js';
import { authorizationManifest } from './authorization/manifest.js';
import { repairsManifest } from './repairs/manifest.js';
import { dutyManifest } from './duty/manifest.js';
import { attendanceManifest } from './attendance/manifest.js';
import { rostersManifest } from './rosters/manifest.js';
import { meetingsManifest } from './meetings/manifest.js';
import { auditManifest } from './audit/manifest.js';
import { filesManifest } from './files/manifest.js';
import { meetingFixtureManifest } from './meetings/public.js';
import { generateRoster as publicRosterGenerator } from './rosters/public.js';
import { membershipIsActive } from './organization/public.js';
import { workspacePermissions } from './authorization/workspace.js';

export const manifests = [identityManifest, organizationManifest, authorizationManifest, repairsManifest, dutyManifest, attendanceManifest, rostersManifest, meetingsManifest, auditManifest, filesManifest];
export const extensionContracts = { meetingFixtureManifest, publicRosterGenerator, membershipIsActive };

export function manifestHash(manifest) {
  const json = JSON.stringify(manifest);
  let hash = 2166136261;
  for (let index = 0; index < json.length; index += 1) hash = Math.imul(hash ^ json.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function validateManifests(items = manifests) {
  const errors = [];
  const codes = items.map(item => item.code);
  if (new Set(codes).size !== codes.length) errors.push('duplicate module code');
  const permissions = items.flatMap(item => item.permissions || []);
  if (new Set(permissions).size !== permissions.length) errors.push('duplicate permission code');
  const routes = items.flatMap(item => item.routes || []);
  if (new Set(routes).size !== routes.length) errors.push('duplicate route');
  for (const item of items) for (const dependency of item.dependencies || []) {
    const code = dependency.split('@')[0];
    if (!codes.includes(code)) errors.push(`${item.code} depends on missing ${dependency}`);
  }
  for (const item of items) {
    if (!item.version || !item.contractVersion || !item.requiredSchemaVersion) errors.push(`${item.code} is missing a version contract`);
    if (!['test', 'ready', 'disabled'].includes(item.releaseState)) errors.push(`${item.code} has an invalid release state`);
  }
  const dependencyMap = Object.fromEntries(items.map(item => [item.code, (item.dependencies || []).map(value => value.split('@')[0])]));
  const visiting = new Set(), visited = new Set();
  function visit(code, path = []) {
    if (visiting.has(code)) { errors.push(`module dependency cycle: ${[...path, code].join(' -> ')}`); return; }
    if (visited.has(code)) return;
    visiting.add(code);
    for (const dependency of dependencyMap[code] || []) visit(dependency, [...path, code]);
    visiting.delete(code); visited.add(code);
  }
  for (const code of codes) visit(code);
  return {
    valid: errors.length === 0,
    errors,
    summary: items.map(item => ({
      code: item.code,
      version: item.version,
      manifestHash: manifestHash(item),
      contractVersion: item.contractVersion,
      requiredSchemaVersion: item.requiredSchemaVersion,
      releaseState: item.releaseState
    }))
  };
}

export function publishedManifests(items = manifests) {
  return items.filter(item => item.releaseState === 'ready');
}

export function navigationFor(actor, grants = [], items = manifests, context = {}) {
  const permissions = workspacePermissions(actor, { ...context, grants });
  return publishedManifests(items).flatMap(item => (item.navigation || []).filter(entry => permissions[entry.permission]).map(entry => ({ ...entry, module: item.code, moduleVersion: item.version })));
}

export function workbenchProviders(items = manifests) {
  return publishedManifests(items).flatMap(item => (item.workbenchProviders || []).map(provider => ({ provider, module: item.code, version: item.version })));
}
