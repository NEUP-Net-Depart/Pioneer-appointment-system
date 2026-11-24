import { runWorkflow } from '../fixtures/workflow-seed.ts';
import { test, expect } from './support/fixtures.ts';
import { dutyPage, loginStaff } from './support/staff.ts';

const people = [
  { memberId: 'member-20261002', name: '陈宇', status: 'arrived', workStatus: 'idle' },
  { memberId: 'member-20261003', name: '周宁', status: 'arrived', workStatus: 'repairing' }
];
async function dayFixture(page: import('@playwright/test').Page, canManage = false) {
  await page.route('**/api/attendance/day?*', (route: import('@playwright/test').Route) =>
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

test('staff can see duty status while both workloads load and refresh together', async ({
  page
}) => {
  await dayFixture(page, true);
  const { promise: gate, resolve: release } = Promise.withResolvers<void>();
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
  release();
  await expect(counts.locator('dd').first()).toHaveText('9');
  const second = panel.getByLabel('周宁接单量', { exact: true });
  await expect(second.locator('dd').first()).toHaveText('9');
  expect(requests).toBe(1);
  monthly = 10;
  await panel.getByRole('button', { name: '刷新值班', exact: true }).click();
  await expect(counts.locator('dd').first()).toHaveText('10');
  await expect(second.locator('dd').first()).toHaveText('10');
  expect(requests).toBe(2);
});

test('workload failure is not shown as zero and refresh can recover', async ({ page }) => {
  let failed: boolean, panel: import("@playwright/test").Locator, counts: import("@playwright/test").Locator;

  await runWorkflow(
    'ui-workload-refresh',
    'initial',
    [
      ['initial', 'LOAD_FAILURE', 'failed'],
      ['failed', 'RETRY', 'loaded']
    ],
    [
      {
        event: 'LOAD_FAILURE',

        run: async () => {
          await dayFixture(page);
          failed = true;
          await page.route('**/api/attendance/workload?*', (route) =>
            route.fulfill(
              failed
                ? { status: 503, json: { error: '暂不可用' } }
                : {
                    json: {
                      month: '2026-10',
                      items: people.map((person) => ({
                        memberId: person.memberId,
                        monthly: 0,
                        total: 0
                      }))
                    }
                  }
            )
          );
          await loginStaff(page);
          panel = await dutyPage(page, '今日值班');
          counts = panel.getByLabel('陈宇接单量', { exact: true });
          await expect(counts.locator('dd').first()).toHaveText('—');
          await expect(panel.getByText('空闲', { exact: true })).toBeVisible();
        }
      },
      {
        event: 'RETRY',

        run: async () => {
          failed = false;
          await panel.getByRole('button', { name: '刷新值班', exact: true }).click();
          await expect(counts.locator('dd').first()).toHaveText('0');
        }
      }
    ]
  );
});
