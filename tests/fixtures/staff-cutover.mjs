import { prepareCutover, cutoverDefinition } from '../../scripts/prepare-staff-cutover.mjs';

export function migrationStatements(sql) {
  const statements=[];let buffer='';
  for(const line of sql.replace(/--[^\n]*/g,'').split('\n')) {
    buffer=`${buffer}\n${line}`.trim();
    if(buffer && (buffer.startsWith('CREATE TRIGGER') ? line.trim()==='END;' : line.trim().endsWith(';'))){statements.push(buffer);buffer='';}
  }
  if(buffer)throw new Error('Incomplete test migration');return statements;
}

export function fixtureInput(people, overrides = {}) {
  return {version:1,environment:'preview',members:people.filter(person => !person.protected).map(person => ({
    memberId:person.id,name:person.name,decision:'revoke',reason:'虚构测试数据：明确撤销未经确认的旧身份',...overrides[person.id]
  }))};
}
export async function stageFixture(sqlite, overrides = {}, directory) {
  const people=sqlite.prepare(`SELECT m.*,EXISTS(SELECT 1 FROM staff_accounts a WHERE a.member_id=m.id AND a.protected=1) AS protected FROM members m`).all();
  const prepared=await prepareCutover(sqlite,fixtureInput(people,overrides),{directory});
  sqlite.exec(prepared.sql); return prepared;
}
// Use the actual D1 engine for cutover rollback tests, including the input schema.
export async function stageD1Fixture(db, overrides = {}, directory) {
  const definition=await cutoverDefinition(directory);
  await db.batch(definition.inputs.split(';').map(sql=>sql.trim()).filter(Boolean).map(sql=>db.prepare(sql)));
  await db.prepare(definition.state).run();
  const {state}=await db.prepare('SELECT state FROM _staff_cutover_current').first();
  await db.prepare('DROP VIEW _staff_cutover_current').run();
  const people=(await db.prepare(`SELECT m.*,EXISTS(SELECT 1 FROM staff_accounts a WHERE a.member_id=m.id AND a.protected=1) AS protected FROM members m`).all()).results;
  const input=fixtureInput(people,overrides);
  await db.batch([
    db.prepare('INSERT INTO _staff_cutover_batch VALUES(1,1,?,?,?,?,?)').bind('preview','isolated-test',definition.sha256,state,new Date().toISOString()),
    ...input.members.map(item=>db.prepare('INSERT INTO _staff_cutover_decisions VALUES(?,?,?,?,?,?,?,?,?,?)').bind(
      item.memberId,item.decision,item.post?.departmentCode||null,item.post?.positionCode||null,item.post?.effectiveFrom||null,item.post?.effectiveTo||null,
      item.exchange?.effectiveFrom||null,item.exchange?.effectiveTo||null,JSON.stringify(item.authorizations||[]),item.reason
    ))
  ]);
}
