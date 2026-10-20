import {test,expect} from '@playwright/test';
import {mockStaff,loginStaff} from './support/staff.mjs';
test('React repair desk keeps manual identifiers separate from signed QR payloads',async({page})=>{
 const id='reverse020261015-07',item={id,status:'expired',campus:'南湖',date:'2026-10-15',timeSlot:'19:00–19:30',canReadDetails:false,revision:0,deviceModel:'历史设备'},requests=[];
 await mockStaff(page,{role:'technician',contexts:[{id:'repair',label:'维修工作台'}],permissions:{'repair.summary.read':true}});await page.route('**/api/scan/search',route=>route.fulfill({json:{items:[item],hasMore:false}}));await page.route('**/api/scan/resolve',route=>{requests.push(route.request().postDataJSON());return route.fulfill({json:item});});await page.route('**/api/field/appointments/'+id,route=>route.fulfill({json:item}));await loginStaff(page);
 const input=page.getByRole('combobox',{name:'预约编号',exact:true});await input.fill(id);await input.press('Enter');await expect(page.getByRole('dialog')).toContainText('已逾期');expect(requests).toEqual([{id}]);await expect(page.getByRole('button',{name:'确认开始维修',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'关闭',exact:true}).click();
 await input.fill(id+'.123456abcdef');await expect(page.getByRole('button',{name:'查询',exact:true})).toBeDisabled();expect(requests).toHaveLength(1);
});
