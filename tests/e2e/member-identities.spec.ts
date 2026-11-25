import type { StaffResult } from './support/staff.ts';
import { test, expect } from './support/fixtures.ts';
import { chooseOption, loginStaff, staffPage, staffApi, dutyPage } from './support/staff.ts';

import { dateKey } from '../../shared/time.ts';
import { WORKFLOW_TIME } from '../fixtures/workflow-seed.ts';

test('member editing only offers manageable campuses and appointments @smoke', async ({ page, context }) => {
  async function openEditor(actorPage: import('@playwright/test').Page, account: string|undefined) {
    await loginStaff(actorPage, account);
    const people = await staffPage(actorPage, '人员管理');
    await people.locator('.react-row').filter({ hasText: '周宁' }).getByRole('button', { name: '人员详情', exact: true }).click();
    return actorPage.getByRole('dialog');
  }

  const member = await openEditor(page, '20261001');
  const campus = member.getByRole('combobox', { name: '所属校区', exact: true });
  await expect(campus).toHaveText('南湖');
  await expect(campus).toBeDisabled();
  await member.getByRole('button', { name: '任职与身份', exact: true }).click();
  await member.getByRole('button', { name: '新增任职', exact: true }).click();
  const organization = member.getByRole('combobox', { name: '正式部门 / 组织', exact: true });
  await organization.click();
  await expect(page.getByRole('option', { name: '硬件部', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: '设备服务站', exact: true })).toHaveCount(0);

  const admin = await context.newPage();
  const adminEditor = await openEditor(admin, 'root001');
  const adminCampus = adminEditor.getByRole('combobox', { name: '所属校区', exact: true });
  await chooseOption(admin, adminCampus, 'campus-hunnan');
  await expect(adminCampus).toHaveText('浑南');
  await chooseOption(admin, adminCampus, 'campus-nanhu');
  await adminEditor.getByRole('button', { name: '任职与身份', exact: true }).click();
  await adminEditor.getByRole('button', { name: '新增任职', exact: true }).click();
  await chooseOption(admin, adminEditor.getByRole('combobox', { name: '正式部门 / 组织', exact: true }), 'unit-device');
  await adminEditor.getByRole('combobox', { name: '职位', exact: true }).click();
  await expect(admin.getByRole('option', { name: '站长', exact: true })).toBeVisible();
});

test('superadmins manually grant and revoke the retired badge across member and personal views', async ({
  page,
  context
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await loginStaff(page);
  const memberId = 'member-20261004';
  const detail = await staffApi<StaffResult<'memberDetail'>>(page, `/api/members/${memberId}`, null, 'GET');
  for (const post of detail.member.memberships)
    await staffApi(
      page,
      `/api/members/${memberId}/memberships/${post.id}`,
      {
        revision: post.revision,
        effectiveTo: dateKey(new Date(WORKFLOW_TIME)),
        requestId: crypto.randomUUID()
      },
      'PATCH'
    );
  const people = await staffPage(page, '人员管理');
  await chooseOption(page, people.getByLabel('筛选成员校区'), detail.member.homeCampusId);
  await people.getByRole('textbox', { name: '搜索成员', exact: true }).fill('20261004');
  const row = people.locator('.react-row').filter({ hasText: '许晨' });
  await row.getByRole('button', { name: '人员详情', exact: true }).click();
  const editor = page.getByRole('dialog');
  await editor.getByRole('button', { name: '任职与身份', exact: true }).click();
  const badge = editor.locator('[data-identity="retired_elder"]');
  await expect(badge).toHaveCount(0);
  await editor.getByRole('button', { name: '授予退休老登身份', exact: true }).click();
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText('退休老登');
  const isAnimating = () =>
    badge.evaluate((node) =>
      node
        .getAnimations()
        .some(
          (animation) =>
            animation.playState === 'running' &&
            animation.effect?.getTiming().iterations === Infinity
        )
    );
  await expect.poll(isAnimating).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(isAnimating).toBe(false);
  await editor.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(row.locator('[data-identity="retired_elder"]')).toBeVisible();

  const retired = await context.newPage();
  await loginStaff(retired, '20261004');
  const personal = await staffPage(retired, '个人中心');
  await expect(personal.locator('.personal-profile [data-identity="retired_elder"]')).toBeVisible();
  const duties = await dutyPage(retired, '我的值班');
  await expect(duties.getByRole('button', { name: '到岗签到', exact: true })).toBeVisible();
  await expect(duties.getByRole('heading', { name: '填写空闲', exact: true })).toHaveCount(0);
  await expect(duties.getByRole('button', { name: '确认接替', exact: true })).toHaveCount(0);
  const hours = duties.getByRole('region', { name: '我的志愿时长', exact: true });
  await expect(hours).toContainText('退休老登仅按有效签到计入，未签到不计时长');
  await expect(hours).not.toContainText('负责人每周自动计入一次');
  const managed = await staffPage(retired, '人员管理');
  await chooseOption(retired, managed.getByLabel('筛选成员校区'), 'campus-nanhu');
  await managed.getByRole('textbox', { name: '搜索成员', exact: true }).fill('20261003');
  await managed
    .locator('.react-row')
    .filter({ hasText: '周宁' })
    .getByRole('button', { name: '人员详情', exact: true })
    .click();
  await retired
    .getByRole('dialog')
    .getByRole('button', { name: '任职与身份', exact: true })
    .click();
  await expect(retired.getByRole('button', { name: '授予退休老登身份', exact: true })).toHaveCount(
    0
  );
  await retired.close();

  await row.getByRole('button', { name: '人员详情', exact: true }).click();
  await editor.getByRole('button', { name: '任职与身份', exact: true }).click();
  await editor.getByRole('button', { name: '撤销退休老登身份', exact: true }).click();
  await expect(badge).toHaveCount(0);
});

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

test('existing members can add a department and both independent identities together', async ({ page }) => {
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
