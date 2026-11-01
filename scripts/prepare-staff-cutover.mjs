import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { root, config } from './cli.mjs';
import { remoteOptions } from './release-guard.mjs';
import { releasePlan, assertCleanRelease } from './release-plan.mjs';
import { validScope } from '../src/modules/authorization/scopes.js';
import { positionsFor, organizationRoles } from '../shared/staff-organization.js';

export const CUTOVER_MIGRATION = '0042_organization_permissions.sql';
const quote = value => value === null ? 'NULL' : "'" + String(value).replaceAll("'", "''") + "'";
const unitKinds = { hardware:'department', network:'department', office:'department', art:'department', publicity:'department', device_station:'station', network_station:'station', affairs_station:'station', center:'center' };
export class CutoverError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const requireValue = (condition, code) => { if (!condition) throw new CutoverError(code); };
const keys = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key));
const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10) === value;
function interval(input) {
  requireValue(input && day(input.effectiveFrom) && (input.effectiveTo === null || input.effectiveTo === undefined || day(input.effectiveTo) && input.effectiveTo > input.effectiveFrom),'CUTOVER_INVALID_INTERVAL');
  return [input.effectiveFrom,input.effectiveTo || null];
}
export async function cutoverDefinition(directory = resolve(root,'migrations')) {
  const sql = (await readFile(resolve(directory,CUTOVER_MIGRATION),'utf8')).replaceAll('\r\n','\n');
  const section = name => {
    const found = sql.match(new RegExp(`-- staff-cutover-${name}:start\\n([\\s\\S]+?)-- staff-cutover-${name}:end`));
    requireValue(found,'CUTOVER_DEFINITION_INVALID'); return found[1].trim();
  };
  return {sql,inputs:section('input'),state:section('state'),sha256:createHash('sha256').update(sql).digest('hex')};
}
function stateOf(sqlite, definition) {
  sqlite.exec(definition.state);
  try { return sqlite.prepare('SELECT state FROM _staff_cutover_current').get().state; }
  finally { sqlite.exec('DROP VIEW _staff_cutover_current'); }
}
// This pre-import comparison also supports the pre-members Production schema.
// Passwords, private contact data and unrelated business records are never copied.
function originalState(sqlite) {
  const columns = {
    staff_accounts:'account,member_id,name,role,status,home_campus,protected,revision,auth_version,token_version',
    staff_campus_grants:'account,campus', members:'id,name,student_id,home_campus_id,status,revision,college,major',
    member_department_memberships:'id,member_id,department_id,assignment_type,is_primary,effective_from,effective_to,revision',
    member_work_profiles:'id,member_id,profile_code,effective_from,effective_to,revision',
    member_roles:'id,member_id,role_id,scope_bindings,effective_from,effective_to,revision',
    departments:'id,code,enabled,revision', roles:'id,code,level,enabled,revision',
    role_grants:'id,role_id,permission_code,scope_spec,condition_spec,validity_spec,revision',
    permission_definitions:'code,version,enabled,scope_kinds,condition_kinds'
  };
  const selections = [];
  for (const [table,wanted] of Object.entries(columns)) {
    const present = new Set(sqlite.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
    if (!present.size) continue;
    const fields = wanted.split(',').filter(column => present.has(column));
    selections.push(`${quote(table)},(SELECT json_group_array(json_array(${fields.join(',')})) FROM (SELECT * FROM ${table} ORDER BY ${fields.join(',')}))`);
  }
  const sql = `SELECT json_object(${selections.join(',')})`;
  return {sql,value:Object.values(sqlite.prepare(sql).get())[0]};
}
export async function projectCutoverSnapshot(dump, directory = resolve(root,'migrations'), {allowApplied=false} = {}) {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec('PRAGMA foreign_keys=OFF; BEGIN;'); sqlite.exec(dump); sqlite.exec('COMMIT; PRAGMA foreign_keys=ON;');
    requireValue(!sqlite.prepare('PRAGMA foreign_key_check').all().length,'CUTOVER_SOURCE_REFERENCES_INVALID');
    const ledger = new Set(sqlite.prepare('SELECT name FROM d1_migrations').all().map(row => row.name));
    if (ledger.has(CUTOVER_MIGRATION)) {
      requireValue(allowApplied,'CUTOVER_ALREADY_APPLIED'); return {sqlite,applied:true};
    }
    const original = originalState(sqlite);
    const files = (await readdir(directory)).filter(file => file.endsWith('.sql')).sort();
    requireValue([...ledger].every(file => files.includes(file)),'CUTOVER_UNKNOWN_MIGRATION');
    for (const file of files.filter(file => file < CUTOVER_MIGRATION && !ledger.has(file))) {
      sqlite.exec('BEGIN; PRAGMA defer_foreign_keys=ON;');
      try {
        sqlite.exec(await readFile(resolve(directory,file),'utf8'));
        sqlite.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(file); sqlite.exec('COMMIT');
      } catch { sqlite.exec('ROLLBACK'); throw new CutoverError('CUTOVER_SOURCE_UPGRADE_FAILED'); }
    }
    return {sqlite,original};
  } catch (error) { sqlite.close(); throw error instanceof CutoverError ? error : new CutoverError('CUTOVER_SOURCE_INVALID'); }
}
export async function prepareCutover(sqlite, input, {environment='preview',databaseId='isolated-test',directory,original} = {}) {
  const definition = await cutoverDefinition(directory);
  requireValue(keys(input,['version','environment','members']) && input.version === 1 && input.environment === environment && Array.isArray(input.members),'CUTOVER_INPUT_INVALID');
  const people = sqlite.prepare(`SELECT m.*,EXISTS(SELECT 1 FROM staff_accounts a WHERE a.member_id=m.id AND a.protected=1) AS protected FROM members m ORDER BY m.id`).all();
  const decisions = [], seen = new Set();
  const template = code => {
    const role = sqlite.prepare('SELECT * FROM roles WHERE code=?').get(code);
    requireValue(role?.enabled === 1 && role.level < 3,'CUTOVER_INVALID_ROLE'); return role;
  };
  for (const item of input.members) {
    requireValue(keys(item,['memberId','studentId','name','decision','reason','post','exchange','authorizations']),'CUTOVER_INPUT_INVALID');
    requireValue(item && typeof item.name === 'string' && item.name.trim() && (typeof item.studentId === 'string' && item.studentId || typeof item.memberId === 'string' && item.memberId),'CUTOVER_IDENTITY_REQUIRED');
    const matches = people.filter(person => item.memberId ? person.id === item.memberId && (!item.studentId || person.student_id === item.studentId) : person.student_id === item.studentId);
    requireValue(matches.length === 1 && matches[0].name === item.name,'CUTOVER_IDENTITY_MISMATCH');
    const member = matches[0];
    requireValue(!member.protected && !seen.has(member.id),'CUTOVER_DUPLICATE_OR_PROTECTED_MEMBER'); seen.add(member.id);
    requireValue(['migrate','revoke'].includes(item.decision) && typeof item.reason === 'string' && item.reason.trim(),'CUTOVER_DECISION_REQUIRED');
    const post = item.post || null, exchange = item.exchange || null, grants = item.authorizations || [];
    requireValue(Array.isArray(grants),'CUTOVER_INVALID_AUTHORIZATION');
    requireValue(item.decision === 'revoke' ? !post && !exchange && !grants.length : !!post || !!exchange || grants.length > 0,'CUTOVER_INVALID_DECISION');
    let postDates = [null,null], exchangeDates = [null,null];
    if (post) {
      requireValue(keys(post,['departmentCode','positionCode','effectiveFrom','effectiveTo']),'CUTOVER_INPUT_INVALID');
      const kind = unitKinds[post.departmentCode];
      requireValue(kind && positionsFor({kind}).includes(post.positionCode),'CUTOVER_INVALID_POSITION');
      postDates = interval(post);
      for (const code of organizationRoles({assignmentType:'primary',isPrimary:true,positionCode:post.positionCode},{code:post.departmentCode,enabled:true})) template(code);
    }
    if (exchange) {
      requireValue(keys(exchange,['effectiveFrom','effectiveTo']),'CUTOVER_INPUT_INVALID');
      requireValue(post?.departmentCode !== 'hardware','CUTOVER_DUPLICATE_EXCHANGE');
      exchangeDates = interval(exchange); template('exchange');
    }
    const campuses = new Set(sqlite.prepare(`SELECT g.campus FROM staff_accounts a JOIN staff_campus_grants g ON g.account=a.account WHERE a.member_id=?`).all(member.id).map(row => row.campus === '南湖' ? 'campus-nanhu' : row.campus === '浑南' ? 'campus-hunnan' : ''));
    const authorizations = grants.map(grant => {
      requireValue(keys(grant,['roleCode','scope','effectiveFrom','effectiveTo','reason']),'CUTOVER_INPUT_INVALID');
      template(grant.roleCode);
      requireValue(grant.scope && validScope(grant.scope) && Object.keys(grant.scope).every(key => ['campusIds','departmentIds','objectIds','self'].includes(key)) && Array.isArray(grant.scope.campusIds) && grant.scope.campusIds.length && grant.scope.campusIds.every(campus => campuses.has(campus)),'CUTOVER_SCOPE_EXCEEDS_ACCOUNT');
      const [effectiveFrom,effectiveTo] = interval(grant);
      requireValue(typeof grant.reason === 'string' && grant.reason.trim(),'CUTOVER_AUTHORIZATION_REASON_REQUIRED');
      return {roleCode:grant.roleCode,scope:grant.scope,effectiveFrom,effectiveTo,reason:grant.reason.trim()};
    });
    decisions.push([member.id,item.decision,post?.departmentCode || null,post?.positionCode || null,...postDates,...exchangeDates,JSON.stringify(authorizations),item.reason.trim()]);
  }
  requireValue(people.filter(person => !person.protected).every(person => seen.has(person.id)),'CUTOVER_DECISIONS_INCOMPLETE');
  const source = stateOf(sqlite,definition), raw = original || originalState(sqlite);
  const businessDate = sqlite.prepare("SELECT date('now','+8 hours') AS day").get().day;
  const preparedAt = new Date().toISOString();
  const buildSql = guard => [definition.inputs,
    'CREATE TABLE _staff_cutover_import_guard(valid INTEGER NOT NULL CONSTRAINT staff_cutover_source_unchanged CHECK(valid=1));',
    guard,
    'DELETE FROM _staff_cutover_decisions; DELETE FROM _staff_cutover_batch;',
    `INSERT INTO _staff_cutover_batch VALUES(1,1,${quote(environment)},${quote(databaseId)},${quote(definition.sha256)},${quote(source)},${quote(businessDate)},${quote(preparedAt)});`,
    ...decisions.map(row => `INSERT INTO _staff_cutover_decisions VALUES(${row.map(quote).join(',')});`),
    'DROP TABLE _staff_cutover_import_guard;'
  ].filter(Boolean).join('\n');
  const sql = buildSql(`INSERT INTO _staff_cutover_import_guard SELECT 0 WHERE (${raw.sql})<>${quote(raw.value)};`);
  // Validate the complete SQL cutover locally before staging any remote input.
  // The source projection is already at 0041; only the original import guard is
  // omitted here. It remains mandatory in the generated staging SQL.
  sqlite.exec('SAVEPOINT staff_cutover_validation');
  try {
    sqlite.exec(buildSql('')); sqlite.exec(definition.sql);
    requireValue(!sqlite.prepare('PRAGMA foreign_key_check').all().length,'CUTOVER_SOURCE_REFERENCES_INVALID');
  } catch { throw new CutoverError('CUTOVER_DECISIONS_INVALID'); }
  finally { sqlite.exec('ROLLBACK TO staff_cutover_validation; RELEASE staff_cutover_validation'); }
  return {sql,summary:{environment,databaseId,migration:CUTOVER_MIGRATION,migrationSha256:definition.sha256,members:decisions.length,posts:decisions.filter(row => row[2]).length,exchanges:decisions.filter(row => row[6]).length,authorizations:decisions.reduce((n,row) => n+JSON.parse(row[8]).length,0),revocations:decisions.filter(row => row[1] === 'revoke').length}};
}
export async function privatePath(path, output=false) {
  requireValue(path && isAbsolute(path),'CUTOVER_PRIVATE_PATH_REQUIRED');
  const actual = output ? resolve(await realpath(dirname(path)),path.slice(dirname(path).length+1)) : await realpath(path);
  const inside = relative(await realpath(root),actual);
  requireValue(inside.startsWith('..') || isAbsolute(inside),'CUTOVER_INPUT_INSIDE_REPOSITORY');
  const check = spawnSync('git',['-C',dirname(actual),'rev-parse','--show-toplevel'],{encoding:'utf8'});
  requireValue(check.status !== 0,'CUTOVER_INPUT_INSIDE_REPOSITORY'); return actual;
}
function runWrangler(args) {
  const result = spawnSync(process.execPath,[resolve(root,'node_modules/wrangler/bin/wrangler.js'),...args],{cwd:root,encoding:'utf8',env:{...process.env,WRANGLER_SEND_METRICS:'false'},maxBuffer:8*1024*1024});
  requireValue(!result.error && result.status === 0,'CUTOVER_D1_OPERATION_FAILED'); return result.stdout;
}
export async function verifyCutoverSnapshot(dump, {environment,databaseId,directory} = {}) {
  const projected = await projectCutoverSnapshot(dump,directory,{allowApplied:true});
  try {
    if (projected.applied) return {cutover:'already-applied'};
    const sqlite = projected.sqlite, definition = await cutoverDefinition(directory);
    const count = sqlite.prepare('SELECT count(*) AS n FROM members WHERE id NOT IN (SELECT member_id FROM staff_accounts WHERE protected=1)').get().n;
    if (count) {
      requireValue(sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='_staff_cutover_batch'").get(),'CUTOVER_INPUT_NOT_STAGED');
      const batch = sqlite.prepare('SELECT environment,database_id,migration_sha256 FROM _staff_cutover_batch WHERE id=1').get();
      requireValue(batch?.environment === environment && batch.database_id === databaseId && batch.migration_sha256 === definition.sha256,'CUTOVER_INPUT_TARGET_OR_VERSION_MISMATCH');
    }
    sqlite.exec('BEGIN; PRAGMA defer_foreign_keys=ON;');
    try { sqlite.exec(definition.sql); requireValue(!sqlite.prepare('PRAGMA foreign_key_check').all().length,'CUTOVER_SOURCE_REFERENCES_INVALID'); }
    catch { throw new CutoverError('CUTOVER_PREFLIGHT_FAILED'); }
    finally { sqlite.exec('ROLLBACK'); }
    return {cutover:count ? 'private-input-verified' : 'empty-database',members:count};
  } finally { projected.sqlite.close(); }
}
export async function verifyRemoteCutover({preview=false,env=process.env} = {}, run=runWrangler) {
  const cfg = await config(), bindings = preview ? cfg.env.preview : cfg;
  const databaseId = bindings.d1_databases.find(item => item.binding === 'DB').database_id;
  const target = ['DB','--remote','--config',resolve(root,'wrangler.jsonc'),...(preview ? ['--env','preview'] : [])];
  const query = sql => {
    let result;
    try { result = JSON.parse(run(['d1','execute',...target,'--json','--command',sql])); }
    catch { throw new CutoverError('CUTOVER_D1_OPERATION_FAILED'); }
    requireValue(Array.isArray(result) && result.every(item => item.success && Array.isArray(item.results)),'CUTOVER_D1_OPERATION_FAILED');
    return result.flatMap(item => item.results);
  };
  // CI checks only schema names and aggregate counts. Private Production
  // snapshots and reviewed input stay on the operator's machine.
  const tables = new Set(query("SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('d1_migrations','staff_accounts','members')").map(row => row.name));
  const applied = tables.has('d1_migrations') ? `(SELECT count(*) FROM d1_migrations WHERE name='${CUTOVER_MIGRATION}')` : '0';
  const members = tables.has('members') ? '(SELECT count(*) FROM members m WHERE NOT EXISTS(SELECT 1 FROM staff_accounts a WHERE a.member_id=m.id AND a.protected=1))'
    : tables.has('staff_accounts') ? '(SELECT count(*) FROM staff_accounts WHERE protected=0)' : '0';
  const [status] = query(`SELECT ${applied} AS applied,${members} AS members`);
  requireValue(status && Number.isInteger(status.applied) && Number.isInteger(status.members),'CUTOVER_D1_OPERATION_FAILED');
  if (status.applied) return {cutover:'already-applied'};
  if (!status.members) return {cutover:'empty-database',members:0};
  requireValue(env.GITHUB_ACTIONS !== 'true','CUTOVER_LOCAL_EXECUTION_REQUIRED');
  const temporary = await mkdtemp(resolve(tmpdir(),'pioneer-cutover-check-'));
  try {
    const snapshot = resolve(temporary,'snapshot.sql');
    run(['d1','export',...target,'--output',snapshot]);
    return await verifyCutoverSnapshot(await readFile(snapshot,'utf8'),{environment:preview ? 'preview' : 'production',databaseId});
  } finally { await rm(temporary,{recursive:true,force:true}); }
}
export async function prepareStaffCutover(args = process.argv.slice(2)) {
  requireValue(process.env.GITHUB_ACTIONS !== 'true','CUTOVER_LOCAL_EXECUTION_REQUIRED');
  const values = {};
  const flags = [];
  for (let index=0;index<args.length;index++) {
    if (['--input','--snapshot','--output'].includes(args[index])) {
      requireValue(!values[args[index]] && args[index+1] && !args[index+1].startsWith('--'),'CUTOVER_ARGUMENT_INVALID');
      values[args[index]] = args[++index];
    } else flags.push(args[index]);
  }
  const options = remoteOptions(flags), environment = options.preview ? 'preview' : 'production';
  requireValue(!options.execute || !values['--snapshot'],'CUTOVER_OFFLINE_EXECUTION_FORBIDDEN');
  const inputPath = await privatePath(values['--input']);
  let input;
  try { input = JSON.parse((await readFile(inputPath,'utf8')).replace(/^\uFEFF/,'')); }
  catch { throw new CutoverError('CUTOVER_INPUT_INVALID'); }
  const cfg = await config(), bindings = options.preview ? cfg.env.preview : cfg;
  const databaseId = bindings.d1_databases.find(item => item.binding === 'DB').database_id;
  const temporary = await mkdtemp(resolve(tmpdir(),'pioneer-staff-cutover-'));
  let projected;
  try {
    const snapshot = values['--snapshot'] ? await privatePath(values['--snapshot']) : resolve(temporary,'snapshot.sql');
    const target = ['DB','--remote','--config',resolve(root,'wrangler.jsonc'),...(options.preview ? ['--env','preview'] : [])];
    if (!values['--snapshot']) runWrangler(['d1','export',...target,'--output',snapshot]);
    projected = await projectCutoverSnapshot(await readFile(snapshot,'utf8'));
    const prepared = await prepareCutover(projected.sqlite,input,{environment,databaseId,original:projected.original});
    if (values['--output']) await writeFile(await privatePath(values['--output'],true),prepared.sql,{mode:0o600,flag:'wx'});
    if (options.execute) {
      assertCleanRelease(await releasePlan('prepare-staff-cutover',options));
      const file = resolve(temporary,'private-input.sql'); await writeFile(file,prepared.sql,{mode:0o600});
      runWrangler(['d1','execute',...target,'--file',file]);
    }
    console.log(JSON.stringify({...prepared.summary,mode:options.execute ? 'private-input-staged' : 'plan-only',changesAuthorization:false}));
    return prepared.summary;
  } finally { projected?.sqlite.close(); await rm(temporary,{recursive:true,force:true}); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await prepareStaffCutover(); }
  catch (error) { console.error(error instanceof CutoverError ? error.code : 'CUTOVER_PREPARATION_FAILED'); process.exitCode = 1; }
}
