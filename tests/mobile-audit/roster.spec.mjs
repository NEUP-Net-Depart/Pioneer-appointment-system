import { test, expect, api, login, loginApi, navigate } from './support.mjs';
import { randomUUID } from 'node:crypto';
import { addDays } from '../../shared/time.js';
test.skip(process.env.E2E_FIELD !== 'true', 'Requires the disposable field fixture');
const fit = sample => expect.soft(sample.documentWidth, sample.id).toBeLessThanOrEqual(sample.viewport.width + 1);
const index = info => ['chromium', 'webkit', 'firefox'].indexOf(info.project.use.browserName) * 5 + [360, 393, 430, 768, 1440].indexOf(info.project.use.viewport.width);

async function prepared(request, info, dutyType) {
  const root = await loginApi(request), week = addDays('2027-03-01', index(info) * 7);
  const accounts = dutyType === 'office' ? ['20261002', '20261003'] : ['20261002', '20261004'];
  if (dutyType === 'office') for (const account of accounts) {
    const detail = await api(request, `/api/members/member-${account}`, root.token);
    if (!detail.member.workProfiles.some(row => row.profileCode === 'office')) await api(request, `/api/members/member-${account}/work-profiles`, root.token, { profileCode: 'office', effectiveFrom: '2026-01-01', revision: detail.member.revision, requestId: randomUUID() });
  }
  const slotStart = dutyType === 'office' ? '17:00' : '19:00', slotEnd = dutyType === 'office' ? '19:00' : '21:00';
  const task = await api(request, '/api/roster-tasks', root.token, { workflowVersion: 1, dutyType, weekStart: week, campusIds: ['campus-nanhu'], slotStart, slotEnd, deadline: `${addDays(week, -1)}T18:00:00+08:00`, memberIds: accounts.map(account => `member-${account}`), requestId: randomUUID() });
  for (const account of accounts) {
    const actor = await loginApi(request, account);
    await api(request, `/api/roster-tasks/${task.id}/submission`, actor.token, { windows: Array.from({ length: 4 }, (_, day) => ({ businessDate: addDays(week, day), campusId: 'campus-nanhu', startAt: slotStart, endAt: slotEnd })), unavailable: false, autoContinue: false, revision: -1, requestId: randomUUID() }, 'PUT');
  }
  return { root, week, task };
}

test('repair-roster-real-generate-adjust-publish', async ({ page, request, audit }, info) => {
  const { week, task } = await prepared(request, info, 'repair');
  await login(page, '20261004');
  await navigate(page, '维修排班管理');
  await page.getByLabel('收集任务', { exact: true }).selectOption(task.seriesId || task.id);
  await page.getByLabel('排班周与校区', { exact: true }).selectOption(task.id);
  await page.getByRole('button', { name: '结束收集', exact: true }).click();
  await page.getByRole('button', { name: '确认结束收集', exact: true }).click();
  await page.getByRole('button', { name: '生成自动排班', exact: true }).click();
  await expect(page.locator('.roster-person')).toHaveCount(2);
  fit(await audit.capture('repair-roster-real-draft', { axe: true }));
  const person = page.locator('.roster-person:visible').first();
  await person.getByRole('button').click();
  await page.getByRole('dialog').getByLabel('锁定此班次', { exact: true }).check();
  fit(await audit.capture('repair-roster-real-lock'));
  await page.getByRole('dialog').getByRole('button', { name: '完成调整', exact: true }).click();
  await page.getByRole('button', { name: '保存并校验', exact: true }).click();
  await expect(page.getByText('调整已保存，已重新校验。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '检查并发布', exact: true }).click();
  await page.getByRole('dialog').getByLabel('发布原因', { exact: true }).fill('本地隔离审查使用两名成员，已核实缺额并安排人工补位');
  for (const checkbox of await page.getByRole('dialog').locator('input[type=checkbox]').all()) await checkbox.check();
  fit(await audit.capture('repair-roster-real-publication'));
  await page.getByRole('button', { name: '确认发布', exact: true }).click();
  await expect(page.getByRole('heading', { name: '班表已发布', exact: true })).toBeVisible();
  await audit.capture('repair-roster-real-published');
  const technician = await loginApi(request, '20261002');
  expect((await api(request, `/api/me/roster?weekStart=${week}`, technician.token)).items.filter(row => row.dutyType === 'repair')).toHaveLength(1);
});

test('swap-real-preview-send-accept-history', async ({ page, request, audit }, info) => {
  const { root, week, task } = await prepared(request, info, 'office');
  await api(request, `/api/roster-tasks/${task.id}/collection`, root.token, { action: 'close', revision: task.revision, requestId: randomUUID() });
  const generated = await api(request, '/api/rosters/generate', root.token, { taskId: task.id, requestId: randomUUID() });
  expect(generated.validation.valid).toBe(true);
  await api(request, `/api/rosters/${generated.version.id}/publish`, root.token, { version: generated.version.version, requestId: randomUUID() });
  await login(page, '20261002');
  await navigate(page, '班次与排班');
  await page.getByLabel('值班周', { exact: true }).selectOption(week);
  // These users also have published repair shifts in the same week; choose the office shift.
  const source = page.locator('.duty-card').filter({ hasText: '办公接待' });
  await expect(source).toHaveCount(2);
  const sourceDay = (await source.first().locator('strong').first().innerText()).trim();
  await source.first().getByRole('button', { name: '发起换班', exact: true }).click();
  const targets = page.getByRole('combobox', { name: '希望调换到', exact: true });
  const option = targets.locator('option').filter({ hasText: '周宁' }).first();
  await expect(option).toHaveCount(1);
  await targets.selectOption(await option.getAttribute('value'));
  await expect(page.getByRole('region', { name: '交换后的班次', exact: true })).toContainText('周宁');
  await page.getByLabel('换班说明').fill(`本地移动换班审查${info.project.name}`);
  fit(await audit.capture('swap-composer-preview', { axe: true }));
  await page.getByRole('button', { name: '发送换班邀请', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '换班申请已发送' })).toBeVisible();
  await page.evaluate(() => sessionStorage.clear());
  await login(page, '20261003');
  await navigate(page, '班次与排班');
  await page.getByRole('button', { name: /我的申请/ }).click();
  const invitation = page.locator('.swap-invitation').filter({ hasText: sourceDay });
  await invitation.getByRole('button', { name: '查看并确认', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '换班详情', exact: true });
  await expect(confirmation.getByRole('button', { name: '确认并同意换班', exact: true })).toBeEnabled();
  fit(await audit.capture('swap-invitation-confirm', { axe: true }));
  await confirmation.getByRole('button', { name: '确认并同意换班', exact: true }).click();
  await expect(confirmation).toBeHidden();
  await expect(invitation).toContainText('已生效');
  await invitation.getByRole('button', { name: '查看详情', exact: true }).click();
  fit(await audit.capture('swap-history'));
});
