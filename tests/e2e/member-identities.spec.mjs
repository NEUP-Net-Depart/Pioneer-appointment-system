import { test, expect } from './support/fixtures.mjs';
import { chooseOption, loginStaff, staffPage } from './support/staff.mjs';
import { dataMotionPresets } from '../../shared/data-motion.js';
import { dateKey } from '../../shared/time.js';
import { WORKFLOW_TIME } from '../fixtures/workflow-seed.mjs';

test('an appointment created today can end today and be added again', async ({ page }) => {
  await loginStaff(page, '20261001');
  const people = await staffPage(page, '人员管理');
  await people.getByRole('button', { name: '新增人员', exact: true }).click();
  const create = page.getByRole('dialog', { name: '新增人员', exact: true });
  await create.getByLabel('学号', { exact: true }).fill('20269908');
  await create.getByLabel('姓名', { exact: true }).fill('当天结束测试');
  await create.getByRole('checkbox', { name: '交流维修', exact: true }).check();
  await create.getByRole('button', { name: '新增人员', exact: true }).click();
  await expect(create).toBeHidden();
  await people
    .locator('.react-row')
    .filter({ hasText: '当天结束测试' })
    .getByRole('button')
    .click();
  await page.getByRole('dialog').getByRole('button', { name: '任职与身份', exact: true }).click();
  const membership = page.getByRole('dialog').locator('.member-memberships');
  const history = membership.getByRole('region', { name: '任职与独立身份记录' });
  await history.getByRole('button', { name: '结束任职', exact: true }).click();
  const today = dateKey(new Date(WORKFLOW_TIME));
  const endDate = membership.getByLabel('结束日期', { exact: true });
  await expect(endDate).toHaveValue(today);
  await expect(endDate).toHaveAttribute('min', today);
  await membership.getByRole('button', { name: '确认结束任职', exact: true }).click();
  await expect(history.getByRole('button', { name: '结束任职', exact: true })).toHaveCount(0);
  await expect(history).toContainText(`${today} 至 ${today}`);
  await membership.getByRole('button', { name: '新增任职', exact: true }).click();
  await expect(
    membership.getByRole('combobox', { name: '正式部门 / 组织', exact: true })
  ).toHaveText('不添加部门');
  await membership.getByRole('checkbox', { name: '交流维修', exact: true }).check();
  await membership.getByRole('button', { name: '保存任职', exact: true }).click();
  await expect(history.getByRole('button', { name: '结束任职', exact: true })).toHaveCount(1);
  await expect(history.getByText('交流维修', { exact: true })).toHaveCount(2);
});

test('existing members can add a department and both independent identities together', async ({
  page,
  isMobile
}) => {
  await loginStaff(page, '20261001');
  const people = await staffPage(page, '人员管理');
  await people.getByRole('button', { name: '新增人员', exact: true }).click();
  const create = page.getByRole('dialog', { name: '新增人员', exact: true });
  await create.getByLabel('学号', { exact: true }).fill('20269909');
  await create.getByLabel('姓名', { exact: true }).fill('组合任职测试');
  await create.getByRole('button', { name: '新增人员', exact: true }).click();
  await expect(create).toBeHidden();
  await people
    .locator('.react-row')
    .filter({ hasText: '组合任职测试' })
    .getByRole('button')
    .click();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: '新增任职', exact: true })
  ).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: '任职与身份', exact: true }).click();
  const membership = page.getByRole('dialog').locator('.member-memberships');
  await membership.getByRole('button', { name: '新增任职', exact: true }).click();
  const department = membership.getByRole('combobox', { name: '正式部门 / 组织', exact: true });
  await expect(department).toHaveText('不添加部门');
  await membership.getByRole('button', { name: '保存任职', exact: true }).click();
  await expect(membership.getByRole('status')).toContainText('请选择正式部门或至少一种独立身份');
  await chooseOption(page, department, 'dept-network');
  await membership.getByRole('checkbox', { name: '交流维修', exact: true }).check();
  await membership.getByRole('checkbox', { name: '维修事务', exact: true }).check();
  const identities = membership.getByRole('group', { name: '独立身份', exact: true });
  await expect(identities).toHaveCSS('border-top-width', '1px');
  await expect(identities).toHaveCSS('padding-left', '12px');
  await identities.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `output/member-appointments-${isMobile ? 'mobile' : 'desktop'}.png`
  });
  await membership.getByRole('button', { name: '保存任职', exact: true }).click();
  const history = membership.getByRole('region', { name: '任职与独立身份记录' });
  await expect(history.getByRole('button', { name: '结束任职', exact: true })).toHaveCount(3);
  await expect(history).toContainText('网络部');
  await expect(history).toContainText('交流维修');
  await expect(history).toContainText('维修事务');
  await expect(membership.locator('form')).toHaveCount(0);
  await membership.getByRole('button', { name: '新增任职', exact: true }).click();
  await expect(department).toHaveText('不添加部门');
  await expect(
    membership.getByRole('checkbox', { name: '交流维修', exact: true })
  ).not.toBeChecked();
});

test('a new ordinary member applies without qualification configuration and a department head approves', async ({
  page,
  context
}) => {
  await loginStaff(page, '20261001');
  const people = await staffPage(page, '人员管理');
  await people.getByRole('button', { name: '新增人员', exact: true }).click();
  const create = page.getByRole('dialog', { name: '新增人员', exact: true });
  await create.getByLabel('学号', { exact: true }).fill('20269907');
  await create.getByLabel('姓名', { exact: true }).fill('默认激活测试');
  await create.getByRole('button', { name: '新增人员', exact: true }).click();
  await expect(create).toBeHidden();
  const applicant = await context.newPage();
  await applicant.goto('/staff/?activate=1');
  await applicant.locator('#activation-student-id').fill('20269907');
  await applicant.locator('#activation-name').fill('默认激活测试');
  await chooseOption(applicant, applicant.locator('#activation-campus'), '南湖');
  await applicant.locator('#activation-password').fill('MemberTest!2026');
  await applicant.locator('#activation-confirm').fill('MemberTest!2026');
  await applicant.getByRole('button', { name: '提交激活申请', exact: true }).click();
  await expect(applicant.locator('#activation-status')).toContainText('申请已提交');
  await people.getByRole('button', { name: '激活与账号', exact: true }).click();
  await people.getByRole('button', { name: '激活审核', exact: true }).click();
  await people.getByRole('checkbox', { name: '选择 20269907', exact: true }).check();
  await people
    .getByRole('checkbox', { name: '我已逐一核实选中申请的本人身份', exact: true })
    .check();
  await people.getByRole('button', { name: '批准申请', exact: true }).click();
  await expect(people.getByText(/已处理 1 条申请/)).toBeVisible();
  await applicant.getByRole('button', { name: '刷新审核结果', exact: true }).click();
  await expect(applicant.locator('#activation-status')).toContainText('审核已通过');
  await loginStaff(applicant, '20269907', 'MemberTest!2026');
});

test('member details remain clickable while a row is revealing', async ({ page }) => {
  await loginStaff(page, '20261001');
  const people = await staffPage(page, '人员管理');
  const button = people.getByRole('button', { name: '人员详情', exact: true }).first();
  await button.evaluate((node) => node.scrollIntoView({ block: 'center' }));
  await expect
    .poll(() =>
      button.evaluate((node) => {
        for (let parent = node; parent; parent = parent.parentElement)
          if (parent.getAnimations().some((animation) => animation.playState === 'running'))
            return false;
        return true;
      })
    )
    .toBe(true);
  await button.evaluate((node, frames) => {
    const animation = node.closest('.react-row').animate(frames, { duration: 240, fill: 'both' });
    animation.pause();
    animation.currentTime = 24;
  }, dataMotionPresets.enter.keyframes);
  const bounds = await button.boundingBox();
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('member detail buttons remain clickable at responsive breakpoints and on a small screen', async ({
  page,
  isMobile
}) => {
  await loginStaff(page, '20261001');
  const people = await staffPage(page, '人员管理');
  // Chromium covers each breakpoint; mobile WebKit covers the fixed bottom navigation.
  for (const width of isMobile ? [375] : [767, 768, 1100, 1101]) {
    await page.setViewportSize({ width, height: 900 });
    const button = people.getByRole('button', { name: '人员详情', exact: true }).last();
    await button.scrollIntoViewIfNeeded();
    // Click the scrolled position directly so automatic scrolling cannot hide an overlay regression.
    const bounds = await button.boundingBox();
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
});
