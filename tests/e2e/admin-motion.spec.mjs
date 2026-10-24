import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { mockStaff, loginStaff, staffPage } from './support/staff.mjs';
const motion = (await readFile(new URL('../../shared/data-motion.js', import.meta.url), 'utf8')).replace('export const dataMotionPresets', 'const dataMotionPresets').replace('export function observeDataMotion', 'window.observeDataMotion = function');

for (const width of [320,390,768,1440]) test(`account cards batch and update in place at ${width}px`, async ({ page }) => {
  await page.setViewportSize({width,height:1000});
  await mockStaff(page);
  let items=Array.from({length:30},(_,i)=>({account:`202600${String(i).padStart(2,'0')}`,name:`测试人员${i}`,role:'staff',homeCampus:'南湖',authorizedCampuses:['南湖'],status:'enabled',workload:i,actions:{edit:true}}));
  await page.route('**/api/users',route=>route.fulfill({json:{items}}));
  await loginStaff(page);await staffPage(page,'账号管理');
  await expect(page.locator('.account-row')).toHaveCount(30);
  const first=page.locator('.account-row').first();
  await first.evaluate(n=>{window.firstAccount=n;});
  await expect.poll(()=>page.evaluate(()=>document.getAnimations().filter(a=>a.effect?.target?.closest('.account-list')).length)).toBe(0);
  items=items.map((v,i)=>i? v:{...v,status:'disabled',roleNames:['维修值班负责人'],workload:7});
  await page.getByRole('button',{name:'刷新账号',exact:true}).click();
  await expect(first).toContainText('已停用');await expect(first).toContainText('维修值班负责人');
  expect(await first.evaluate(n=>n===window.firstAccount)).toBe(true);
  const search=page.getByPlaceholder('姓名、学号或校区');
  await search.fill('测试人员1');
  await expect(search).toBeFocused();
  await expect(page.locator('.account-row')).toHaveCount(11);
  await search.fill('');await expect(page.locator('.account-row')).toHaveCount(30);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`output/issue-73/accounts-motion-${width}.png`,fullPage:false});
});

test('dense list has a fixed animation budget, bounded staggering and no unchanged replay', async ({page})=>{
  await page.setViewportSize({width:1440,height:1000});
  await page.setContent('<style>body{margin:0}.row{height:32px;display:flex;gap:20px}.account-list{width:900px}</style><main><section class="account-list"></section></main>');
  await page.addScriptTag({content:motion});
  const result=await page.evaluate(async()=>{
    const rawRAF=window.requestAnimationFrame.bind(window);window.motionCosts=[];
    window.requestAnimationFrame=callback=>rawRAF(time=>{const start=performance.now();callback(time);window.motionCosts.push(performance.now()-start);});
    window.stopMotion=window.observeDataMotion(document.querySelector('main'));
    document.querySelector('section').innerHTML=Array.from({length:500},(_,i)=>`<article class="row" data-motion-item="${i}"><strong data-motion-value="text">人员${i}</strong><span data-motion-value="status">空闲</span><span data-motion-value="number">0</span></article>`).join('');
    await new Promise(r=>rawRAF(()=>rawRAF(r)));
    const animations=document.getAnimations();
    return {active:animations.length,maxDelay:Math.max(...animations.map(a=>a.effect.getTiming().delay)),maxTotal:Math.max(...animations.map(a=>a.effect.getTiming().delay+a.effect.getTiming().duration))};
  });
  expect(result.active).toBeGreaterThan(0);expect(result.active).toBeLessThanOrEqual(24);
  expect(result.maxDelay).toBeLessThanOrEqual(60);expect(result.maxTotal).toBeLessThanOrEqual(260);
  await expect.poll(()=>page.evaluate(()=>document.getAnimations().length)).toBe(0);
  const replay=await page.evaluate(async()=>{
    document.querySelector('strong').firstChild.data='人员0';
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    return document.getAnimations().length;
  });
  expect(replay).toBe(0);
  const metrics=await page.evaluate(async()=>{
    let peak=0;
    for(let round=0;round<10;round++){
      for(const node of [...document.querySelectorAll('[data-motion-value="number"]')].slice(0,30))node.textContent=String(round+1);
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      peak=Math.max(peak,document.getAnimations().length);
    }
    return {peak,frames:window.motionCosts.length,maxWorkMs:Math.max(...window.motionCosts),meanWorkMs:window.motionCosts.reduce((a,b)=>a+b,0)/window.motionCosts.length};
  });
  expect(metrics.peak).toBeLessThanOrEqual(24);
  // Detect a gross regression, without pretending CI hardware has a fixed fps.
  expect(metrics.maxWorkMs).toBeLessThan(100);
  await writeFile('output/issue-73/motion-performance.json',JSON.stringify({items:500,...result,...metrics},null,2));
  await test.info().attach('motion-performance.json',{body:JSON.stringify({items:500,...result,...metrics},null,2),contentType:'application/json'});
  await expect.poll(()=>page.evaluate(()=>document.getAnimations().length)).toBe(0);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(async()=>{document.querySelector('section').firstElementChild.remove();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
  expect(await page.evaluate(()=>document.getAnimations().length)).toBe(0);
});

test('modal closes with local feedback and restores focus; sidebar collapse makes entries inert',async({page})=>{
  await mockStaff(page);
  await page.route('**/api/users',r=>r.fulfill({json:{items:[{account:'20260001',name:'测试人员',homeCampus:'南湖',authorizedCampuses:['南湖'],status:'enabled',role:'staff',actions:{edit:true}}]}}));
  await loginStaff(page);await staffPage(page,'账号管理');
  const trigger=page.getByRole('button',{name:'管理账号',exact:true});await trigger.click();
  const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'关闭',exact:true}).click();
  await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
  const group=page.locator('.workspace-nav-group').filter({has:page.getByRole('button',{name:'平台管理',exact:true})});
  await group.getByRole('button',{name:'平台管理',exact:true}).click();
  await expect(group.locator('.motion-collapse')).toHaveAttribute('inert','');
  await group.getByRole('button',{name:'平台管理',exact:true}).click();
  await expect(group.getByRole('button',{name:'账号管理',exact:true})).toBeVisible();
});

test('short task prompt reveals characters with one animation and remains fully accessible', async ({page})=>{
  const session=await mockStaff(page,{contexts:[{id:'repair',label:'维修工作台'}]});
  await page.addInitScript(()=>{
    window.phraseAnimations=0;
    const original=Element.prototype.animate;
    Element.prototype.animate=function(frames,options){if(this.classList.contains('motion-phrase'))window.phraseAnimations++;return original.call(this,frames,options);};
  });
  await loginStaff(page);
  const title=page.getByRole('heading',{name:'准备好接待下一位机主',exact:true});
  await expect(title).toBeVisible();
  const phrase=title.locator('.motion-phrase');
  await expect(phrase.locator('.motion-accessible')).toHaveText('准备好接待下一位机主');
  expect(await page.evaluate(()=>window.phraseAnimations)).toBe(1);
  await expect.poll(()=>phrase.locator('.motion-glyph').last().evaluate(n=>getComputedStyle(n).opacity)).toBe('1');
  await page.emulateMedia({reducedMotion:'reduce'});
  session.home.reason='更新后的工作提示';
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await expect(title).toBeVisible();
});

test('native disclosure and floating more actions stay readable after opening',async({page})=>{
  await mockStaff(page);await loginStaff(page);
  await page.evaluate(()=>{
    const host=document.querySelector('.workspace-route:not([hidden])');
    host.insertAdjacentHTML('beforeend','<details id="motion-disclosure"><summary>展开测试说明</summary><p>完整可读的说明</p></details><details class="workspace-more-actions" id="motion-actions"><summary>测试更多操作</summary><div class="workspace-more-action-list"><button>测试操作按钮</button></div></details>');
  });
  await page.getByText('展开测试说明',{exact:true}).click();
  await expect(page.getByText('完整可读的说明',{exact:true})).toBeVisible();
  await page.getByText('测试更多操作',{exact:true}).click();
  const action=page.getByRole('button',{name:'测试操作按钮',exact:true});
  await expect(action).toBeVisible();await action.click();
});

test('distribution bars update their native value immediately and animate only the visual fill',async({page})=>{
  await mockStaff(page);
  let count=2;
  await page.route('**/api/stats/summary*',r=>r.fulfill({json:{total:10,completed:2,cancelled:0,expired:0,repairSuccessRate:50,daily:{},faults:{'蓝屏':count,'不开机':10},campuses:{'南湖':10},technicians:{}}}));
  await loginStaff(page);await staffPage(page,'统计分析');
  const meter=page.getByRole('meter',{name:'蓝屏 2 条',exact:true});await expect(meter).toHaveAttribute('value','2');
  count=7;await page.getByRole('button',{name:'刷新统计',exact:true}).click();
  await expect(page.getByRole('meter',{name:'蓝屏 7 条',exact:true})).toHaveAttribute('value','7');
  await expect.poll(()=>page.locator('.report-distribution li').filter({has:page.getByRole('meter',{name:'蓝屏 7 条',exact:true})}).locator('[data-motion-value="bar"]').evaluate(n=>getComputedStyle(n).transform)).toMatch(/matrix\(0\.7/);
});

test('title-bearing wrappers stay fixed while their inner sections enter',async({page})=>{
  await page.setContent('<main><section class="roster-workflow"><header class="workspace-heading"><h1>维修排班管理</h1></header><article class="react-card"><p>本周收集</p></article></section></main>');
  await page.addScriptTag({content:motion});
  const geometry=await page.locator('h1').boundingBox();
  await page.evaluate(()=>{window.stopMotion=window.observeDataMotion(document.querySelector('main'),{enterInitial:true});});
  expect(await page.locator('h1').boundingBox()).toEqual(geometry);
  expect(await page.evaluate(()=>document.getAnimations().some(a=>a.effect?.target?.matches('.roster-workflow')))).toBe(false);
  expect(await page.evaluate(()=>document.getAnimations().some(a=>a.effect?.target?.matches('.react-card')))).toBe(true);
  await expect.poll(()=>page.evaluate(()=>document.getAnimations().length)).toBe(0);
  await page.evaluate(()=>document.querySelector('article').insertAdjacentHTML('afterend','<article class="react-card">自动排班结果</article>'));
  await expect(page.getByText('自动排班结果',{exact:true})).toBeVisible();
  expect(await page.locator('h1').boundingBox()).toEqual(geometry);
});

for (const width of [390,1440]) test(`roles and appointment rows reveal downward without filter fly-in at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000});
  await mockStaff(page);
  await page.addInitScript(()=>{
    window.listMotions=[];
    const original=Element.prototype.animate;
    Element.prototype.animate=function(frames,options){
      if(this.closest('.permissions-workspace,.records-table-wrap,.account-list'))window.listMotions.push({tag:this.tagName,classes:this.className,item:this.hasAttribute('data-motion-item'),frames,delay:options?.delay||0});
      return original.call(this,frames,options);
    };
  });
  const roles=Array.from({length:10},(_,i)=>({id:`role-test-${i}`,name:`测试角色${i}`,code:`test-${i}`,description:'用于验证列表展开',revision:1,grants:[],actions:{edit:true}}));
  const permissions=[...Array.from({length:10},(_,i)=>({code:`settings.test${i}`,name:`配置功能${i}`,scopeKinds:[],conditionKinds:[]})),{code:'repair.start',name:'开始维修',scopeKinds:[],conditionKinds:[]}];
  await page.route('**/api/users',r=>r.fulfill({json:{items:roles.map((v,i)=>({account:`202600${i}`,name:`测试账号${i}`,role:'staff',homeCampus:'南湖',authorizedCampuses:['南湖'],status:'enabled',actions:{edit:true}}))}}));
  await page.route('**/api/roles',r=>r.fulfill({json:{items:roles}}));
  await page.route('**/api/permissions',r=>r.fulfill({json:{items:permissions}}));
  await page.route('**/api/appointments?*',r=>r.fulfill({json:{items:Array.from({length:10},(_,i)=>({id:`reserve020261024-${String(i).padStart(2,'0')}`,name:`测试客户${i}`,date:'2026-10-24',timeSlot:'14:00-14:30',status:'booked',campus:'南湖',deviceModel:'ThinkPad'}))}}));
  await loginStaff(page);await staffPage(page,'授权管理');
  await expect(page.locator('[aria-label="角色列表"] > button')).toHaveCount(10);
  await expect(page.locator('.react-permission-item')).toHaveCount(11);
  const roleMotion=await page.evaluate(()=>window.listMotions.filter(v=>v.tag==='BUTTON'&&v.item));
  expect(roleMotion.length).toBeGreaterThan(0);
  expect(roleMotion.every(v=>v.frames[0].clipPath==='inset(0 0 100% 0)'&&!v.frames.some(f=>f.transform))).toBe(true);
  expect(roleMotion.map(v=>v.delay)).toEqual(roleMotion.map(v=>v.delay).sort((a,b)=>a-b));
  await expect.poll(()=>page.evaluate(()=>document.querySelector('.permissions-workspace').getAnimations({subtree:true}).length)).toBe(0);
  await page.evaluate(()=>{window.listMotions=[];});
  await page.getByRole('button',{name:'接待与维修',exact:true}).click();
  await expect(page.locator('.react-permission-item')).toHaveCount(1);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  expect(await page.evaluate(()=>window.listMotions.filter(v=>v.item||v.classes==='react-card').some(v=>v.frames.some(f=>f.transform&&f.transform!=='none')))).toBe(false);
  await page.getByRole('button',{name:'全部功能',exact:true}).click();
  await expect(page.locator('.react-permission-item')).toHaveCount(11);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.evaluate(()=>{window.listMotions=[];});
  await staffPage(page,'预约记录');
  await expect(page.locator('.records-table tbody tr')).toHaveCount(10);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const recordsMotion=await page.evaluate(()=>window.listMotions.filter(v=>v.tag==='TR'));
  expect(recordsMotion.length).toBeGreaterThan(0);
  expect(recordsMotion.every(v=>v.frames[0].clipPath==='inset(0 0 100% 0)'&&!v.frames.some(f=>f.transform))).toBe(true);
  expect(recordsMotion.map(v=>v.delay)).toEqual(recordsMotion.map(v=>v.delay).sort((a,b)=>a-b));
  await page.evaluate(()=>{window.listMotions=[];});
  await staffPage(page,'账号管理');
  await expect(page.locator('.account-row')).toHaveCount(10);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const accountsMotion=await page.evaluate(()=>window.listMotions.filter(v=>v.classes.includes('account-row')));
  expect(accountsMotion.length).toBeGreaterThan(0);
  expect(accountsMotion.every(v=>v.frames[0].clipPath==='inset(0 0 100% 0)'&&!v.frames.some(f=>f.transform))).toBe(true);
});

test('an unrelated response does not cut an in-progress row reveal short',async({page})=>{
  await page.setContent('<main><p id="count" data-motion-value="text">读取概况</p><section class="account-list"></section></main>');
  await page.addScriptTag({content:motion});
  const continuity=await page.evaluate(async()=>{
    window.stopMotion=window.observeDataMotion(document.querySelector('main'));
    document.querySelector('section').innerHTML='<article data-motion-item="row"><span data-motion-value="text">维修工作人员</span></article>';
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const row=document.querySelector('article'),animation=row.getAnimations()[0];
    document.querySelector('#count').textContent='概况已更新';
    row.querySelector('span').textContent='负责人身份已确认';
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    return {same:row.getAnimations()[0]===animation,state:animation.playState,nested:row.querySelector('span').getAnimations().length,text:row.textContent};
  });
  expect(continuity.same).toBe(true);expect(continuity.state).toBe('running');expect(continuity.nested).toBe(0);expect(continuity.text).toBe('负责人身份已确认');
  await expect.poll(()=>page.evaluate(()=>document.getAnimations().length)).toBe(0);
});

test('a static title wrapper does not block a nested content expansion',async({page})=>{
  await page.setContent('<main><div class="roster-workflow"><header class="workspace-heading"><h1>固定标题</h1></header><article class="react-card"><div style="height:60px">已加载内容</div></article></div></main>');
  await page.addScriptTag({content:motion});
  const title=await page.locator('h1').boundingBox();
  const result=await page.evaluate(async()=>{
    window.stopMotion=window.observeDataMotion(document.querySelector('main'));
    const card=document.querySelector('article'),height=card.getBoundingClientRect().height;
    card.insertAdjacentHTML('beforeend','<p style="height:80px;margin:0">异步补充的信息</p>');
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    return {before:height,current:card.getBoundingClientRect().height,own:card.getAnimations().length,outer:document.querySelector('.roster-workflow').getAnimations().length};
  });
  expect(result.own).toBe(1);expect(result.outer).toBe(0);expect(result.current).toBeLessThan(result.before+80);
  expect(await page.locator('h1').boundingBox()).toEqual(title);
  await expect.poll(()=>page.locator('article').evaluate(n=>n.getAnimations().length)).toBe(0);
  expect((await page.locator('article').boundingBox()).height).toBe(result.before+80);
});

test('returning to a cached page reveals its content and retains filters and nodes',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});
  await mockStaff(page);
  await page.addInitScript(()=>{
    window.accountEntries=0;
    const original=Element.prototype.animate;
    Element.prototype.animate=function(frames,options){if(this.classList.contains('account-row')&&frames[0].clipPath)window.accountEntries++;return original.call(this,frames,options);};
  });
  await page.route('**/api/users',r=>r.fulfill({json:{items:[{account:'20261001',name:'测试人员',role:'staff',homeCampus:'南湖',authorizedCampuses:['南湖'],status:'enabled',actions:{edit:true}}]}}));
  await loginStaff(page);await staffPage(page,'账号管理');
  const card=page.locator('.account-row');await expect(card).toHaveCount(1);
  await card.evaluate(n=>{window.cachedAccount=n;});
  await page.getByPlaceholder('姓名、学号或校区').fill('测试');
  await expect.poll(()=>card.evaluate(n=>n.getAnimations().length)).toBe(0);
  const initial=await page.evaluate(()=>window.accountEntries),title=await page.getByRole('heading',{name:'账号管理',exact:true}).boundingBox();
  await staffPage(page,'统计分析');await expect(page.getByRole('heading',{name:'统计分析',exact:true})).toBeVisible();
  await staffPage(page,'账号管理');await expect(card).toBeVisible();
  expect(await card.evaluate(n=>n===window.cachedAccount)).toBe(true);
  await expect(page.getByPlaceholder('姓名、学号或校区')).toHaveValue('测试');
  expect(await page.evaluate(()=>window.accountEntries)).toBeGreaterThan(initial);
  expect(await page.getByRole('heading',{name:'账号管理',exact:true}).boundingBox()).toEqual(title);
  const duration=await page.locator('.workspace-section-nav button').first().evaluate(n=>getComputedStyle(n).transitionDuration);
  expect(duration.split(',').some(v=>parseFloat(v)>0)).toBe(true);
  await page.emulateMedia({reducedMotion:'reduce'});
  expect(await page.locator('.workspace-section-nav button').first().evaluate(n=>getComputedStyle(n).transitionDuration)).toBe('0s');
});
