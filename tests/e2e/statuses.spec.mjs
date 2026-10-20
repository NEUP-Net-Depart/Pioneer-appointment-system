import {mockStaff,loginStaff,staffPage} from './support/staff.mjs';
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

test('student list groups five real states, has no queue or card actions, and opens legacy details',async({page})=>{
  const items=fixtures(),accessToken='a'.repeat(43),requests=[];
  await page.addInitScript(entries=>localStorage.setItem('pioneerAppointmentAccess',JSON.stringify(entries)),items.map(item=>({id:item.id,accessToken})));
  await page.route('**/api/appointments/*',route=>{const id=new URL(route.request().url()).pathname.split('/').at(-1);return route.fulfill({json:items.find(item=>item.id===id)});});
  page.on('request',request=>requests.push(request.url()));await page.goto('/#lookup');await expect(page.locator('.student-record')).toHaveCount(5);await expect(page.locator('.record-group').first().locator('.student-record')).toHaveCount(2);await expect(page.locator('.record-group').last().locator('.student-record')).toHaveCount(3);await expect(page.locator('.student-record').first()).toContainText('维修中');await expect(page.locator('[data-cancel-open]')).toHaveCount(0);
  const expired=items.find(item=>item.status==='expired');await page.locator(`[data-detail-id="${expired.id}"]`).click();await expect(page.locator('#appointment-detail')).toContainText(expirationMessage);await expect(page.locator('#detail-qr details')).toHaveJSProperty('open',false);await expect(page.locator('#appointment-detail')).not.toContainText('未修复');await expect(page.locator('[data-rebook]')).toBeVisible();
  expect(requests.some(url=>url.includes('/api/live/summary'))).toBe(false);
});


async function staffFixture(page){
 const items=fixtures().map(item=>({...item,canReadDetails:true,canCorrect:true,canRecoverCredential:true}));await mockStaff(page);await page.route('**/api/appointments?*',route=>route.fulfill({json:{items,counts:Object.fromEntries(Object.keys(statusLabels).map(key=>[key,1]))}}));await page.route('**/api/field/appointments/*',route=>route.fulfill({json:items.find(item=>route.request().url().endsWith(item.id))||{}}));await loginStaff(page);await staffPage(page,'预约记录');return items;
}
test('staff filters, statistics and recovery use the five-state interface',async({page})=>{
 await staffFixture(page);for(const [status,label]of Object.entries(statusLabels)){await page.locator('.records-toolbar').getByRole('button',{name:/全部状态|待处理|已预约|维修中|已完成|已取消|已逾期/}).click();const pending=page.waitForRequest(req=>req.url().includes('/api/appointments?')&&new URL(req.url()).searchParams.get('status')===status);await page.getByRole('dialog').getByRole('button',{name:new RegExp('^'+label)}).click();await pending;await page.getByRole('button',{name:'完成',exact:true}).click();}
 await page.locator('.records-table tbody tr').first().getByRole('button',{name:'查看详情'}).click();await expect(page.getByRole('button',{name:'重发客户凭证',exact:true})).toBeVisible();await page.getByRole('button',{name:'关闭',exact:true}).click();await staffPage(page,'统计分析');await expect(page.locator('.report-workspace')).toContainText('已逾期');
});
test('React repair details treat completed, cancelled and expired records as terminal',async({page})=>{
 const items=await staffFixture(page);for(const item of items.filter(item=>terminalStatuses.includes(item.status))){await page.locator('.records-table tbody tr').filter({hasText:item.id}).getByRole('button',{name:'查看详情'}).click();await expect(page.getByRole('dialog')).toContainText(statusLabels[item.status]);await expect(page.getByRole('button',{name:'确认开始维修',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'完成维修',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'关闭',exact:true}).click();}
});
