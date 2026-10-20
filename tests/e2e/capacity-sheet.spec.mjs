import {test,expect} from '@playwright/test';
import {TIME_SLOTS} from '../../shared/constants.js';
import {mockStaff,loginStaff,staffPage} from './support/staff.mjs';
async function fixture(page){
 await mockStaff(page);const writes=[],items=['南湖','浑南'].flatMap(campus=>TIME_SLOTS.flatMap((timeSlot,row)=>[1,2,3,4].map(weekday=>({campus,timeSlot,weekday,capacity:row*4+weekday,revision:0}))));
 await page.route('**/api/slot-capacities',route=>{if(route.request().method()==='PATCH'){const input=route.request().postDataJSON();writes.push(input);return route.fulfill({json:{items:input.items.map(item=>({...item,revision:item.revision+1}))}});}return route.fulfill({json:{items}});});
 await loginStaff(page);await staffPage(page,'预约配置');await expect(page.locator('[role=gridcell]')).toHaveCount(16);return {writes,cell:(row,col)=>page.locator(`[role=gridcell][data-row="${row}"][data-col="${col}"]`)};
}
test('capacity sheet selects blocks and rows, fills drafts, cancels and undoes without writing',async({page})=>{
 const {writes,cell}=await fixture(page);await cell(0,0).click();await cell(1,1).click({modifiers:['Shift']});await expect(page.getByRole('gridcell',{selected:true})).toHaveCount(4);
 await cell(0,0).dblclick();await cell(0,0).locator('input').fill('9');await cell(0,0).locator('input').press('Enter');expect(writes).toHaveLength(0);
 await page.getByRole('button',{name:'撤销上一步',exact:true}).click();await expect(cell(0,0).locator('input')).toHaveValue('1');
 await cell(0,0).dblclick();await cell(0,0).locator('input').fill('8');await cell(0,0).locator('input').press('Escape');await expect(cell(0,0).locator('input')).toHaveValue('8');await page.getByRole('button',{name:'撤销上一步',exact:true}).click();await expect(cell(0,0).locator('input')).toHaveValue('1');expect(writes).toHaveLength(0);
});
test('capacity sheet pastes complete blocks, rejects invalid input and confirms one atomic save',async({page})=>{
 const {writes,cell}=await fixture(page);await cell(0,0).click();
 // Use a real ClipboardEvent so the browser supplies the same DataTransfer as native paste.
 await cell(0,0).evaluate(node=>{const data=new DataTransfer();data.setData('text/plain','7\t8\n9\t10');node.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:data}));});
 await expect(cell(0,0).locator('input')).toHaveValue('7');await expect(cell(1,1).locator('input')).toHaveValue('10');expect(writes).toHaveLength(0);
 await cell(0,0).evaluate(node=>{const data=new DataTransfer();data.setData('text/plain','-1');node.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:data}));});await expect(page.getByRole('status').filter({hasText:/非负|人数|数字/}).first()).toBeVisible();expect(writes).toHaveLength(0);
 await page.getByRole('button',{name:'预览并保存',exact:true}).click();await page.getByRole('button',{name:'确认保存全部修改',exact:true}).click();await expect.poll(()=>writes.length).toBe(1);expect(writes[0].items.length).toBeGreaterThanOrEqual(4);
});
test('capacity sheet keyboard navigation and mobile copying retain unsaved values',async({page})=>{
 const {writes,cell}=await fixture(page);await cell(0,0).click();await page.keyboard.press('ArrowRight');await expect(cell(0,1)).toBeFocused();await page.keyboard.press('ArrowDown');await expect(cell(1,1)).toBeFocused();
 await page.setViewportSize({width:390,height:844});await page.getByText('批量填写与复制',{exact:true}).click();await page.getByLabel('统一人数',{exact:true}).fill('6');await page.getByRole('button',{name:'填入草稿',exact:true}).click();expect(writes).toHaveLength(0);
 await page.getByRole('button',{name:'复制整周到目标校区',exact:true}).click();await expect(page.getByLabel('有未保存修改')).toHaveCount(2);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'放弃修改',exact:true}).click();await page.getByRole('button',{name:'确认放弃修改',exact:true}).click();expect(writes).toHaveLength(0);
});

async function dragBetween(page, from, to) {
  await from.evaluate(element => element.closest('table').scrollIntoView({ block:'center', behavior:'instant' }));
  const start = await from.boundingBox(), end = await to.boundingBox();
  await page.mouse.move(start.x + start.width / 2,start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2,end.y + end.height / 2,{ steps:12 });
  await page.mouse.up();
}

test('logout keeps unsaved capacity edits until the user saves or discards them',async({page})=>{
  const {writes,cell}=await fixture(page);
  await cell(0,0).dblclick();await cell(0,0).locator('input').fill('17');await cell(0,0).locator('input').press('Enter');
  const logout=page.locator('.field-sidebar').getByRole('button',{name:'退出登录',exact:true});
  await logout.click();const dialog=page.getByRole('dialog',{name:'有未保存的调整'});
  await expect(dialog).toBeVisible();expect(writes).toHaveLength(0);
  await dialog.getByRole('button',{name:'取消退出',exact:true}).click();await expect(cell(0,0).locator('input')).toHaveValue('17');
  expect(await page.evaluate(()=>sessionStorage.getItem('pioneerToken'))).toBeTruthy();
  await logout.click();await dialog.getByRole('button',{name:'保存并退出',exact:true}).click();
  await expect(page.locator('#login-form')).toBeVisible();expect(writes).toHaveLength(1);
  expect(writes[0].items.some(item=>item.capacity===17)).toBe(true);
  expect(await page.evaluate(()=>sessionStorage.getItem('pioneerToken'))).toBeNull();
});
test('React capacity drag fill repeats blocks in both axes and undo preserves the stored configuration', async ({page}) => {
  const {writes,cell} = await fixture(page);
  const handle = page.getByRole('button',{name:'拖动复制选区人数',exact:true});
  const undo = page.getByRole('button',{name:'撤销上一步',exact:true});
  await dragBetween(page,cell(0,0),cell(1,1));
  await expect(page.getByRole('gridcell',{selected:true})).toHaveCount(4);
  await dragBetween(page,handle,cell(3,1));
  await expect(cell(2,0).locator('input')).toHaveValue('1');
  await expect(cell(3,1).locator('input')).toHaveValue('6');
  await undo.click();
  await expect(cell(2,0).locator('input')).toHaveValue('9');
  await cell(0,0).click();await dragBetween(page,handle,cell(0,3));
  for (const col of [1,2,3]) await expect(cell(0,col).locator('input')).toHaveValue('1');
  await undo.click();await cell(0,3).click();await dragBetween(page,handle,cell(0,0));
  await expect(cell(0,0).locator('input')).toHaveValue('4');
  await undo.click();await cell(3,0).click();await dragBetween(page,handle,cell(0,0));
  await expect(cell(0,0).locator('input')).toHaveValue('13');
  await undo.click();expect(writes).toHaveLength(0);
});
test('React capacity headers and native clipboard copy columns across campuses without implicit saves', async ({page,context}) => {
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  const {writes,cell} = await fixture(page);
  await dragBetween(page,page.getByRole('button',{name:'选择周一整列',exact:true}),page.getByRole('button',{name:'选择周二整列',exact:true}));
  await expect(page.getByRole('gridcell',{selected:true})).toHaveCount(8);
  await cell(3,1).focus();await page.keyboard.press('ControlOrMeta+c');
  await expect.poll(()=>page.evaluate(()=>navigator.clipboard.readText())).toBe('1\t2\n5\t6\n9\t10\n13\t14');
  await page.getByRole('button',{name:'浑南校区',exact:true}).click();await cell(0,2).click();
  await page.keyboard.press('ControlOrMeta+v');
  await expect(cell(3,3).locator('input')).toHaveValue('14');expect(writes).toHaveLength(0);
  await page.getByRole('button',{name:'撤销上一步',exact:true}).click();
  await cell(3,3).click();await page.evaluate(()=>navigator.clipboard.writeText('1\t2\n3\t4'));await page.keyboard.press('ControlOrMeta+v');
  await expect(page.getByRole('status').filter({hasText:'超出表格'})).toBeVisible();
  await expect(cell(3,3).locator('input')).toHaveValue('16');expect(writes).toHaveLength(0);
});
