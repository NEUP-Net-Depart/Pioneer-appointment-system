import { test, expect, api, login, loginApi, navigate } from './support.mjs';
import { addDays } from '../../shared/time.js';
import { randomUUID } from 'node:crypto';
test.skip(process.env.E2E_FIELD !== 'true', 'Requires the disposable field fixture');

test('real-office-reflow-and-task-settings', async ({ page, request, audit }, info) => {
  const index = ['chromium', 'webkit', 'firefox'].indexOf(info.project.use.browserName) * 5 + [360, 393, 430, 768, 1440].indexOf(info.project.use.viewport.width);
  // Separate from management.spec's published office weeks; assignments in those
  // weeks correctly make the same member unavailable for a second task.
  const week = addDays('2027-10-04', index * 7), root = await loginApi(request), office = await loginApi(request, '20261001');
  const task = await api(request, '/api/roster-tasks', root.token, { workflowVersion: 1, dutyType: 'office', weekStart: week, campusIds: ['campus-nanhu'], slotStart: '15:00', slotEnd: '17:00', deadline: `${addDays(week, -1)}T18:00:00+08:00`, memberIds: ['member-20261001'], requestId: randomUUID() });
  await api(request, `/api/roster-tasks/${task.id}/submission`, office.token, { windows: Array.from({ length: 4 }, (_, day) => ({ businessDate: addDays(week, day), campusId: 'campus-nanhu', startAt: '15:00', endAt: '17:00' })), unavailable: false, autoContinue: false, revision: -1, requestId: randomUUID() }, 'PUT');
  await api(request, `/api/roster-tasks/${task.id}/collection`, root.token, { action: 'close', revision: task.revision, requestId: randomUUID() });
  await api(request, '/api/rosters/generate', root.token, { taskId: task.id, requestId: randomUUID() });
  await login(page);
  await navigate(page, '办公排班管理');
  await page.getByLabel('收集任务', { exact: true }).selectOption(task.seriesId || task.id);
  await page.getByLabel('排班周与校区', { exact: true }).selectOption(task.id);
  await expect(page.locator('.roster-person')).toHaveCount(4);
  await page.getByRole('button', { name: '任务设置', exact: true }).click();
  await audit.capture('roster-task-settings');
  await page.getByRole('dialog').getByRole('button', { name: '增补参与人员', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '增补参与人员' })).toBeVisible();
  await audit.capture('roster-add-participants');
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  const normal = await audit.capture('real-office-roster-normal');
  expect.soft(normal.documentWidth).toBeLessThanOrEqual(normal.viewport.width + 1);
  const enlarged = await audit.captureFont200('real-office-roster');
  expect.soft(enlarged.documentWidth).toBeLessThanOrEqual(enlarged.viewport.width + 1);
  const original = info.project.use.viewport;
  await page.setViewportSize({ width: original.height, height: original.width });
  const landscape = await audit.captureFont200('real-office-roster-landscape');
  expect.soft(landscape.documentWidth).toBeLessThanOrEqual(landscape.viewport.width + 1);
  await page.setViewportSize(original);
  await page.getByRole('button', { name: '检查并发布', exact: true }).click();
  await page.getByRole('button', { name: '确认发布', exact: true }).click();
  await expect(page.getByRole('heading', { name: '班表已发布', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '调整已发布班表', exact: true }).click();
  await expect(page.getByRole('heading', { name: '正在修订已发布班表', exact: true })).toBeVisible();
  const revision = await audit.captureFont200('real-office-revision');
  expect.soft(revision.documentWidth).toBeLessThanOrEqual(revision.viewport.width + 1);
});
