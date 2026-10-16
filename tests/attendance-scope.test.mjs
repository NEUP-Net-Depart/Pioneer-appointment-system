import test from 'node:test';
import assert from 'node:assert/strict';
import {staffPlatformService} from '../src/services/staff-platform.js';
import {createAuthorizer} from '../src/modules/authorization/public.js';
import {dateKey,addDays} from '../shared/time.js';

const actor = {account:'scope-manager',role:'technician',authorizedCampuses:['南湖','浑南']};
function setup() {
  const dates = [], today = dateKey();
  let grants = ['attendance.correct','attendance.export'].flatMap(permissionCode => [
    {permissionCode,scope:{campusIds:['campus-nanhu'],departmentIds:['dept-hardware']}},
    {permissionCode,scope:{campusIds:['campus-hunnan'],departmentIds:['dept-office']}}
  ]);
  const records = [
    ['one','campus-nanhu','dept-hardware'],['two','campus-hunnan','dept-office'],
    ['hidden-office','campus-nanhu','dept-office'],['hidden-hardware','campus-hunnan','dept-hardware']
  ].map(([id,campusId,department]) => ({id,memberId:id,campusId,primaryDepartmentIdSnapshot:department,
    departmentId:department,occurredAt:`${today}T10:00:00.000Z`,businessDate:today,attendanceCount:1}));
  const repository = {listAttendance:async () => records,attendanceExport:async () => records};
  const platform = {authorizer:createAuthorizer(),authContext:async (_actor,query) => {
    dates.push(query.businessDate); return {actor:{memberId:'manager'},grants,todayDuties:[]};
  }};
  return {service:staffPlatformService({repository,platform,manifests:[]}),repository,records,dates,setGrants:value => {grants=value;}};
}

test('attendance lists and exports evaluate each historical department/campus pair with current complete grants', async () => {
  const {service,dates} = setup();
  const list = await service.attendanceList(actor,{all:'1',businessDate:'2026-01-01'});
  assert.deepEqual(list.items.map(row => row.id),['one','two']);
  const exported = await service.attendanceExport(actor,{month:'2026-01'});
  assert.deepEqual(exported.rows.map(row => row.id),['one','two']);
  assert.ok(dates.every(day => day === dateKey()),'Requested record dates never choose the actor grant version');
});

test('future and expired attendance grants cannot be activated by changing the requested date', async () => {
  const {service,setGrants} = setup();
  for (const validity of [{effectiveFrom:addDays(dateKey(),1)},{effectiveTo:dateKey()}]) {
    setGrants(['attendance.correct','attendance.export'].map(permissionCode => ({permissionCode,scope:{campusIds:['campus-nanhu']},validity})));
    await assert.rejects(service.attendanceList(actor,{all:'1',businessDate:addDays(dateKey(),7)}),error => error.status === 403);
    await assert.rejects(service.attendanceExport(actor,{month:'2026-01'}),error => error.status === 403);
  }
});

test('attendance exports reuse safe CSV escaping and keep long or leading-zero student IDs as text', async () => {
  const {service,records} = setup();
  Object.assign(records[0],{memberName:'=HYPERLINK("untrusted")',studentId:'00123456789012345678',department:'硬件,部'});
  const result = await service.attendanceExport(actor,{month:'2026-01'});
  assert.ok(result.csv.includes('"\'=HYPERLINK(""untrusted"")"'));
  assert.ok(result.csv.includes('"\'00123456789012345678"'));
  assert.ok(result.csv.includes('"硬件,部"'));
  assert.equal(result.rows[0].studentId,'00123456789012345678','CSV formatting does not modify the public row values');
});

test('attendance pagination scans past inaccessible facts and returns cursors for visible records only', async () => {
  const {service,repository} = setup(), facts = [];
  for (let index=0;index<320;index++) facts.push({id:`attendance-${String(999-index).padStart(3,'0')}`,memberId:'member',
    campusId:'campus-nanhu',primaryDepartmentIdSnapshot:index<110 ? 'dept-office' : 'dept-hardware',occurredAt:'2026-01-01T10:00:00.000Z'});
  repository.listAttendance = async ({after}) => facts.filter(row => !after || row.occurredAt<after.occurredAt || row.occurredAt===after.occurredAt && row.id<after.id).slice(0,101);
  const seen = []; let cursor='',pages=0;
  do {
    const page = await service.attendanceList(actor,{all:'1',cursor});
    assert.equal(page.items.length,pages<2 ? 100 : 10);
    assert.ok(page.items.every(row => row.primaryDepartmentIdSnapshot==='dept-hardware'));
    seen.push(...page.items.map(row => row.id)); cursor=page.nextCursor; pages++;
    if (cursor) assert.equal(JSON.parse(decodeURIComponent(cursor))[1],page.items.at(-1).id);
  } while(cursor);
  assert.deepEqual(seen,facts.slice(110).map(row => row.id));
  await assert.rejects(service.attendanceList(actor,{all:'1',cursor:'bad'}),error => error.status === 400);
});
