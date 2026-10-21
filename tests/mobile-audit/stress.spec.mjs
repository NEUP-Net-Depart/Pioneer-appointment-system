/* global document, getComputedStyle */
import { test, expect, login, loginApi, navigate, orderFixture } from './support.mjs';

test.skip(process.env.E2E_FIELD !== 'true', 'Requires the disposable field fixture');
const fit = sample => expect.soft(sample.documentWidth, sample.id).toBeLessThanOrEqual(sample.viewport.width + 1);

test('presentation-dense-roster-long-names-font200', async ({ page, audit }, info) => {
  // Presentation only: API fixtures are explicitly distinguished from real D1 workflows.
  const campusIds = ['campus-nanhu', 'campus-hunnan'];
  const slots = campusIds.flatMap(campusId => Array.from({ length: 4 }, (_, day) => ({ businessDate: `2027-07-${String(5 + day).padStart(2, '0')}`, campusId, startAt: '19:00', endAt: '21:00', ordinaryMinimum: 6 })));
  const assignments = slots.flatMap(slot => Array.from({ length: 7 }, (_, i) => ({ ...slot, memberId: `dense-${slot.businessDate}-${slot.campusId}-${i}`, roleKind: i === 0 ? 'repair_lead' : '', locked: false })));
  const members = assignments.map((row, index) => ({ memberId: row.memberId, name: index === 1 ? '欧阳司徒测试很长姓名'.repeat(7) : `示例人员${index + 1}`, pool: row.roleKind ? 'lead' : 'ordinary', identities: [{ code: row.roleKind ? 'repair_lead' : 'repair_staff', label: row.roleKind ? '维修值班负责人' : '维修工作人员' }], available: slots, manualSlots: slots, reportedWindows: slots }));
  const task = { id: 'mobile-dense-roster', weekStart: '2027-07-05', scopeLabel: '南湖、浑南 · 每班七人', dutyType: 'repair', campusScope: { campusIds }, slotStart: '19:00', slotEnd: '21:00', actions: { manage: true, configure: true } };
  await page.route('**/api/roster-tasks', route => route.fulfill({ json: { items: [task] } }));
  await page.route('**/api/roster-tasks/mobile-dense-roster/roster', route => route.fulfill({ json: { task, stage: 'adjusting', collectionState: 'closed', members, slots, protectedAssignments: [], draft: { id: 'mobile-dense-draft', status: 'draft', version: 0, assignments, validation: { valid: true, errors: [] } } } }));
  await login(page);
  await navigate(page, '维修排班管理');
  await expect(page.locator('.roster-person')).toHaveCount(56);
  fit(await audit.capture('dense-roster-56', { axe: true }));
  const adjust = page.locator('.roster-person:visible').first().getByRole('button');
  await adjust.focus();
  await page.keyboard.press('Enter');
  fit(await audit.capture('dense-roster-adjust-dialog'));
  // Native dialog keyboard trap, Escape and restoration of opener focus.
  for (let count = 0; count < 14; count++) {
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => ({ inside: !!document.activeElement.closest('dialog[open]'), element: document.activeElement.outerHTML.slice(0, 600) }));
    audit.diagnostics.notes.push({ step: count, focus });
    // Native dialog focus may visit browser chrome (activeElement=body), see W3C H102.
    // Safari's default Tab excludes some buttons; this must not be reported as background-page escape.
    expect.soft(focus.inside || focus.element.startsWith('<body'), `Background page received dialog focus: ${focus.element}`).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect.soft(adjust).toBeFocused();
  await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('*')];
    const sizes = nodes.map(node => parseFloat(getComputedStyle(node).fontSize));
    nodes.forEach((node, i) => { if (sizes[i]) node.style.fontSize = `${sizes[i] * 2}px`; });
  });
  fit(await audit.capture('dense-roster-font200'));
  const original = info.project.use.viewport;
  await page.setViewportSize({ width: original.height, height: original.width });
  fit(await audit.capture('dense-roster-landscape-font200'));
});

test('presentation-many-records-members-and-empty-errors', async ({ page, request, audit }, info) => {
  const office = await loginApi(request, '20261001');
  await orderFixture(request, office.token, info);
  await page.route('**/api/appointments?*', async route => {
    const response = await route.fetch();
    const data = await response.json();
    const template = data.items[0];
    const query = new URL(route.request().url()).searchParams.get('q');
    if (!query && !template) throw new Error('Presentation stress requires a local workflow record');
    data.items = query ? [] : Array.from({ length: 100 }, (_, i) => ({ ...template, id: `reserve020261015-${2000 + i}`, name: '欧阳司徒长姓名同学'.repeat(8), deviceModel: 'L'.repeat(120), issue: 'https://example.invalid/' + 'a'.repeat(900) }));
    await route.fulfill({ response, json: data });
  });
  await login(page);
  await navigate(page, '预约记录');
  await expect(page.locator('.records-table tbody tr')).toHaveCount(100);
  fit(await audit.capture('records-100-long-content', { axe: true }));
  await page.getByLabel('查找预约', { exact: true }).fill('no-match-audit');
  await expect(page.locator('.records-table tbody tr')).toHaveCount(0);
  fit(await audit.capture('records-empty-result'));
  await page.route('**/api/members?*', async route => {
    const response = await route.fetch();
    const data = await response.json();
    const template = data.items[0];
    if (!template) throw new Error('Presentation stress needs the original isolated member fixture');
    data.items = Array.from({ length: 100 }, (_, i) => ({ ...template, memberId: `mobile-long-${i}`, name: '欧阳司徒长姓名同学'.repeat(8), studentId: String(20800000 + i) }));
    await route.fulfill({ response, json: data });
  });
  await navigate(page, '成员管理');
  await expect(page.locator('.members-results .react-row:not(.react-row-head)')).toHaveCount(100);
  fit(await audit.capture('members-100-long-names', { axe: true }));
  await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('*')];
    const sizes = nodes.map(node => parseFloat(getComputedStyle(node).fontSize));
    nodes.forEach((node, i) => { if (sizes[i]) node.style.fontSize = `${sizes[i] * 2}px`; });
  });
  fit(await audit.capture('members-font200'));
});
