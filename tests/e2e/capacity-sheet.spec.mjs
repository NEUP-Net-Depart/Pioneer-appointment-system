import { test,expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { TIME_SLOTS } from '../../shared/constants.js';

async function openSheet(browser,{ mobile = false } = {}) {
  const context = await browser.newContext({ baseURL:process.env.E2E_BASE_URL,permissions:['clipboard-read','clipboard-write'],
    viewport:mobile ? { width:390,height:844 } : { width:1440,height:1000 },hasTouch:mobile,isMobile:mobile,
    extraHTTPHeaders:{ 'CF-Connecting-IP':mobile ? '198.51.100.62' : '198.51.100.61' } });
  const page = await context.newPage(), writes = [];
  // Spreadsheet UI tests own their session and data; business.spec exercises real permissions and D1 saves.
  const actor = { token:'capacity-test-only',account:'test-capacity-admin',name:'配置测试管理员',role:'admin',homeCampus:'南湖',authorizedCampuses:['南湖','浑南'] };
  await page.route('**/api/auth/login',route => route.fulfill({ json:actor }));
  await page.route('**/api/auth/me',route => route.fulfill({ json:actor }));
  await page.route('**/api/service-locations**',route=>route.fulfill({json:{items:[],changes:[],affectedAppointments:[]}}));
  await page.route('**/api/scan/config',route => route.fulfill({ json:{ enabled:false } }));
  await page.route('**/api/appointments?*',route => route.fulfill({ json:{ items:[],counts:{},filteredCounts:{} } }));
  await page.route('**/api/appointments/overview',route => route.fulfill({ json:{ dates:[],campuses:['南湖','浑南'],updatedAt:new Date().toISOString(),items:[] } }));
  const items = ['南湖','浑南'].flatMap(campus => TIME_SLOTS.flatMap((timeSlot,row) => [1,2,3,4].map(weekday => ({ campus,weekday,timeSlot,capacity:row * 4 + weekday,revision:0 }))));
  await page.route('**/api/slot-capacities',async route => {
    if (route.request().method() === 'PATCH') {
      const payload = route.request().postDataJSON(); writes.push(payload);
      const updated = payload.items.map(item => ({ ...item,revision:item.revision + 1 }));
      for (const item of updated) Object.assign(items.find(current => current.campus === item.campus && current.weekday === item.weekday && current.timeSlot === item.timeSlot),item);
      await route.fulfill({ json:{ items:updated } });
    } else await route.fulfill({ json:{ items } });
  });
  await page.goto('/staff/');
  await page.locator('#login-id').fill(actor.account); await page.locator('#login-password').fill('test-only');
  await page.locator('#login-form button').click(); await expect(page.locator('#app-shell')).toBeVisible();
  await page.getByRole('button',{ name:'个人设置',exact:true }).click();
  await expect(page.locator('.capacity-row:visible')).toHaveCount(16);
  const cell = (row,col) => page.locator(`.capacity-campus:visible .capacity-row[data-sheet-row="${row}"][data-weekday="${col + 1}"]`);
  return { page,context,cell,writes };
}
async function dragBetween(page,from,to) {
  await from.evaluate(element => element.closest('table').scrollIntoView({ block:'center',behavior:'instant' }));
  const start = await from.boundingBox(), end = await to.boundingBox();
  await page.mouse.move(start.x + start.width / 2,start.y + start.height / 2);
  await page.mouse.down(); await page.mouse.move(end.x + end.width / 2,end.y + end.height / 2,{ steps:12 }); await page.mouse.up();
}
async function pasteText(page,text) {
  await page.evaluate(text => navigator.clipboard.writeText(text),text);
  await page.keyboard.press('ControlOrMeta+v');
}

test('capacity sheet selects blocks and rows, repeats fill in both axes, cancels and undoes drafts',async ({ browser }) => {
  const { page,context,cell,writes } = await openSheet(browser);
  try {
    await dragBetween(page,cell(0,0),cell(1,1));
    await expect(page.locator('.capacity-row.is-selected')).toHaveCount(4);
    await dragBetween(page,page.locator('.capacity-fill-handle:visible'),cell(3,1));
    await expect(cell(2,0).locator('input')).toHaveValue('1');
    await expect(cell(3,1).locator('input')).toHaveValue('6');
    await expect(page.locator('.capacity-row.is-selected')).toHaveCount(8);
    await page.locator('#capacity-undo').click();
    await expect(cell(2,0).locator('input')).toHaveValue('9');
    await cell(0,0).click();
    await dragBetween(page,page.locator('.capacity-fill-handle:visible'),cell(0,3));
    for (const col of [1,2,3]) await expect(cell(0,col).locator('input')).toHaveValue('1');
    await page.locator('#capacity-undo').click();
    await cell(0,3).click();
    await dragBetween(page,page.locator('.capacity-fill-handle:visible'),cell(0,0));
    await expect(cell(0,0).locator('input')).toHaveValue('4');
    await page.locator('#capacity-undo').click();
    await cell(3,0).click();
    await dragBetween(page,page.locator('.capacity-fill-handle:visible'),cell(0,0));
    await expect(cell(0,0).locator('input')).toHaveValue('13');
    await page.locator('#capacity-undo').click();
    await dragBetween(page,page.locator('.capacity-campus:visible [data-sheet-header="col"][data-sheet-index="0"]'),page.locator('.capacity-campus:visible [data-sheet-header="col"][data-sheet-index="1"]'));
    await expect(page.locator('.capacity-row.is-selected')).toHaveCount(8);
    await dragBetween(page,page.locator('.capacity-fill-handle:visible'),cell(3,3));
    await expect(cell(0,2).locator('input')).toHaveValue('1');
    await expect(cell(3,3).locator('input')).toHaveValue('14');
    await page.locator('#capacity-undo').click();
    await page.locator('.capacity-campus:visible [data-sheet-header="row"][data-sheet-index="0"]').focus();
    await page.keyboard.press('Enter'); await expect(page.locator('.capacity-row.is-selected')).toHaveCount(4);
    await page.locator('.capacity-campus:visible [data-sheet-header="row"][data-sheet-index="1"]').focus();
    await page.keyboard.press('Space'); await expect(page.locator('.capacity-row.is-selected')).toHaveCount(4);
    await expect(cell(1,0)).toHaveAttribute('aria-selected','true');
    await cell(0,0).click();
    const handle = await page.locator('.capacity-fill-handle:visible').boundingBox(), end = await cell(2,0).boundingBox();
    await page.mouse.move(handle.x + 5,handle.y + 5); await page.mouse.down(); await page.mouse.move(end.x + 20,end.y + 20);
    await page.keyboard.press('Escape'); await page.mouse.up();
    await expect(cell(2,0).locator('input')).toHaveValue('9');
    await page.locator('.capacity-campus:visible [data-sheet-header="row"][data-sheet-index="0"]').click();
    await page.locator('.capacity-campus:visible [data-sheet-header="row"][data-sheet-index="1"]').click({ modifiers:['Shift'] });
    await expect(page.locator('.capacity-row.is-selected')).toHaveCount(8);
    await dragBetween(page,page.locator('.capacity-fill-handle:visible'),cell(3,3));
    await expect(cell(2,3).locator('input')).toHaveValue('4');
    await expect(cell(3,3).locator('input')).toHaveValue('8');
    expect(writes).toHaveLength(0);
    await mkdir('output/playwright',{ recursive:true });
    await page.screenshot({ path:'output/playwright/capacity-sheet-selection.png',fullPage:true });
  } finally { await context.close(); }
});

test('capacity sheet copies columns across campuses with native clipboard and validates complete pastes',async ({ browser }) => {
  const { page,context,cell,writes } = await openSheet(browser);
  try {
    await page.locator('.capacity-campus:visible [data-sheet-header="col"][data-sheet-index="0"]').click();
    await page.locator('.capacity-campus:visible [data-sheet-header="col"][data-sheet-index="1"]').click({ modifiers:['Shift'] });
    await expect(page.locator('.capacity-row.is-selected')).toHaveCount(8);
    await page.keyboard.press('ControlOrMeta+c');
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('1\t2\n5\t6\n9\t10\n13\t14');
    await page.locator('[data-capacity-campus="浑南"]').click(); await cell(0,2).click(); await page.keyboard.press('ControlOrMeta+v');
    await expect(cell(3,3).locator('input')).toHaveValue('14');
    await expect(page.locator('#capacity-draft-status')).toContainText('8 项');
    await expect(page.locator('#capacity-draft-status')).toContainText('浑南 周三、周四');
    await page.locator('#capacity-undo').click();
    await cell(3,3).click(); await pasteText(page,'1\t2\n3\t4');
    await expect(page.locator('#toast')).toContainText('超出表格');
    await expect(cell(3,3).locator('input')).toHaveValue('16');
    await cell(0,0).click(); await pasteText(page,'8\t-1');
    await expect(page.locator('#toast')).toContainText('非负整数');
    await expect(cell(0,0).locator('input')).toHaveValue('1');
    await pasteText(page,'1\t2\n3'); await expect(page.locator('#toast')).toContainText('矩形');
    await dragBetween(page,cell(0,0),cell(2,1));
    await pasteText(page,'1\t2\n3\t4'); await expect(page.locator('#toast')).toContainText('整倍数');
    await page.keyboard.press('Control+a'); await pasteText(page,'2\t3\n4\t5');
    await expect(cell(3,3).locator('input')).toHaveValue('5');
    await page.locator('#capacity-undo').click(); await cell(0,0).click();
    await pasteText(page,'0\t0\r\n7\t8\r\n');
    await expect(cell(1,1).locator('input')).toHaveValue('8');
    await expect(cell(0,0).locator('input')).toHaveValue('0');
    await expect(page.locator('.capacity-row.is-selected')).toHaveCount(4);
    await page.locator('#capacity-save-all').click();
    expect(writes).toHaveLength(1); expect(writes[0].items).toHaveLength(4);
    expect(writes[0].items.every(item => item.campus === '浑南' && item.revision === 0)).toBe(true);
    await expect(page.locator('#capacity-draft-status')).toHaveText('所有配置已保存');
  } finally { await context.close(); }
});

test('capacity sheet keyboard edits and navigation never save implicitly, and touch buttons copy between campuses',async ({ browser }) => {
  const { page,context,cell,writes } = await openSheet(browser,{ mobile:true });
  try {
    await cell(0,0).locator('input').tap(); await cell(0,0).locator('input').fill('21');
    await page.keyboard.press('Enter'); await expect(cell(1,0)).toBeFocused();
    await page.keyboard.press('9'); await expect(cell(1,0).locator('input')).toBeFocused();
    await page.keyboard.press('Enter'); await page.keyboard.press('ArrowRight');
    await expect(cell(2,1)).toBeFocused();
    await page.keyboard.press('Tab'); await expect(cell(2,2)).toBeFocused();
    await page.keyboard.press('F2'); await cell(2,2).locator('input').fill('99'); await page.keyboard.press('Escape');
    await expect(cell(2,2).locator('input')).toHaveValue('11');
    await cell(0,0).tap(); await page.locator('[data-sheet-extend]').tap(); await cell(1,1).tap();
    await expect(page.locator('.capacity-row.is-selected')).toHaveCount(4);
    await page.locator('[data-sheet-copy]').tap();
    await page.locator('[data-sheet-extend]').tap();
    await page.locator('[data-capacity-campus="浑南"]').tap();
    await cell(0,0).locator('input').tap(); await page.locator('[data-sheet-paste]').tap();
    await expect(cell(0,0).locator('input')).toHaveValue('21');
    await expect(cell(1,0).locator('input')).toHaveValue('9');
    await cell(2,2).locator('input').tap(); await cell(2,2).locator('input').fill('6'); await page.keyboard.press('Enter');
    // Use real touch events to drag the fill handle, rather than synthesizing pointer handlers.
    await cell(3,2).scrollIntoViewIfNeeded(); await cell(2,2).scrollIntoViewIfNeeded();
    await cell(2,2).locator('input').tap(); await page.keyboard.press('Escape');
    await cell(3,2).scrollIntoViewIfNeeded(); await page.locator('.capacity-fill-handle:visible').scrollIntoViewIfNeeded();
    const handle = await page.locator('.capacity-fill-handle:visible').boundingBox(), destination = await cell(3,2).boundingBox();
    const client = await context.newCDPSession(page);
    await client.send('Input.dispatchTouchEvent',{ type:'touchStart',touchPoints:[{ x:handle.x + handle.width / 2,y:handle.y + handle.height / 2 }] });
    for (let step = 1; step <= 4; step++) {
      await client.send('Input.dispatchTouchEvent',{ type:'touchMove',touchPoints:[{ x:handle.x + handle.width / 2 + (destination.x + destination.width / 2 - handle.x - handle.width / 2) * step / 4,y:handle.y + handle.height / 2 + (destination.y + destination.height / 2 - handle.y - handle.height / 2) * step / 4 }] });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    }
    await client.send('Input.dispatchTouchEvent',{ type:'touchEnd',touchPoints:[] });
    await expect(cell(3,2).locator('input')).toHaveValue('6');
    expect(writes).toHaveLength(0);
    for (const width of [320,390,768]) {
      await page.setViewportSize({ width,height:844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.setViewportSize({ width:390,height:844 });
    await mkdir('output/playwright',{ recursive:true }); await page.screenshot({ path:'output/playwright/capacity-sheet-mobile.png',fullPage:true });
  } finally { await context.close(); }
});
