import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {validateRemoteConfig} from './release-guard.mjs';
export const root = fileURLToPath(new URL('..', import.meta.url));
export function wrangler(args, { capture = false } = {}) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url)), ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  if (result.error || result.status !== 0) throw result.error || new Error(`Wrangler exited ${result.status}`);
  return result.stdout;
}
export async function config({staffStaging=false}={}) { return JSON.parse(await readFile(new URL(staffStaging ? '../wrangler.staff-staging.jsonc' : '../wrangler.jsonc', import.meta.url), 'utf8')); }
export async function localVars() {
  const contents = await readFile(new URL('../.dev.vars', import.meta.url), 'utf8');
  return Object.fromEntries(contents.split(/\r?\n/).flatMap(line => {
    const match = line.match(/^([A-Z_\d]+)=(.*)$/);
    return match ? [[match[1], match[2].replace(/^['"]|['"]$/g, '')]] : [];
  }));
}
export async function remoteConfig({staffStaging=false}={}) {
  const base=validateRemoteConfig(await config());
  if(!staffStaging)return base;
  const {validateStaffConfig}=await import('./release-guard.mjs');
  return validateStaffConfig(base,await config({staffStaging:true}));
}
