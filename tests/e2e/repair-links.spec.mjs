import { runWorkflow } from '../fixtures/workflow-seed.mjs';
import { test, expect } from './support/fixtures.mjs';
import { loginStaff, staffPage, onsiteOrder, staffApi, chooseOption } from './support/staff.mjs';

test('repair-induced relationship requires renewed confirmation and displays its saved reason', async ({
  page
}) => {
  let dialog, confirmation, submit;

  await runWorkflow(
    'ui-repair-link',
    'initial',
    [
      ['initial', 'CHANGE_REASON', 'needsConfirmation'],
      ['needsConfirmation', 'REQUIRE_CONFIRMATION', 'needsConfirmation'],
      ['needsConfirmation', 'CONFIRM_AND_LINK', 'linked']
    ],
    [
      {
        event: 'CHANGE_REASON',

        run: async () => {
          await loginStaff(page, '20261003');
          const parent = await onsiteOrder(page);
          const started = await staffApi(
            page,
            `/api/appointments/${parent.id}/status`,
            {
              revision: parent.revision,
              requestId: crypto.randomUUID(),
              status: 'in_progress',
              photosCaptured: true,
              uploadTimedOut: true
            },
            'PATCH'
          );
          await staffApi(
            page,
            `/api/appointments/${parent.id}/status`,
            {
              revision: started.revision,
              requestId: crypto.randomUUID(),
              status: 'completed',
              outcome: 'repaired',
              repairNote: '模拟原故障维修完成'
            },
            'PATCH'
          );
          const child = await onsiteOrder(page, { faultType: '维修后新增故障' });
          await staffPage(page, '今日工作');
          await page.getByRole('button', { name: '刷新工作台', exact: true }).click();
          await page.getByRole('button').filter({ hasText: child.id }).first().click();
          dialog = page.getByRole('dialog', { name: '维修工单', exact: true });
          await chooseOption(
            page,
            dialog.getByRole('combobox', { name: '选择原工单', exact: true }),
            parent.id
          );
          confirmation = dialog.getByRole('checkbox', { name: /已核对为同一设备/ });
          await confirmation.check();
          await chooseOption(
            page,
            dialog.getByRole('combobox', { name: '关联原因', exact: true }),
            'repair_induced'
          );
          await expect(confirmation).not.toBeChecked();
          await expect(confirmation).toHaveAccessibleName('已核对为同一设备，且新故障由原维修引入');
        }
      },
      {
        event: 'REQUIRE_CONFIRMATION',

        run: async () => {
          submit = dialog.getByRole('button', { name: '关联现有工单', exact: true });
          await expect(submit).toBeDisabled();
        }
      },
      {
        event: 'CONFIRM_AND_LINK',

        run: async () => {
          await confirmation.check();
          await submit.click();
          await expect(dialog.getByText('本次关联原单', { exact: false })).toContainText(
            '维修引入新故障'
          );
          await expect(dialog.getByRole('combobox', { name: '关联原因', exact: true })).toHaveCount(
            0
          );
        }
      }
    ]
  );
});

test('private query links require explicit issuance and stay available until copied or delivered', async ({ page }) => {
  await loginStaff(page);
  const order = await onsiteOrder(page);
  const lookup = token => page.request.get(`/api/appointments/${order.id}`, {
    headers: { 'X-Appointment-Token': token }
  });
  let issued = 0;
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().endsWith(`/appointments/${order.id}/credential`)) issued++;
  });
  await staffPage(page, '今日工作');
  await page.getByRole('button', { name: '刷新工作台', exact: true }).click();
  const open = () => page.getByRole('button').filter({ hasText: order.id }).first().click();
  await open();
  const dialog = page.getByRole('dialog', { name: '维修工单', exact: true });
  const confirmation = page.getByRole('dialog', { name: '有未保存的调整', exact: true });
  const panel = dialog.locator('.repair-credential .repair-control-panel');
  async function fillVerification() {
    await dialog.getByRole('button', { name: '补发查询链接', exact: true }).click();
    await panel.getByRole('checkbox', { name: '已人工核验机主身份', exact: true }).check();
    await panel.getByLabel('核验说明（勿录入完整联系方式）', { exact: true }).fill('已当面核对机主身份与设备信息');
  }
  await fillVerification();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(confirmation).toContainText('请返回工单点击“签发私人链接”');
  await expect(confirmation.getByRole('button', { name: '保存并继续', exact: true })).toHaveCount(0);
  await confirmation.getByRole('button', { name: '取消操作', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  // An update notification uses this same navigation event while a dialog is open.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('staff-request-navigation', { detail: '__refresh__' })));
  await expect(confirmation).toContainText('请返回工单点击“签发私人链接”');
  await expect(confirmation.getByRole('button', { name: '保存并继续', exact: true })).toHaveCount(0);
  await confirmation.getByRole('button', { name: '取消操作', exact: true }).click();
  await expect(panel.getByRole('checkbox')).toBeChecked();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await confirmation.getByRole('button', { name: '丢弃并继续', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(issued).toBe(0);
  expect((await lookup(order.accessToken)).ok()).toBe(true);

  await open();
  await fillVerification();
  await panel.getByRole('button', { name: '签发私人链接', exact: true }).click();
  const link = panel.getByRole('textbox', { name: '新私人查询链接', exact: true });
  await expect(link).toBeVisible();
  const url = await link.inputValue();
  const token = new URLSearchParams(new URL(url).hash.slice(1)).get('access');
  expect(token).toBeTruthy();
  expect(token).not.toBe(order.accessToken);
  expect((await lookup(token)).ok()).toBe(true);
  expect((await lookup(order.accessToken)).status()).toBe(404);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(confirmation).toContainText('新链接尚未复制');
  await confirmation.getByRole('button', { name: '取消操作', exact: true }).click();
  await expect(link).toHaveValue(url);

  const copies = [];
  await page.exposeFunction('recordCredentialCopy', value => copies.push(value));
  await page.evaluate(() => {
    let denied = true;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText(value) {
        if (denied) {
          denied = false;
          return Promise.reject(new DOMException('Denied', 'NotAllowedError'));
        }
        return window.recordCredentialCopy(value);
      } }
    });
  });
  await panel.getByRole('button', { name: '复制私人查询链接', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('请手动复制上方链接');
  await expect(link).toHaveValue(url);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(confirmation).toContainText('新链接尚未复制');
  await confirmation.getByRole('button', { name: '取消操作', exact: true }).click();
  await panel.getByRole('button', { name: '复制私人查询链接', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('已复制新链接');
  expect(copies).toEqual([url]);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(issued).toBe(1);
});
