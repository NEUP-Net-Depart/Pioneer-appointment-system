import { test, expect } from '@playwright/test';

for (const width of [320, 1440]) {
  test(`booking advice follows choices and counters remain readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 700 : 1000 });
    await page.goto('/');
    const warranty = page.locator('[name=warranty]'), fault = page.locator('[name=faultType]');
    await expect(page.locator('#warranty-advice')).toBeHidden();
    await expect(page.locator('#thermal-advice')).toBeHidden();
    await warranty.selectOption('是');
    await expect(page.locator('#warranty-advice')).toBeVisible();
    for (const value of ['否', '不清楚', '']) {
      await warranty.selectOption(value);
      await expect(page.locator('#warranty-advice')).toBeHidden();
    }
    await warranty.selectOption('是');
    await fault.selectOption('清灰换硅脂');
    await expect(page.locator('[name=faultType] + #thermal-advice')).toContainText('我们提供免费普通硅脂，您亦可自带');
    await expect(page.locator('#thermal-advice')).toContainText('液金');
    await fault.selectOption('蓝屏');
    await expect(page.locator('#thermal-advice')).toBeHidden();
    await fault.selectOption('清灰换硅脂');
    await page.locator('[name=issue]').fill('蓝屏🙂');
    await page.locator('[name=note]').fill('已备份');
    await expect(page.locator('#issue-count')).toHaveText('4 / 10000 字');
    await expect(page.locator('#note-count')).toHaveText('3 / 500 字');
    await page.locator('[name=issue]').fill('');
    await expect(page.locator('#issue-count')).toHaveText('0 / 10000 字');
    await page.locator('#thermal-advice').scrollIntoViewIfNeeded();
    for (const selector of ['#thermal-advice', '#issue-count', '#note-count']) {
      const box = await page.locator(selector).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    await page.screenshot({ path: `output/playwright/booking-form-hints-${width}.png`, fullPage: true });
    await page.locator('#agreement-link').click();
    await expect(page.locator('#agreement-modal')).toContainText('普通硅脂由中心提供，无需自备');
    await page.locator('#close-agreement').click();
    await page.locator('#booking-form').evaluate(form => form.reset());
    await expect(page.locator('#warranty-advice')).toBeHidden();
    await expect(page.locator('#thermal-advice')).toBeHidden();
    await expect(page.locator('#note-count')).toHaveText('0 / 500 字');
  });
}

test('textarea limits match the original server limits and count edits immediately', async ({ page }) => {
  await page.goto('/');
  for (const [name, limit] of [['issue', 10000], ['note', 500]]) {
    const input = page.locator(`[name=${name}]`), counter = page.locator(`#${name}-count`);
    await input.fill('字'.repeat(limit + 1));
    await expect(input).toHaveValue('字'.repeat(limit));
    await expect(counter).toHaveText(`${limit} / ${limit} 字`);
    await input.fill('修改');
    await expect(counter).toHaveText(`2 / ${limit} 字`);
  }
});

test('intake reminds staff to verify thermal materials only for thermal servicing', async ({ page }) => {
  await page.route('**/api/auth/login', route => route.fulfill({ json: { token: 'test-only', account: 'test-admin', role: 'admin', authorizedCampuses: ['南湖'] } }));
  await page.route('**/api/appointments/overview', route => route.fulfill({ json: { dates: ['2026-10-12'], campuses: ['南湖'], items: [], updatedAt: '2026-10-12T08:00:00Z' } }));
  await page.route('**/api/appointments?*', route => route.fulfill({ json: {
    items: ['清灰换硅脂', '蓝屏'].map((faultType, index) => ({ id: `test-${index}`, faultType, studentId: '20260001', name: '测试同学', campus: '南湖', deviceType: '笔记本电脑', brand: '测试', deviceModel: '测试', date: '2026-10-12', timeSlot: '19:00–20:00', status: 'booked', repairNote: '' })),
    counts: { all: 2, booked: 2, in_progress: 0, completed: 0 }
  } }));
  await page.goto('/staff/');
  await page.locator('#login-id').fill('test-admin');
  await page.locator('#login-password').fill('test-only-password');
  await page.locator('#login-form button').click();
  await page.locator('[data-start="test-0"]').click();
  await expect(page.locator('#intake-thermal-advice')).toBeVisible();
  await expect(page.locator('#intake-thermal-advice')).toContainText('确认设备是否使用液金');
  await page.locator('#cancel-intake').click();
  await page.locator('[data-start="test-1"]').click();
  await expect(page.locator('#intake-thermal-advice')).toBeHidden();
});
