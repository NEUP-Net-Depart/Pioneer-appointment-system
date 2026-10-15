import { test, expect } from '@playwright/test';
import { setupStudent,chooseTime,fillDevice,goReview } from './support/student.mjs';
for(const width of [320,1440])test(`student shows only the requested fault advice and review reminders at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});await setupStudent(page);await chooseTime(page);await fillDevice(page);
  await page.locator('[name=warranty][value="是"]').check();
  for(const [fault,message] of [['清灰换硅脂','我们免费提供普通硅脂，也可自行携带。'],['换硬盘','更换硬盘所需配件请自行准备；不确定兼容性可在故障描述中说明。'],['换内存','更换内存所需配件请自行准备；不确定兼容性可在故障描述中说明。']]){
    await page.locator(`[name=faultType][value="${fault}"]`).check();await expect(page.locator('[name=faultType]:checked')).toHaveCount(1);
    await expect(page.locator('#fault-advice')).toBeVisible();await expect(page.locator('#fault-advice-title')).toHaveText(fault+'须知');await expect(page.locator('#fault-advice-message')).toHaveText(message);await expect(page.locator('#fault-advice')).not.toContainText('液金');
  }
  for(const fault of ['系统问题','蓝屏','黑屏','网络问题','其他']){await page.locator(`[name=faultType][value="${fault}"]`).check();await expect(page.locator('#fault-advice')).toBeHidden();}
  await page.locator('[name=faultType][value="蓝屏"]').check();
  await expect(page.locator('#warranty-advice, #issue-hint, #issue-count')).toHaveCount(0);
  await page.locator('[name=issue]').fill('蓝屏🙂');
  await page.locator('[name=brand]').selectOption('Dell');await expect(page.locator('#dell-g15-field')).toBeVisible();await page.locator('[name=dellG15][value="不清楚"]').check();await page.locator('[name=brand]').selectOption('联想');await expect(page.locator('#dell-g15-field')).toBeHidden();await expect(page.locator('[name=dellG15]:checked')).toHaveCount(0);
  await page.locator('[name=contactType][value=wechat]').check();await page.locator('[name=wechatAccount]').fill('other-account');await page.locator('[name=contactType][value=qq]').check();await goReview(page);await expect(page.locator('#booking-review')).toContainText('123456789');await expect(page.locator('#booking-review')).not.toContainText('other-account');
  await expect(page.locator('.booking-preparation')).toBeVisible();await expect(page.locator('.booking-preparation')).toContainText('提前备份重要数据');await expect(page.locator('.booking-preparation')).toContainText('携带设备及对应电源适配器');
  await page.locator('#agreement-link').click();await expect(page.locator('#agreement-modal')).toContainText('普通硅脂由中心提供，无需自备');await page.locator('#close-agreement').click();await expect(page.locator('[name=agreement]')).not.toBeChecked();await expect(page.locator('#signature-modal')).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('other fault, brand and college validate at the first error while all other input is retained',async({page})=>{
  await setupStudent(page);await chooseTime(page);await fillDevice(page);await page.locator('[name=faultType][value="其他"]').check();await page.locator('#step-two-next').click();await expect(page.locator('[data-error-for=issue]')).toHaveText('请输入故障描述与补充说明');await expect(page.locator('[name=issue]')).toBeFocused();await expect(page.locator('[name=name]')).toHaveValue('预约测试同学');
  await page.locator('[name=issue]').fill('字'.repeat(1001));await expect(page.locator('[name=issue]')).toHaveValue('字'.repeat(1000));await expect(page.locator('[data-error-for=issue]')).toBeEmpty();await page.locator('[name=issue]').fill('🙂'.repeat(1000));await page.locator('[name=brand]').selectOption('other');await page.locator('[name=brandOther]').fill('自行组装');await page.locator('[name=college]').selectOption('other');await page.locator('[name=collegeOther]').fill('完整学院名称');await goReview(page);await expect(page.locator('#booking-review')).toContainText('完整学院名称');await expect(page.locator('#booking-review')).not.toContainText('不能超过');await expect(page.locator('#booking-review')).toContainText('自行组装');
});
test('intake reminds staff to verify thermal materials only for thermal servicing', async ({ page }) => {
  await page.route('**/api/scan/current', route => route.fulfill({ json: { items: [], pending: null } }));
  await page.route('**/api/auth/login', route => route.fulfill({ json: { token: 'test-only', account: 'test-admin', role: 'admin', authorizedCampuses: ['南湖'] } }));
  await page.route('**/api/appointments/overview', route => route.fulfill({ json: { dates: ['2026-10-12'], campuses: ['南湖'], items: [], updatedAt: '2026-10-12T08:00:00Z' } }));
  await page.route('**/api/appointments?*', route => route.fulfill({ json: {
    items: ['清灰换硅脂', '蓝屏'].map((faultType, index) => ({ id: `test-${index}`, faultType, studentId: '20260001', name: '测试同学', campus: '南湖', deviceType: '笔记本电脑', brand: '测试', deviceModel: '测试', date: '2026-10-12', timeSlot: '19:00–19:30', status: 'booked', repairNote: '' })),
    counts: { all: 2, booked: 2, in_progress: 0, completed: 0, cancelled: 0, expired: 0 }
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
