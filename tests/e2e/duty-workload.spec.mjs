import { test, expect } from './support/fixtures.mjs';
import { dutyPage, loginStaff } from './support/staff.mjs';

const people = [
  { memberId: 'member-20261002', name: '陈宇', status: 'arrived', workStatus: 'idle' },
  { memberId: 'member-20261003', name: '周宁', status: 'arrived', workStatus: 'repairing' }
];
async function dayFixture(page, canManage = false) {
  await page.route('**/api/attendance/day?*', (route) =>
    route.fulfill({
      json: {
        campusId: 'campus-nanhu',
        businessDate: '2026-10-15',
        canManage,
        items: people.map((person, index) => ({ ...person, canCorrect: canManage && index === 0 })),
        temporary: [],
        summary: { expected: 2, arrived: 2, pending: 0 }
      }
    })
  );
}

test('duty rows remain usable and stable while batched workload loads and updates', async ({
  page
}) => {
  await dayFixture(page, true);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let monthly = 9;
  let requests = 0;
  await page.route('**/api/attendance/workload?*', async (route) => {
    requests += 1;
    await gate;
    await route.fulfill({
      json: {
        month: '2026-10',
        items: people.map((person) => ({ memberId: person.memberId, monthly, total: 99 }))
      }
    });
  });
  await loginStaff(page);
  const panel = await dutyPage(page, '今日值班');
  const row = panel.locator('.duty-person').filter({ hasText: '陈宇' });
  await expect(row.getByText('空闲', { exact: true })).toBeVisible();
  const counts = row.getByLabel('陈宇接单量', { exact: true });
  await expect(counts.locator('[aria-busy="true"]')).toHaveCount(2);
  const before = await row.boundingBox();
  release();
  await expect(counts.locator('dd').first()).toHaveText('9');
  const loaded = await row.boundingBox();
  expect(loaded.height).toBe(before.height);
  expect(loaded.width).toBe(before.width);
  expect(requests).toBe(1);
  monthly = 10;
  await panel.getByRole('button', { name: '刷新值班', exact: true }).click();
  await expect(counts.locator('dd').first()).toHaveText('10');
  expect((await row.boundingBox()).height).toBe(before.height);
  expect(requests).toBe(2);
  for (const width of [320, 375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(async () => row.evaluate((node) => node.scrollWidth <= node.clientWidth))
      .toBe(true);
    const bounds = await counts.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    if (width === 1440) {
      const second = await panel.getByLabel('周宁接单量', { exact: true }).boundingBox();
      expect(second.x).toBe(bounds.x);
      expect(second.width).toBe(bounds.width);
    }
  }
});

test('workload failure is not shown as zero and refresh can recover', async ({ page }) => {
  await dayFixture(page);
  let failed = true;
  await page.route('**/api/attendance/workload?*', (route) =>
    route.fulfill(
      failed
        ? { status: 503, json: { error: '暂不可用' } }
        : {
            json: {
              month: '2026-10',
              items: people.map((person) => ({ memberId: person.memberId, monthly: 0, total: 0 }))
            }
          }
    )
  );
  await loginStaff(page);
  const panel = await dutyPage(page, '今日值班');
  const counts = panel.getByLabel('陈宇接单量', { exact: true });
  await expect(counts.locator('dd').first()).toHaveText('—');
  await expect(panel.getByText('空闲', { exact: true })).toBeVisible();
  failed = false;
  await panel.getByRole('button', { name: '刷新值班', exact: true }).click();
  await expect(counts.locator('dd').first()).toHaveText('0');
});
