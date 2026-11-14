import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { volunteerWorkbook } from '../frontend/staff-react/report-xlsx.js';
import { calculateVolunteerReport } from '../src/modules/attendance/volunteer-report.js';

const template = readFileSync('frontend/assets/volunteer-register-template.xlsx');
for (const count of [0, 1, 40, 601]) test(`new volunteer template exports ${count} people without leftover sample rows`, () => {
  const rows = Array.from({ length: count }, (_, index) => ({ college: '测试学院', name: `模拟人员${index}`, studentId: `000${index}`, hours: 4 }));
  const files = unzipSync(volunteerWorkbook('2026-11', { weekStart: '2026-11-02', rows }, template));
  const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
  assert.equal([...sheet.matchAll(/<row\b/g)].length, Math.max(1, count) + 3);
  assert.match(sheet, /width="25.0625"/);
  assert.match(sheet, /mergeCell ref="A1:J1"/);
  assert.match(strFromU8(files['xl/workbook.xml']), new RegExp(`Sheet1!\\$A\\$1:\\$J\\$${Math.max(4, count + 3)}<`));
  if (count) {
    assert.match(sheet, /r="C4" s="9" t="inlineStr"><is><t>0000/);
    assert.match(sheet, /2026年11月2日-11月6日/);
    assert.match(sheet, /r="E4" s="2"><v>4<\/v>/);
  }
  const strings = strFromU8(files['xl/sharedStrings.xml']);
  assert.equal([...strings.matchAll(/<si>/g)].length, 12);
  assert.doesNotMatch(strings, /王劭哲|20241834|10月19日/);
});

test('volunteer automatic credit includes all six leadership positions, not independent roles or admin alone', () => {
  const positions = ['head', 'deputy_head', 'director', 'deputy_director', 'president', 'vice_president', 'member', 'maintenance_affairs', 'exchange', 'superadmin'];
  const facts = positions.map(code => ({ memberId: code, active: true, role: code === 'superadmin' ? code : 'technician', campuses: ['南湖'], memberships: [{ positionCode: code, assignmentType: ['maintenance_affairs', 'exchange'].includes(code) ? code : 'primary', isPrimary: true, effectiveFrom: '2026-01-01' }] }));
  const report = calculateVolunteerReport({ month: '2026-11', weeks: ['2026-11-02'], settings: { mergeLeaders: true, countMode: 'weekly', hoursPerCount: 4 }, today: '2026-11-14', data: { members: positions.map(memberId => ({ memberId, name: memberId })), records: [] }, facts, paused: [], canRead: () => true });
  const rows = report.weeks[0].campuses.flatMap(campus => campus.rows);
  assert.deepEqual(rows.map(row => row.memberId).sort(), positions.slice(0, 6).sort());
  assert.ok(rows.every(row => row.hours === 4 && row.dates.length === 0));
});
