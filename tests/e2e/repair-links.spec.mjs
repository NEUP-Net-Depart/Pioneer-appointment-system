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
