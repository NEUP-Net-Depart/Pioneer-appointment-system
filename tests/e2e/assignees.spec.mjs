import {test,expect} from '@playwright/test';
import {mockStaff,loginStaff,staffPage} from './support/staff.mjs';
const id='reserve020261015-01';
async function fixture(page,{assignedTo='tech-old',assignedToName='历史维修员',campus='南湖'}={}){
 const writes=[];let item={id,name:'测试客户',studentId:'20306001',revision:3,campus,date:'2026-10-15',timeSlot:'19:00–19:30',status:'in_progress',deviceModel:'ThinkPad',brand:'联想',assignedTo,assignedToName,repairNote:'原维修说明',canReadDetails:true,canCorrect:true,canRecoverCredential:true};
 await mockStaff(page);
 await page.route('**/api/appointments?*',route=>route.fulfill({json:{items:[item],counts:{all:1},filteredCounts:{all:1}}}));
 await page.route('**/api/field/appointments/'+id,route=>route.fulfill({json:item}));
 await page.route('**/api/field/appointments/*/assignees',route=>route.fulfill({json:{items:[{account:'tech-1',name:'同名维修员'},{account:'tech-2',name:'同名维修员'}]}}));
 await page.route('**/api/appointments/*/correction',route=>{const body=route.request().postDataJSON();writes.push(body);item={...item,...body,revision:item.revision+1};return route.fulfill({json:item});});
 await loginStaff(page);await staffPage(page,'预约记录');await page.getByRole('button',{name:'查看详情',exact:true}).click();return {writes,edit:()=>page.getByRole('button',{name:'修正预约记录',exact:true}).click()};
}
async function save(page){await page.getByLabel('纠错原因',{exact:true}).fill('已经当面核实并修正维修人员关联');await page.getByRole('button',{name:'核对修改',exact:true}).click();await page.getByRole('button',{name:'确认修正记录',exact:true}).click();}
test('duplicate assignee names retain distinct accounts and selection submits only the account',async({page})=>{
 const {writes,edit}=await fixture(page);await edit();const select=page.getByRole('combobox',{name:'维修人员',exact:true});await expect(select.locator('option')).toContainText(['未分配','历史维修员（原记录）','同名维修员 · tech-1','同名维修员 · tech-2']);await select.selectOption('tech-2');await save(page);await expect.poll(()=>writes.length).toBe(1);expect(writes[0].assignedTo).toBe('tech-2');expect(writes[0].revision).toBe(3);
});
test('a historical assignee remains selected until explicitly cleared or replaced',async({page})=>{
 const {writes,edit}=await fixture(page);await edit();await expect(page.getByRole('combobox',{name:'维修人员',exact:true})).toHaveValue('tech-old');await page.getByRole('textbox',{name:'维修说明',exact:true}).fill('只修改说明并保留原账号');await save(page);await expect.poll(()=>writes.length).toBe(1);expect(writes[0].assignedTo).toBe('tech-old');
});
test('candidate loading failures can be retried without losing the current association',async({page})=>{
 const {edit}=await fixture(page);let failed=true;await page.route('**/api/field/appointments/*/assignees',route=>failed?route.fulfill({status:503,json:{error:'候选读取失败'}}):route.fulfill({json:{items:[{account:'tech-3',name:'恢复后的维修员'}]}}));
 await edit();await expect(page.getByRole('dialog')).toContainText('候选读取失败');await expect(page.getByRole('combobox',{name:'维修人员',exact:true})).toHaveValue('tech-old');failed=false;await edit();await edit();await expect(page.getByRole('combobox',{name:'维修人员',exact:true}).locator('option')).toContainText(['未分配','历史维修员（原记录）','恢复后的维修员 · tech-3']);
});
test('late candidates from a closed appointment cannot replace the next appointment',async({page})=>{
 const {edit}=await fixture(page);let release,started;const pending=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>started=resolve);await page.route('**/api/field/appointments/*/assignees',async route=>{started();await pending;await route.fulfill({json:{items:[{account:'late-old',name:'旧候选'}]}}).catch(()=>{});});await edit();await ready;await page.getByRole('button',{name:'关闭',exact:true}).click();
 await page.route('**/api/field/appointments/*/assignees',route=>route.fulfill({json:{items:[{account:'new-campus',name:'新候选'}]}}));await page.getByRole('button',{name:'查看详情',exact:true}).click();await edit();release();await expect(page.getByRole('combobox',{name:'维修人员',exact:true}).locator('option')).toContainText(['未分配','历史维修员（原记录）','新候选 · new-campus']);await expect(page.getByRole('combobox',{name:'维修人员',exact:true}).locator('option[value=late-old]')).toHaveCount(0);
});
test('repair details show the staff name and historical association retains its account fallback',async({page})=>{
 const {edit}=await fixture(page);await expect(page.getByRole('dialog')).toContainText('维修人员：历史维修员');await edit();await expect(page.getByRole('combobox',{name:'维修人员',exact:true}).locator('option[value=tech-old]')).toHaveText('历史维修员（原记录）');
});
