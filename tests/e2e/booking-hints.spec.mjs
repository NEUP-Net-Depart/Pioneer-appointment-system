import { test, expect } from '@playwright/test';
import { setupStudent,chooseTime,fillDevice,goReview,submitStudent } from './support/student.mjs';
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
  await page.locator('[name=issue]').fill('字'.repeat(1001));await expect(page.locator('[name=issue]')).toHaveValue('字'.repeat(1001));await expect(page.locator('[data-error-for=issue]')).toHaveText('必须在 1000 字以内');await page.locator('#step-two-next').click();await expect(page.locator('[data-step="2"]')).toBeVisible();await page.locator('[name=issue]').fill('🙂'.repeat(1000));await expect(page.locator('[data-error-for=issue]')).toBeEmpty();await page.locator('[name=brand]').selectOption('other');await page.locator('[name=brandOther]').fill('自行组装');await page.locator('[name=college]').selectOption('other');await page.locator('[name=collegeOther]').fill('完整学院名称');await goReview(page);await expect(page.locator('#booking-review')).toContainText('完整学院名称');await expect(page.locator('#booking-review')).not.toContainText('字以内');await expect(page.locator('#booking-review')).toContainText('自行组装');
});
test('every booking text limit reports only overflow, retains the full value and blocks review',async({page})=>{
  const state=await setupStudent(page);await chooseTime(page);await fillDevice(page);
  await page.locator('[name=brand]').selectOption('other');await page.locator('[name=brandOther]').fill('自选品牌');
  await page.locator('[name=college]').selectOption('other');await page.locator('[name=collegeOther]').fill('自选学院');
  const cases=[['name',20,'名'],['studentId',20,'1'],['brandOther',30,'牌'],['deviceModel',60,'型'],['collegeOther',50,'院'],['email',254,'a'],['qqAccount',12,'1'],['wechatAccount',20,'w'],['issue',1000,'🙂']];
  for(const [name,limit,character] of cases){
    if(name==='wechatAccount')await page.locator('[name=contactType][value=wechat]').check();
    const input=page.locator(`[name=${name}]`),error=page.locator(`[data-error-for=${name}]`);
    const value=length=>name==='email' ? 'a'.repeat(length-13)+'@example.test' : character.repeat(length);
    for(const length of [limit-1,limit]){await input.fill(value(length));await expect(error).toBeEmpty();}
    const overlong=value(limit+1);await input.fill(overlong);await expect(input).toHaveValue(overlong);await expect(error).toHaveText(`必须在 ${limit} 字以内`);await expect(input).toHaveAttribute('aria-invalid','true');
    await page.locator('#step-two-next').click();await expect(page.locator('[data-step="2"]')).toBeVisible();await expect(input).toBeFocused();expect(state.calls).toHaveLength(0);
    await input.fill(value(limit));await expect(error).toBeEmpty();await expect(input).not.toHaveAttribute('aria-invalid','true');
  }
  await goReview(page);await submitStudent(page);expect(state.calls).toHaveLength(1);expect(state.calls[0].body.issue).toBe('🙂'.repeat(1000));expect(state.calls[0].body.contactValue).toBe('w'.repeat(20));
});
test('QQ requires 5 to 12 digits and an overlong value is never silently submitted',async({page})=>{
  const state=await setupStudent(page);await chooseTime(page);await fillDevice(page);
  const input=page.locator('[name=qqAccount]'),error=page.locator('[data-error-for=qqAccount]');
  for(const value of ['1234','abcde','01234','1234567890123']){
    await input.fill(value);await page.locator('#step-two-next').click();await expect(page.locator('[data-step="2"]')).toBeVisible();await expect(input).toHaveValue(value);await expect(error).toHaveText(value.length>12 ? '必须在 12 字以内' : '请输入 5～12 位 QQ 数字，首位不能为 0');expect(state.calls).toHaveLength(0);
  }
  for(const value of ['12345','12345678','123456789','1234567890','12345678901','123456789012']){
    await input.fill(value);await expect(error).toBeEmpty();await goReview(page);await expect(page.locator('#booking-review')).toContainText(value);
    if(value.length<12)await page.getByRole('button',{name:'修改设备和联系方式',exact:true}).click();
  }
  await submitStudent(page);expect(state.calls[0].body.contactValue).toBe('123456789012');
});
test('overlong drafts and IME input retain every character until explicitly corrected',async({page})=>{
  const state=await setupStudent(page);await chooseTime(page);await fillDevice(page);await page.locator('[name=qqAccount]').fill('1234567890123');
  await page.reload();await page.locator('#draft-restore').click();await expect(page.locator('[name=qqAccount]')).toHaveValue('1234567890123');await expect(page.locator('[data-error-for=qqAccount]')).toHaveText('必须在 12 字以内');
  await page.locator('[name=qqAccount]').fill('123456789');
  const issue=page.locator('[name=issue]');await issue.evaluate(input=>{input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));input.value='字'.repeat(1001);input.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));});
  await expect(page.locator('[data-error-for=issue]')).toBeEmpty();await issue.dispatchEvent('compositionend');await expect(issue).toHaveValue('字'.repeat(1001));await expect(page.locator('[data-error-for=issue]')).toHaveText('必须在 1000 字以内');
  await page.locator('#step-two-next').click();await expect(page.locator('[data-step="2"]')).toBeVisible();expect(state.calls).toHaveLength(0);
});
test('private link imports preserve overlong text, show a limit error and send no request',async({page})=>{
  await setupStudent(page);let requests=0;await page.route('**/api/appointments/*',route=>{requests++;return route.fulfill({status:404,json:{error:'无权限'}});});
  await page.locator('[data-view-link=lookup]').first().click();await page.locator('[data-open-import]').click();const input=page.locator('#private-link-input'),error=page.locator('#length-error-private-link-input');
  await expect(error).toBeHidden();await input.fill('a'.repeat(2048));await expect(error).toBeHidden();const link='a'.repeat(2049);await input.fill(link);await expect(input).toHaveValue(link);await expect(error).toHaveText('必须在 2048 字以内');await page.locator('#import-form [type=submit]').click();expect(requests).toBe(0);
  await input.fill('a'.repeat(2048));await expect(error).toBeHidden();await expect(error).toBeEmpty();
});
test('staff activation length limits retain overflow and stop submission until corrected',async({page})=>{
  const calls=[];await page.route('**/api/activation',route=>{calls.push(route.request().postDataJSON());return route.fulfill({json:{id:'test',receipt:'test',status:'pending'}});});
  await page.goto('/staff/?activate=1');await page.locator('#activation-campus').selectOption('南湖');
  for(const [id,value] of Object.entries({'activation-student-id':'20260001','activation-name':'测试同学','activation-password':'test-password','activation-confirm':'test-password'}))await page.locator('#'+id).fill(value);
  for(const [id,limit,character] of [['activation-student-id',20,'1'],['activation-name',80,'名'],['activation-password',128,'p'],['activation-confirm',128,'p']]){
    const input=page.locator('#'+id),error=page.locator('#length-error-'+id);await expect(error).toBeHidden();
    for(const length of [limit-1,limit]){await input.fill(character.repeat(length));await expect(error).toBeHidden();}
    const value=character.repeat(limit+1);await input.fill(value);await expect(input).toHaveValue(value);await expect(error).toHaveText(`必须在 ${limit} 字以内`);await page.locator('#activation-form [type=submit]').click();expect(calls).toHaveLength(0);await expect(input).toBeFocused();
    await input.fill(character.repeat(limit));await expect(error).toBeHidden();
  }
  await page.locator('#activation-form [type=submit]').click();await expect(page.locator('#activation-status')).toContainText('等待管理员');expect(calls).toHaveLength(1);expect(calls[0].name).toBe('名'.repeat(80));
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
