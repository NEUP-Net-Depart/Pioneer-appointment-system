import {test,expect} from '@playwright/test';
import {statusLabels,terminalStatuses,expirationMessage} from '../../shared/constants.js';

const fixtures = () => Object.keys(statusLabels).map((status,index) => ({
  id:`reserve020261012-${String(index+1).padStart(2,'0')}`,revision:0,status,
  name:'状态测试同学',studentId:`2026000${index}`,campus:'南湖',date:'2026-10-12',timeSlot:'19:00–20:00',
  deviceType:'笔记本电脑',brand:'联想',deviceModel:'ThinkPad',faultType:'蓝屏',source:'booking',
  assignedTo:status==='booked' ? '' : 'teststaff',outcome:status==='completed' ? 'repaired' : null,
  repairNote:status==='completed' ? '完成维修并复测' : '',createdAt:'2026-10-12T02:00:00.000Z',
  startedAt:['in_progress','completed'].includes(status) ? '2026-10-12T11:00:00.000Z' : null,
  completedAt:terminalStatuses.includes(status) ? '2026-10-12T13:30:00.000Z' : null,
  expiresAt:'2026-10-12T13:30:00.000Z',attachments:[]
}));

async function mockLogin(page,role) {
  const user = {account:'teststaff',name:'状态测试员',role,token:'local-status-test',authorizedCampuses:['南湖']};
  await page.route('**/api/auth/login',route => route.fulfill({json:user}));
  await page.route('**/api/auth/me',route => route.fulfill({json:user}));
  await page.route('**/api/scan/config',route => route.fulfill({json:{enabled:true}}));
  await page.route('**/api/scan/current*',route => route.fulfill({json:{items:[],pending:null,registration:null}}));
  await page.route('**/api/appointments/*/attachments',route => route.fulfill({json:{items:[]}}));
  await page.route('**/api/staff/assignees?*',route => route.fulfill({json:{items:[{account:user.account,name:user.name}]}}));
  await page.goto('/staff/');
  await page.locator('#login-id').fill(user.account);await page.locator('#login-password').fill('local-status-test');
  await page.locator('#login-form button').click();
  await expect(page.locator('#app-shell')).toBeVisible();
}

test('student list groups five real states, has no queue or card actions, and opens legacy details',async({page})=>{
  const items=fixtures(),accessToken='a'.repeat(43),requests=[];
  await page.addInitScript(entries=>localStorage.setItem('pioneerAppointmentAccess',JSON.stringify(entries)),items.map(item=>({id:item.id,accessToken})));
  await page.route('**/api/appointments/*',route=>{const id=new URL(route.request().url()).pathname.split('/').at(-1);return route.fulfill({json:items.find(item=>item.id===id)});});
  page.on('request',request=>requests.push(request.url()));await page.goto('/#lookup');await expect(page.locator('.student-record')).toHaveCount(5);await expect(page.locator('.record-group').first().locator('.student-record')).toHaveCount(2);await expect(page.locator('.record-group').last().locator('.student-record')).toHaveCount(3);await expect(page.locator('.student-record').first()).toContainText('维修中');await expect(page.locator('[data-cancel-open]')).toHaveCount(0);
  const expired=items.find(item=>item.status==='expired');await page.locator(`[data-detail-id="${expired.id}"]`).click();await expect(page.locator('#appointment-detail')).toContainText(expirationMessage);await expect(page.locator('#detail-qr details')).toHaveJSProperty('open',false);await expect(page.locator('#appointment-detail')).not.toContainText('未修复');await expect(page.locator('[data-rebook]')).toBeVisible();
  expect(requests.some(url=>url.includes('/api/live/summary'))).toBe(false);
});

test('staff filters, statistics and recovery use the five-state interface',async ({page}) => {
  const items=fixtures(),errors=[];let corrected;
  const counts=() => ({all:items.length,...Object.fromEntries(Object.keys(statusLabels).map(status => [status,items.filter(item => item.status===status).length]))});
  page.on('pageerror',error => errors.push(error.message));
  await page.route('**/api/appointments/overview',route => route.fulfill({json:{start:'2026-10-12',end:'2026-10-18',dates:['2026-10-12'],campuses:['南湖'],items:[],updatedAt:'2026-10-12T02:00:00.000Z',week:{start:'2026-10-12',end:'2026-10-18',dates:['2026-10-12'],items:[]}}}));
  await page.route('**/api/appointments?*',async route => {
    const status=new URL(route.request().url()).searchParams.get('status');
    // Keep the previous rows visible while the filtered response is pending.
    if(status==='expired' && !corrected) await new Promise(resolve => setTimeout(resolve,300));
    return route.fulfill({json:{items:items.filter(item => status==='all' || item.status===status),counts:counts(),filteredCounts:counts()}});
  });
  await page.route('**/api/appointments/*/status',route => {
    corrected=route.request().postDataJSON();const item=items.find(item => item.status==='expired');
    Object.assign(item,{status:corrected.status,expiresAt:new Date(corrected.expiresAt).toISOString(),completedAt:null,revision:1});
    return route.fulfill({json:item});
  });
  await page.route('**/api/stats/summary?*',route => route.fulfill({json:{total:5,completed:1,cancelled:1,expired:0,expiredRate:0,repairSuccessRate:100,daily:{},faults:{},campuses:{},technicians:{}}}));
  await mockLogin(page,'admin');
  await expect(page.locator('#appointments-table .status-pill')).toHaveCount(5);
  await page.locator('[data-column-menu=status]').click();
  for (const [status,label] of Object.entries(statusLabels)) await expect(page.locator(`[data-filter=${status}]`)).toContainText(label);
  await page.locator('[data-filter=expired]').click();
  await expect(page.locator('#appointments-table .status-pill')).toHaveText(['已逾期']);
  await expect(page.locator('#count-expired')).toHaveText('1');
  await page.locator('#staff-menu-status [data-menu-close]').last().click();
  await page.locator('[data-detail]').click();
  await expect(page.locator('#detail-expiration-message')).toHaveText(expirationMessage);
  await expect(page.locator('#start-detail')).toBeHidden();await expect(page.locator('#complete-detail')).toBeHidden();
  await page.locator('#correction-panel summary').click();await page.locator('#correction-status').selectOption('booked');
  await expect(page.locator('#correction-outcome')).toBeHidden();await expect(page.locator('#correction-expires')).toBeVisible();
  await page.locator('#correction-expires').fill('2099-01-01T22:00');await page.locator('#correction-reason').fill('管理员核实漏记后延长期限重新签到');
  page.once('dialog',dialog => dialog.accept());await page.locator('#apply-correction').click();
  await expect(page.locator('#detail-modal')).toBeHidden();
  expect(corrected).toMatchObject({action:'correct',status:'booked',expiresAt:'2099-01-01T22:00:00+08:00',correctionReason:'管理员核实漏记后延长期限重新签到'});
  expect(corrected.outcome).toBeUndefined();
  await page.locator('[data-view-link=stats]').click();
  await expect(page.locator('#stats-cancelled')).toHaveText('1');await expect(page.locator('#stats-expired')).toHaveText('0');
  await expect(page.locator('#stats-expired-rate')).toHaveText('0%');
  await expect(page.locator('#stats-view')).not.toContainText('未到场');
  expect(errors).toEqual([]);
});

test('scan workbench treats all three terminal states as closed records',async ({page}) => {
  const items=fixtures().filter(item => terminalStatuses.includes(item.status));
  await page.addInitScript(() => Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async () => {throw new DOMException('Denied','NotAllowedError');}}));
  await page.route('**/api/scan/resolve',route => route.fulfill({json:items.find(item => item.id===route.request().postDataJSON().id)}));
  await mockLogin(page,'technician');
  for (const item of items) {
    await expect(page.locator('#scan-home')).toBeVisible();await page.getByRole('button',{name:'手动输入编号',exact:true}).click();
    await page.locator('#scan-number').fill(item.id);await page.getByRole('button',{name:'查询工单',exact:true}).click();
    await expect(page.locator('#scan-detail')).toBeVisible();await expect(page.locator('.scan-status-pill')).toHaveText(statusLabels[item.status]);
    await expect(page.locator('#scan-intake-form')).toBeHidden();await expect(page.locator('#scan-result-form')).toBeHidden();
    await expect(page.locator('#scan-cancel-onsite')).toBeHidden();
    if (item.status==='expired') await expect(page.locator('#scan-message')).toHaveText(expirationMessage);
    await page.locator('#scan-detail-back').click();
  }
});
